import { execFile } from 'node:child_process';
export function run(file: string, args: string[], cwd: string, accepted = [0]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, shell: false }, (error, stdout) => {
      if (error && (error.killed || error.signal || !accepted.includes(Number(error.code)))) {
        // Never include stderr, arguments, source text, or environment in diagnostics.
        reject(new Error(`Subprocess ${file} failed (${error.code ?? 'unknown'}); check installation or limits`));
      } else resolve(stdout);
    });
  });
}
