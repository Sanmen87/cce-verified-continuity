import path from 'node:path';
import {lstat,mkdir,open} from 'node:fs/promises';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createCceServer,type ToolTrace} from './index.ts';
const args=process.argv.slice(2),value=(key:string)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
if(args.some((v,i)=>i%2===0&&!['--root','--log','--mode'].includes(v))||args.length%2||!value('--root'))throw Error('Usage: --root <fixed workspace> [--log <host log.jsonl>] [--mode cce|workspace|combined]');
const root=path.resolve(value('--root')!),mode=value('--mode')??'cce';
if(!['cce','workspace','combined'].includes(mode))throw Error('Invalid mode');
const log=value('--log');let handle:Awaited<ReturnType<typeof open>>|undefined;
if(log){const file=path.resolve(log);await mkdir(path.dirname(file),{recursive:true});
 for(let dir=path.dirname(file);;dir=path.dirname(dir)){if((await lstat(dir)).isSymbolicLink())throw Error('Linked log directory');if(path.dirname(dir)===dir)break;}
 try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>8388608)throw Error('Unsafe log file');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 handle=await open(file,'a',0o600);const s=await handle.stat();if(s.nlink!==1)throw Error('Linked log file');
}
const trace=async(event:ToolTrace)=>{if(handle){if((await handle.stat()).size>8388608)throw Error('Log quota reached');await handle.appendFile(JSON.stringify(event)+'\n');}};
const app=await createCceServer(root,{mode:mode as 'cce'|'workspace'|'combined',trace});
let closed=false;async function close(){if(closed)return;closed=true;await app.close();await handle?.close();}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
await app.server.connect(new StdioServerTransport());app.server.onclose=()=>void close();
