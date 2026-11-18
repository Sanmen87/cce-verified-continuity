const syntheticSecret = 'sk-' + 'x'.repeat(36);
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { LocalEmbeddingProvider, loopbackUrl } from '../packages/core/src/native/embeddings.ts';
test('local embeddings enforce loopback, exact Unicode preprocessing, response integrity and defensive query cache', async t => {
  for (const url of ['https://127.0.0.1', 'http://example.com', 'http://user:pass@localhost', 'file:///tmp/a', 'http://localhost?token=secret']) assert.throws(() => loopbackUrl(url));
  let calls = 0; const batches: string[][] = []; let invalid = false;
  const server = createServer(async (req,res) => {
    let text = ''; for await (const data of req) text += data.toString();
    const body = JSON.parse(text) as { input: string[] }; batches.push(body.input); calls++;
    assert.equal(req.url, '/v1/embeddings');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: invalid ? [1, 2] : [1, 0, 0] })) }));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const provider = new LocalEmbeddingProvider({ endpoint: `http://127.0.0.1:${address.port}/v1`, model:'fixture', revision:'sha-v1', dimension:3 });
  const input = '😀'.repeat(3001); const first = await provider.embed([input],'query');
  assert.equal(Array.from(batches[0]![0]!).length,3000); assert.equal(batches[0]![0], '😀'.repeat(3000));
  first[0]![0] = 99; assert.equal((await provider.embed([input],'query'))[0]![0],1); assert.equal(calls,1);
  invalid = true; await assert.rejects(provider.embed(['another'],'document'),/dimension/i);
  await assert.rejects(provider.embed(['api_key = "' + syntheticSecret + '"'],'document'),/secret/i);
  assert.equal(calls,2);
});
