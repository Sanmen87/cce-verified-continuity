import path from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { CodeChunk, ImportFact, CallFact, ExpressionFact, SyntaxFacts } from '../contracts.ts';
import { TreeSitterAdapter, field, named, all, argumentFacts, type Declaration } from './tree-sitter.ts';
export class PythonAdapter extends TreeSitterAdapter {
  readonly id = 'python';
  private scopedBindings:boolean;
  constructor(scopedBindings=false){super();this.scopedBindings=scopedBindings;}
  protected override get bindingTracking():boolean{return this.scopedBindings;}
  override get version():string{return super.version+(this.scopedBindings?'/scoped-bindings-v1':'');}
  detects(file: string): boolean { return /\.pyi?$/i.test(file); }
  moduleName(file: string): string { return file.replace(/\.pyi?$/i, '').replace(/\/__init__$/, '').replaceAll('/', '.'); }
  resolveImport(from: string, specifier: string, files: ReadonlySet<string>, relative = 0): string | null {
    let prefix = '';
    if (relative) { prefix = path.posix.dirname(from); for (let i = 1; i < relative; i++) prefix = path.posix.dirname(prefix); }
    const base = path.posix.normalize(path.posix.join(prefix, specifier.replaceAll('.', '/'))).replace(/^\.\//, '');
    if (base.startsWith('..')) return null;
    return [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`].find(p => files.has(p)) ?? null;
  }
  protected declaration(node: Node, scope: CodeChunk): Declaration | null {
    let definition = node; const decorators: string[] = [];
    if (node.type === 'decorated_definition') {
      const inner = field(node, 'definition'); if (!inner) return null; definition = inner;
      decorators.push(...named(node).filter(c => c.type === 'decorator').map(c => c.text.slice(1)));
    }
    if (!['class_definition', 'function_definition'].includes(definition.type)) return null;
    const name = field(definition, 'name'); if (!name) return null;
    return { name: name.text, kind: definition.type === 'class_definition' ? 'class' : scope.kind === 'class' ? 'method' : 'function',
      definition, display: node, body: field(definition, 'body'), decorators,
      bases: named(field(definition, 'superclasses')).filter(c => c.type !== 'keyword_argument').map(c => c.text),
      async: all(definition).some(c => c.type === 'async') };
  }
  protected imports(node: Node): ImportFact[] {
    if (!['import_statement', 'import_from_statement'].includes(node.type)) return [];
    if (node.type === 'import_statement') return named(node).filter(c => ['dotted_name', 'aliased_import'].includes(c.type)).map(c => ({
      module: field(c, 'name')?.text ?? c.text, name: null, alias: field(c, 'alias')?.text ?? null, relative: 0,
    }));
    const moduleNode = field(node, 'module_name'); const raw = moduleNode?.text ?? '';
    const relative = raw.length - raw.replace(/^\.+/, '').length;
    const module = raw.slice(relative);
    return named(node).filter(c => c.id !== moduleNode?.id && ['dotted_name', 'aliased_import', 'wildcard_import'].includes(c.type)).map(c => ({
      module, name: field(c, 'name')?.text ?? c.text, alias: field(c, 'alias')?.text ?? null, relative,
    }));
  }
  protected assignment(node: Node): SyntaxFacts['assignment'] {
    if (node.type !== 'assignment') return null;
    const left = field(node, 'left'), right = field(node, 'right');
    return left && right ? { target: left.text, value: this.expression(right) } : null;
  }
  protected call(node: Node): CallFact | null {
    if (node.type !== 'call') return null;
    return { callee: field(node, 'function')?.text ?? '', ...argumentFacts(field(node, 'arguments'), n => this.expression(n)) };
  }
  protected expression(node: Node): ExpressionFact {
    if (node.type === 'string') return { kind: 'string', text: node.text, value: named(node).filter(c => c.type === 'string_content').map(c => c.text).join('') };
    if (['list', 'tuple', 'set'].includes(node.type)) return { kind: 'array', text: node.text, elements: named(node).map(c => this.expression(c)) };
    const call = this.call(node); if (call) return { kind: 'call', text: node.text, ...call };
    return { kind: node.type === 'attribute' ? 'member' : node.type, text: node.text };
  }
}
