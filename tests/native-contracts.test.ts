import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry, TextLanguageAdapter, symbolId } from '../packages/core/src/native/registry.ts';
import type { FrameworkAdapter, LanguageAdapter } from '../packages/core/src/native/contracts.ts';
import { sha256 } from '../packages/core/src/workspace.ts';
test('language/framework contracts accept a new plugin and unknown languages without core changes', async () => {
  const fallbackParser = new TextLanguageAdapter();
  const custom: LanguageAdapter = { id: 'new-language', version: '1', detects: file => file.endsWith('.new'),
    moduleName: file => file, resolveImport: () => null,
    parse: async (file, text, hash) => ({ ...await fallbackParser.parse(file, text, hash), language: 'new-language' }) };
  const framework: FrameworkAdapter = { id: 'custom-framework', version: '1', detects: p => p.files.includes('custom.manifest'),
    enrich: () => ({ metadata: {}, relations: [] }) };
  const registry = new AdapterRegistry([custom], [framework]);
  assert.equal(registry.language('example.new').id, custom.id);
  assert.equal(registry.detectFrameworks({ files: [], manifests: {} }).length, 0);
  assert.equal(registry.detectFrameworks({ files: ['custom.manifest'], manifests: {} }).length, 1);
  const fallback = await new AdapterRegistry([]).language('main.go').parse('main.go', 'package main\n', sha256('package main\n'));
  assert.equal(fallback.chunks[0]?.text, 'package main\n');
  assert.equal(fallback.chunks[0]?.endLine, 2);
  assert.equal(symbolId('src\\main.go', 'go', 'function', 'main'), symbolId('src/main.go', 'go', 'function', 'main'));
  assert.throws(() => new AdapterRegistry([custom, custom]), /Duplicate/);
});
