import { AdapterRegistry } from '../native/registry.ts';
import type { LanguageAdapter, ParsedFile } from '../native/contracts.ts';
import { sha256 } from '../workspace.ts';
/** Elara-like definition population. Numeric retrieval formulas remain unchanged. */
class CompatibleLanguage implements LanguageAdapter {
  readonly base: LanguageAdapter;
  constructor(base: LanguageAdapter) {this.base=base;}
  get id():string{return this.base.id;}
  get version():string{return this.base.version+'/elara-definitions-v1';}
  detects(file:string):boolean{return this.base.detects(file);}
  moduleName(file:string):string{return this.base.moduleName(file);}
  resolveImport(from:string,specifier:string,files:ReadonlySet<string>,relative?:number):string|null{return this.base.resolveImport(from,specifier,files,relative);}
  async parse(file:string,source:string,fileHash:string):Promise<ParsedFile>{
    const parsed=await this.base.parse(file,source,fileHash),definitions=parsed.chunks.filter(c=>['class','function','method'].includes(c.kind));
    for(const c of definitions){
      const bounds=c.metadata.definitionBounds as {start?:number;end?:number;startLine?:number;endLine?:number}|undefined;
      if(bounds&&typeof bounds.start==='number'&&typeof bounds.end==='number'){
        c.text=source.slice(bounds.start,bounds.end);c.startLine=bounds.startLine!;c.endLine=bounds.endLine!;c.chunkHash=sha256(c.text);
      }
      const signature=c.metadata.signatureBounds as {start:number;end:number}|undefined;
      if(signature)c.signature=source.slice(signature.start,signature.end).trimEnd();
      c.kind=c.kind==='method'?'function':c.kind;c.parserVersion=this.version;
    }
    const module=parsed.chunks.find(c=>c.kind==='module');
    if(module){module.retrievable=definitions.length===0&&Boolean(source.trim());module.parserVersion=this.version;}
    return{...parsed,chunks:[...(module?[module]:[]),...definitions]};
  }
}
export function compatibleRegistry(registry:AdapterRegistry):AdapterRegistry{return new AdapterRegistry(registry.languages.map(a=>new CompatibleLanguage(a)),registry.frameworks);}
