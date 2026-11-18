import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngine,sha256 } from '../packages/core/src/index.ts';
import { PythonAdapter } from '../packages/core/src/native/languages/python.ts';
import { AdapterRegistry } from '../packages/core/src/native/registry.ts';
import { compatibleRegistry } from '../packages/core/src/quality/compatible.ts';
import { nativeFixture } from './native-fixtures.ts';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
test('v05 compatible definitions preserve exact undecorated AST source and stable symbol IDs', async () => {
  const parser=compatibleRegistry(new AdapterRegistry([new PythonAdapter()])).language('module.py');
  const source='from lib import decorate\n@decorate\nclass Invoice:\n    amount = 2\n    @decorate\n    def save(self):\n        return self.amount\n';
  const parsed=await parser.parse('module.py',source,sha256(source)),again=await parser.parse('module.py','\n'+source,sha256('\n'+source));
  assert.equal(parsed.chunks.filter(c=>c.retrievable).length,2);
  const c=parsed.chunks.find(c=>c.name==='Invoice')!;assert.ok(c.text.startsWith('class Invoice:'));assert.equal(c.startLine,3);
  assert.equal(parsed.chunks.find(c=>c.name==='save')!.kind,'function');assert.equal(c.id,again.chunks.find(c=>c.name==='Invoice')!.id);
  assert.ok(!parsed.chunks.some(c=>c.kind==='property'||c.kind==='import'));
});
test('v05 profiles prioritize required class definitions over structural hits and retain source provenance', async () => {
  for(const profile of ['elara-compatible','definitions-first','structural-balanced','hybrid-quality']as const){
    const root=await nativeFixture('django');
    await writeFile(path.join(root,'usage.py'),'from models import Ledger\nclass Form:\n    model = Ledger\n');
    const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{profile},hybrid:{enableVector:false,enableLiteral:false}}});
    try{
      const found=await engine.native!.searchChunks('class Ledger',{topK:5});
      if(profile==='elara-compatible')assert.ok(found.every(r=>['class','function'].includes(r.chunk.kind)));
      else {assert.ok(found.some(r=>r.chunk.name==='Ledger'&&r.chunk.kind==='class'));assert.equal(found[0]!.chunk.name,'Ledger');assert.ok(found[0]!.debug.quality!.components.exactSymbol!>0);}
      assert.ok((engine.native!.lastTrace!.timings.sourceRevalidation??-1)>=0);
      const full=await engine.native!.expandChunk(found[0]!.chunk.id);assert.equal(full.fileHash,sha256(await import('node:fs/promises').then(fs=>fs.readFile(path.join(root,full.path),'utf8'))));
    }finally{engine.close();}
  }
});
