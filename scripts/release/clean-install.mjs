import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { npm, exec, read, write, hash } from './common.mjs';
const packed = await read('release-artifacts/latest.json');
for (const pkg of packed.packages) assert.equal(hash(await fs.readFile(pkg.tarball)), pkg.sha256);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cce-release-consumer-'));
const relative = path.relative(path.resolve('.'), temp); assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'Consumer must be outside checkout');
const reports = [];
for (const mode of ['core-alone', 'core-mcp', 'host-and-adapters']) {
 const directory = path.join(temp, mode); await fs.mkdir(directory);
 await write(directory + '/package.json', { name: 'cce-clean-consumer', version: '0.0.0', private: true, type: 'module' });
 await fs.writeFile(directory + '/empty.npmrc', 'registry=https://registry.npmjs.org/\nignore-scripts=true\naudit=false\nfund=false\n');
 const env = { ...process.env, NODE_PATH: '', NPM_CONFIG_USERCONFIG: directory + '/empty.npmrc' };
 delete env.CCE_CONFIG; delete env.NODE_OPTIONS;
 const selected = packed.packages.filter(pkg => mode === 'core-alone' ? pkg.name === packed.scope + '/core' : mode === 'core-mcp' ? pkg.name !== packed.scope + '/pi-extension' : true);
 const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', ...selected.map(pkg => path.resolve(pkg.tarball))];
 args.push('typescript@5.9.3', '@types/node@22.19.19');
 if (mode === 'host-and-adapters') args.push('@earendil-works/pi-coding-agent@' + (await read('release/config.json')).piTestedVersion);
 const install = await npm(args, { cwd: directory, env });
 await fs.copyFile('scripts/release/consumer-smoke.mjs', directory + '/smoke.mjs');
 const smoke = await exec(process.execPath, ['smoke.mjs', packed.scope, ...(mode === 'host-and-adapters' ? ['--pi'] : mode === 'core-mcp' ? ['--mcp'] : [])], { cwd: directory, env, windowsHide: true, timeout: 120000, maxBuffer: 2097152 });
 if (mode !== 'host-and-adapters') assert.equal(await fs.stat(directory + '/node_modules/@earendil-works/pi-coding-agent').then(() => true, () => false), false, 'Core/MCP must not install Pi');
 let strictConsumerTypes = 'PASS', upstreamDeclarationIssue = null;
 {
  await write(directory + '/tsconfig.json', { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] }, include: ['consumer.ts'] });
  await fs.writeFile(directory + '/consumer.ts', `import { ContextEngine, parseConfig } from '${packed.scope}/core';\nconst config = parseConfig({ lifecycle: { currentWorkEnabled: false } });\nvoid ContextEngine.open; void config;\n` + (mode === 'host-and-adapters' ? `import { registerCce, type ExtensionOptions } from '${packed.scope}/pi-extension';\nconst options: ExtensionOptions = { config };\nvoid registerCce; void options;\n` : '') + (mode !== 'core-alone' ? `import { createCceServer } from '${packed.scope}/mcp';\nvoid createCceServer;\n` : ''));
  try { await exec(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'], { cwd: directory, env, windowsHide: true, maxBuffer: 4194304 }); }
  catch (error) {
   const lines = String(error.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
   if (mode !== 'host-and-adapters' || !lines.length || !lines.every(line => /node_modules\/@earendil-works\/pi-ai\/dist\/providers\/[^/]+\.models\.d\.ts.*error TS1543/.test(line.replaceAll('\\', '/')))) throw error;
   upstreamDeclarationIssue = { package: '@earendil-works/pi-ai', code: 'TS1543', affectedDeclarationCount: lines.length, condition: 'Generated JSON imports in host declarations lack NodeNext import attributes', originalStrictCheck: 'FAIL_UPSTREAM_ONLY', workaround: 'skipLibCheck:true for Pi consumer; CCE core and MCP checked separately with skipLibCheck:false' };
   const tsconfig = await read(directory + '/tsconfig.json'); tsconfig.compilerOptions.skipLibCheck = true; await write(directory + '/tsconfig.json', tsconfig);
   await exec(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'], { cwd: directory, env, windowsHide: true, maxBuffer: 4194304 });
   strictConsumerTypes = 'PASS_APPLICATION_STRICT_WITH_DOCUMENTED_UPSTREAM_SKIPLIBCHECK';
  }
 }
 reports.push({ mode, install: 'PASS', smoke: JSON.parse(smoke.stdout.trim().split('\n').at(-1)), strictConsumerTypes, upstreamDeclarationIssue, installLogSha256: hash(install.stdout + install.stderr), sourceCheckoutDependenciesAccessible: false });
}
await write('release-artifacts/clean-install.json', { at: new Date().toISOString(), status: 'PASS', projectLocation: 'Fresh OS temporary directories outside checkout; no node_modules links or NODE_PATH', node: process.version, packages: packed.packages.map(pkg => ({ name: pkg.name, sha256: pkg.sha256 })), reports, modelRequests: 0 });
await write('.bench/release-hardening/last-consumer.json', { temp, reports });
console.log(JSON.stringify({ status: 'PASS', consumers: reports.length, reports, modelRequests: 0 }));
