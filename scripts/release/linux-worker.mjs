import fs from 'node:fs/promises';
import { exec, write } from './common.mjs';
const status = { status: 'RUNNING', node: process.version, platform: process.platform, modelRequests: 0, checks: [] };
try {
 process.env.npm_config_cache = '/work/npm-cache';
 await fs.cp('/input', '/work/project', { recursive: true }); process.chdir('/work/project');
 await exec('git', ['init', '--quiet'], { windowsHide: true }); await exec('git', ['add', '.'], { windowsHide: true });
 await exec('git', ['-c', 'user.name=CCE Release Test', '-c', 'user.email=cce@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Reviewed public source smoke'], { windowsHide: true });
 const commands = [
  ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'typecheck'], ['run', 'test:public'], ['run', 'test:release'], ['run', 'test:evaluation'],
  ['run', 'build'], ['run', 'smoke:pi'], ['run', 'release:stage'], ['run', 'release:audit'], ['run', 'release:pack'], ['run', 'release:clean-install'],
 ];
 for (const [index, args] of commands.entries()) {
  const label = String(index + 1).padStart(2, '0') + '-' + args.join('-').replaceAll(':', '-');
  console.log('CHECK ' + label);
  try {
   const result = await exec(process.execPath, ['/usr/local/lib/node_modules/npm/bin/npm-cli.js', ...args], { timeout: 360000, maxBuffer: 16777216, env: { ...process.env, npm_execpath: '/usr/local/lib/node_modules/npm/bin/npm-cli.js' } });
   await fs.writeFile('/output/' + label + '.log', result.stdout + result.stderr); status.checks.push({ command: args, status: 'PASS' });
  } catch (error) { await fs.writeFile('/output/' + label + '.log', String(error.stdout ?? '') + String(error.stderr ?? '')); throw error; }
 }
 for (const file of ['clean-install.json', 'release-audit.json']) await fs.copyFile('release-artifacts/' + file, '/output/' + file);
 status.status = 'PASS';
} catch (error) { status.status = 'FAIL'; status.error = String(error.message).slice(0, 2048); process.exitCode = 1; }
finally { await write('/output/result.json', status); console.log(JSON.stringify(status)); }
