// Chunk traversal is derived from Elara indexer/chunker.py at
// 75071156e08a145fab17c8ce30bb5f418286f434, MIT (Fazle Elahee).
// Qualified IDs, syntax facts, parentage and decorated ranges are CCE extensions.
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { sha256 } from '../../workspace.ts';
import { CHUNKING_VERSION, emptySyntax, symbolId, TextLanguageAdapter } from '../registry.ts';
import type { CodeChunk, LanguageAdapter, ParsedFile, ImportFact, CallFact, ExpressionFact, SyntaxFacts } from '../contracts.ts';
const read = promisify(readFile);
const assets = new URL('../../../assets/grammars/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assets), 'utf8')) as {
  runtime: string; grammars: Array<{ language: string; version: string; file: string; sha256: string }>;
};
let initialized: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();
export interface Declaration {
  name: string; kind: string; definition: Node; display: Node; body: Node | null;
  decorators: string[]; bases: string[]; async: boolean;
}
export interface ExportBinding {name:string;local:string|null;module:string|null;imported:string|null}
export abstract class TreeSitterAdapter implements LanguageAdapter {
  abstract readonly id: string;
  abstract detects(file: string): boolean;
  abstract moduleName(file: string): string;
  abstract resolveImport(from: string, specifier: string, files: ReadonlySet<string>, relative?: number): string | null;
  protected abstract declaration(node: Node, scope: CodeChunk): Declaration | null;
  protected abstract imports(node: Node): ImportFact[];
  protected abstract assignment(node: Node): SyntaxFacts['assignment'];
  protected abstract call(node: Node): CallFact | null;
  protected abstract expression(node: Node): ExpressionFact;
  protected exports(_node:Node):ExportBinding[]{return[];}
  protected get bindingTracking():boolean{return false;}
  get version(): string {
    const record = manifest.grammars.find(r => r.language === this.id);
    if (!record) throw new Error('Unregistered bundled grammar');
    return `${this.id}@${record.version}/${manifest.runtime}/${record.sha256}/${CHUNKING_VERSION}`;
  }
  private async language(): Promise<Language> {
    initialized ??= Parser.init(); await initialized;
    let loading = languages.get(this.id);
    if (!loading) {
      loading = (async () => {
        const record = manifest.grammars.find(r => r.language === this.id)!;
        const data = await read(new URL(record.file, assets));
        if (sha256(data) !== record.sha256) throw new Error('Grammar integrity mismatch');
        return Language.load(data);
      })(); languages.set(this.id, loading);
    }
    return loading;
  }
  async parse(input: string, source: string, fileHash: string): Promise<ParsedFile> {
    const file = input.replaceAll('\\', '/');
    if (sha256(source) !== fileHash) throw new Error('Parser source hash mismatch');
    const language = await this.language();
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    if (!tree) { parser.delete(); throw new Error('Parser returned no tree'); }
    try {
      if (tree.rootNode.hasError) {
        const fallback = await new TextLanguageAdapter().parse(file, source, fileHash);
        fallback.language = this.id; fallback.diagnostics.push('Syntax errors: text fallback; AST links unavailable');
        for (const chunk of fallback.chunks) { chunk.language = this.id; chunk.parserVersion = this.version; }
        return fallback;
      }
      const chunks: CodeChunk[] = []; const counts = new Map<string, number>();
      const make = (node: Node, kind: string, name: string, parent: CodeChunk | null, definition = node): CodeChunk => {
        const qualifiedName = parent ? `${parent.qualifiedName}.${name}` : this.moduleName(file);
        const key = `${kind}:${qualifiedName}`; const ordinal = counts.get(key) ?? 0; counts.set(key, ordinal + 1);
        const chunk: CodeChunk = { id: symbolId(file, this.id, kind, qualifiedName, ordinal), path: file, language: this.id,
          kind, name, qualifiedName, parentId: parent?.id ?? null, startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1, definitionStartLine: definition.startPosition.row + 1,
          fileHash, chunkHash: sha256(node.text), signature: node.text, docstring: '', text: node.text,
          parserVersion: this.version, algorithmVersion: CHUNKING_VERSION, retrievable: kind !== 'module',
          syntax: emptySyntax(), metadata: { definitionBounds: { start: definition.startIndex, end: definition.endIndex, startLine: definition.startPosition.row + 1, endLine: definition.endPosition.row + 1 } } };
        chunks.push(chunk); return chunk;
      };
      const module = make(tree.rootNode, 'module', this.moduleName(file), null);
      module.signature = source.split('\n').find(l => l.trim()) ?? '';
      const visit = (node: Node, parent: CodeChunk): void => {
        const exports=this.exports(node);if(exports.length)module.metadata.exportBindings=[...(module.metadata.exportBindings as ExportBinding[]??[]),...exports];
        let scope = parent; let target = node;
        const declaration = this.declaration(node, parent);
        if (declaration) {
          const d = declaration; scope = make(d.display, d.kind, d.name, parent, d.definition); target = d.definition;
          scope.signature = d.body ? source.slice(d.display.startIndex, d.body.startIndex).trimEnd() : d.display.text;
          scope.metadata.signatureBounds = { start: d.definition.startIndex, end: d.body?.startIndex ?? d.definition.endIndex };
          scope.syntax.bases = d.bases; scope.syntax.decorators = d.decorators; scope.metadata.async = d.async;
          if(this.bindingTracking)scope.metadata.parameterNames=named(field(d.definition,'parameters')).flatMap(n=>{const m=/^(?:\.{3}|\*{0,2})([A-Za-z_$][\w$]*)/.exec(n.text);return m?[m[1]!]:[];});
          const statement = d.body?.firstNamedChild;
          if (statement?.type === 'expression_statement' && statement.firstNamedChild?.type === 'string') scope.docstring = this.expression(statement.firstNamedChild).value ?? statement.text;
          else {
            let previous = d.display.previousNamedSibling;
            if (!previous && d.display.parent?.type === 'export_statement') previous = d.display.parent.previousNamedSibling;
            if (previous?.type === 'comment' && previous.text.startsWith('/**')) scope.docstring = previous.text;
          }
        }
        const imported = this.imports(target);
        if (imported.length) {
          const label = imported.map(i => `${'.'.repeat(i.relative)}${i.module}:${i.name ?? '*'}`).join(',');
          scope = make(target, 'import', label, parent); scope.syntax.imports = imported;
          module.syntax.imports.push(...imported);
        }
        const assignment = this.assignment(target);
        if (assignment) {
          if(this.bindingTracking&&!declaration&&['function','method'].includes(parent.kind)&&/^[A-Za-z_$][\w$]*$/.test(assignment.target))parent.metadata.localNames=[...(parent.metadata.localNames as string[]??[]),assignment.target];
          if (!declaration && ['module', 'class', 'interface'].includes(parent.kind)) scope = make(target, 'property', assignment.target, parent);
          scope.syntax.assignment = assignment;
        }
        const called = this.call(target); if (called) scope.syntax.calls.push(called);
        if (['identifier', 'type_identifier', 'property_identifier', 'shorthand_property_identifier'].includes(target.type) && target.text !== scope.name) scope.syntax.references.push(target.text);
        for (const child of named(target)) visit(child, scope);
      };
      for (const node of named(tree.rootNode)) visit(node, module);
      module.retrievable = chunks.length === 1;
      for (const chunk of chunks) {
        chunk.syntax.references = [...new Set(chunk.syntax.references)];
        chunk.metadata.members = chunks.filter(c => c.parentId === chunk.id && !['import', 'module'].includes(c.kind)).map(c => c.qualifiedName);
      }
      return { path: file, language: this.id, fileHash, chunks, diagnostics: [] };
    } finally { tree.delete(); parser.delete(); }
  }
}
export const field = (node: Node, name: string): Node | null => node.childForFieldName(name);
export const named = (node: Node | null | undefined): Node[] => node?.namedChildren.filter((n): n is Node => n !== null) ?? [];
export const all = (node: Node | null | undefined): Node[] => node?.children.filter((n): n is Node => n !== null) ?? [];
export function argumentFacts(node: Node | null, expression: (node: Node) => ExpressionFact): Pick<CallFact, 'arguments' | 'keywords'> {
  const args: ExpressionFact[] = []; const keywords: Record<string, ExpressionFact> = {};
  for (const child of named(node)) {
    if (child.type === 'keyword_argument') {
      const name = field(child, 'name'), value = field(child, 'value');
      if (name && value) Object.defineProperty(keywords, name.text, { value: expression(value), enumerable: true });
    } else args.push(expression(child));
  }
  return { arguments: args, keywords };
}
