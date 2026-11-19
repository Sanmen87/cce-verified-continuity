// Test the declared Windows Node floor using an official checksum-verified runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { exec, read, write, hash } from './common.mjs';
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This local verification helper targets Windows x64');
const root = path.resolve('.bench/release-hardening/windows-node22-' + new Date().toISOString().replaceAll(/[:.]/g, '-')); await fs.mkdir(root, { recursive: true });
const file = 'node-v22.19.0-win-x64.zip', base = 'https://nodejs.org/dist/v22.19.0';
const sumsResponse = await fetch(base + '/SHASUMS256.txt', { signal: AbortSignal.timeout(120000) }); assert.equal(sumsResponse.status, 200);
const expected = (await sumsResponse.text()).split('\n').find(line => line.endsWith('  ' + file))?.split(' ')[0]; assert.match(expected ?? '', /^[a-f0-9]{64}$/);
const response = await fetch(base + '/' + file, { signal: AbortSignal.timeout(120000) }); assert.equal(response.status, 200);
const zip = Buffer.from(await response.arrayBuffer()); assert.equal(hash(zip), expected); await fs.writeFile(root + '/' + file, zip, { flag: 'wx' });
await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:CCE_RELEASE_NODE_ZIP -DestinationPath $env:CCE_RELEASE_NODE_EXTRACT'], { windowsHide: true, timeout: 120000, env: { ...process.env, CCE_RELEASE_NODE_ZIP: root + '/' + file, CCE_RELEASE_NODE_EXTRACT: root + '/runtime' } });
const binary = root + '/runtime/node-v22.19.0-win-x64/node.exe', npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const env = { ...process.env, PATH: path.dirname(binary) + path.delimiter + process.env.PATH, npm_execpath: npmCli };
assert.equal((await exec(binary, ['--version'], { windowsHide: true })).stdout.trim(), 'v22.19.0');
const checks = [];
for (const [name, args] of [
 ['typecheck', [npmCli, 'run', 'typecheck']], ['public-tests', [npmCli, 'run', 'test:public']], ['release-tests', [npmCli, 'run', 'test:release']],
 ['evaluation-tests', [npmCli, 'run', 'test:evaluation']],
 ['continuity-demo', [npmCli, 'run', 'demo:continuity']],
 ['build', [npmCli, 'run', 'build']], ['pi-smoke', [npmCli, 'run', 'smoke:pi']], ['pack', ['scripts/release/pack.mjs']], ['clean-install', [npmCli, 'run', 'release:clean-install']],
]) {
 console.log('CHECK ' + name);
 try { const result = await exec(binary, args, { env, windowsHide: true, timeout: 360000, maxBuffer: 16777216 }); await fs.writeFile(root + '/' + name + '.log', result.stdout + result.stderr); checks.push({ name, status: 'PASS' }); }
 catch (error) { await fs.writeFile(root + '/' + name + '.log', String(error.stdout ?? '') + String(error.stderr ?? '')); throw error; }
}
const report = { at: new Date().toISOString(), status: 'PASS', node: 'v22.19.0', platform: 'win32-x64', source: base, zipSha256: expected, runtimeSha256: hash(await fs.readFile(binary)), checks, cleanConsumers: await read('release-artifacts/clean-install.json'), modelRequests: 0, hostedGitHubCi: 'NOT_RUN' };
await write('release-artifacts/windows-node22.json', report); await write('.bench/release-hardening/windows-latest.json', { root });
console.log(JSON.stringify({ status: 'PASS', node: report.node, checks: checks.length, modelRequests: 0 }));
