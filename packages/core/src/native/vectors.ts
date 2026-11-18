import type { DatabaseSync } from 'node:sqlite';
import type { VectorIndex, RankedId } from './contracts.ts';
export function validateVector(vector: ArrayLike<number>, dimension: number): Float32Array {
  if (vector.length !== dimension || dimension < 1 || dimension > 65536) throw new Error('Embedding dimension mismatch');
  const result = Float32Array.from(vector); let norm = 0;
  for (const value of result) { if (!Number.isFinite(value)) throw new Error('Non-finite embedding'); norm += value * value; }
  if (!norm) throw new Error('Zero embedding is not searchable'); return result;
}
export function packVector(vector: Float32Array): Buffer {
  const buffer = Buffer.alloc(vector.length * 4); vector.forEach((n, i) => buffer.writeFloatLE(n, i * 4)); return buffer;
}
export function unpackVector(blob: Uint8Array, dimension: number): Float32Array {
  if (blob.byteLength !== dimension * 4) throw new Error('Corrupt embedding blob');
  const buffer = Buffer.from(blob); return validateVector(Array.from({ length: dimension }, (_, i) => buffer.readFloatLE(i * 4)), dimension);
}
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) throw new Error('Incompatible vectors');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
  if (!aa || !bb) throw new Error('Zero vector');
  return Math.min(2, Math.max(0, 1 - dot / Math.sqrt(aa * bb)));
}
function count(topK: number): void { if (!Number.isSafeInteger(topK) || topK < 1 || topK > 10000) throw new Error('Invalid vector topK'); }
export class SqliteVectorIndex implements VectorIndex {
  readonly backend = 'sqlite-vec'; private db: DatabaseSync; readonly dimension: number;
  constructor(db: DatabaseSync, dimension: number) {
    this.db = db; this.dimension = dimension;
    if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 65536) throw new Error('Invalid embedding dimension');
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS native_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[${dimension}] distance_metric=cosine)`);
  }
  replace(entries: ReadonlyArray<{ id: string; vector: Float32Array }>): void {
    const remove = this.db.prepare('DELETE FROM native_vec WHERE id=?'); const insert = this.db.prepare('INSERT INTO native_vec(id,embedding) VALUES(?,?)');
    for (const row of entries) { const vector = validateVector(row.vector, this.dimension); remove.run(row.id); insert.run(row.id, packVector(vector)); }
  }
  remove(ids: readonly string[]): void { const statement = this.db.prepare('DELETE FROM native_vec WHERE id=?'); for (const id of ids) statement.run(id); }
  search(vector: Float32Array, topK: number, allowed?: ReadonlySet<string>): RankedId[] {
    count(topK); const checked = validateVector(vector, this.dimension);
    if (allowed) {
      if (allowed.size > 10000) throw new Error('Filtered vector lookup limit exceeded');
      const get = this.db.prepare('SELECT embedding FROM native_vec WHERE id=?'); const rows: RankedId[] = [];
      for (const id of allowed) { const row = get.get(id); if (row?.embedding instanceof Uint8Array) { const distance = cosineDistance(checked, unpackVector(row.embedding, this.dimension)); rows.push({ id, score: 1 - distance, distance }); } }
      return rows.sort((a, b) => a.distance! - b.distance! || a.id.localeCompare(b.id)).slice(0, topK);
    }
    // vec0 rejects secondary ORDER BY and caps k at 4096. Fetch past the
    // boundary until ALL tied candidates are present, then sort by stable id.
    // A scalar scan is needed only for >4095 results or a huge boundary tie.
    if (topK < 4096) {
      let requested = Math.min(4096, topK + 1);
      const knn = this.db.prepare('SELECT id,distance FROM native_vec WHERE embedding MATCH ? AND k=? ORDER BY distance');
      while (true) {
        const rows = knn.all(packVector(checked), requested).map(row => ({ id: String(row.id), distance: Number(row.distance), score: 1 - Number(row.distance) }))
          .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
        if (rows.length < requested || rows.length <= topK || rows[topK - 1]!.distance < rows.at(-1)!.distance) return rows.slice(0, topK);
        if (requested === 4096) break;
        requested = Math.min(4096, requested * 2);
      }
    }
    return this.db.prepare('SELECT id,vec_distance_cosine(embedding,?) AS distance FROM native_vec ORDER BY distance,id LIMIT ?')
      .all(packVector(checked), topK).map(row => ({ id: String(row.id), distance: Number(row.distance), score: 1 - Number(row.distance) }));
  }
}
export class ExactVectorIndex implements VectorIndex {
  readonly backend = 'exact-float32-cosine'; private db: DatabaseSync; readonly dimension: number;
  constructor(db: DatabaseSync, dimension: number) { this.db = db; this.dimension = dimension; db.exec('CREATE TABLE IF NOT EXISTS native_vec_exact(id TEXT PRIMARY KEY,embedding BLOB NOT NULL)'); }
  replace(entries: ReadonlyArray<{ id: string; vector: Float32Array }>): void {
    const insert = this.db.prepare('INSERT OR REPLACE INTO native_vec_exact VALUES(?,?)');
    for (const row of entries) insert.run(row.id, packVector(validateVector(row.vector, this.dimension)));
  }
  remove(ids: readonly string[]): void { const statement = this.db.prepare('DELETE FROM native_vec_exact WHERE id=?'); for (const id of ids) statement.run(id); }
  search(vector: Float32Array, topK: number, allowed?: ReadonlySet<string>): RankedId[] {
    count(topK); const checked = validateVector(vector, this.dimension);
    return this.db.prepare('SELECT id,embedding FROM native_vec_exact').all().filter(row => !allowed || allowed.has(String(row.id))).map(row => {
      const distance = cosineDistance(checked, unpackVector(row.embedding as Uint8Array, this.dimension));
      return { id: String(row.id), score: 1 - distance, distance };
    }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, topK);
  }
}
