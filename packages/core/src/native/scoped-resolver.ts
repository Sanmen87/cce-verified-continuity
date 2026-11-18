import type {CodeChunk,LanguageAdapter,ImportFact}from './contracts.ts';
import type {ExportBinding}from './languages/tree-sitter.ts';
export const SCOPED_RESOLUTION_VERSION='scoped-resolver-v1';
/** Conservative static binding resolution. A same-name symbol elsewhere is never proof of a binding. */
export function scopedResolver(chunks:readonly CodeChunk[],language:(file:string)=>LanguageAdapter){
 const byId=new Map(chunks.map(c=>[c.id,c])),modules=new Map(chunks.filter(c=>c.kind==='module').map(c=>[c.path,c])),files=new Set(modules.keys());
 const children=new Map<string,CodeChunk[]>();for(const c of chunks)if(c.parentId)children.set(c.parentId,[...children.get(c.parentId)??[],c]);
 const one=(rows:CodeChunk[])=>rows.length===1?rows[0]!:null;
 const members=(parent:CodeChunk,name:string)=>children.get(parent.id)?.filter(c=>c.name===name&&!['module','import'].includes(c.kind))??[];
 const exportsOf=(file:string,name:string,seen=new Set<string>()):CodeChunk|null=>{
  const key=JSON.stringify([file,name]);if(seen.has(key)||seen.size>=16)return null;const next=new Set(seen).add(key),module=modules.get(file);if(!module)return null;
  if(module.language==='python'){
   const direct=members(module,name);if(direct.length)return one(direct);
   const imports=(children.get(module.id)??[]).filter(c=>c.kind==='import').flatMap(c=>c.syntax.imports).filter(i=>(i.alias??i.name??i.module.split('.')[0])===name);
   if(imports.length!==1)return null;const i=imports[0]!,target=language(file).resolveImport(file,i.module,files,i.relative);return target&&i.name?exportsOf(target,i.name,next):null;
  }
  const bindings=(module.metadata.exportBindings??[])as ExportBinding[];
  const matches=bindings.filter(b=>b.name===name);if(matches.length>1)return null;
  if(matches.length){const b=matches[0]!;if(b.module){const target=language(file).resolveImport(file,b.module,files);return target?exportsOf(target,b.imported??name,next):null;}
   const direct=b.local?members(module,b.local):[];if(direct.length)return one(direct);
   const imports=(children.get(module.id)??[]).filter(c=>c.kind==='import').flatMap(c=>c.syntax.imports).filter(i=>(i.alias??i.name)===b.local);
   if(imports.length===1){const i=imports[0]!,target=language(file).resolveImport(file,i.module,files,i.relative);return target?exportsOf(target,i.name??name,next):null;}return null;
  }
  const wildcard=bindings.filter(b=>b.name==='*'&&b.module).flatMap(b=>{const target=language(file).resolveImport(file,b.module!,files);const found=target?exportsOf(target,name,next):null;return found?[found]:[];});
  return one([...new Map(wildcard.map(c=>[c.id,c])).values()]);
 };
 const importTarget=(from:string,i:ImportFact,tail:string[]):CodeChunk|null=>{
  const file=language(from).resolveImport(from,i.module,files,i.relative);if(!file)return null;
  const namespace=i.name===null||i.name==='*';let target=namespace?(tail.length?exportsOf(file,tail.shift()!):modules.get(file)??null):exportsOf(file,i.name!);
  for(const member of tail)target=target?one(members(target,member)):null;
  return target;
 };
 return(source:CodeChunk,name:string,relation:string):{chunk:CodeChunk|null;resolution:string}=>{
  const permitted=(c:CodeChunk)=>relation==='CALLS'?['function','method','class'].includes(c.kind):relation==='INHERITS'?['class','interface','type'].includes(c.kind):!['module','import'].includes(c.kind);
  const result=(chunk:CodeChunk|null,resolution:string)=>chunk&&permitted(chunk)?{chunk,resolution}:{chunk:null,resolution:'unresolved'};
  if(!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name))return result(null,'unresolved');
  const [head,...tail]=name.split('.');
  if(head==='self'||head==='this'){
   let owner:CodeChunk|undefined=source;while(owner&&!['class','interface'].includes(owner.kind))owner=owner.parentId?byId.get(owner.parentId):undefined;
   let target:CodeChunk|null=owner??null;for(const part of tail)target=target?one(members(target,part)):null;
   return result(target,'lexical-member');
  }
  if(!tail.length&&source.name===head&&source.kind==='function')return result(source,'recursive-function');
  let scope:CodeChunk|undefined=source;
  while(scope){
   const locals=members(scope,head!);
   if(locals.length){let target=one(locals);for(const part of tail)target=target?one(members(target,part)):null;return result(target,'lexical-symbol');}
   const bound=(children.get(scope.id)??[]).filter(c=>c.kind==='import').flatMap(c=>c.syntax.imports).filter(i=>(i.alias??i.name??i.module.split('.')[0])===head);
   if(bound.length)return result(bound.length===1?importTarget(source.path,bound[0]!,[...tail]):null,'static-import');
   if([...(scope.metadata.parameterNames as string[]??[]),...(scope.metadata.localNames as string[]??[])].includes(head!))return result(null,'unresolved');
   const parent:CodeChunk|undefined=scope.parentId?byId.get(scope.parentId):undefined;
   // Class namespace is not a lexical closure for method bare-name references.
   scope=parent&&scope.kind==='method'&&parent.kind==='class'?(parent.parentId?byId.get(parent.parentId):undefined):parent;
  }
  return result(null,'unresolved');
 };
}
