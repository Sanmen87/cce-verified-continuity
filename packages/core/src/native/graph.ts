// SQLite graph persistence follows Elara storage/graph_store.py (MIT).
// Semantic AST links and bounded multi-hop traversal are independent CCE additions.
import { sha256 } from '../workspace.ts';
import type { CodeChunk, CodeGraph, FrameworkAdapter, GraphEdge, GraphNode, LanguageAdapter, ParsedFile } from './contracts.ts';
import {scopedResolver}from './scoped-resolver.ts';
export function buildGraph(chunks: readonly CodeChunk[], language: (file: string) => LanguageAdapter, frameworks: readonly FrameworkAdapter[],options:{resolution?:'legacy'|'scoped'}={}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>(chunks.map(c => [c.id, { id: c.id, name: c.qualifiedName, path: c.path, kind: c.kind }]));
  const byId = new Map(chunks.map(c => [c.id, c])); const files = new Set(chunks.map(c => c.path));
  const byQualified = new Map(chunks.map(c => [c.qualifiedName, c]));
  const byFileName = new Map<string, CodeChunk[]>(); const byName = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const key = JSON.stringify([chunk.path, chunk.name]); byFileName.set(key, [...byFileName.get(key) ?? [], chunk]);
    if (!['module', 'import'].includes(chunk.kind)) byName.set(chunk.name, [...byName.get(chunk.name) ?? [], chunk]);
  }
  const modules = new Map(chunks.filter(c => c.kind === 'module').map(c => [c.path, c]));
  const edges = new Map<string, GraphEdge>();
  const scoped=options.resolution==='scoped'?scopedResolver(chunks,language):null;
  const connect = (source: CodeChunk, target: string, relation: string, confidence: GraphEdge['confidence'], metadata: Record<string, unknown> = {}) => {
    if (edges.size >= 200000) throw new Error('Graph edge limit exceeded');
    const edge: GraphEdge = { source: source.id, target, relation, path: source.path, fileHash: source.fileHash, confidence, metadata };
    const previous=edges.get(JSON.stringify([source.id,target,relation]));
    if(scoped&&previous&&typeof metadata.expression==='string'){
      previous.metadata.expressions=[...new Set([...(previous.metadata.expressions as string[]??[]),...(typeof previous.metadata.expression==='string'?[previous.metadata.expression]:[]),metadata.expression])];return;
    }
    edges.set(JSON.stringify([source.id, target, relation]), edge);
  };
  const exported = (file: string, name: string, depth = 0): CodeChunk | null => {
    const direct = (byFileName.get(JSON.stringify([file, name])) ?? []).filter(c => c.kind !== 'import');
    if (direct.length === 1) return direct[0]!;
    if (depth >= 3) return null;
    const imported = modules.get(file)?.syntax.imports.find(i => (i.alias ?? i.name) === name);
    if (!imported) return null;
    const target = language(file).resolveImport(file, imported.module, files, imported.relative);
    return target ? exported(target, imported.name ?? name, depth + 1) : null;
  };
  const unresolved=(source:CodeChunk,name:string)=>{const id=sha256(JSON.stringify(['external',source.path,name]));if(nodes.size>=100000)throw new Error('Graph node limit exceeded');nodes.set(id,{id,name,path:null,kind:'unresolved'});return{id,resolution:'unresolved'};};
  const resolve = (source: CodeChunk, name: string,relation='REFERENCES'): { id: string; resolution: string } => {
    if(scoped){const resolved=scoped(source,name,relation);return resolved.chunk?{id:resolved.chunk.id,resolution:resolved.resolution}:unresolved(source,name);}
    const exact = byQualified.get(name); if (exact) return { id: exact.id, resolution: 'qualified' };
    if (name.startsWith('self.') || name.startsWith('this.')) {
      let owner: CodeChunk | undefined = source;
      while (owner && !['class', 'interface'].includes(owner.kind)) owner = owner.parentId ? byId.get(owner.parentId) : undefined;
      const member = byQualified.get(`${owner?.qualifiedName}.${name.slice(name.indexOf('.') + 1)}`);
      if (member) return { id: member.id, resolution: 'lexical-member' };
    }
    const local = exported(source.path, name); if (local) return { id: local.id, resolution: 'file-symbol' };
    const [head, ...tail] = name.split('.');
    const imported = modules.get(source.path)?.syntax.imports.find(i => (i.alias ?? i.name ?? i.module.split('.')[0]) === head);
    if (imported) {
      const file = language(source.path).resolveImport(source.path, imported.module, files, imported.relative);
      const symbol = file ? exported(file, tail.at(-1) ?? imported.name ?? head!) : null;
      if (symbol) return { id: symbol.id, resolution: 'static-import' };
    }
    const modulePrefix = name.split('.').slice(0, -1).join('.');
    if (modulePrefix) {
      const file = language(source.path).resolveImport(source.path, modulePrefix, files);
      const symbol = file ? exported(file, name.split('.').at(-1)!) : null;
      if (symbol) return { id: symbol.id, resolution: 'qualified-import' };
    }
    const matches = byName.get(name) ?? [];
    if (matches.length === 1) return { id: matches[0]!.id, resolution: 'unique-name-inference' };
    const id = sha256(JSON.stringify(['external', source.path, name]));
    if (nodes.size >= 100000) throw new Error('Graph node limit exceeded');
    nodes.set(id, { id, name, path: null, kind: 'unresolved' }); return { id, resolution: 'unresolved' };
  };
  for (const chunk of chunks) {
    if (chunk.parentId && byId.has(chunk.parentId)) {
      const parent = byId.get(chunk.parentId)!;
      connect(parent, chunk.id, 'DEFINES', 'syntax'); connect(parent, chunk.id, 'CONTAINS', 'syntax');
    }
    if(scoped&&chunk.kind==='module')for(const binding of (chunk.metadata.exportBindings??[])as Array<{module:string|null}>){
      if(!binding.module)continue;const file=language(chunk.path).resolveImport(chunk.path,binding.module,files);
      const target=file?modules.get(file):null;const resolved=target?{id:target.id,resolution:'static-reexport'}:unresolved(chunk,binding.module);
      connect(chunk,resolved.id,'IMPORTS',target?'syntax':'inferred',{...binding,resolution:resolved.resolution});
    }
    for (const imported of chunk.syntax.imports) {
      const file = language(chunk.path).resolveImport(chunk.path, imported.module, files, imported.relative);
      const target = file && modules.has(file) ? { id: modules.get(file)!.id, resolution: 'static-import' } : resolve(chunk, imported.module);
      connect(chunk, target.id, 'IMPORTS', target.resolution === 'unresolved' ? 'inferred' : 'syntax', { ...imported, resolution: target.resolution });
    }
    for (const base of chunk.syntax.bases) { const target = resolve(chunk, base,'INHERITS'); connect(chunk, target.id, 'INHERITS', 'inferred', { expression: base, resolution: target.resolution, declarationConfirmed: true }); }
    for (const call of chunk.syntax.calls) { const target = resolve(chunk, call.callee,'CALLS'); connect(chunk, target.id, 'CALLS', 'inferred', { expression: call.callee, resolution: target.resolution, invocationConfirmed: true }); }
    for (const reference of chunk.syntax.references) { const target = resolve(chunk, reference); connect(chunk, target.id, 'REFERENCES', 'inferred', { expression: reference, resolution: target.resolution }); }
  }
  for (const [file, module] of modules) {
    const parsed: ParsedFile = { path: file, language: module.language, fileHash: module.fileHash, chunks: chunks.filter(c => c.path === file), diagnostics: [] };
    for (const framework of frameworks) for (const relation of framework.enrich(parsed).relations) {
      const source = byId.get(relation.source); if (!source) continue;
      const target = resolve(source, relation.targetName);
      connect(source, target.id, relation.relation, target.resolution === 'unresolved' || target.resolution === 'unique-name-inference' ? 'inferred' : relation.confidence,
        { ...relation.metadata, resolution: target.resolution, declarationConfirmed: true });
    }
  }
  return { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.relation.localeCompare(b.relation)) };
}
export class BoundedCodeGraph implements CodeGraph {
  readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[]; private byId: Map<string, GraphNode>;
  constructor(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) { this.nodes = nodes; this.edges = edges; this.byId = new Map(nodes.map(n => [n.id, n])); }
  neighbors(id: string, relations?: readonly string[]): Array<{ node: GraphNode; edge: GraphEdge }> {
    return this.edges.filter(edge => edge.source === id && (!relations || relations.includes(edge.relation))).slice(0, 1024)
      .flatMap(edge => { const node = this.byId.get(edge.target); return node ? [{ node, edge }] : []; });
  }
  expand(ids: readonly string[], options: { depth: number; maxNodes: number; relations?: readonly string[] }): GraphNode[] {
    if (!Number.isSafeInteger(options.depth) || options.depth < 0 || options.depth > 5 || !Number.isSafeInteger(options.maxNodes) || options.maxNodes < 1 || options.maxNodes > 1000 || ids.length > options.maxNodes) throw new Error('Graph expansion limit exceeded');
    const visited = new Map<string, GraphNode>(); let frontier = [...new Set(ids)].filter(id => this.byId.has(id));
    for (const id of frontier) visited.set(id, this.byId.get(id)!);
    for (let depth = 0; depth < options.depth && frontier.length && visited.size < options.maxNodes; depth++) {
      const next: string[] = [];
      traversal: for (const id of frontier) for (const { node } of this.neighbors(id, options.relations)) {
        if (visited.size >= options.maxNodes) break traversal;
        if (!visited.has(node.id)) { visited.set(node.id, node); next.push(node.id); }
        if (visited.size >= options.maxNodes) break;
      }
      frontier = next;
    }
    return [...visited.values()].slice(0, options.maxNodes);
  }
}
