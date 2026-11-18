import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CceConfig } from '../../core/src/config.ts';
import { estimateTokens } from '../../core/src/context.ts';
import type { TokenCounter } from '../../core/src/lifecycle/contracts.ts';
import {providerPacket} from './provider-packet.ts';
export interface ContextBudget {
  windowTokens: number; occupiedTokens: number; historyTokens: number; overheadTokens: number;
  envelopeTokens: number; textBudget: number; availableTokens: number; source: 'estimated'|'pi-usage'|'model-tokenizer';
  outputReserveTokens:number;historyKnown:boolean;anchorVerified:boolean;anchoredTrailingTokens:number|null;
}

/** Usage anchors can include a previous ephemeral recovery that is absent from
 * this frame, while raw Pi tool tails can greatly overestimate occupancy. Prefer
 * the matching host tokenizer on the current SDK-serialized frame, even when an
 * anchor survived. Keep the anchored/conservative fallback if capture fails.
 * JSON metadata and an extra envelope remain conservative overhead; this is not
 * an exact provider request/cost measurement. Failures retain the byte guard. */
export async function recoveryBudget(pi:ExtensionAPI,ctx:ExtensionContext,config:CceConfig,requested:number,counter?:TokenCounter,messages?:readonly unknown[]):Promise<ContextBudget>{
  const fallback=contextBudget(pi,ctx,config,requested);
  if(!fallback.historyKnown||counter?.source!=='model-tokenizer'||!ctx.model?.id||counter.modelId!==ctx.model.id)return fallback;
  try{
    const before=JSON.stringify(messages??ctx.sessionManager.buildSessionProjection().messages);
    const count=async(text:string)=>{const tokens=await counter.count(text);if(!tokenCount(tokens)||(text.length>0&&tokens===0))throw Error('Invalid model token count');return tokens;};
    const packet=await providerPacket(pi,ctx,(messages??ctx.sessionManager.buildSessionProjection().messages) as Parameters<typeof providerPacket>[2]);
    const historyTokens=await count(before),packetTokens=await count(JSON.stringify(packet.body)),overheadTokens=Math.max(0,packetTokens-historyTokens);
    // Do not reuse a count if an external hook changed the projected context.
    if(before!==JSON.stringify(messages??ctx.sessionManager.buildSessionProjection().messages))return fallback;
    const occupiedTokens=packetTokens,availableTokens=Math.max(0,fallback.windowTokens-fallback.outputReserveTokens-occupiedTokens);
    return{...fallback,occupiedTokens,historyTokens,overheadTokens,availableTokens,source:'model-tokenizer',textBudget:Math.max(0,Math.min(requested,config.context.retrievalBudgetTokens,availableTokens-fallback.envelopeTokens))};
  }catch{return fallback;}
}
function tokenCount(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
/** Pi usage includes system/tools and estimated trailing messages. Verify that its
 * provider anchor survived the current projection and follows the last invalidator.
 * Old retained assistant usage is not valid immediately after compaction/edit. */
function currentUsageAnchor(ctx:ExtensionContext,projection:ReturnType<ExtensionContext['sessionManager']['buildSessionProjection']>,reported:number,factor:number):{occupied:number;trailing:number}|undefined{
  try{
    if(!ctx.model?.id)return;
    const projected=new Set(projection.entries.filter(entry=>entry.messages.some(message=>message.role==='assistant')).map(entry=>entry.sourceEntry.id));
    const branch=ctx.sessionManager.getBranch();
    const invalidator=branch.findLastIndex(entry=>entry.type==='compaction'||entry.type==='context_edit');
    for(let i=branch.length-1;i>invalidator;i--){
      const entry=branch[i];if(entry?.type!=='message'||entry.message.role!=='assistant'||!projected.has(entry.id))continue;
      const message=entry.message,usage=message.usage;
      if(message.stopReason==='error'||message.stopReason==='aborted'||!usage)continue;
      if(message.model!==ctx.model.id||![usage.input,usage.output,usage.cacheRead,usage.cacheWrite,usage.totalTokens].every(tokenCount))return;
      const components=usage.input+usage.output+usage.cacheRead+usage.cacheWrite;
      if(usage.totalTokens>0&&usage.totalTokens<components)return;
      const tokens=usage.totalTokens||components;
      if(tokens===0)continue;
      // An understated/inconsistent API value cannot override the fallback guard.
      if(reported<tokens)return;
      let offset=0,anchorIndex=-1;
      for(const item of projection.entries){if(item.sourceEntry.id===entry.id){const local=item.messages.findLastIndex(m=>m.role==='assistant');if(local<0)return;anchorIndex=offset+local;break;}offset+=item.messages.length;}
      if(anchorIndex<0)return;
      const tail=projection.messages.slice(anchorIndex+1),trailing=tail.length?estimateTokens(JSON.stringify(tail),factor):0;
      // The measured prefix needs no byte estimate. Newly appended data still
      // needs a conservative upper bound; take max, never add the same tail twice.
      return{occupied:Math.max(reported,tokens+trailing),trailing};
    }
  }catch{/* Missing branch/provenance keeps the independent conservative fallback. */}
  return;
}
export function contextBudget(pi: ExtensionAPI, ctx: ExtensionContext, config: CceConfig, requested: number,
  pendingPrompt = ''): ContextBudget {
  let usage:ReturnType<ExtensionContext['getContextUsage']>;try{usage=ctx.getContextUsage();}catch{usage=undefined;}
  const reported=tokenCount(usage?.tokens)?usage.tokens:undefined;
  const windows = [config.context.windowTokens, ctx.model?.contextWindow, usage?.contextWindow]
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  const windowTokens = Math.min(...windows);
  const factor = config.context.tokenEstimateSafetyFactor;
  let historyTokens: number;
  let historyKnown=false,anchor:ReturnType<typeof currentUsageAnchor>;
  try {
    const projection = ctx.sessionManager.buildSessionProjection();
    historyTokens = estimateTokens(JSON.stringify(projection.messages.filter(m => m.role !== 'system')), factor);
    historyKnown=true;
    anchor=reported!==undefined?currentUsageAnchor(ctx,projection,reported,factor):undefined;
  } catch {
    // Without a projection, usage is still an estimate. Unknown occupancy fails closed.
    historyTokens = reported??windowTokens;
    historyKnown=reported!==undefined;
  }
  const pendingTokens=estimateTokens(pendingPrompt,factor);
  historyTokens += pendingTokens;
  const active = new Set(pi.getActiveTools());
  const overheadTokens = estimateTokens(ctx.getSystemPrompt(), factor) +
    estimateTokens(JSON.stringify(pi.getAllTools().filter(t => active.has(t.name))), factor) + 256;
  // A verified Pi estimate accounts for the live model projection, including tool
  // results after its last provider anchor. Raw Pi JSON also contains metadata and
  // signatures; its byte upper bound must not invalidate current provider usage.
  // Retain that upper bound for diagnostics and for unanchored/unknown contexts.
  const anchorVerified=anchor!==undefined;
  const occupiedTokens = anchor ? anchor.occupied+pendingTokens : Math.max(reported??0,historyTokens+overheadTokens);
  const modelOutput=ctx.model?.maxTokens;
  const outputReserveTokens=Math.max(config.context.reserveTokens,typeof modelOutput==='number'&&Number.isSafeInteger(modelOutput)&&modelOutput>0?modelOutput:0);
  const availableTokens = Math.max(0, windowTokens - outputReserveTokens - occupiedTokens);
  const envelopeTokens = 2048;
  return { windowTokens, occupiedTokens, historyTokens, overheadTokens, envelopeTokens, availableTokens,outputReserveTokens,historyKnown,anchorVerified,anchoredTrailingTokens:anchor?.trailing??null,
    textBudget: Math.max(0, Math.min(requested, config.context.retrievalBudgetTokens, availableTokens - envelopeTokens)), source: anchorVerified?'pi-usage':'estimated' };
}
