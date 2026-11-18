import type {ExtensionAPI,ExtensionContext,SessionBeforeCompactEvent} from '@earendil-works/pi-coding-agent';
import type {CceConfig} from '../../core/src/config.ts';
import type {TokenCounter} from '../../core/src/lifecycle/contracts.ts';
import {conservativeCounter} from '../../core/src/lifecycle/compiler.ts';
import {sha256} from '../../core/src/workspace.ts';
import {CounterFailure} from './lifecycle-diagnostics.ts';
import {buildSessionProjection} from '@earendil-works/pi-coding-agent';
import {getCurrentSystemMessage} from '@earendil-works/pi-ai/compat';
import {providerPacket} from './provider-packet.ts';
/** Pure prospective projection; never writes native history or changes the cut point. */
export function prospectiveProjection(event:SessionBeforeCompactEvent,summary=''){
  const entries=event.branchEntries,cut=entries.findIndex(e=>e.id===event.preparation.firstKeptEntryId);if(cut<0)return null;
  const id='cce-prospective-'+sha256(JSON.stringify(entries.map(e=>e.id))).slice(0,16);
  // Mirror SessionManager.appendCompaction: snapshot the current system/tool
  // state at the new boundary rather than silently losing its section patches.
  const systemMessage=getCurrentSystemMessage(buildSessionProjection(entries,entries.at(-1)?.id).messages);
  return buildSessionProjection([...entries,{type:'compaction',id,parentId:entries.at(-1)?.id??null,timestamp:new Date(0).toISOString(),summary,firstKeptEntryId:event.preparation.firstKeptEntryId,tokensBefore:event.preparation.tokensBefore,fromHook:true,...(systemMessage?{systemMessage}: {})}],id);
}
export function handoffCapacity(input:{windowTokens:number;outputReserveTokens:number;keptTokens:number;fixedTokens:number;requested:number;safetyTokens?:number}):number{
  if(Object.values(input).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Unknown post-compaction token budget');
  return Math.max(0,Math.min(input.requested,input.windowTokens-input.outputReserveTokens-input.keptTokens-input.fixedTokens-(input.safetyTokens??512)));
}
/** Compute the prospective retained window, not occupancy of the still-uncompacted history. */
export async function compactionBudget(pi:ExtensionAPI,ctx:ExtensionContext,config:CceConfig,event:SessionBeforeCompactEvent,counter:TokenCounter=conservativeCounter){
  const projection=prospectiveProjection(event);if(!projection)return null;
  const windows=[config.context.windowTokens,ctx.model?.contextWindow,ctx.getContextUsage()?.contextWindow].filter((n):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0),windowTokens=Math.min(...windows);
  const outputReserveTokens=Math.max(config.context.reserveTokens,ctx.model?.maxTokens??0);
  const count=async(stage:string,text:string)=>{try{const value=await counter.count(text);if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid tokenizer result');return value;}catch(error){throw new CounterFailure(stage,Buffer.byteLength(text),sha256(text),error);}};
  const retained=projection.entries.filter(e=>e.sourceEntry.type!=='compaction'||e.sourceEntry.id!==projection.entries[0]?.sourceEntry.id).flatMap(e=>e.messages);
  const projectedRetainedTokens=await count('retained-history',JSON.stringify(retained));
  const packet=await providerPacket(pi,ctx,projection.messages),packetTokens=await count('future-provider-packet',JSON.stringify(packet.body));
  const encoded=packet.body as {messages?:Array<{role?:string}>};
  const keptTokens=packet.serialization==='pi-openai-completions'?await count('retained-provider-messages',JSON.stringify(encoded.messages?.filter(m=>m.role!=='system'&&m.role!=='developer')??[])):projectedRetainedTokens;
  const fixedTokens=Math.max(0,packetTokens-keptTokens),recoveryReserveTokens=config.lifecycle.recoveryReserveTokens;
  const textBudget=Math.max(0,Math.min(config.lifecycle.handoffBudgetTokens,windowTokens-outputReserveTokens-packetTokens-recoveryReserveTokens-512));
  return{windowTokens,outputReserveTokens,keptTokens,fixedTokens,packetTokens,projectedRetainedTokens,recoveryReserveTokens,safetyTokens:512,textBudget,accounting:counter.source,serialization:packet.serialization,
    activeRetainedMessages:retained.length,inactiveSummaryCount:projection.entries.filter(e=>e.sourceEntry.type==='compaction'&&!e.messages.length).length};
}

export async function validateCompactionPacket(pi:ExtensionAPI,ctx:ExtensionContext,event:SessionBeforeCompactEvent,summary:string,budget:NonNullable<Awaited<ReturnType<typeof compactionBudget>>>,counter:TokenCounter=conservativeCounter){
  const projection=prospectiveProjection(event,summary);if(!projection)return{fits:false,reason:'UNKNOWN_KEPT_BOUNDARY',packetTokens:null};
  const packet=await providerPacket(pi,ctx,projection.messages),packetTokens=await counter.count(JSON.stringify(packet.body));
  if(!Number.isSafeInteger(packetTokens)||packetTokens<0)throw Error('Invalid future packet count');
  const required=packetTokens+budget.outputReserveTokens+budget.recoveryReserveTokens+budget.safetyTokens;
  return{fits:required<=budget.windowTokens,reason:required<=budget.windowTokens?'FITS':'POST_COMPACTION_PACKET_OVERFLOW',packetTokens,required,windowTokens:budget.windowTokens,serialization:packet.serialization};
}
