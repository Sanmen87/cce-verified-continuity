import { conservativeCounter } from './compiler.ts';
import type { CompiledHandoff, MiniCompressor, TokenCounter } from './contracts.ts';
/** Optional compressor may select verbatim spans only. It cannot author new factual claims. */
export async function compressNarratives(baseline:CompiledHandoff,provider:MiniCompressor|undefined,narratives:Array<{id:string;text:string}>,timeoutMs=10000,counter:TokenCounter=conservativeCounter){
  const started=performance.now(),controller=new AbortController();
  const fallback=(reason:string)=>({handoff:baseline,status:'DETERMINISTIC_FALLBACK',reason,ms:performance.now()-started,providerUsage:null});
  if(!provider||!narratives.length)return fallback(!provider?'Provider unavailable':'No eligible narrative sections');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const result=await Promise.race([provider.compress({narratives:structuredClone(narratives),signal:controller.signal}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);})]);
    if(!result||typeof result!=='object'||!Array.isArray((result as {sections?:unknown}).sections))return fallback('Malformed compressor response');
    let text=baseline.text;const seen=new Set<string>();
    for(const raw of (result as {sections:unknown[]}).sections){if(!raw||typeof raw!=='object')return fallback('Invalid narrative section');const row=raw as {id?:unknown;text?:unknown},original=narratives.find(n=>n.id===row.id);
      if(!original||!/^[a-f0-9]{64}$/.test(original.id)||typeof row.text!=='string'||seen.has(original.id)||!original.text.includes(row.text))return fallback('Invented or changed narrative');
      const block=`<CCE_NARRATIVE id="${original.id}">\n${original.text}\n</CCE_NARRATIVE>`;
      if(!text.includes(block)||text.indexOf(block)!==text.lastIndexOf(block))return fallback('Narrative not independently delimited');
      seen.add(original.id);text=text.replace(block,`<CCE_NARRATIVE id="${original.id}">\n${row.text}\n</CCE_NARRATIVE>`);
    }
    const tokens=await counter.count(text);if(tokens>baseline.budget||tokens>baseline.tokens)return fallback('Budget audit failed');
    return{handoff:{...baseline,text,tokens},status:'COMPRESSED',reason:null,ms:performance.now()-started,providerUsage:null};
  }catch{return fallback('Provider failed or timed out');}finally{if(timer)clearTimeout(timer);controller.abort();}
}
