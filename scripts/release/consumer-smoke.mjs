// Copied into a new OS-temp project: imports must resolve from installed tarballs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const scope = process.argv[2], withHost = process.argv.includes('--pi');
const { ContextEngine, parseConfig } = await import(scope + '/core');
assert.equal(parseConfig().mode, 'observe-only'); assert.equal(parseConfig().lifecycle.enabled, false); assert.equal(parseConfig().hybrid.enableVector, false);
const project = path.join(process.cwd(), 'sample'); await fs.mkdir(project);
await fs.writeFile(project + '/example.py', 'class ReleaseExample:\n    def run(self):\n        return 1\n');
const engine = await ContextEngine.open(project, { config: { retrieval: { backend: 'hybrid-native' }, hybrid: { enableVector: false } } });
try { await engine.reindex(); assert.ok((await engine.searchCode('ReleaseExample')).hits.length); } finally { engine.close(); }
if (withHost) {
 const { DefaultResourceLoader, SettingsManager } = await import('@earendil-works/pi-coding-agent');
 const agentDir = path.join(process.cwd(), 'agent'); await fs.mkdir(agentDir);
 const installed = path.join(process.cwd(), 'node_modules', scope, 'pi-extension');
 const loader = new DefaultResourceLoader({ cwd: project, agentDir, settingsManager: SettingsManager.inMemory({ packages: [installed] }), disabledBuiltinExtensions: ['mcp', 'codemode'], noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
 await loader.reload(); const extensions = loader.getExtensions(); assert.deepEqual(extensions.errors, []); assert.deepEqual(extensions.warnings ?? [], []);
 assert.ok(extensions.extensions.some(extension => extension.tools.has('cce_search_code')));
}
if (withHost || process.argv.includes('--mcp')) { const { createCceServer } = await import(scope + '/mcp'); const app = await createCceServer(project); await app.close(); }
console.log(JSON.stringify({ status: 'PASS', installedCoreNativeAst: true, vectorEnabled: false, piCompiledLoader: withHost, modelRequests: 0, workspaceOutsideCheckout: true }));
