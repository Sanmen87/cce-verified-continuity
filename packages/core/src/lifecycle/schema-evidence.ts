import type { ContextEngine } from '../index.ts';
import { PythonAdapter } from '../native/languages/python.ts';
import { containsSecret } from '../native/secrets.ts';
/** Experimental static declaration evidence, never a live database/ORM evaluator. */
export async function schemaEvidence(engine:ContextEngine,paths:readonly string[]){
  if(paths.length>8)throw Error('Schema evidence is limited to eight explicit source files');
  const allowed=new Set(await engine.sourceFiles(true)),adapter=new PythonAdapter(true),files=[];
  for(const input of paths){
    const file=engine.workspace.normalize(input);if(!allowed.has(file)||!file.endsWith('.py'))throw Error('Schema source unavailable');
    const source=await engine.workspace.read(file,engine.config.retrieval.maxFileBytes);if(containsSecret(source.text))throw Error('Potential secret schema source');
    const parsed=await adapter.parse(file,source.text,source.sha256),module=parsed.chunks.find(c=>c.kind==='module'),sqlalchemy=module?.syntax.imports.some(i=>i.module==='sqlalchemy'||i.module.startsWith('sqlalchemy.'))??false;
    const models=sqlalchemy?parsed.chunks.filter(c=>c.kind==='class').flatMap(c=>{
      const properties=parsed.chunks.filter(p=>p.parentId===c.id&&p.syntax.assignment),table=properties.find(p=>p.name==='__tablename__')?.syntax.assignment?.value;
      if(!table)return[];
      const declared=properties.filter(p=>p.syntax.assignment?.value.kind==='call').map(p=>({name:p.name,expression:p.syntax.assignment!.value.text,startLine:p.startLine,endLine:p.endLine,interpretation:'STATIC_DECLARATION_UNVERIFIED'}));
      return[{symbol:c.qualifiedName,chunkId:c.id,startLine:c.startLine,endLine:c.endLine,table:table.kind==='string'?table.value:null,declared,ormRuntime:'UNVERIFIED'}];
    }):[];
    const revisionNames=new Set(['revision','down_revision','depends_on','branch_labels']);
    const revisions=parsed.chunks.filter(c=>c.parentId===module?.id&&c.syntax.assignment&&revisionNames.has(c.name)).map(c=>{const value=c.syntax.assignment!.value;return{name:c.name,value:value.kind==='string'?value.value:value.text==='None'?null:value.kind==='array'&&value.elements?.every(e=>e.kind==='string')?value.elements.map(e=>e.value):null,expression:value.text,status:value.kind==='string'||value.text==='None'||value.kind==='array'&&value.elements?.every(e=>e.kind==='string')?'STATIC_LITERAL':'UNVERIFIED',chunkId:c.id,startLine:c.startLine,endLine:c.endLine};});
    files.push({path:file,sha256:source.sha256,models,revisions,representation:'REFERENCE_ONLY',liveDatabaseSchema:'UNKNOWN',completeness:'UNVERIFIED'});
  }
  return{adapter:'experimental-sqlalchemy-alembic-source-v1',files,liveDatabaseSchema:'UNKNOWN',completeness:'UNVERIFIED'};
}
