import { sha256 } from '../workspace.ts';
import type { ContextLedger } from './ledger.ts';
import type { EvidenceObservation, WindowManifest } from './contracts.ts';
/** Presence describes an observed projection, never an assertion of provider delivery. */
export class ContextProjection {
  readonly ledger:ContextLedger; readonly session:string; readonly branch:string;
  private current:WindowManifest;
  constructor(ledger:ContextLedger,session:string,branch:string){
    this.ledger=ledger;this.session=session;this.branch=branch;
    const raw=ledger.loadProjection(session,branch);let saved:WindowManifest|undefined;
    if(raw){saved=JSON.parse(raw) as WindowManifest;if(saved.schemaVersion!==1||saved.projectId!==ledger.workspace.projectId||saved.sessionId!==session||saved.branchId!==branch||!Number.isSafeInteger(saved.generation)||!Array.isArray(saved.evidence))throw Error('Corrupt manifest');}
    // A persisted window is not proof that a resumed agent will send that window.
    this.current={schemaVersion:1,projectId:ledger.workspace.projectId,sessionId:session,branchId:branch,projectionId:'',generation:(saved?.generation??0)+1,modelId:null,observation:'unknown',delivery:'UNKNOWN',payloadSha256:null,evidence:(saved?.evidence??[]).slice(0,512).map(e=>({...e,presence:'UNKNOWN'}))};
    this.save();
  }
  private save(){this.current.projectionId=sha256(JSON.stringify({...this.current,projectionId:''}));this.ledger.saveProjection(this.session,this.branch,JSON.stringify(this.current));}
  snapshot():WindowManifest{return structuredClone(this.current);}
  async observe(payload:string,observations:EvidenceObservation[],modelId:string|null,stage:'pre-context'|'pre-provider',bodyView=payload):Promise<WindowManifest>{
    if(Buffer.byteLength(payload)>16777216)throw Error('Projection payload limit');if(observations.length>512)throw Error('Projection evidence limit');
    const evidence:EvidenceObservation[]=[];
    for(const input of observations){
      if(!/^[a-f0-9]{64}$/.test(input.evidenceId))throw Error('Invalid evidence identity');
      let presence=input.presence;
      if(input.source&&await this.ledger.freshness(input.source)!=='CURRENT')presence='OMITTED';
      if(presence==='FULL_BODY'||presence==='PARTIAL_BODY'){
        // Require exact original body inclusion; a SHA/name/reference in a summary is insufficient.
        if(!input.text||!input.bodySha256||sha256(input.text)!==input.bodySha256||(!bodyView.includes(input.text)&&!bodyView.includes(JSON.stringify(input.text).slice(1,-1))))presence='UNKNOWN';
        if(input.source&&presence!=='UNKNOWN'){
          const source=await this.ledger.workspace.read(input.source.path,this.ledger.maxBlobBytes);
          const body=input.source.startLine===undefined?source.text:source.text.split(/\r?\n/).slice(input.source.startLine-1,input.source.endLine).join('\n');
          if(body!==input.text)presence='UNKNOWN';
        }
      }
      const {text: _text,...metadata}=input; evidence.push({...metadata,presence});
    }
    this.current={...this.current,modelId,observation:stage,payloadSha256:sha256(payload),delivery:'UNKNOWN',evidence};this.save();return this.snapshot();
  }
  compacted(summary:string):WindowManifest{
    this.current={...this.current,generation:this.current.generation+1,modelId:this.current.modelId,observation:'compacted',payloadSha256:sha256(summary),evidence:this.current.evidence.map(e=>({...e,presence:summary.includes(e.evidenceId)?'REFERENCE_ONLY':'OMITTED'}))};this.save();return this.snapshot();
  }
  unknown():void{this.current={...this.current,observation:'unknown',payloadSha256:null,evidence:this.current.evidence.map(e=>({...e,presence:'UNKNOWN'}))};this.save();}
}
