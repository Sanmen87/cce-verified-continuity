import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {ContextLedger} from '../packages/core/src/lifecycle/ledger.ts';
import {Workspace,sha256} from '../packages/core/src/workspace.ts';
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'cce-v06-'));const workspace=await Workspace.create(root),ledger=await ContextLedger.open(workspace,'.context-engine');ledger.branch('s','main');return{root,workspace,ledger};}
test('v06 ledger exact originals survive restart; duplicate conflicts roll back without trust promotion',async()=>{
 const {root,workspace,ledger}=await fixture();
 const input={externalId:'user-1',kind:'USER_REQUIREMENT' as const,origin:'user' as const,text:'Keep all original events.',mandatory:true};
 const a=await ledger.append('s','main',input),b=await ledger.append('s','main',input);assert.equal(a.id,b.id);assert.equal(ledger.latestSequence('s','main'),a.sequence);
 await assert.rejects(ledger.append('s','main',{...input,text:'Changed requirement'}),/Conflicting/);
 await assert.rejects(ledger.append('s','main',{externalId:'bad',kind:'TEST_EXECUTED',origin:'agent',text:'tests passed',mandatory:true}),/explicit/);
 ledger.close();const restored=await ContextLedger.open(workspace,'.context-engine');
 try{assert.equal((await restored.original('s','main',a.id)).text,input.text);assert.equal(restored.get('s','main',a.id)?.trust,'UNTRUSTED_DATA');assert.equal(restored.search('s','main','original')[0]?.id,a.id);
 const db=new DatabaseSync(path.join(root,'.context-engine/lifecycle/ledger.db'));db.prepare('UPDATE events SET record=? WHERE id=?').run('{}',a.id);db.close();assert.throws(()=>restored.get('s','main',a.id),/Corrupt/);
 }finally{restored.close();}
});
test('v06 branch cutoff isolates future siblings and sessions; timeline is paginated',async()=>{
 const {ledger}=await fixture();try{
 const a=await ledger.append('s','main',{externalId:'a',kind:'MESSAGE',origin:'user',text:'initial'});ledger.branch('s','fork','main',a.sequence);
 const future=await ledger.append('s','main',{externalId:'b',kind:'MESSAGE',origin:'agent',text:'future on main'});
 const fork=await ledger.append('s','fork',{externalId:'c',kind:'MESSAGE',origin:'user',text:'fork decision'});
 ledger.branch('other','main');assert.equal(ledger.get('other','main',a.id),null);assert.equal(ledger.get('s','fork',future.id),null);assert.equal(ledger.get('s','main',fork.id),null);
 assert.equal(ledger.list('s','fork').length,2);assert.equal(ledger.timeline('s','fork',fork.id,1).length,2);assert.equal(ledger.list('s','fork',{after:a.sequence,limit:1})[0]?.id,fork.id);
 assert.throws(()=>ledger.branch('s','fork','main',future.sequence),/origin/);
 }finally{ledger.close();}
});
test('v06 blob corruption, missing original, traversal and source changes fail visibly',async()=>{
 const {root,ledger}=await fixture();try{
 await writeFile(path.join(root,'a.ts'),'export const a=1;');const source={path:'a.ts',sha256:sha256('export const a=1;')};
 const a=await ledger.append('s','main',{externalId:'a',kind:'SOURCE_OBSERVED',origin:'tool',text:'original',sources:[source]});
 assert.equal(await ledger.freshness(source),'CURRENT');await writeFile(path.join(root,'a.ts'),'export const a=2;');assert.equal(await ledger.freshness(source),'STALE');
 await assert.rejects(ledger.append('s','main',{externalId:'bad',kind:'SOURCE_OBSERVED',origin:'tool',text:'bad',sources:[{...source,path:'../a.ts'}]}),/Unsafe/);
 await assert.rejects(ledger.original('s','main','../a'),/Invalid/);await assert.rejects(ledger.original('s','main',a.id,1),/BUDGET/);
 await writeFile(path.join(root,'.context-engine/lifecycle/blobs',a.blobSha256),'tampered');await assert.rejects(ledger.original('s','main',a.id),/Corrupt/);
 }finally{ledger.close();}
});
test('v06 ledger limits and abandoned blob writes do not create partial events',async()=>{
 const {workspace,ledger}=await fixture();ledger.close();const limited=await ContextLedger.open(workspace,'.context-engine',{maxBlobBytes:16,maxStoreBytes:24});
 try{await assert.rejects(limited.append('s','main',{externalId:'x',kind:'MESSAGE',origin:'agent',text:'x'.repeat(17)}));assert.equal(limited.list('s','main').length,0);
 await limited.append('s','main',{externalId:'x',kind:'MESSAGE',origin:'agent',text:'x'.repeat(16)});
 await assert.rejects(limited.append('s','main',{externalId:'y',kind:'MESSAGE',origin:'agent',text:'y'.repeat(16)}),/retention/);assert.equal(limited.list('s','main').length,1);
 }finally{limited.close();}
});
test('v06 state directory junction cannot redirect ledger outside workspace',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-v06-link-')),outside=await mkdtemp(path.join(tmpdir(),'cce-v06-outside-'));await mkdir(path.join(root,'.context-engine'));
 await symlink(outside,path.join(root,'.context-engine/lifecycle'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(ContextLedger.open(await Workspace.create(root),'.context-engine'),/Unsafe/);
});
test('v06 SQLite rolls back a killed writer; surviving originals and later appends stay consistent',async()=>{
 const {root,ledger}=await fixture();try{
 const original=await ledger.append('s','main',{externalId:'stable',kind:'MESSAGE',origin:'user',text:'committed before crash'});
 const child=spawn(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec(\"BEGIN IMMEDIATE; INSERT INTO events(id,session,branch,kind,mandatory,blob,bytes,record,hash) VALUES('crashed','s','main','MESSAGE',0,'none',0,'{}','bad');\");process.stdout.write('ready');setInterval(()=>{},1000);",path.join(root,'.context-engine/lifecycle/ledger.db')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let error='';child.stderr.on('data',b=>error+=b);const closed=new Promise<number|null>(resolve=>child.on('close',resolve));
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',()=>resolve());child.once('exit',code=>{if(code!==null&&code!==0)reject(Error(error));});});child.kill('SIGKILL');await closed;
 assert.equal(ledger.list('s','main').length,1);assert.equal((await ledger.original('s','main',original.id)).text,'committed before crash');
 await ledger.append('s','main',{externalId:'after',kind:'MESSAGE',origin:'user',text:'committed after crash'});assert.equal(ledger.list('s','main').length,2);
 }finally{ledger.close();}
});
