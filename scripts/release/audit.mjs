import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, read, walk, exec, write } from './common.mjs';

export function scanText(text) {
 const rules = {
  'private-profile-path': /[A-Z]:[\\/]+(?:Users|projects)[\\/]+[A-Za-z0-9_. -]+[\\/]/i,
  'private-unix-profile': /\/(?:Users|home)\/(?!runner(?:\/|\b)|user(?:\/|\b)|example(?:\/|\b))[A-Za-z0-9_.-]+\//,
  'github-token': /gh[pousr]_[A-Za-z0-9]{24,}/,
  'npm-token': /npm_[A-Za-z0-9]{24,}/,
  'openai-token': /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,
  'aws-access-key': /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  'private-key': /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m,
  'token-based-workflow': /secrets\.(?:NPM_TOKEN|NODE_AUTH_TOKEN)/,
 };
 return Object.entries(rules).filter(([, pattern]) => pattern.test(text)).map(([rule]) => rule);
}
export function forbiddenPath(relative) {
 return relative.split('/').some(part => ['.bench', 'benchmark', 'benchmarks', 'experiments', '.context-engine', 'node_modules', '.aws', '.codex', '.agents'].includes(part)) || /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|acceptance-cases\.json|[^/]*oracle[^/]*)$|\.(?:log|db|sqlite|sse|jsonl|map)$/i.test(relative);
}
export async function scanTree(root) {
 const findings = [], files = await walk(root);
 for (const file of files) {
  if (forbiddenPath(file)) findings.push({ file, rule: 'private-artifact-path' });
  const bytes = await fs.readFile(path.join(root, file));
  if (file.endsWith('.wasm')) continue; // Pinned separately against the grammar SHA manifest.
  for (const rule of scanText(bytes.toString('utf8'))) findings.push({ file, rule });
 }
 return { files: files.length, findings, status: findings.length ? 'FAIL' : 'PASS' };
}
export async function dependencyLicenses() {
 const lock = await read('package-lock.json'), rows = [];
 for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location.startsWith('node_modules/') || entry.link) continue;
  const id = location.slice(location.lastIndexOf('node_modules/') + 13);
  const installed = await read(location + '/package.json').catch(() => null);
  const license = installed?.license ?? entry.license ?? 'UNKNOWN';
  rows.push({ name: id, version: entry.version, license, developmentOnly: Boolean(entry.dev), installed: Boolean(installed), permitted: typeof license === 'string' && /^(?:MIT|Apache-2\.0|ISC|BSD-[23]-Clause|0BSD|CC0-1\.0|Unlicense|BlueOak-1\.0\.0|Python-2\.0|\(MIT OR)/.test(license) });
 }
 return { scope: 'Root lockfile; host Pi development dependencies distinguished from shipped CCE dependencies', dependencies: rows, review: rows.filter(row => !row.permitted) };
}
export async function historyAudit() {
 const args = ['-c', 'safe.directory=' + process.cwd()];
 const history = await exec('git', [...args, 'rev-list', '--all', '--objects', '--reflog'], { windowsHide: true, maxBuffer: 16777216 }).catch(error => { if (/does not have any commits|bad default revision/.test(String(error.stderr))) return { stdout: '' }; throw error; });
 const tracked = (await exec('git', [...args, 'ls-files', '-z'], { windowsHide: true, maxBuffer: 16777216 })).stdout.split('\0').filter(Boolean);
 const objects = history.stdout.trim().split('\n').filter(Boolean), findings = [];
 for (const line of objects) {
  const [id, ...parts] = line.split(' '), file = parts.join(' ');
  if (!file) continue;
  if (forbiddenPath(file)) findings.push({ file, rule: 'private-history-path' });
  const kind = (await exec('git', [...args, 'cat-file', '-t', id], { windowsHide: true })).stdout.trim();
  if (kind !== 'blob' || file.endsWith('.wasm')) continue;
  const content = (await exec('git', [...args, 'cat-file', '-p', id], { windowsHide: true, maxBuffer: 16777216 })).stdout;
  for (const rule of scanText(content)) findings.push({ file, object: id, rule });
 }
 for (const file of tracked) if (forbiddenPath(file)) findings.push({ file, rule: 'private-index-path' });
 return { objectsReachableIncludingReflogs: objects.length, trackedFiles: tracked.length, status: findings.length ? 'FAIL' : 'PASS', unborn: objects.length === 0, findings, scope: 'All refs and reflogs plus index; empty original object database verified separately before hardening' };
}
async function main() {
 const stage = process.argv[2] ?? (await read('release-artifacts/public-source.json')).directory;
 const result = { at: new Date().toISOString(), tree: await scanTree(stage), history: await historyAudit(), licenses: await dependencyLicenses(), secretsPolicy: 'Only rule IDs and filenames are reported; no matched secret text', limitation: 'Pattern audit is not proof of absence of every possible credential; public source uses explicit allowlists' };
 await write('release-artifacts/release-audit.json', result);
 console.log(JSON.stringify({ tree: result.tree.status, history: result.history.status, files: result.tree.files, licenseReview: result.licenses.review }));
 if (result.tree.status !== 'PASS' || result.history.status !== 'PASS' || result.licenses.review.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
