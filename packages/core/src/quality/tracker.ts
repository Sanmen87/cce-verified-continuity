import { randomUUID } from 'node:crypto';
import { boundedString } from '../config.ts';
import { sha256 } from '../workspace.ts';
import { containsSecret } from '../native/secrets.ts';
import { observeExecution } from './execution.ts';
import type { SourceEvidence } from '../native/contracts.ts';
import type { ApprovedCheck, ContextQualityReport, ExplicitTaskContract, ProjectBinding, RequirementStatus, VerificationReceipt } from './contracts.ts';
const EXECUTED_CHECK = Symbol('executed-check-receipt');
const bindingDigest=(binding:ProjectBinding)=>sha256(JSON.stringify([binding.projectId,Object.entries(binding.files).sort(([a],[b])=>a.localeCompare(b)),binding.git]));
export function validateTaskContract(input: ExplicitTaskContract): ExplicitTaskContract {
  if (!input || !['user','confirmed-task-contract'].includes(input.source)) throw new Error('Only explicit user/confirmed task contracts are accepted');
  boundedString(input.id,128); boundedString(input.text,32768);
  if (!Array.isArray(input.requirements) || input.requirements.length < 1 || input.requirements.length > 64) throw new Error('Invalid requirement count');
  const ids=new Set<string>();
  for (const r of input.requirements) {
    boundedString(r.id,128); boundedString(r.clause,4096);
    if(ids.has(r.id)||!input.text.includes(r.clause))throw new Error('Requirement must quote a unique part of the explicit task');ids.add(r.id);
    if(!Array.isArray(r.needs)||r.needs.length>32||!Array.isArray(r.checks)||r.checks.length>32)throw new Error('Invalid requirement evidence/checks');
    const needs=new Set<string>();for(const need of r.needs){boundedString(need.id,128);if(needs.has(need.id)||!['definition','source','dependency','test'].includes(need.kind)||!['preview','full'].includes(need.representation))throw new Error('Invalid context need');needs.add(need.id);
      for(const value of [need.symbol,need.path,need.relation,need.targetSymbol])if(value!==undefined)boundedString(value,1024);
      if(!need.symbol&&!need.path)throw new Error('An explicit evidence target is required');}
    r.checks.forEach(id=>boundedString(id,128));if(new Set(r.checks).size!==r.checks.length)throw new Error('Duplicate checks');
  }
  return structuredClone(input);
}
export class TaskCoverageTracker {
  private readonly explicitContract: ExplicitTaskContract; readonly contractSha256: string;
  get contract():ExplicitTaskContract{return structuredClone(this.explicitContract);}
  private contexts = new Map<string,SourceEvidence[]>(); private implemented = new Map<string,SourceEvidence[]>();
  private blocked = new Map<string,string>(); private receipts = new Map<string,VerificationReceipt>();
  constructor(contract: ExplicitTaskContract) { this.explicitContract=validateTaskContract(contract); this.contractSha256=sha256(JSON.stringify(this.explicitContract)); }
  private requirement(id:string) {const r=this.contract.requirements.find(r=>r.id===id);if(!r)throw new Error('Unknown requirement');return r;}
  applyContext(report: ContextQualityReport): void {
    if(report.contractId!==this.contract.id)throw new Error('Wrong task contract');
    for(const r of this.contract.requirements){const sources=report.coveredRequirements.includes(r.id)?report.evidenceByRequirement[r.id]??[]:[];
      this.contexts.set(r.id,sources.map(s=>({path:s.path,sha256:s.sha256})));}
  }
  reportImplementation(id:string,files:SourceEvidence[]):void {this.requirement(id);if(!files.length||files.length>64||files.some(f=>!/^[a-f0-9]{64}$/.test(f.sha256)))throw new Error('Implementation requires source evidence');this.implemented.set(id,structuredClone(files));this.blocked.delete(id);}
  block(id:string,reason:string):void {this.requirement(id);this.blocked.set(id,boundedString(reason,2048));}
  acceptVerification(receipt:VerificationReceipt,authority:symbol):void {
    if(authority!==EXECUTED_CHECK)throw new Error('Verification requires an actually executed approved check');
    for(const id of receipt.requirementIds){const r=this.requirement(id);if(!r.checks.includes(receipt.checkId))throw new Error('Check is not part of the confirmed task contract');this.blocked.delete(id);}
    this.receipts.set(receipt.checkId,structuredClone(receipt));
  }
  inspect(binding:ProjectBinding) {
    return this.contract.requirements.map(r=>{
      const checks=r.checks.map(id=>this.receipts.get(id)),fresh=checks.filter((c):c is VerificationReceipt=>Boolean(c)&&bindingDigest(c!.binding)===bindingDigest(binding));
      const staleChecks=checks.filter(c=>c&&!fresh.includes(c)).map(c=>c!.checkId);
      let status:RequirementStatus='NOT_CHECKED';
      const context=this.contexts.get(r.id)??[],freshContext=context.filter(f=>binding.files[f.path]===f.sha256);
      if(freshContext.length===context.length&&context.length)status='CONTEXT_FOUND';
      if(this.implemented.has(r.id))status='IMPLEMENTED_UNVERIFIED';
      if(fresh.some(c=>c.status==='FAIL'))status='VERIFIED_FAIL';
      else if(r.checks.length&&fresh.length===r.checks.length&&fresh.every(c=>c.status==='PASS'))status='VERIFIED_PASS';
      if(this.blocked.has(r.id))status='BLOCKED';
      return{id:r.id,clause:r.clause,status,checks:r.checks,staleChecks,contextEvidence:freshContext,staleContextEvidence:context.filter(f=>binding.files[f.path]!==f.sha256),implementationEvidence:this.implemented.get(r.id)??[],blocker:this.blocked.get(r.id)??null};
    });
  }
  inspectReceipts(binding:ProjectBinding) {
    return [...this.receipts.values()].map(receipt=>({
      id:receipt.id,checkId:receipt.checkId,executionId:receipt.executionId,source:receipt.source,
      status:bindingDigest(receipt.binding)===bindingDigest(binding)?receipt.status:'UNKNOWN',
      historicalStatus:receipt.status,freshness:bindingDigest(receipt.binding)===bindingDigest(binding)?'CURRENT':'STALE',
      requirementIds:[...receipt.requirementIds],finishedAt:receipt.finishedAt,
      ...(receipt.execution?{execution:receipt.execution}:{}),...(receipt.resultPolicy?{resultPolicy:receipt.resultPolicy}:{}),
    }));
  }
  snapshot() {return{schemaVersion:1,contract:this.contract,contractSha256:this.contractSha256,implementation:[...this.implemented],verificationRequiresRevalidation:true};}
  static restore(snapshot:ReturnType<TaskCoverageTracker['snapshot']>,confirmedContract:ExplicitTaskContract):TaskCoverageTracker {
    if(snapshot.schemaVersion!==1||sha256(JSON.stringify(snapshot.contract))!==snapshot.contractSha256)throw new Error('Invalid task snapshot');
    const tracker=new TaskCoverageTracker(confirmedContract);
    if(tracker.contractSha256!==snapshot.contractSha256)throw new Error('Restored task requires the same independently confirmed contract');
    for(const [id,files]of snapshot.implementation)tracker.reportImplementation(id,files);
    // Serialized claims cannot recreate trusted verification capabilities.
    return tracker;
  }
}
/** Only a host-approved runnable adapter can issue a verification receipt. No model tool exposes this capability. */
export class VerificationFeedback {
  private tracker:TaskCoverageTracker;private binding:()=>Promise<ProjectBinding>;private checks:Map<string,ApprovedCheck>;
  constructor(tracker:TaskCoverageTracker,binding:()=>Promise<ProjectBinding>,checks:ApprovedCheck[]){
    this.tracker=tracker;this.binding=binding;this.checks=new Map(checks.map(c=>[c.id,c]));if(this.checks.size!==checks.length)throw new Error('Duplicate approved checks');
  }
  availableChecks() {
    return [...this.checks.values()].flatMap(check => {
      const requirementIds=this.tracker.contract.requirements.filter(r=>r.checks.includes(check.id)).map(r=>r.id);
      return requirementIds.length?[{id:check.id,type:check.type,source:check.source,requirementIds}]:[];
    });
  }
  async run(checkId:string):Promise<VerificationReceipt>{
    const check=this.checks.get(checkId);if(!check)throw new Error('Unapproved check');
    const requirements=this.tracker.contract.requirements.filter(r=>r.checks.includes(checkId));if(!requirements.length)throw new Error('Check has no explicit requirement mapping');
    const before=await this.binding(),startedAt=new Date().toISOString();
    let exitCode:number|null=null,diagnostic='Verification execution unavailable',executionId:string=randomUUID();
    let termination:VerificationReceipt['termination']='launch-error',outcome:unknown;
    try{const result=await check.execute();exitCode=result.exitCode;diagnostic=result.diagnostic;executionId=boundedString(result.executionId,256);termination=result.termination??'completed';outcome=result.outcome;}catch{diagnostic='Approved check execution failed before a trustworthy result';}
    const after=await this.binding(),stable=bindingDigest(before)===bindingDigest(after);
    const execution=observeExecution(exitCode,false,diagnostic,termination),resultPolicy=check.resultPolicy??'exit-code';
    let status:VerificationReceipt['status']='UNKNOWN';
    if(stable&&termination==='completed'&&execution.processOutcome!=='UNKNOWN'){
      if(resultPolicy==='explicit-result'){
        if(outcome==='FAIL')status='FAIL';
        else if(outcome==='PASS'&&exitCode===0)status='PASS';
      }else if(resultPolicy==='exit-code'&&execution.observedOutcome!=='CONTRADICTORY')status=exitCode===0?'PASS':'FAIL';
    }
    if(!stable)diagnostic='Source/Git changed during verification; rerun required';
    if(containsSecret(diagnostic))diagnostic='Diagnostic omitted: potential secret';
    const receipt:VerificationReceipt={id:randomUUID(),checkId,type:check.type,status,diagnostic:diagnostic.slice(0,4096),source:check.source,executionId,termination,execution,resultPolicy,startedAt,finishedAt:new Date().toISOString(),binding:before,requirementIds:requirements.map(r=>r.id),
      retryRetrieval:status==='FAIL'?requirements.map(r=>({requirementId:r.id,symbols:r.needs.flatMap(n=>n.symbol?[n.symbol]:[]),paths:r.needs.flatMap(n=>n.path?[n.path]:[]),includeTests:true})):[]};
    this.tracker.acceptVerification(receipt,EXECUTED_CHECK);return receipt;
  }
}
