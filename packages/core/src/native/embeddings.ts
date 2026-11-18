// Local preprocessing follows Elara OllamaBackend (3000 code points, no prefix):
// indexer/embedder.py @ 75071156e08a145fab17c8ce30bb5f418286f434, MIT.
import { sha256 } from '../workspace.ts';
import type { EmbeddingProvider } from './contracts.ts';
import { validateVector } from './vectors.ts';
import { assertNoSecrets } from './secrets.ts';
export interface LocalEmbeddingOptions {
  endpoint: string; model: string; dimension: number; revision: string;
  protocol?: 'openai' | 'ollama'; batchSize?: number; timeoutMs?: number;
}
export function loopbackUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Only explicit unauthenticated loopback HTTP is allowed');
  return url;
}
async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(); const buffers: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error('Embedding response exceeds limit'); } buffers.push(result.value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(buffers).toString('utf8');
}
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id: string; readonly dimension: number; readonly preprocessing = 'elara-raw-3000-codepoints-v1';
  readonly options: LocalEmbeddingOptions; private endpoint: URL; private queries = new Map<string, Float32Array>();
  constructor(options: LocalEmbeddingOptions) {
    this.endpoint = loopbackUrl(options.endpoint);
    if (!options.model.trim() || !options.revision.trim() || !Number.isSafeInteger(options.dimension) || options.dimension < 1 || options.dimension > 65536) throw new Error('Explicit embedding model/revision/dimension required');
    this.dimension = options.dimension; this.options = { ...options };
    this.id = sha256(JSON.stringify([options.model, options.revision, options.dimension, this.preprocessing]));
  }
  async embed(texts: readonly string[], purpose: 'document' | 'query'): Promise<Float32Array[]> {
    if (texts.length > 30000) throw new Error('Embedding batch count exceeds limit');
    for (const text of texts) { assertNoSecrets(text); if (!text.trim()) throw new Error('Empty embedding input'); }
    if (purpose === 'query' && texts.length === 1) {
      const key = sha256(this.id + ':' + texts[0]); const cached = this.queries.get(key);
      if (cached) { this.queries.delete(key); this.queries.set(key, cached); return [new Float32Array(cached)]; }
    }
    const out: Float32Array[] = []; const batchSize = this.options.batchSize ?? 64;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error('Invalid embedding batch size');
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map(text => Array.from(text).slice(0, 3000).join(''));
      out.push(...await this.request(batch));
    }
    if (purpose === 'query' && texts.length === 1) {
      const key = sha256(this.id + ':' + texts[0]); this.queries.set(key, new Float32Array(out[0]!));
      if (this.queries.size > 256) this.queries.delete(this.queries.keys().next().value!);
    }
    return out;
  }
  private async request(input: string[]): Promise<Float32Array[]> {
    const protocol = this.options.protocol ?? 'openai';
    const endpoint = this.endpoint.toString().replace(/\/$/, '') + (protocol === 'ollama' ? '/api/embed' : '/embeddings');
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 60000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.options.model, input }) });
    const body = await boundedText(response, response.ok ? 8 * 1024 * 1024 : 16384);
    if (!response.ok) {
      if (response.status === 400 && /context length/i.test(body)) {
        if (input.length > 1) { const rows: Float32Array[] = []; for (const text of input) rows.push(...await this.request([text])); return rows; }
        const chars = Array.from(input[0]!); if (chars.length > 1) return this.request([chars.slice(0, Math.floor(chars.length / 2)).join('')]);
      }
      throw new Error(`Local embedding request failed (HTTP ${response.status}); no remote fallback`);
    }
    const parsed = JSON.parse(body) as { embeddings?: unknown[]; data?: Array<{ index?: number; embedding?: unknown }> };
    const vectors = protocol === 'ollama' ? parsed.embeddings : parsed.data?.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(row => row.embedding);
    if (!Array.isArray(vectors) || vectors.length !== input.length) throw new Error('Embedding response count mismatch');
    return vectors.map(vector => {
      if (!Array.isArray(vector) || !vector.every(v => typeof v === 'number')) throw new Error('Invalid embedding data');
      return validateVector(vector, this.dimension);
    });
  }
}
