import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine,Workspace} from '../packages/core/src/index.ts';
import {ContextLedger} from '../packages/core/src/lifecycle/ledger.ts';
import {schemaEvidence} from '../packages/core/src/lifecycle/schema-evidence.ts';
import {LocalNarrativeCompressor} from '../packages/core/src/lifecycle/local-compressor.ts';
import type {ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';
const config={mode:'assist',lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,historyRecallEnabled:true,capabilityContractEnabled:true}};
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'cce-v06-service-'));await writeFile(path.join(root,'a.ts'),'export const a=1;\n');return root;}
test('v06 full-text history searches beyond metadata prefix and pages exact originals without silent truncation',async()=>{
 const root=await fixture(),engine=await ContextEngine.open(root,{config});try{
 const life=engine.lifecycle!,original='Repeated output. '.repeat(300)+'tailneedle',event=await life.ledger.append(engine.sessionId,life.branchId,{externalId:'long',kind:'TOOL_RESULT',origin:'tool',text:original});
 assert.equal(life.ledger.search(engine.sessionId,life.branchId,'tailneedle')[0]?.id,event.id);
 let offset=0,recovered='';for(let n=0;n<20;n++){const response=await life.history({eventId:event.id,level:'original',offset,maxTokens:2048}) as {text:string;nextOffset:number|null;status:string};assert.ok(response.text.length>0);recovered+=response.text;if(response.nextOffset===null)break;assert.ok(response.nextOffset>offset);offset=response.nextOffset;}assert.equal(recovered,original);
 }finally{engine.close();}
});
test('v06 current verification uses existing tracker authority; source edits invalidate it and restart cannot promote history',async()=>{
 const root=await fixture(),contract:ExplicitTaskContract={id:'a',source:'user',text:'Update a.',requirements:[{id:'a',clause:'Update a.',needs:[{id:'body',kind:'source',path:'a.ts',representation:'full'}],checks:['check']}]};let calls=0;
 const options={config:{...config,quality:{guardEnabled:true,coverageEnabled:true}},taskContract:contract,verificationChecks:[{id:'check',type:'custom-approved' as const,source:'test-host-adapter',execute:async()=>{calls++;return{exitCode:0,diagnostic:'Executed host callback',executionId:'unit-host-1'};}}]};
 const engine=await ContextEngine.open(root,options);try{
 await engine.lifecycle!.userRequirement('goal','Update a.');await engine.quality!.feedback!.run('check');assert.equal(calls,1);
 const handoff=await engine.lifecycle!.compile(12000);assert.match(handoff.text,/CURRENT HOST VERIFICATION VIEW/);assert.match(handoff.text,/VERIFIED_PASS/);
 await writeFile(path.join(root,'a.ts'),'export const a=2;');assert.doesNotMatch((await engine.lifecycle!.compile(12000)).text,/VERIFIED_PASS/);
 }finally{engine.close();}
 const restored=await ContextEngine.open(root,options);try{assert.doesNotMatch((await restored.lifecycle!.compile(12000)).text,/VERIFIED_PASS/);}finally{restored.close();}
});
test('v06 schema evidence uses static Python AST and marks dynamic declarations and live DB unknown',async()=>{
 const root=await fixture();await mkdir(path.join(root,'migrations'));
 await writeFile(path.join(root,'models.py'),'from sqlalchemy.orm import mapped_column, relationship\nclass Deal(Base):\n    __tablename__ = "deals"\n    id = mapped_column(primary_key=True)\n    contacts = relationship("Contact")\n');
 await writeFile(path.join(root,'migrations/001.py'),'revision = "r001"\ndown_revision = None\ndepends_on = compute_revision()\n');
 const engine=await ContextEngine.open(root,{config});try{const schema=await schemaEvidence(engine,['models.py','migrations/001.py']);assert.equal(schema.liveDatabaseSchema,'UNKNOWN');assert.equal(schema.files[0]!.models[0]?.symbol,'models.Deal');assert.equal(schema.files[1]!.revisions.find(r=>r.name==='revision')?.value,'r001');assert.equal(schema.files[1]!.revisions.find(r=>r.name==='depends_on')?.status,'UNVERIFIED');await assert.rejects(schemaEvidence(engine,['../models.py']));}finally{engine.close();}
});
test('v06 ledger identity rejects copied workspaces; linked blobs cannot escape',async()=>{
 const root=await fixture(),workspace=await Workspace.create(root),ledger=await ContextLedger.open(workspace,'.context-engine');ledger.branch('s','main');const e=await ledger.append('s','main',{externalId:'a',kind:'MESSAGE',origin:'user',text:'original'});ledger.close();
 const outside=await mkdtemp(path.join(tmpdir(),'cce-v06-foreign-'));await mkdir(path.join(outside,'.context-engine/lifecycle'),{recursive:true});
 const {copyFile,unlink}=await import('node:fs/promises');await copyFile(path.join(root,'.context-engine/lifecycle/ledger.db'),path.join(outside,'.context-engine/lifecycle/ledger.db'));await assert.rejects(ContextLedger.open(await Workspace.create(outside),'.context-engine'),/Wrong workspace/);
 await unlink(path.join(root,'.context-engine/lifecycle/blobs',e.blobSha256));await symlink(outside,path.join(root,'.context-engine/lifecycle/blobs',e.blobSha256),process.platform==='win32'?'junction':'dir');
 const reopened=await ContextLedger.open(workspace,'.context-engine');try{await assert.rejects(reopened.original('s','main',e.id));}finally{reopened.close();}
});
test('v06 mini local transport rejects remote endpoints, credentials and implicit models',()=>{
 for(const endpoint of ['https://example.com/v1','http://127.0.0.1:1234/v1?token=x','http://user:password@localhost/v1'])assert.throws(()=>new LocalNarrativeCompressor(endpoint,'mini'));
 assert.throws(()=>new LocalNarrativeCompressor('http://localhost:1234/v1',''));
});
