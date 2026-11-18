import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { boundedString } from './config.ts';
import { validateCheckpoint } from './checkpoints.ts';
import type { Checkpoint } from './types.ts';
import type { Workspace } from './workspace.ts';
export class SqliteStorage {
  private db: DatabaseSync;
  private constructor(db: DatabaseSync) { this.db = db; }
  static async open(workspace: Workspace, stateDir: string): Promise<SqliteStorage> {
    const relative = workspace.normalize(stateDir);
    let directory = workspace.root;
    for (const part of relative.split('/')) {
      directory = path.join(directory, part);
      try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Cannot create state directory');
      }
      const entry = await lstat(directory);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Unsafe state directory');
    }
    const filename = path.join(directory, 'state.db');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        const entry = await lstat(filename + suffix);
        if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('Unsafe SQLite path');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(filename);
      db.exec('PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL;');
      const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1) throw new Error('Unsupported SQLite schema');
      if (version === 0) db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE checkpoints(project TEXT NOT NULL, session TEXT NOT NULL, task TEXT NOT NULL,
          payload TEXT NOT NULL, PRIMARY KEY(project,session,task));
        CREATE TABLE manifest(project TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL,
          PRIMARY KEY(project,path));
        CREATE TABLE metrics(id INTEGER PRIMARY KEY, project TEXT NOT NULL, session TEXT NOT NULL,
          name TEXT NOT NULL, value REAL NOT NULL, source TEXT NOT NULL, savedAt TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
      return new SqliteStorage(db);
    } catch { db?.close(); throw new Error('SQLite unavailable, corrupt, or unsupported; state file was not replaced'); }
  }
  save(checkpoint: Checkpoint): void {
    const payload = JSON.stringify(validateCheckpoint(checkpoint));
    if (Buffer.byteLength(payload) > 65536) throw new Error('Checkpoint exceeds 64 KiB');
    this.db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?)')
      .run(checkpoint.projectId, checkpoint.sessionId, checkpoint.taskId, payload);
  }
  load(project: string, session: string, task: string): Checkpoint | null {
    const row = this.db.prepare('SELECT payload FROM checkpoints WHERE project=? AND session=? AND task=?').get(project, session, task);
    if (!row) return null;
    if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > 65536) throw new Error('Invalid stored checkpoint');
    try { return validateCheckpoint(JSON.parse(row.payload)); }
    catch { throw new Error('Invalid or incompatible checkpoint data'); }
  }
  replaceManifest(project: string, files: Array<{ path: string; sha256: string }>): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM manifest WHERE project=?').run(project);
      const insert = this.db.prepare('INSERT INTO manifest VALUES(?,?,?)');
      for (const file of files) insert.run(project, file.path, file.sha256);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  manifestCount(project: string): number {
    return Number(this.db.prepare('SELECT count(*) AS count FROM manifest WHERE project=?').get(project)?.count ?? 0);
  }
  metric(project: string, session: string, name: string, value: number, source: 'measured' | 'estimated'): void {
    if (!Number.isFinite(value) || value < 0 || !/^[a-z_.]+$/.test(name)) throw new Error('Invalid metric');
    boundedString(session, 256);
    this.db.prepare('INSERT INTO metrics(project,session,name,value,source,savedAt) VALUES(?,?,?,?,?,?)')
      .run(project, session, name, value, source, new Date().toISOString());
  }
  close(): void { this.db.close(); }
}
