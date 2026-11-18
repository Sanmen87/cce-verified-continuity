// Adapted from Elara 75071156e08a145fab17c8ce30bb5f418286f434:
// retrieval/{retriever,query_parser,confidence}.py and storage/fts_store.py.
// Copyright (c) 2026 Fazle Elahee, MIT; see THIRD_PARTY_NOTICES.md.
import type { CodeChunk, RankedId, RetrievalDebug } from './contracts.ts';
const ftsStops = new Set('a an and are as at be by can do does for from how i in is it of on or that the this to was we what when where which who why will with you not'.split(' '));
const queryStops = new Set('the a an is are was were do does did what how why where when who which in on at to for of with about me my we our it its i you tell give'.split(' '));
const prefixes = new Set('show find get set fetch save validate create update delete'.split(' '));
export function escapeFts(query: string): string {
  const tokens = query.split(/\s+/u).filter(t => /[\p{L}\p{N}]/u.test(t));
  const kept = tokens.filter(t => !ftsStops.has(t.toLowerCase()));
  return (kept.length ? kept : tokens).map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
}
export interface ParsedQuery { intent: string; keywords: string[]; fileHints: string[] }
export function parseQuery(query: string): ParsedQuery {
  const text = query.toLowerCase();
  const decision = [/what did we decide/, /decision about/, /why did we/, /last session/, /previous discussion/, /agreed on/];
  const architecture = [/how is .+ structured/, /architecture/, /module.+structure/, /component.+design/, /how does .+ work/, /overview of/, /explain the .+ system/];
  const code = [/find .+ function/, /show me .+ class/, /where is .+ defined/, /implementation of/, /\.py|\.js|\.ts/, /function|class|method|def |import /];
  const intent = decision.some(p => p.test(text)) ? 'decision_recall' : architecture.some(p => p.test(text)) ? 'architecture' : code.some(p => p.test(text)) ? 'code_lookup' : 'general';
  const identifiers = query.match(/[A-Z][a-zA-Z0-9]+/g) ?? [];
  const words = (query.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []).filter(w => w.length > 2 && !queryStops.has(w.toLowerCase()) && (intent === 'code_lookup' || !prefixes.has(w.toLowerCase())));
  return { intent, keywords: [...new Set([...identifiers, ...words])], fileHints: query.match(/[a-zA-Z0-9_./-]+\.[a-zA-Z]{1,10}/g) ?? [] };
}
export function reciprocalRankFusion(components: ReadonlyArray<{ entries: readonly RankedId[]; weight: number }>, k = 60): Map<string, number> {
  if (!Number.isFinite(k) || k <= 0) throw new Error('Invalid RRF constant');
  const scores = new Map<string, number>();
  for (const component of components) {
    if (!Number.isFinite(component.weight) || component.weight < 0) throw new Error('Invalid RRF weight');
    const seen = new Set<string>();
    component.entries.forEach((entry, rank) => {
      if (seen.has(entry.id)) return; seen.add(entry.id);
      scores.set(entry.id, (scores.get(entry.id) ?? 0) + component.weight / (k + rank));
    });
  }
  return scores;
}
export function confidence(vectorDistance: number, keywordDistance: number, modifiedTs?: number, now = Date.now() / 1000): number {
  const recency = modifiedTs === undefined ? 0.5 : now <= modifiedTs ? 1 : 0.5 ** ((now - modifiedTs) / 604800);
  return Math.min(1, Math.max(0, 0.5 * Math.max(0, 1 - vectorDistance) + 0.4 * Math.max(0, 1 - keywordDistance / 5) + 0.1 * recency));
}
export function rankHybrid(chunks: readonly CodeChunk[], query: string, vector: readonly RankedId[], keyword: readonly RankedId[],
  options: { topK: number; threshold?: number; now?: number; literal?: readonly RankedId[] }): Array<{ chunk: CodeChunk; debug: RetrievalDebug }> {
  const scored=scoreHybridCandidates(chunks,query,vector,keyword,options);
  return selectHybrid(scored,options.topK,options.threshold??0);
}
export function scoreHybridCandidates(chunks: readonly CodeChunk[], query:string, vector:readonly RankedId[], keyword:readonly RankedId[],
  options:{topK:number;now?:number;literal?:readonly RankedId[];pathPenalty?:boolean}):Array<{chunk:CodeChunk;debug:RetrievalDebug}>{
  if (!Number.isSafeInteger(options.topK) || options.topK < 1 || options.topK > 100) throw new Error('Invalid topK');
  const parsed = parseQuery(query); const literal = options.literal ?? [];
  const rrf = reciprocalRankFusion([{ entries: vector, weight: 1 }, { entries: keyword, weight: parsed.intent === 'code_lookup' ? 1.5 : 1 }, { entries: literal, weight: 1 }]);
  const ranks = (rows: readonly RankedId[]) => new Map(rows.map((r, i) => [r.id, i]));
  const vr = ranks(vector), kr = ranks(keyword), lr = ranks(literal);
  const distances = new Map(vector.map(r => [r.id, r.distance ?? 2]));
  const worst = vector.length ? Math.max(...vector.map(r => r.distance ?? 2)) : 2;
  const best = Math.max(0, ...rrf.values());
  const scored = chunks.filter(c => rrf.has(c.id)).map(chunk => {
    // Elara's vector store retains 5000 code points; preserve that scoring view.
    const content = Array.from(chunk.text).slice(0, 5000).join('');
    const keywordDistance = parsed.fileHints.some(h => chunk.path.includes(h)) || parsed.keywords.some(w => content.toLowerCase().includes(w.toLowerCase())) ? 0 : 2;
    const modified = typeof chunk.metadata.modified_ts === 'number' ? chunk.metadata.modified_ts : undefined;
    const conf = confidence(Math.min(1, Math.max(0, (distances.get(chunk.id) ?? worst) / 2)), keywordDistance, modified, options.now);
    let score = 0.5 * conf + 0.5 * (best ? rrf.get(chunk.id)! / best : 0);
    if (options.pathPenalty !== false && !chunk.path.startsWith('git:') && ['tests/', 'test_', 'docs/', 'spec', 'plan'].some(marker => chunk.path.toLowerCase().includes(marker))) score *= 0.8;
    return { chunk, debug: { literalRank: lr.get(chunk.id) ?? null, keywordRank: kr.get(chunk.id) ?? null, vectorRank: vr.get(chunk.id) ?? null,
      literalScore: literal.find(r => r.id === chunk.id)?.score ?? null, keywordScore: keyword.find(r => r.id === chunk.id)?.score ?? null,
      vectorDistance: distances.get(chunk.id) ?? null,
      rrf: rrf.get(chunk.id)!, confidence: conf, final: score, graph: false } };
  }).sort((a, b) => b.debug.final - a.debug.final || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine || a.chunk.id.localeCompare(b.chunk.id));
  return scored;
}
export function selectHybrid(scored:Array<{chunk:CodeChunk;debug:RetrievalDebug}>,topK:number,threshold=0):Array<{chunk:CodeChunk;debug:RetrievalDebug}>{
  const deduped: typeof scored = [];
  for (const entry of scored) {
    if (deduped.some(other => other.chunk.path === entry.chunk.path &&
      Math.min(other.chunk.endLine, entry.chunk.endLine) - Math.max(other.chunk.startLine, entry.chunk.startLine) + 1 >
      0.5 * Math.min(other.chunk.endLine - other.chunk.startLine + 1, entry.chunk.endLine - entry.chunk.startLine + 1))) continue;
    deduped.push(entry);
  }
  const filtered = deduped.filter(r => r.debug.final >= threshold);
  const eligible = filtered.length ? filtered : deduped.slice(0, 1); // Elara top-1 guarantee.
  const counts = new Map<string, number>(); const selected: typeof scored = [];
  for (const row of eligible) {
    if ((counts.get(row.chunk.path) ?? 0) >= 3) continue;
    counts.set(row.chunk.path, (counts.get(row.chunk.path) ?? 0) + 1); selected.push(row);
    if (selected.length >= topK) break;
  }
  return selected;
}
/** Additional, explicitly non-equivalent code-token BM25. Elara uses unicode61 FTS5. */
export function codeTokens(text: string): string[] {
  return (text.normalize('NFKC').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}
export function bm25(documents: ReadonlyMap<string, string>, query: string, k1 = 1.2, b = 0.75): RankedId[] {
  if (!Number.isFinite(k1) || k1 <= 0 || !Number.isFinite(b) || b < 0 || b > 1) throw new Error('Invalid BM25 parameters');
  const terms = [...new Set(codeTokens(query))];
  const df = new Map(terms.map(term => [term, 0]));
  const docs = [...documents].map(([id, text]) => {
    const tokens = codeTokens(text), frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const term of terms) if (frequencies.has(term)) df.set(term, df.get(term)! + 1);
    return { id, length: tokens.length, frequencies };
  });
  const avg = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  return docs.map(doc => ({ id: doc.id, score: terms.reduce((sum, term) => {
    const frequency = doc.frequencies.get(term) ?? 0, documentFrequency = df.get(term)!;
    const idf = Math.log(1 + (docs.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
    return sum + (frequency ? idf * frequency * (k1 + 1) / (frequency + k1 * (1 - b + b * doc.length / (avg || 1))) : 0);
  }, 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
