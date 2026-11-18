// Elara storage/fts_store.py, 75071156e08a145fab17c8ce30bb5f418286f434.
// MIT, Copyright (c) 2026 Fazle Elahee; see THIRD_PARTY_NOTICES.md.
import type { DatabaseSync } from 'node:sqlite';
import type { CodeChunk, KeywordIndex, RankedId } from './contracts.ts';
import { escapeFts } from './ranking.ts';
export class SqliteKeywordIndex implements KeywordIndex {
  readonly backend = 'sqlite-fts5-unicode61-bm25'; private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS native_fts USING fts5(id UNINDEXED,content,file_path,language,chunk_type)'); }
  replace(chunks: readonly CodeChunk[]): void {
    const remove = this.db.prepare('DELETE FROM native_fts WHERE id=?'); const insert = this.db.prepare('INSERT INTO native_fts VALUES(?,?,?,?,?)');
    for (const chunk of chunks) { remove.run(chunk.id); insert.run(chunk.id, Array.from(chunk.text).slice(0, 5000).join(''), chunk.path, chunk.language, chunk.kind === 'method' ? 'function' : chunk.kind); }
  }
  remove(ids: readonly string[]): void { const statement = this.db.prepare('DELETE FROM native_fts WHERE id=?'); for (const id of ids) statement.run(id); }
  search(query: string, topK: number): RankedId[] {
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 10000) throw new Error('Invalid keyword topK');
    const match = escapeFts(query); if (!match) return [];
    // FTS5 rank is negative BM25 (smaller is better). Preserve its raw score.
    return this.db.prepare('SELECT id,rank FROM native_fts WHERE native_fts MATCH ? ORDER BY rank,id LIMIT ?').all(match, topK).map(row => ({ id: String(row.id), score: Number(row.rank) }));
  }
}
