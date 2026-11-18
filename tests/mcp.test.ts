import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,symlink,mkdir} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createCceServer,type ToolTrace} from '../packages/mcp/src/index.ts';
import {sha256} from '../packages/core/src/index.ts';
const json=(r:any)=>JSON.parse(r.content[0].text);
test('MCP actual protocol searches source, expands current SHA and records bounded metadata without source bodies',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-mcp-')),text='export function eligible(value: number) { return value >= 5000; }\n';await writeFile(path.join(root,'rules.ts'),text);
 const traces:ToolTrace[]=[],app=await createCceServer(root,{trace:e=>{traces.push(e);}}),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 t.after(async()=>{await client.close();await app.close();});await app.server.connect(a);await client.connect(b);
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['cce_search','cce_expand']);
 const found=await client.callTool({name:'cce_search',arguments:{query:'eligible'}});assert.equal(found.isError,false);assert.equal(json(found).hits[0].path,'rules.ts');
 const expanded=await client.callTool({name:'cce_expand',arguments:{path:'rules.ts',sha256:sha256(text)}});assert.equal(json(expanded).text,text);assert.equal(json(expanded).representation,'FULL_FILE');
 assert.equal(traces.length,4);assert.equal(traces[0]!.callId,traces[1]!.callId);assert.ok(traces[1]!.responseSha256);assert.doesNotMatch(JSON.stringify(traces),/return value|export function/);
 await writeFile(path.join(root,'rules.ts'),text+'// changed');assert.equal(json(await client.callTool({name:'cce_expand',arguments:{path:'rules.ts',sha256:sha256(text)}})).status,'STALE_SOURCE');
 const secret='sk-'+ 'x'.repeat(24);assert.equal(json(await client.callTool({name:'cce_search',arguments:{query:secret}})).status,'POTENTIAL_SECRET');assert.ok(!JSON.stringify(traces).includes(secret));
});
test('MCP refuses traversal, symlink escape, secrets, extra arguments and excludes CCE in baseline mode',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-mcp-safe-')),outside=await mkdtemp(path.join(tmpdir(),'cce-mcp-out-'));await writeFile(path.join(root,'ok.ts'),'public');await writeFile(path.join(root,'.env'),'private');await writeFile(path.join(outside,'outside.ts'),'canary');await symlink(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');
 const app=await createCceServer(root,{mode:'workspace'}),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();t.after(async()=>{await client.close();await app.close();});await app.server.connect(a);await client.connect(b);
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['workspace_list_files','workspace_read_file']);
 for(const file of ['../outside.ts','.env','escape/outside.ts',path.join(outside,'outside.ts')])assert.equal((await client.callTool({name:'workspace_read_file',arguments:{path:file}})).isError,true);
 assert.equal(json(await client.callTool({name:'cce_search',arguments:{query:'ok'}})).status,'UNKNOWN_TOOL');
 assert.equal(json(await client.callTool({name:'workspace_list_files',arguments:{command:'execute'}})).status,'INVALID_ARGUMENTS');
 assert.equal(json(await client.callTool({name:'workspace_read_file',arguments:{path:'ok.ts',startLine:0}})).status,'INVALID_RANGE');
 await writeFile(path.join(root,'large.txt'),'a'.repeat(50000));assert.equal(json(await client.callTool({name:'workspace_read_file',arguments:{path:'large.txt'}})).status,'BUDGET_EXCEEDED');
 assert.equal(await readFile(path.join(root,'ok.ts'),'utf8'),'public');
});
test('MCP stdio CLI starts with a real client and writes valid start/end JSONL separately from protocol stdout',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-mcp-stdio-'));await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/a.ts'),'export const A=1;');const log=path.join(root,'.context-engine/calls.jsonl');
 const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',path.resolve('packages/mcp/src/cli.ts'),'--root',root,'--log',log,'--mode','workspace'],stderr:'pipe'}),client=new Client({name:'stdio-test',version:'1'});t.after(()=>client.close());await client.connect(transport);
 const reply=await client.callTool({name:'workspace_read_file',arguments:{path:'src/a.ts'}});assert.equal(reply.isError,false);assert.equal(json(reply).text,'export const A=1;');
 const lines=(await readFile(log,'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.deepEqual(lines.map(x=>x.event),['tool_start','tool_end']);assert.equal(lines[1].sources[0].path,'src/a.ts');
});
