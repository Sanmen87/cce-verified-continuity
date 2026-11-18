import {convertToLlm} from '@earendil-works/pi-coding-agent';
import type {ExtensionAPI,ExtensionContext} from '@earendil-works/pi-coding-agent';
import {openAICompletionsApi,normalizeContext} from '@earendil-works/pi-ai/compat';
import type {Model} from '@earendil-works/pi-ai/compat';

/** Official SDK serializer, stopped before transport. No credentials or network are used.
 * Unsupported provider APIs retain an explicitly labelled projected-JSON upper bound. */
export async function providerPacket(pi:ExtensionAPI,ctx:ExtensionContext,messages:Parameters<typeof convertToLlm>[0]){
  const active=new Set(pi.getActiveTools()),tools=pi.getAllTools().filter(t=>active.has(t.name)),system=ctx.getSystemPrompt();
  if(ctx.model?.api!=='openai-completions')return{serialization:'pi-projected-json' as const,body:{messages,system,tools},networkCalls:0};
  let payload:unknown,networkCalls=0;
  // Pi 1.4 carries prompt/tool declarations in the transcript itself. Its agent
  // loop normalizes only `messages`; adding ctx.getSystemPrompt() again would
  // duplicate the prompt and override historical tool deltas. Headerless callers
  // (including older adapters) still need an initial prompt/tool declaration.
  const converted=convertToLlm(messages);
  const transcript=converted[0]?.role==='system'?normalizeContext({messages:converted}):normalizeContext({systemPrompt:system,messages:converted,tools});
  const events=openAICompletionsApi().stream(ctx.model as Model<'openai-completions'>,transcript,{
    apiKey:'cce-local-serialization-only',maxTokens:ctx.model.maxTokens,maxRetries:0,
    fetch:async()=>{networkCalls++;throw Error('CCE serializer transport forbidden');},
    onPayload:body=>{payload=body;throw Error('CCE_SERIALIZATION_CAPTURE_COMPLETE');},
  });
  await events.result();
  if(payload===undefined||networkCalls)throw Error('CCE provider serialization unavailable');
  return{serialization:'pi-openai-completions' as const,body:payload,networkCalls};
}
