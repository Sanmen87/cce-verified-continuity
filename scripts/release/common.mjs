import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
export const exec = promisify(execFile);
export const hash = data => createHash('sha256').update(data).digest('hex');
export const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const write = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
export async function npm(args, options = {}) {
 const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
 let cli;
 for (const file of candidates) if (await fs.stat(file).catch(() => null)) { cli = file; break; }
 if (!cli) throw Error('Run this command through npm run so npm_execpath identifies npm-cli.js');
 return exec(process.execPath, [cli, ...args], { windowsHide: true, timeout: 300000, maxBuffer: 16777216, ...options });
}
export async function walk(root) {
 const files = [];
 async function visit(directory, prefix = '') {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
   const relative = prefix ? prefix + '/' + entry.name : entry.name, file = path.join(directory, entry.name), stat = await fs.lstat(file);
   if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw Error('Linked release input: ' + relative);
   if (stat.isDirectory()) await visit(file, relative); else if (stat.isFile()) files.push(relative); else throw Error('Unsupported release input');
  }
 }
 await visit(root); return files;
}
