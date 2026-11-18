import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';
import { reciprocalRankFusion, confidence, codeTokens, bm25, escapeFts, rankHybrid } from '../packages/core/src/native/ranking.ts';
import { SqliteVectorIndex, ExactVectorIndex } from '../packages/core/src/native/vectors.ts';
import { SqliteKeywordIndex } from '../packages/core/src/native/keyword.ts';
import { TextLanguageAdapter } from '../packages/core/src/native/registry.ts';
import { sha256 } from '../packages/core/src/workspace.ts';
test('Elara RRF uses zero-based ranks, weights, missing-source union and duplicate protection', () => {
  const scores = reciprocalRankFusion([{ entries: [{ id: 'a', score: 0 }, { id: 'b', score: 0 }], weight: 1 },
    { entries: [{ id: 'b', score: 0 }, { id: 'a', score: 0 }, { id: 'a', score: 0 }], weight: 1.5 }]);
  assert.ok(Math.abs(scores.get('a')! - (1 / 60 + 1.5 / 61)) < 1e-12);
  assert.equal(reciprocalRankFusion([]).size, 0);
  assert.throws(() => reciprocalRankFusion([{ entries: [], weight: -1 }]), /weight/);
  assert.equal(confidence(0, 0), 0.9500000000000001);
  assert.equal(confidence(0, 0, 10, 10), 1);
  assert.ok(Math.abs(confidence(0, 0, 10, 10 + 604800) - 0.95) < 1e-12);
});
test('code-token BM25 is explicitly separate from Elara FTS5 and handles identifiers deterministically', () => {
  assert.deepEqual(codeTokens('getUserById snake_case HTTPRequest'), ['get', 'user', 'by', 'id', 'snake', 'case', 'http', 'request']);
  const rows = bm25(new Map([['a', 'save'], ['b', 'other']]), 'save');
  assert.equal(rows[0]?.id, 'a'); assert.ok(Math.abs(rows[0]!.score - Math.log(2)) < 1e-12);
  assert.equal(bm25(new Map(), 'save').length, 0);
  assert.equal(escapeFts('where is delete_by_files'), '"delete_by_files"');
});
test('real sqlite-vec and exact Float32 cosine agree, including filtered search and deletion', t => {
  const db = new DatabaseSync(':memory:', { allowExtension: true }); t.after(() => db.close()); load(db);
  const vector = new SqliteVectorIndex(db, 3); const exact = new ExactVectorIndex(db, 3);
  const entries = [{ id: 'b', vector: new Float32Array([0, 1, 0]) }, { id: 'a', vector: new Float32Array([1, 0, 0]) }, { id: 'c', vector: new Float32Array([-1, 0, 0]) }];
  vector.replace(entries); exact.replace(entries); const query = new Float32Array([1, 0, 0]);
  const actual = vector.search(query, 3), expected = exact.search(query, 3);
  assert.deepEqual(actual.map(r => r.id), expected.map(r => r.id));
  actual.forEach((row, i) => assert.ok(Math.abs(row.distance! - expected[i]!.distance!) < 1e-6));
  assert.equal(vector.search(query, 1, new Set(['b']))[0]?.id, 'b');
  vector.remove(['a']); assert.equal(vector.search(query, 2)[0]?.id, 'b');
  vector.replace(Array.from({ length: 100 }, (_, i) => ({ id: `tie-${String(99 - i).padStart(3, '0')}`, vector: query })));
  assert.deepEqual(vector.search(query, 2).map(r => r.id), ['tie-000', 'tie-001']);
  assert.equal(vector.search(query,4096).length,102, 'requests beyond vec0 k cap use the exact scalar fallback');
  assert.throws(() => vector.search(new Float32Array([1]), 1), /dimension/);
  assert.throws(() => exact.search(new Float32Array([0, 0, 0]), 1), /Zero/);
});
test('FTS safe quoting, confidence threshold, empty vectors and top-1 guarantee are functional', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const keyword = new SqliteKeywordIndex(db);
  const parser = new TextLanguageAdapter();
  const a = (await parser.parse('alpha.py', 'def save_ledger(): pass', sha256('def save_ledger(): pass'))).chunks[0]!;
  const b = (await parser.parse('beta.py', 'unrelated notes', sha256('unrelated notes'))).chunks[0]!;
  keyword.replace([a, b]); const rows = keyword.search('where is save_ledger', 5);
  assert.equal(rows[0]?.id, a.id); assert.equal(keyword.search('" NEAR()', 5).length, 0);
  const selected = rankHybrid([a, b], 'save_ledger', [], rows, { topK: 5, threshold: 1 });
  assert.equal(selected.length, 1); assert.ok(selected[0]!.debug.confidence < 0.6);
  assert.equal(rankHybrid([a, b], 'nothing', [], [], { topK: 5 }).length, 0);
  keyword.remove([a.id]); assert.equal(keyword.search('save_ledger', 5).length, 0);
});
