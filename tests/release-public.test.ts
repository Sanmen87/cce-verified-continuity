import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ContextEngine, parseConfig } from '../packages/core/src/index.ts';
import { fixture } from './helpers.ts';

test('public API opens in observe-only, retrieves fresh source and invalidates source after external edits', async t => {
 const root = await fixture(t), engine = await ContextEngine.open(root); t.after(() => engine.close());
 assert.equal(engine.config.mode, 'observe-only'); assert.equal(engine.config.lifecycle.enabled, false);
 assert.equal(engine.config.hybrid.enableVector, false);
 const result = await engine.searchCode('Deal'); assert.ok(result.hits.length);
 await writeFile(path.join(root, 'crm/models.py'), 'class Deal:\n    changed = True\n');
 const context = await engine.buildContext({ task: 'Inspect Deal', hits: result.hits });
 assert.ok(context.omitted.some(item => /stale/.test(item.reason)));
});

test('alpha configuration keeps model endpoints and compression helpers opt-in', () => {
 const config = parseConfig();
 assert.equal(config.hybrid.enableVector, false);
 assert.equal(config.lifecycle.miniLlm.enabled, false);
 assert.equal(config.lifecycle.externalizeToolOutputs, false);
 assert.throws(() => parseConfig({ lifecycle: { miniLlm: { enabled: true, endpoint: 'https://example.invalid', model: 'test' } } }));
});
