import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
const files = JSON.parse(await fs.readFile('release/public-tests.json', 'utf8'));
for (const file of files) {
 if (!/^[a-z0-9-]+\.test\.ts$/.test(file)) throw Error('Invalid public test name');
 const source = await fs.readFile('tests/' + file, 'utf8');
 if (/scripts\/benchmark|benchmarks\/|prepare-benchmark/.test(source)) throw Error('Private harness dependency in public test: ' + file);
}
const child = spawn(process.execPath, ['--experimental-strip-types', '--test', ...files.map(file => 'tests/' + file)], { stdio: 'inherit', windowsHide: true });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
