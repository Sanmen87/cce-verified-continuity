import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PythonAdapter } from '../packages/core/src/native/languages/python.ts';
import { TypeScriptAdapter } from '../packages/core/src/native/languages/typescript.ts';
import { DjangoAdapter } from '../packages/core/src/native/frameworks/django.ts';
import { sha256 } from '../packages/core/src/workspace.ts';
test('Python AST preserves decorators, async methods, docstrings, nested properties, Unicode and stable IDs', async () => {
  const adapter = new PythonAdapter();
  const text = '"💡 中文"\n' + await readFile(new URL('./fixtures/native/django/models.py', import.meta.url), 'utf8');
  const file = await adapter.parse('models.py', text, sha256(text));
  assert.deepEqual(file.diagnostics, []);
  const save = file.chunks.find(c => c.name === 'save')!;
  assert.equal(save.kind, 'method'); assert.match(save.text, /^@transaction\.atomic/);
  assert.ok(save.startLine < save.definitionStartLine); assert.match(save.docstring, /Persist an entry/);
  assert.equal(file.chunks.find(c => c.name === 'refresh_entry')?.metadata.async, true);
  const again = await adapter.parse('models.py', '\n' + text, sha256('\n' + text));
  assert.equal(again.chunks.find(c => c.qualifiedName === save.qualifiedName)?.id, save.id);
  const field = file.chunks.find(c => c.name === 'owner')!;
  assert.equal(field.syntax.assignment?.value.callee, 'm.ForeignKey');
  const framework = new DjangoAdapter();
  assert.equal(framework.detects({ files: ['models.py'], manifests: { 'requirements.txt': 'Django>=5' } }), true);
  const enriched = framework.enrich(file);
  assert.equal(enriched.relations.filter(r => r.relation.startsWith('ORM_')).length, 4);
  assert.equal(enriched.metadata[file.chunks.find(c => c.name === 'Ledger')!.id]?.role, 'model');
  assert.ok(Object.values(enriched.metadata).some(m => m.role === 'permissions'));
  assert.equal(enriched.relations.find(r => r.source === field.id)?.metadata.targetExpression, 'settings.AUTH_USER_MODEL');
});
test('TypeScript/JavaScript/TSX AST indexes classes, methods, arrow functions and named imports', async () => {
  const adapter = new TypeScriptAdapter();
  const source = await readFile(new URL('./fixtures/native/typescript/src/orders.service.ts', import.meta.url), 'utf8');
  const file = await adapter.parse('src/orders.service.ts', source, sha256(source));
  assert.deepEqual(file.diagnostics, []);
  assert.ok(file.chunks.some(c => c.name === 'OrdersService' && c.kind === 'class'));
  assert.ok(file.chunks.some(c => c.name === 'findOrder' && c.kind === 'method' && c.metadata.async));
  assert.ok(file.chunks.some(c => c.name === 'createService' && c.kind === 'function'));
  assert.ok(file.chunks.find(c => c.kind === 'module')?.syntax.imports.some(i => i.module === './storage.js' && i.name === 'lookupOrder'));
  assert.equal(adapter.resolveImport('src/orders.service.ts', './storage.js', new Set(['src/storage.ts'])), 'src/storage.ts');
  for (const [language, text, filename] of [['javascript', 'export function render() { return 1; }', 'render.js'], ['tsx', 'export const App = () => <main>Hello</main>;', 'App.tsx']] as const) {
    const result = await new TypeScriptAdapter(language).parse(filename, text, sha256(text));
    assert.equal(result.diagnostics.length, 0); assert.ok(result.chunks.some(c => c.kind === 'function'));
  }
});
test('syntax errors fall back safely; source hashes and module imports are validated', async () => {
  const adapter = new PythonAdapter();
  const broken = 'def bad(:\n    return 1\n';
  const file = await adapter.parse('bad.py', broken, sha256(broken));
  assert.equal(file.chunks[0]?.metadata.fallback, true); assert.equal(file.diagnostics.length, 1);
  await assert.rejects(adapter.parse('bad.py', broken, 'a'.repeat(64)), /hash mismatch/);
  assert.equal(adapter.resolveImport('pkg/main.py', 'helpers', new Set(['pkg/helpers.py']), 1), 'pkg/helpers.py');
});

test('Django recognizes imported abstract-base inheritance and invalidates removed base facts', async () => {
  const parser = new PythonAdapter(), django = new DjangoAdapter();
  const baseText = 'from django.db import models\nclass Base(models.Model):\n    pass\nclass Base1(Base):\n    pass\n';
  const dealText = 'from common.models import Base1\nfrom django.db import models\nclass Deal(Base1):\n    parent = models.ForeignKey("crm.Deal", on_delete=models.CASCADE)\n';
  const base = await parser.parse('common/models.py',baseText,sha256(baseText));
  const deal = await parser.parse('crm/models/deal.py',dealText,sha256(dealText));
  django.prepare([...deal.chunks,...base.chunks]);
  const enriched = django.enrich(deal); assert.equal(enriched.metadata[deal.chunks.find(c=>c.name==='Deal')!.id]?.role,'model');
  assert.equal(enriched.relations.length,1); assert.equal(enriched.relations[0]?.targetName,'crm.models.deal.Deal');
  django.prepare(deal.chunks); assert.equal(django.enrich(deal).relations.length,0);
});
