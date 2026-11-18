import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import { boundedString, integer } from '../config.ts';
import { sha256, type Workspace } from '../workspace.ts';
import { containsSecret } from '../native/secrets.ts';
import { EVENT_KINDS, type ContextEvent, type EventInput, type SourceReference } from './contracts.ts';
const key=(v:string)=>boundedString(v,256);
const digest=(v:string)=>{if(!/^[a-f0-9]{64}$/.test(v))throw Error('Invalid history ID');return v;};
const stable=(v:unknown):string=>JSON.stringify(v);
/** Local append-only metadata. Blobs are inert data, never executable instructions. */
export class ContextLedger {
  readonly workspace:Workspace; private directory:string; private db:DatabaseSync;
  readonly maxBlobBytes:number; readonly maxStoreBytes:number;
  private atomicOwner:symbol|undefined;private atomicScope=new AsyncLocalStorage<symbol>();
  async atomic<T>(action:()=>Promise<T>):Promise<T>{
    if(this.atomicOwner)throw Error('Ledger transaction busy');const owner=Symbol('ledger-import');this.atomicOwner=owner;let began=false;
    try{this.db.exec('BEGIN IMMEDIATE');began=true;const result=await this.atomicScope.run(owner,action);this.db.exec('COMMIT');return result;}catch(error){if(began)this.db.exec('ROLLBACK');throw error;}finally{this.atomicOwner=undefined;}
  }
  private constructor(workspace:Workspace,directory:string,db:DatabaseSync,maxBlobBytes:number,maxStoreBytes:number){this.workspace=workspace;this.directory=directory;this.db=db;this.maxBlobBytes=maxBlobBytes;this.maxStoreBytes=maxStoreBytes;}
  static async open(workspace:Workspace,stateDir:string,limits={maxBlobBytes:2097152,maxStoreBytes:67108864}):Promise<ContextLedger>{
    const relative=workspace.normalize(stateDir+'/lifecycle'); let directory=workspace.root;
    for(const p of relative.split('/')){directory=path.join(directory,p);await mkdir(directory,{mode:0o700}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe lifecycle directory');}
    for(const name of ['ledger.db','ledger.db-wal','ledger.db-shm','ledger.db-journal','blobs']){try{const stat=await lstat(path.join(directory,name));if(stat.isSymbolicLink()||(name==='blobs'?!stat.isDirectory():!stat.isFile()))throw Error('Unsafe lifecycle storage');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    await mkdir(path.join(directory,'blobs'),{mode:0o700,recursive:true});
    const db=new DatabaseSync(path.join(directory,'ledger.db'));
    try{
      db.exec('PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(version>1)throw Error('Unsupported lifecycle schema');
      if(version===0)db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE identity(project TEXT PRIMARY KEY);
        CREATE TABLE branches(session TEXT,branch TEXT,parent TEXT,cutoff INTEGER,PRIMARY KEY(session,branch));
        CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,session TEXT,branch TEXT,kind TEXT,mandatory INTEGER,blob TEXT,bytes INTEGER,record TEXT,hash TEXT);
        CREATE INDEX scope_events ON events(session,branch,seq);
        CREATE VIRTUAL TABLE history_fts USING fts5(text,content='',tokenize='unicode61');
        CREATE TABLE blobs(hash TEXT PRIMARY KEY,bytes INTEGER NOT NULL,created TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE projections(session TEXT,branch TEXT,payload TEXT,PRIMARY KEY(session,branch));
        PRAGMA user_version=1; COMMIT;`);
      db.exec(`CREATE TABLE IF NOT EXISTS entry_bindings(session TEXT,entry TEXT,branch TEXT,event_id TEXT,seq INTEGER,PRIMARY KEY(session,entry));
        CREATE TABLE IF NOT EXISTS active_branches(session TEXT PRIMARY KEY,branch TEXT,leaf TEXT);`);
      db.prepare('INSERT OR IGNORE INTO identity VALUES(?)').run(workspace.projectId);
      if(db.prepare('SELECT project FROM identity').all().some(r=>r.project!==workspace.projectId))throw Error('Wrong workspace history');
      return new ContextLedger(workspace,directory,db,limits.maxBlobBytes,limits.maxStoreBytes);
    }catch(e){db.close();throw e;}
  }
  private async checkStorage():Promise<void>{
    const rel=path.relative(this.workspace.root,this.directory).replaceAll('\\','/');
    if(await this.workspace.resolve(rel,false)!==this.directory)throw Error('History storage moved');
    const stat=await lstat(path.join(this.directory,'blobs'));if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe blob directory');
  }
  private async blobPath(hash:string):Promise<string>{await this.checkStorage();const file=path.join(this.directory,'blobs',digest(hash));try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1)throw Error('Unsafe history blob');if(await realpath(file)!==file)throw Error('Blob path mismatch');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return file;}
  branch(session:string,branch:string,parent?:string,cutoff?:number):void{
    if(this.atomicOwner&&this.atomicScope.getStore()!==this.atomicOwner)throw Error('Ledger transaction busy');
    key(session);key(branch);if(parent===branch)throw Error('Branch cycle');
    if(parent){key(parent);if(!this.db.prepare('SELECT 1 FROM branches WHERE session=? AND branch=?').get(session,parent))throw Error('Unknown parent branch');integer(cutoff??0,0,Number.MAX_SAFE_INTEGER);}
    const old=this.db.prepare('SELECT parent,cutoff FROM branches WHERE session=? AND branch=?').get(session,branch);
    if(old){if(parent!==undefined&&(old.parent!==parent||Number(old.cutoff)!==cutoff))throw Error('Branch origin mismatch');return;}
    this.db.prepare('INSERT INTO branches VALUES(?,?,?,?)').run(session,branch,parent??null,cutoff??null);
  }
  private scopes(session:string,branch:string):Array<{branch:string;cutoff:number}>{
    if(this.atomicOwner&&this.atomicScope.getStore()!==this.atomicOwner)throw Error('Ledger transaction busy');
    key(session);key(branch);const out:Array<{branch:string;cutoff:number}>=[];let cursor:string|null=branch,limit=Number.MAX_SAFE_INTEGER;
    while(cursor){if(out.length>=128||out.some(s=>s.branch===cursor))throw Error('Invalid branch ancestry');const row:Record<string,unknown>|undefined=this.db.prepare('SELECT parent,cutoff FROM branches WHERE session=? AND branch=?').get(session,cursor);if(!row)throw Error('Unknown history branch');out.push({branch:cursor,cutoff:limit});limit=Math.min(limit,row.cutoff===null?limit:Number(row.cutoff));cursor=typeof row.parent==='string'?row.parent:null;}
    return out;
  }
  private clause(session:string,branch:string){const scopes=this.scopes(session,branch);return{sql:scopes.map(()=>'(branch=? AND seq<=?)').join(' OR '),args:scopes.flatMap(s=>[s.branch,s.cutoff])};}
  private decode(row:Record<string,unknown>):ContextEvent{
    if(typeof row.record!=='string'||Buffer.byteLength(row.record)>65536)throw Error('Corrupt history record');
    const e=JSON.parse(row.record) as ContextEvent;
    if(sha256(row.record)!==row.hash||e.id!==row.id||e.projectId!==this.workspace.projectId||e.sessionId!==row.session||e.branchId!==row.branch||e.blobSha256!==row.blob||!EVENT_KINDS.includes(e.kind)||e.trust!=='UNTRUSTED_DATA')throw Error('Corrupt history binding');
    return{...e,sequence:Number(row.seq),recordHash:String(row.hash)};
  }
  async append(session:string,branch:string,input:EventInput):Promise<ContextEvent>{
    this.scopes(session,branch);key(input.externalId);boundedString(input.text||' ',this.maxBlobBytes);
    if(!EVENT_KINDS.includes(input.kind)||!['user','agent','tool','host','unknown'].includes(input.origin))throw Error('Invalid event kind/origin');
    if(Buffer.byteLength(input.text)>this.maxBlobBytes)throw Error('History blob size limit');
    if(input.mandatory&&input.origin!=='user'&&input.origin!=='host')throw Error('Only explicit user/host facts can be mandatory');
    if(input.exitCode!==undefined&&input.exitCode!==null)integer(input.exitCode,-255,255);
    const stamp=input.timestamp??new Date().toISOString();if(!Number.isFinite(Date.parse(stamp)))throw Error('Invalid event timestamp');
    const sources=(input.sources??[]).map(s=>{const p=this.workspace.normalize(s.path);digest(s.sha256);if(s.startLine!==undefined)integer(s.startLine,1,10000000);if(s.endLine!==undefined)integer(s.endLine,s.startLine??1,10000000);return{...s,path:p};});if(sources.length>64)throw Error('Too many event sources');
    const id=sha256(stable([this.workspace.projectId,session,branch,input.externalId])),blob=sha256(input.text);
    const existing=this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(existing){const decoded=this.decode(existing);if(decoded.blobSha256!==blob||decoded.kind!==input.kind||decoded.origin!==input.origin||stable(decoded.sources)!==stable(sources)||decoded.mandatory!==Boolean(input.mandatory)||decoded.exitCode!==input.exitCode||decoded.isError!==input.isError||decoded.supersedes!==input.supersedes)throw Error('Conflicting duplicate event');return decoded;}
    const file=await this.blobPath(blob),known=this.db.prepare('SELECT * FROM blobs WHERE hash=?').get(blob);
    if(!known||known.deleted){const used=Number(this.db.prepare('SELECT coalesce(sum(bytes),0) AS size FROM blobs WHERE deleted=0').get()?.size);if(used+Buffer.byteLength(input.text)>this.maxStoreBytes)throw Error('History retention limit reached');
      const temporary=path.join(this.directory,'blobs',randomUUID()+'.tmp'),handle=await open(temporary,'wx',0o600);
      try{await handle.writeFile(input.text,'utf8');await handle.sync();}finally{await handle.close();}
      try{await rename(temporary,file);}catch(e){await unlink(temporary).catch(()=>{});throw e;}
    }else{const original=await readFile(file);if(sha256(original)!==blob)throw Error('Corrupt existing blob');}
    if(this.atomicOwner&&this.atomicScope.getStore()!==this.atomicOwner)throw Error('Ledger transaction busy');
    const ownTransaction=!this.atomicOwner;if(ownTransaction)this.db.exec('BEGIN IMMEDIATE');
    try{
      if(Number(this.db.prepare('SELECT count(*) AS n FROM events').get()?.n)>=100000)throw Error('History event limit reached');
      const previous=String(this.db.prepare('SELECT hash FROM events WHERE session=? AND branch=? ORDER BY seq DESC LIMIT 1').get(session,branch)?.hash??'');
      const record={id,sequence:0,projectId:this.workspace.projectId,sessionId:session,branchId:branch,kind:input.kind,origin:input.origin,timestamp:stamp,title:containsSecret(input.text)?'[Potential secret omitted from searchable metadata]':input.text.slice(0,768),blobSha256:blob,bytes:Buffer.byteLength(input.text),sources,mandatory:Boolean(input.mandatory),...(input.toolCallId?{toolCallId:key(input.toolCallId)}:{}),...(input.messageId?{messageId:key(input.messageId)}:{}),...(input.supersedes?{supersedes:digest(input.supersedes)}:{}),...(input.exitCode!==undefined?{exitCode:input.exitCode}:{}),...(input.isError!==undefined?{isError:input.isError}:{}),previousHash:previous,recordHash:'',trust:'UNTRUSTED_DATA' as const,historical:true as const};
      const json=stable(record),hash=sha256(json);if(Buffer.byteLength(json)>65536)throw Error('Metadata too large');
      this.db.prepare('INSERT INTO blobs(hash,bytes,created,deleted) VALUES(?,?,?,0) ON CONFLICT(hash) DO UPDATE SET deleted=0').run(blob,record.bytes,stamp);
      this.db.prepare('INSERT INTO events(id,session,branch,kind,mandatory,blob,bytes,record,hash) VALUES(?,?,?,?,?,?,?,?,?)').run(id,session,branch,input.kind,Number(record.mandatory),blob,record.bytes,json,hash);
      const seq=this.db.prepare('SELECT seq FROM events WHERE id=?').get(id)!.seq;
      this.db.prepare('INSERT INTO history_fts(rowid,text) VALUES(?,?)').run(Number(seq),containsSecret(input.text)?record.title:input.text);if(ownTransaction)this.db.exec('COMMIT');
      return this.decode(this.db.prepare('SELECT * FROM events WHERE id=?').get(id)!);
    }catch(e){if(ownTransaction)this.db.exec('ROLLBACK');throw e;}
  }
  get(session:string,branch:string,id:string):ContextEvent|null{digest(id);const scope=this.clause(session,branch),row=this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND id=?`).get(session,...scope.args,id);return row?this.decode(row):null;}
  list(session:string,branch:string,options:{after?:number;limit?:number;mandatory?:boolean;before?:number}={}):ContextEvent[]{const scope=this.clause(session,branch),limit=integer(options.limit??100,1,1024),after=integer(options.after??0,0,Number.MAX_SAFE_INTEGER),before=integer(options.before??Number.MAX_SAFE_INTEGER,0,Number.MAX_SAFE_INTEGER);return this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq>? AND seq<=? ${options.mandatory?'AND mandatory=1':''} ORDER BY seq LIMIT ?`).all(session,...scope.args,after,before,limit).map(row=>this.decode(row));}
  facts(session:string,branch:string,before=Number.MAX_SAFE_INTEGER):ContextEvent[]{const scope=this.clause(session,branch);integer(before,0,Number.MAX_SAFE_INTEGER);return this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND kind IN ('USER_GOAL','USER_REQUIREMENT','TASK_CONTRACT','TASK_DECISION','SOURCE_MODIFIED','TEST_EXECUTED','IMPLEMENTATION_REPORTED','OPEN_ISSUE','NEXT_STEP') ORDER BY seq LIMIT 1024`).all(session,...scope.args,before).map(row=>this.decode(row));}
  contractEvents(session:string,branch:string,before=Number.MAX_SAFE_INTEGER):ContextEvent[]{const scope=this.clause(session,branch);integer(before,0,Number.MAX_SAFE_INTEGER);return this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND kind='TASK_CONTRACT' ORDER BY seq LIMIT 1024`).all(session,...scope.args,before).map(row=>this.decode(row));}
  /** Bounded derived working set. Mandatory originals are never displaced by test/compaction history. */
  currentFacts(session:string,branch:string,before=Number.MAX_SAFE_INTEGER){
    const scope=this.clause(session,branch);integer(before,0,Number.MAX_SAFE_INTEGER);
    const rows=this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND mandatory=1 ORDER BY seq LIMIT 1024`).all(session,...scope.args,before);
    const mandatoryCount=Number(this.db.prepare(`SELECT count(*) AS n FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND mandatory=1`).get(session,...scope.args,before)?.n);
    const omitted:Record<string,number>={};
    for(const [kind,limit]of Object.entries({TASK_DECISION:8,SOURCE_MODIFIED:128,SOURCE_OBSERVED:32,TEST_EXECUTED:32,IMPLEMENTATION_REPORTED:16,OPEN_ISSUE:32,NEXT_STEP:16,TOOL_RESULT:8})){
      const count=Number(this.db.prepare(`SELECT count(*) AS n FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND mandatory=0 AND kind=?`).get(session,...scope.args,before,kind)?.n);
      rows.push(...this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND mandatory=0 AND kind=? ORDER BY seq DESC LIMIT ?`).all(session,...scope.args,before,kind,limit));omitted[kind]=Math.max(0,count-limit);
    }
    return{events:rows.map(row=>this.decode(row)).sort((a,b)=>a.sequence-b.sequence),mandatoryOverflow:mandatoryCount>1024,mandatoryCount,omitted};
  }
  narratives(session:string,branch:string,before=Number.MAX_SAFE_INTEGER):ContextEvent[]{const scope=this.clause(session,branch);return this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq<=? AND kind='NARRATIVE' ORDER BY seq DESC LIMIT 8`).all(session,...scope.args,before).map(row=>this.decode(row));}
  search(session:string,branch:string,query:string,options:{offset?:number;limit?:number}={}):ContextEvent[]{boundedString(query,512);const terms=query.match(/[\p{L}\p{N}_]+/gu)?.slice(0,16)??[];if(!terms.length)return[];const scope=this.clause(session,branch),q=terms.map(t=>'"'+t+'"').join(' AND ');return this.db.prepare(`SELECT e.* FROM events e JOIN history_fts f ON f.rowid=e.seq WHERE history_fts MATCH ? AND session=? AND (${scope.sql}) ORDER BY bm25(history_fts),seq DESC LIMIT ? OFFSET ?`).all(q,session,...scope.args,integer(options.limit??10,1,50),integer(options.offset??0,0,100000)).map(row=>this.decode(row));}
  async original(session:string,branch:string,id:string,maxBytes=this.maxBlobBytes):Promise<{event:ContextEvent;text:string;historical:true}>{const event=this.get(session,branch,id);if(!event)throw Error('History event not found or access denied');if(event.bytes>integer(maxBytes,1,this.maxBlobBytes))throw Error('BUDGET_EXCEEDED');const row=this.db.prepare('SELECT deleted FROM blobs WHERE hash=?').get(event.blobSha256);if(!row||row.deleted)throw Error('History original expired or missing');const file=await this.blobPath(event.blobSha256),handle=await open(file,'r');try{const stat=await handle.stat();if(stat.size!==event.bytes||stat.nlink>1)throw Error('Corrupt history blob');const data=await handle.readFile();if(sha256(data)!==event.blobSha256)throw Error('Corrupt history original');return{event,text:data.toString('utf8'),historical:true};}finally{await handle.close();}}
  timeline(session:string,branch:string,id:string,radius=3):ContextEvent[]{integer(radius,0,20);const event=this.get(session,branch,id);if(!event)throw Error('Event inaccessible');const scope=this.clause(session,branch);const rows=this.db.prepare(`SELECT * FROM events WHERE session=? AND (${scope.sql}) AND seq<=? ORDER BY seq DESC LIMIT ?`).all(session,...scope.args,event.sequence,radius+1).reverse();return[...rows.map(r=>this.decode(r)),...this.list(session,branch,{after:event.sequence,limit:Math.max(1,radius)}).slice(0,radius)];}
  latestSequence(session:string,branch:string):number{const scope=this.clause(session,branch);return Number(this.db.prepare(`SELECT coalesce(max(seq),0) AS n FROM events WHERE session=? AND (${scope.sql})`).get(session,...scope.args)?.n);}
  entryBinding(session:string,entry:string):{branch:string;eventId:string;sequence:number}|null{key(session);key(entry);const row=this.db.prepare('SELECT * FROM entry_bindings WHERE session=? AND entry=?').get(session,entry);return row?{branch:String(row.branch),eventId:String(row.event_id),sequence:Number(row.seq)}:null;}
  bindEntry(session:string,entry:string,event:ContextEvent):void{if(event.sessionId!==session||!this.get(session,event.branchId,event.id))throw Error('Entry binding mismatch');this.db.prepare('INSERT OR IGNORE INTO entry_bindings VALUES(?,?,?,?,?)').run(session,key(entry),event.branchId,event.id,event.sequence);}
  activeBranch(session:string):{branch:string;leaf:string|null}|null{key(session);const row=this.db.prepare('SELECT * FROM active_branches WHERE session=?').get(session);return row?{branch:String(row.branch),leaf:typeof row.leaf==='string'?row.leaf:null}:null;}
  setActiveBranch(session:string,branch:string,leaf:string|null):void{this.scopes(session,branch);if(leaf)key(leaf);this.db.prepare('INSERT INTO active_branches VALUES(?,?,?) ON CONFLICT(session) DO UPDATE SET branch=excluded.branch,leaf=excluded.leaf').run(session,branch,leaf);}
  saveProjection(session:string,branch:string,payload:string):void{this.scopes(session,branch);if(Buffer.byteLength(payload)>524288)throw Error('Manifest too large');this.db.prepare('INSERT INTO projections VALUES(?,?,?) ON CONFLICT(session,branch) DO UPDATE SET payload=excluded.payload').run(session,branch,payload);}
  loadProjection(session:string,branch:string):string|null{this.scopes(session,branch);return this.db.prepare('SELECT payload FROM projections WHERE session=? AND branch=?').get(session,branch)?.payload as string??null;}
  async freshness(source:SourceReference):Promise<'CURRENT'|'STALE'|'MISSING'>{try{return(await this.workspace.read(source.path,this.maxBlobBytes)).sha256===source.sha256?'CURRENT':'STALE';}catch{return'MISSING';}}
  async expireBefore(session:string,branch:string,before:string):Promise<number>{if(!Number.isFinite(Date.parse(before)))throw Error('Invalid retention timestamp');const scope=this.clause(session,branch);let count=0;const rows=this.db.prepare(`SELECT hash FROM blobs WHERE created<? AND deleted=0 AND hash IN (SELECT blob FROM events WHERE session=? AND (${scope.sql})) AND NOT EXISTS(SELECT 1 FROM events e WHERE e.blob=blobs.hash AND NOT(session=? AND (${scope.sql}))) LIMIT 1000`).all(before,session,...scope.args,session,...scope.args);for(const row of rows){const hash=String(row.hash);await unlink(await this.blobPath(hash)).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});this.db.prepare('UPDATE blobs SET deleted=1 WHERE hash=?').run(hash);count++;}await this.append(session,branch,{externalId:randomUUID(),kind:'RETENTION',origin:'host',text:`Expired ${count} original blobs before ${before}; metadata and recall failure markers remain.`});return count;}
  close():void{this.db.close();}
}
