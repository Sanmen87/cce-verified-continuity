export interface WholeSource {path:string;sha256:string;startLine:number;endLine:number;text:string}
export interface PackingCandidate {source:WholeSource;priority:number;required:boolean}
export interface PackingOmission {source:Omit<WholeSource,'text'>;reason:'budget'|'covered-by-source';required:boolean}
const overlaps=(a:WholeSource,b:WholeSource)=>a.path===b.path&&a.sha256===b.sha256&&Math.min(a.endLine,b.endLine)>=Math.max(a.startLine,b.startLine);
const covers=(a:WholeSource,b:WholeSource)=>a.path===b.path&&a.sha256===b.sha256&&a.startLine<=b.startLine&&a.endLine>=b.endLine;
function union(sources:WholeSource[]):WholeSource {
  const first=sources[0]!,startLine=Math.min(...sources.map(s=>s.startLine)),endLine=Math.max(...sources.map(s=>s.endLine)),lines=new Map<number,string>();
  for(const s of sources){const parts=s.text.split(/\r?\n/);if(parts.length!==s.endLine-s.startLine+1)throw new Error('Source text/range mismatch');
    parts.forEach((text,i)=>{const line=s.startLine+i;if(lines.has(line)&&lines.get(line)!==text)throw new Error('Conflicting source ranges');lines.set(line,text);});}
  const text=[];for(let line=startLine;line<=endLine;line++){if(!lines.has(line))throw new Error('Cannot synthesize missing source lines');text.push(lines.get(line)!);}
  return{path:first.path,sha256:first.sha256,startLine,endLine,text:text.join('\n')};
}
/** Caller supplies fresh disk-bound sources and explicit required evidence. No oracle or inferred task requirements. */
export async function packWholeSources(candidates:readonly PackingCandidate[],options:{policy:'legacy'|'quality-aware';budgetTokens:number;countTokens:(text:string)=>number|Promise<number>;render?:(sources:WholeSource[])=>string}){
  if(!Number.isSafeInteger(options.budgetTokens)||options.budgetTokens<0||candidates.length>1000)throw new Error('Invalid packing budget/population');
  for(const c of candidates)if(!Number.isFinite(c.priority)||!Number.isSafeInteger(c.source.startLine)||!Number.isSafeInteger(c.source.endLine)||c.source.startLine<1||c.source.endLine<c.source.startLine||!/^[a-f0-9]{64}$/.test(c.source.sha256))throw new Error('Invalid source record');
  const render=options.render??JSON.stringify,measure=async(sources:WholeSource[])=>{const n=await options.countTokens(render(sources));if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid tokenizer result');return n;};
  const ordered=options.policy==='legacy'?[...candidates]:candidates.map((c,i)=>({...c,i})).sort((a,b)=>Number(b.required)-Number(a.required)||b.priority-a.priority||a.i-b.i);
  let sources:WholeSource[]=[];const omitted:PackingOmission[]=[];
  for(const c of ordered){
    const {text,...reference}=c.source;void text;
    if(options.policy==='quality-aware'&&sources.some(s=>covers(s,c.source))){omitted.push({source:reference,reason:'covered-by-source',required:c.required});continue;}
    let next=[...sources,c.source];
    if(options.policy==='quality-aware'){
      const overlapping=sources.filter(s=>overlaps(s,c.source));
      if(overlapping.length){const merged=union([c.source,...overlapping]);next=[...sources.filter(s=>!overlapping.includes(s)),merged];}
    }
    if(await measure(next)<=options.budgetTokens)sources=next;else omitted.push({source:reference,reason:'budget',required:c.required});
  }
  const usedTokens=await measure(sources),required=candidates.filter(c=>c.required),unpackedRequired=required.filter(c=>!sources.some(s=>covers(s,c.source))).map(c=>{const {text,...s}=c.source;void text;return s;});
  return{sources,omitted,usedTokens,budgetTokens:options.budgetTokens,envelopeFits:usedTokens<=options.budgetTokens,unpackedRequired,completeness:'UNVERIFIED' as const};
}
