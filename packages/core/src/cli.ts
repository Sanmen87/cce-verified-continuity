import { readFile } from 'node:fs/promises';
import { ContextEngine } from './index.ts';
import { parseJson } from './config.ts';
const [command = 'status', root = '.', argument = '', configPath] = process.argv.slice(2);
let engine: ContextEngine | undefined;
try {
  const config: unknown = configPath ? parseJson(await readFile(configPath, 'utf8')) : {};
  engine = await ContextEngine.open(root, { config });
  let result: unknown;
  switch (command) {
    case 'status': result = engine.getStatus(); break;
    case 'reindex': result = await engine.reindex(); break;
    case 'search': result = await engine.searchCode(argument); break;
    case 'context': result = await engine.buildContext({ task: argument, hits: (await engine.searchCode(argument)).hits }); break;
    case 'save': result = await engine.saveCheckpoint(parseJson(await readFile(argument, 'utf8')) as Parameters<ContextEngine['saveCheckpoint']>[0]); break;
    case 'load': result = await engine.loadCheckpoint(argument); break;
    default: throw new Error('Usage: cce status|reindex|search|context|save|load <root> <query|json-file|task-id> [config-file]');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) { console.error(error instanceof Error ? error.message : 'CCE failed'); process.exitCode = 1; }
finally { engine?.close(); }
