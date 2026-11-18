import test from 'node:test';
import assert from 'node:assert/strict';
import {PythonAdapter} from '../packages/core/src/native/languages/python.ts';
import {sha256,ContextEngine,parseConfig} from '../packages/core/src/index.ts';
import {scoreQuality,selectQuality,type QualityCandidate} from '../packages/core/src/quality/retrieval.ts';
import {nativeFixture} from './native-fixtures.ts';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
async function candidates(){
 const parser=new PythonAdapter(),source=Array.from({length:8},(_,i)=>`def check_${i}():\n    return ${i}\n`).join('\n');
 const parsed=await parser.parse('checks.py',source,sha256(source));
 const other=await parser.parse('other.py','def competitor():\n    return 1\n',sha256('def competitor():\n    return 1\n'));
 return [...parsed.chunks,...other.chunks].filter(c=>c.kind==='function').map((chunk,i)=>({chunk,debug:{literalRank:null,keywordRank:i,vectorRank:i,literalScore:null,keywordScore:1,vectorDistance:0.3,rrf:1,confidence:0.9,final:i<6?1-i*.01:i<8?.3:0.95,graph:false}})) satisfies QualityCandidate[];
}
test('fix2 evidence quota retains six independent high-relevance methods, preserves diversity, scores and topK',async()=>{
 const rows=(await candidates()).sort((a,b)=>b.debug.final-a.debug.final),before=JSON.stringify(rows);
 const legacy=selectQuality(rows,'authentication checks',10),aware=selectQuality(rows,'authentication checks',10,{policy:'evidence-aware'});
 assert.equal(legacy.selected.filter(r=>r.chunk.path==='checks.py').length,3);
 assert.equal(aware.selected.filter(r=>r.chunk.path==='checks.py').length,6);
 assert.ok(aware.selected.some(r=>r.chunk.path==='other.py'));
 assert.ok(aware.decisions.some(d=>d.reason==='OMITTED_BY_FILE_QUOTA'));
 assert.equal(JSON.stringify(rows),before);
 const capped=selectQuality(rows,'authentication checks',4,{policy:'evidence-aware'});assert.equal(capped.selected.length,4);assert.ok(capped.decisions.some(d=>d.reason==='OMITTED_BY_GLOBAL_TOPK'));
 assert.deepEqual(selectQuality(rows,'authentication checks',10,{policy:'evidence-aware'}),aware);
});
test('fix2 required definitions are explicit and path-bound; a structural hit cannot replace full source',async()=>{
 const rows=await candidates(),target=rows[5]!;
 const property={...target,chunk:{...target.chunk,id:sha256('property'),kind:'property',endLine:target.chunk.startLine},debug:{...target.debug,final:2}};
 const aware=selectQuality([property,target],'authentication',3,{policy:'evidence-aware'});assert.deepEqual(aware.selected.map(r=>r.chunk.id),[target.chunk.id]);assert.equal(aware.decisions[0]!.reason,'OMITTED_BY_OVERLAP');
 const required=selectQuality(rows,'authentication',2,{policy:'evidence-aware',required:[{symbol:target.chunk.name,path:'checks.py'}]});assert.equal(required.selected[0]!.chunk.id,target.chunk.id);
 const wrongPath=selectQuality(rows,'authentication',2,{policy:'evidence-aware',required:[{symbol:target.chunk.name,path:'unrelated.py'}]});assert.notEqual(wrongPath.selected[0]!.chunk.id,target.chunk.id);
});
test('fix2 parent source covers nested definitions; explicit child requirements reserve their full bodies',async()=>{
 const source='class Gate:\n    def check(self):\n        def inner():\n            return True\n        return inner()\n';
 const parsed=await new PythonAdapter().parse('gate.py',source,sha256(source)),rows=parsed.chunks.filter(c=>c.kind!=='module').map((chunk,i)=>({chunk,debug:{literalRank:null,keywordRank:i,vectorRank:null,literalScore:null,keywordScore:1,vectorDistance:null,rrf:1,confidence:1,final:1-i/10,graph:false}}));
 const selected=selectQuality(rows,'permission checks',3,{policy:'evidence-aware'});assert.equal(selected.selected[0]!.chunk.name,'Gate');assert.ok(selected.decisions.filter(d=>d.reason==='OMITTED_BY_OVERLAP').every(d=>d.coveredBy===selected.selected[0]!.chunk.id));
 const explicit=selectQuality(rows,'permission checks',3,{policy:'evidence-aware',required:[{symbol:'Gate.check.inner',path:'gate.py'}]});assert.equal(explicit.selected[0]!.chunk.name,'inner');
});
test('fix2 production scoring is identical between quota policies and contract changes are read live',async()=>{
 const rows=await candidates(),scored=scoreQuality(rows,'check authentication','hybrid-quality'),before=JSON.stringify(scored);
 selectQuality(scored,'check authentication',10,{policy:'legacy'});selectQuality(scored,'check authentication',10,{policy:'evidence-aware'});assert.equal(JSON.stringify(scored),before);
 assert.equal(parseConfig().quality.selection,'legacy');assert.throws(()=>parseConfig({quality:{selection:'unlimited'}}),/selection/);
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'checks.py'),Array.from({length:6},(_,i)=>`def check_${i}():\n    return True\n`).join('\n'));
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality',selection:'evidence-aware',coverageEnabled:true},hybrid:{enableGraph:false,enableVector:false}},taskContract:{id:'explicit',source:'user',text:'Inspect check_5.',requirements:[{id:'r',clause:'Inspect check_5.',needs:[{id:'n',kind:'definition',symbol:'check_5',path:'checks.py',representation:'full'}],checks:[]}]}});
 try{assert.deepEqual(engine.native!.requiredDefinitions(),[{symbol:'check_5',path:'checks.py'}]);const hits=await engine.native!.searchChunks('checks',{topK:2});assert.ok(hits.some(r=>r.chunk.name==='check_5'));assert.ok(engine.native!.lastSelection.length);}
 finally{engine.close();}
});
