import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'sqlite-vec';
import type { Workspace } from '../workspace.ts';
import type { CodeChunk, GraphEdge, GraphNode, MemoryRecord, ParsedFile, VectorIndex } from './contracts.ts';
import { SqliteKeywordIndex } from './keyword.ts';
import { ExactVectorIndex, SqliteVectorIndex, packVector, unpackVector } from './vectors.ts';
import {randomUUID} from 'node:crypto';
import {GRAPH_RELATIONS,type GraphDirection,type GraphRelation} from './graph-contracts.ts';
export class NativeStore {
  readonly db: DatabaseSync; readonly keyword: SqliteKeywordIndex; readonly vector: VectorIndex | null;
  readonly filename: string; readonly dimension: number;
  private constructor(db: DatabaseSync, filename: string, dimension: number, vectorBackend: string) {
    this.db = db; this.filename = filename; this.dimension = dimension; this.keyword = new SqliteKeywordIndex(db);
    this.vector = dimension ? vectorBackend === 'sqlite-vec' ? new SqliteVectorIndex(db, dimension) : new ExactVectorIndex(db, dimension) : null;
  }
  static async open(workspace: Workspace, stateDir: string, dimension = 0, vectorBackend: 'auto' | 'sqlite-vec' | 'exact' = 'auto'): Promise<NativeStore> {
    if (!Number.isSafeInteger(dimension) || dimension < 0 || dimension > 65536) throw new Error('Invalid vector dimension');
    let directory = workspace.root;
    for (const part of workspace.normalize(stateDir).split('/')) {
      directory = path.join(directory, part);
      try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe native index directory');
    }
    const filename = path.join(directory, 'hybrid.db');
    for (const suffix of ['', '-wal', '-shm', '-journal']) try {
      const stat = await lstat(filename + suffix); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe native index path');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(filename, { allowExtension: true });
      db.exec('PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL;');
      const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1) throw new Error('Unsupported native schema');
      let backend = 'exact';
      if (dimension && vectorBackend !== 'exact') try { load(db); backend = 'sqlite-vec'; }
      catch { if (vectorBackend === 'sqlite-vec') throw new Error('sqlite-vec unavailable'); }
      db.enableLoadExtension(false);
      if (!version) db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE native_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE native_files(path TEXT PRIMARY KEY,sha256 TEXT NOT NULL,language TEXT NOT NULL,diagnostics TEXT NOT NULL);
        CREATE TABLE native_chunks(id TEXT PRIMARY KEY,path TEXT NOT NULL,payload TEXT NOT NULL);
        CREATE VIRTUAL TABLE native_fts USING fts5(id UNINDEXED,content,file_path,language,chunk_type);
        CREATE INDEX native_chunks_path ON native_chunks(path);
        CREATE TABLE native_nodes(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE native_edges(source TEXT NOT NULL,target TEXT NOT NULL,relation TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source,target,relation));
        CREATE INDEX native_edges_source ON native_edges(source);
        CREATE TABLE native_embeddings(key TEXT PRIMARY KEY,dim INTEGER NOT NULL,embedding BLOB NOT NULL);
        CREATE TABLE native_memory(id TEXT PRIMARY KEY,project TEXT NOT NULL,payload TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
      for (const table of ['native_meta', 'native_files', 'native_chunks', 'native_fts', 'native_nodes', 'native_edges', 'native_embeddings', 'native_memory']) {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('Invalid native schema');
      }
      const project = db.prepare("SELECT value FROM native_meta WHERE key='project'").get()?.value;
      if (project && project !== workspace.projectId) throw new Error('Native index belongs to another workspace');
      db.exec('CREATE INDEX IF NOT EXISTS native_edges_out ON native_edges(source,relation,target); CREATE INDEX IF NOT EXISTS native_edges_in ON native_edges(target,relation,source);');
      db.exec('CREATE TABLE IF NOT EXISTS native_chunk_headers(id TEXT PRIMARY KEY,payload TEXT NOT NULL,scoring TEXT NOT NULL);');
      db.prepare('INSERT OR IGNORE INTO native_meta VALUES(?,?)').run('indexIdentity',randomUUID());
      db.prepare('INSERT OR IGNORE INTO native_meta VALUES(?,?)').run('indexGeneration','0');
      const previousDimension = db.prepare("SELECT value FROM native_meta WHERE key='dimension'").get()?.value;
      const previousBackend = db.prepare("SELECT value FROM native_meta WHERE key='vectorBackend'").get()?.value;
      if ((previousDimension !== undefined && Number(previousDimension) !== dimension) || (previousBackend && previousBackend !== backend)) {
        db.exec('DROP TABLE IF EXISTS native_vec; DROP TABLE IF EXISTS native_vec_exact; DELETE FROM native_embeddings;');
        db.prepare("DELETE FROM native_meta WHERE key='fingerprint'").run();
      }
      for (const [key, value] of [['project', workspace.projectId], ['dimension', String(dimension)], ['vectorBackend', backend]]) db.prepare('INSERT OR REPLACE INTO native_meta VALUES(?,?)').run(key!, value!);
      return new NativeStore(db, filename, dimension, backend);
    } catch (error) { db?.close(); throw new Error('Native SQLite unavailable, corrupt, bound to another workspace, or unsupported', { cause: error }); }
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE'); try { const result = action(); this.setMeta('indexGeneration',(BigInt(this.meta('indexGeneration')??'0')+1n).toString());this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  meta(key: string): string | null { const value = this.db.prepare('SELECT value FROM native_meta WHERE key=?').get(key)?.value; return typeof value === 'string' ? value : null; }
  setMeta(key: string, value: string): void { this.db.prepare('INSERT OR REPLACE INTO native_meta VALUES(?,?)').run(key, value); }
  generation():string{return `${this.meta('indexIdentity')}:${this.meta('indexGeneration')}`;}
  graphNode(id:string):GraphNode|null {const r=this.db.prepare('SELECT payload FROM native_nodes WHERE id=?').get(id);return r?JSON.parse(String(r.payload))as GraphNode:null;}
  graphNeighbors(id:string,direction:Exclude<GraphDirection,'both'>,relations:readonly GraphRelation[],limit:number):GraphEdge[]{
    if(!/^[a-f0-9]{64}$/.test(id)||!Number.isSafeInteger(limit)||limit<1||limit>4096||!relations.length||relations.length>GRAPH_RELATIONS.length||relations.some(r=>!GRAPH_RELATIONS.includes(r)))throw new Error('Invalid bounded graph query');
    const incoming=direction==='incoming';if(!incoming&&direction!=='outgoing')throw new Error('Invalid graph direction');
    const column=incoming?'target':'source',other=incoming?'source':'target',index=incoming?'native_edges_in':'native_edges_out';
    return this.db.prepare(`SELECT payload FROM native_edges INDEXED BY ${index} WHERE ${column}=? AND relation IN (${relations.map(()=>'?').join(',')}) ORDER BY relation,${other} LIMIT ?`).all(id,...relations,limit).map(r=>JSON.parse(String(r.payload))as GraphEdge);
  }
  files(): Map<string, string> { return new Map(this.db.prepare('SELECT path,sha256 FROM native_files').all().map(row => [String(row.path), String(row.sha256)])); }
  chunkCount(): number { return Number(this.db.prepare('SELECT count(*) AS n FROM native_chunks').get()?.n ?? 0); }
  chunks(): CodeChunk[] { return this.db.prepare('SELECT payload FROM native_chunks ORDER BY path,id').all().map(row => JSON.parse(String(row.payload)) as CodeChunk); }
  chunk(id: string): CodeChunk | null { const row = this.db.prepare('SELECT payload FROM native_chunks WHERE id=?').get(id); return row ? JSON.parse(String(row.payload)) as CodeChunk : null; }
  private header(chunk:CodeChunk):CodeChunk {
    const {text,signature,docstring,syntax,metadata,baseMetadata,...identity}=chunk;void text;void signature;void docstring;void baseMetadata;
    return{...identity,text:'',signature:'',docstring:'',metadata:typeof metadata.modified_ts==='number'?{modified_ts:metadata.modified_ts}:{},syntax:{bases:[],decorators:syntax.decorators,imports:[],calls:[],references:[],assignment:null}};
  }
  private writeHeader(chunk:CodeChunk):void{
    const header=this.header(chunk),scoring={text:Array.from(chunk.text).slice(0,5000).join('')};
    this.db.prepare('INSERT OR REPLACE INTO native_chunk_headers VALUES(?,?,?)').run(chunk.id,JSON.stringify(header),JSON.stringify(scoring));
  }
  chunkHeaders():CodeChunk[]{return this.db.prepare('SELECT h.payload FROM native_chunk_headers h JOIN native_chunks c ON c.id=h.id ORDER BY c.path,c.id').all().map(r=>JSON.parse(String(r.payload))as CodeChunk);}
  chunkHeader(id:string):CodeChunk|null {const r=this.db.prepare('SELECT payload FROM native_chunk_headers WHERE id=?').get(id);return r?JSON.parse(String(r.payload))as CodeChunk:null;}
  scoringHeaders(ids:readonly string[]):Map<string,CodeChunk>{
    const out=new Map<string,CodeChunk>();for(let i=0;i<ids.length;i+=256){const batch=ids.slice(i,i+256);if(!batch.length)continue;
      for(const r of this.db.prepare(`SELECT payload,scoring FROM native_chunk_headers WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch)){
        const c=JSON.parse(String(r.payload))as CodeChunk;c.text=(JSON.parse(String(r.scoring))as {text:string}).text;out.set(c.id,c);
      }
    }return out;
  }
  removeFile(file: string): void {
    const ids = this.db.prepare('SELECT id FROM native_chunks WHERE path=?').all(file).map(r => String(r.id));
    this.keyword.remove(ids); this.vector?.remove(ids);for(const id of ids)this.db.prepare('DELETE FROM native_chunk_headers WHERE id=?').run(id);
    this.db.prepare('DELETE FROM native_chunks WHERE path=?').run(file); this.db.prepare('DELETE FROM native_files WHERE path=?').run(file);
  }
  replaceFile(file: ParsedFile): void {
    this.removeFile(file.path);
    const insert = this.db.prepare('INSERT INTO native_chunks VALUES(?,?,?)');
    for (const chunk of file.chunks) {insert.run(chunk.id, chunk.path, JSON.stringify(chunk));this.writeHeader(chunk);}
    this.keyword.replace(file.chunks.filter(c => c.retrievable));
    this.db.prepare('INSERT INTO native_files VALUES(?,?,?,?)').run(file.path, file.fileHash, file.language, JSON.stringify(file.diagnostics));
  }
  updateMetadata(chunks: readonly CodeChunk[]): void {
    const update = this.db.prepare('UPDATE native_chunks SET payload=? WHERE id=?');
    for (const chunk of chunks) {update.run(JSON.stringify(chunk), chunk.id);this.writeHeader(chunk);}
  }
  replaceGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): void {
    this.db.exec('DELETE FROM native_edges; DELETE FROM native_nodes;');
    const node = this.db.prepare('INSERT OR REPLACE INTO native_nodes VALUES(?,?)'), edge = this.db.prepare('INSERT OR REPLACE INTO native_edges VALUES(?,?,?,?)');
    for (const n of nodes) node.run(n.id, JSON.stringify(n));
    for (const e of edges) edge.run(e.source, e.target, e.relation, JSON.stringify(e));
  }
  graph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: this.db.prepare('SELECT payload FROM native_nodes ORDER BY id').all().map(r => JSON.parse(String(r.payload)) as GraphNode),
      edges: this.db.prepare('SELECT payload FROM native_edges ORDER BY source,target,relation').all().map(r => JSON.parse(String(r.payload)) as GraphEdge) };
  }
  cached(key: string): Float32Array | null {
    const row = this.db.prepare('SELECT dim,embedding FROM native_embeddings WHERE key=?').get(key);
    return row ? unpackVector(row.embedding as Uint8Array, Number(row.dim)) : null;
  }
  cache(key: string, vector: Float32Array): void { this.db.prepare('INSERT OR REPLACE INTO native_embeddings VALUES(?,?,?)').run(key, vector.length, packVector(vector)); }
  pruneCache(known: ReadonlySet<string>): void { const remove = this.db.prepare('DELETE FROM native_embeddings WHERE key=?'); for (const row of this.db.prepare('SELECT key FROM native_embeddings').all()) if (!known.has(String(row.key))) remove.run(String(row.key)); }
  memories(project: string): MemoryRecord[] { return this.db.prepare('SELECT payload FROM native_memory WHERE project=? ORDER BY id').all(project).map(row => JSON.parse(String(row.payload)) as MemoryRecord); }
  saveMemory(record: MemoryRecord): void { this.db.prepare('INSERT OR REPLACE INTO native_memory VALUES(?,?,?)').run(record.id, record.projectId, JSON.stringify(record)); }
  close(): void { this.db.close(); }
}
