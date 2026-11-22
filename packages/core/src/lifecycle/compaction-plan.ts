export interface CompactionPlanInput {
  windowTokens:number;
  outputReserveTokens:number;
  safetyTokens:number;
  fixedPacketTokens:number|null;
  mandatoryRecoveryTokens:number|null;
  historyTokens:number|null;
  nextActionTokens:number|null;
  accounting:'model-tokenizer'|'estimated:utf8-bytes';
}

/** Advisory arithmetic over explicitly separated components. The adapter must
 * validate any proposed retained projection with its actual SDK serializer. */
export function recommendCompaction(input:CompactionPlanInput){
  for(const value of Object.values(input)){
    if(typeof value==='number' && (!Number.isSafeInteger(value)||value<0))throw Error('Invalid context component');
  }
  const {windowTokens,outputReserveTokens,safetyTokens,fixedPacketTokens,
    mandatoryRecoveryTokens,historyTokens,nextActionTokens}=input;
  const basis={accounting:input.accounting,application:'ADVISORY_ONLY' as const,requiresPacketValidation:true};
  if(fixedPacketTokens===null || mandatoryRecoveryTokens===null || historyTokens===null)
    return {...basis,packetFit:'UNKNOWN',continuationHeadroom:null,compactionRecommendation:'UNKNOWN',
      targetRetainedTokens:null,reason:'MISSING_CURRENT_COMPONENTS'};
  const historyCapacity=windowTokens-outputReserveTokens-safetyTokens-fixedPacketTokens-mandatoryRecoveryTokens;
  const continuationHeadroom=historyCapacity-historyTokens;
  const packetFit=continuationHeadroom>=0?'FITS':'EXCEEDS_CAPACITY';
  if(historyCapacity<0)return {...basis,packetFit,continuationHeadroom,compactionRecommendation:'INSUFFICIENT_CAPACITY',
    targetRetainedTokens:null,reason:'MANDATORY_AND_FIXED_COMPONENTS_EXCEED_WINDOW'};
  if(nextActionTokens===null)return {...basis,packetFit,continuationHeadroom,
    compactionRecommendation:packetFit==='FITS'?'UNKNOWN':'COMPACT_RECOMMENDED',
    targetRetainedTokens:packetFit==='FITS'?null:historyCapacity,reason:'NEXT_ACTION_UNKNOWN'};
  const target=historyCapacity-nextActionTokens;
  if(target<0)return {...basis,packetFit,continuationHeadroom,compactionRecommendation:'INSUFFICIENT_CAPACITY',
    targetRetainedTokens:null,reason:'NEXT_ACTION_SCENARIO_EXCEEDS_WINDOW'};
  return {...basis,packetFit,continuationHeadroom,
    compactionRecommendation:historyTokens>target?'COMPACT_RECOMMENDED':'NO_COMPACTION_NEEDED',
    targetRetainedTokens:target,reason:'NEXT_ACTION_SCENARIO'};
}
