// Public-source-only Linux check. Docker build context contains only a toolchain Dockerfile.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec, read, write } from './common.mjs';
const source = await read('release-artifacts/public-source.json'), id = new Date().toISOString().replaceAll(/[:.]/g, '-');
const root = path.resolve('.bench/release-hardening/linux-' + id), context = root + '/context', output = root + '/output';
await fs.mkdir(context, { recursive: true }); await fs.mkdir(output);
const base = 'node:22.19.0-bookworm-slim';
await exec('docker', ['pull', base], { windowsHide: true, timeout: 300000, maxBuffer: 4194304 });
const info = JSON.parse((await exec('docker', ['image', 'inspect', base], { windowsHide: true })).stdout)[0];
const digest = info.RepoDigests?.[0]; if (!digest) throw Error('Official Node image digest missing');
await fs.writeFile(context + '/Dockerfile', 'ARG BASE\nFROM ${BASE}\nRUN apt-get update && apt-get install -y --no-install-recommends git python3 ripgrep && rm -rf /var/lib/apt/lists/*\nUSER 1000:1000\nWORKDIR /work\n');
const image = 'cce-release-node22:local';
console.log(JSON.stringify({ event: 'BUILD_TOOLCHAIN', baseDigest: digest }));
const build = await exec('docker', ['build', '--build-arg', 'BASE=' + digest, '-t', image, context], { windowsHide: true, timeout: 300000, maxBuffer: 8388608 }); await fs.writeFile(root + '/build.log', build.stdout + build.stderr);
const imageId = JSON.parse((await exec('docker', ['image', 'inspect', image], { windowsHide: true })).stdout)[0].Id;
const name = 'cce-release-check-' + randomUUID().slice(0, 8);
for (const directory of [source.directory, output]) if (/[\r\n,]/.test(path.resolve(directory))) throw Error('Unsafe mount path');
const args = ['run', '--name', name, '--rm', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g', '--cpus', '2',
 '--tmpfs', '/work:rw,exec,nosuid,nodev,size=2147483648,uid=1000,gid=1000', '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=2147483648,uid=1000,gid=1000',
 '--mount', 'type=bind,source=' + path.resolve(source.directory) + ',target=/input,readonly', '--mount', 'type=bind,source=' + output + ',target=/output', imageId, 'node', '/input/scripts/release/linux-worker.mjs'];
await write(root + '/launch.json', { args, publicSourceOnly: true, baseDigest: digest, imageId });
try { const result = await exec('docker', args, { windowsHide: true, timeout: 1200000, maxBuffer: 16777216 }); await fs.writeFile(root + '/run.log', result.stdout + result.stderr); }
catch (error) { await fs.writeFile(root + '/run.log', String(error.stdout ?? '') + String(error.stderr ?? '')); throw error; }
finally { await exec('docker', ['rm', '-f', name], { windowsHide: true }).catch(() => {}); await write('.bench/release-hardening/linux-latest.json', { root, output }); }
const result = await read(output + '/result.json');
await write('release-artifacts/linux-node22.json', { ...result, baseDigest: digest, imageId, sourceFiles: source.files.length, sourceGitHistoryCopied: false, limitation: 'Local Linux Docker run; hosted GitHub matrix remains a separate check' });
console.log(JSON.stringify({ status: result.status, node: result.node, checks: result.checks.length, modelRequests: 0 }));
