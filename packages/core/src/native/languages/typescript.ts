import path from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { CodeChunk, ImportFact, CallFact, ExpressionFact, SyntaxFacts } from '../contracts.ts';
import { TreeSitterAdapter, field, named, all, argumentFacts, type Declaration,type ExportBinding } from './tree-sitter.ts';
export class TypeScriptAdapter extends TreeSitterAdapter {
  readonly id: 'typescript' | 'javascript' | 'tsx';
  private scopedBindings:boolean;
  constructor(language: 'typescript' | 'javascript' | 'tsx' = 'typescript',scopedBindings=false) { super(); this.id = language;this.scopedBindings=scopedBindings; }
  override get version():string{return super.version+(this.scopedBindings?'/export-bindings-v1':'');}
  protected override get bindingTracking():boolean{return this.scopedBindings;}
  protected override exports(node:Node):ExportBinding[]{
    if(!this.scopedBindings||node.type!=='export_statement')return[];
    const source=field(node,'source'),module=source?this.expression(source).value??null:null;
    const clause=named(node).find(n=>n.type==='export_clause');
    if(clause)return named(clause).filter(n=>n.type==='export_specifier').map(n=>({name:field(n,'alias')?.text??field(n,'name')?.text??n.text,local:module?null:field(n,'name')?.text??n.text,module,imported:module?field(n,'name')?.text??n.text:null}));
    const declaration=field(node,'declaration')??named(node).find(n=>/declaration$/.test(n.type));
    if(declaration){const names=declaration.type==='lexical_declaration'?named(declaration).flatMap(n=>field(n,'name')?[field(n,'name')!.text]:[]):[field(declaration,'name')?.text??'default'];
      return names.map(local=>({name:all(node).some(n=>n.type==='default')?'default':local,local,module:null,imported:null}));}
    // Wildcards are followed only when a single exported binding can be proven downstream.
    if(module&&all(node).some(n=>n.type==='*'))return[{name:'*',local:null,module,imported:'*'}];
    return[];
  }
  detects(file: string): boolean {
    return this.id === 'javascript' ? /\.[cm]?jsx?$/i.test(file) : this.id === 'tsx' ? /\.tsx$/i.test(file) : /\.[cm]?ts$/i.test(file);
  }
  moduleName(file: string): string { return file.replace(/\.[^.]+$/, '').replace(/\/index$/, '').replaceAll('/', '.'); }
  resolveImport(from: string, specifier: string, files: ReadonlySet<string>): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (base.startsWith('..')) return null;
    const stem = base.replace(/\.[cm]?jsx?$/, '');
    return [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '/index.ts', '/index.js'].map(ext => stem + ext)].find(p => files.has(p)) ?? null;
  }
  protected declaration(node: Node, scope: CodeChunk): Declaration | null {
    let definition = node; let display = node; let name = field(node, 'name')?.text ?? '';
    const types = ['class_declaration', 'abstract_class_declaration', 'function_declaration', 'generator_function_declaration', 'method_definition', 'method_signature', 'interface_declaration', 'type_alias_declaration'];
    if (node.type === 'export_statement') {
      const inner = named(node).find(c => types.includes(c.type)); if (!inner) return null;
      definition = inner; name = field(inner, 'name')?.text ?? 'default';
    } else if (node.parent?.type === 'export_statement' && types.includes(node.type)) return null;
    else if (['variable_declarator', 'public_field_definition', 'field_definition'].includes(node.type)) {
      const value = field(node, 'value'); if (!value || !['arrow_function', 'function_expression', 'generator_function'].includes(value.type)) return null;
      definition = value; display = node.parent?.type === 'lexical_declaration' ? node.parent : node;
      if (display.parent?.type === 'export_statement') display = display.parent;
    } else if (!types.includes(node.type)) return null;
    if (!name) name = '$anonymous';
    const kind = definition.type.includes('class') ? 'class' : definition.type === 'interface_declaration' ? 'interface' : definition.type === 'type_alias_declaration' ? 'type' : definition.type.includes('method') || scope.kind === 'class' ? 'method' : 'function';
    const heritage = named(definition).find(c => c.type === 'class_heritage');
    const bases = named(heritage).filter(c => c.type === 'extends_clause').flatMap(c => named(c).map(n => n.text));
    return { name, kind, definition, display, body: field(definition, 'body'), bases,
      decorators: named(display).filter(c => c.type === 'decorator').map(c => c.text.slice(1)),
      async: all(definition).some(c => c.type === 'async') };
  }
  protected imports(node: Node): ImportFact[] {
    if (node.type !== 'import_statement') return [];
    const source = field(node, 'source'); if (!source) return [];
    const module = this.expression(source).value ?? ''; const clause = named(node).find(c => c.type === 'import_clause');
    if (!clause) return [{ module, name: null, alias: null, relative: 0 }];
    const out: ImportFact[] = [];
    const visit = (n: Node): void => {
      if (n.type === 'import_specifier') { out.push({ module, name: field(n, 'name')?.text ?? n.text, alias: field(n, 'alias')?.text ?? null, relative: 0 }); return; }
      if (n.type === 'namespace_import') { out.push({ module, name: '*', alias: n.lastNamedChild?.text ?? null, relative: 0 }); return; }
      if (n.type === 'identifier' && n.parent?.type === 'import_clause') { out.push({ module, name: 'default', alias: n.text, relative: 0 }); return; }
      named(n).forEach(visit);
    }; visit(clause); return out;
  }
  protected assignment(node: Node): SyntaxFacts['assignment'] {
    if (!['public_field_definition', 'field_definition', 'variable_declarator'].includes(node.type)) return null;
    const left = field(node, 'name'), right = field(node, 'value');
    return left ? { target: left.text, value: right ? this.expression(right) : { kind: 'type', text: field(node, 'type')?.text ?? '' } } : null;
  }
  protected call(node: Node): CallFact | null {
    if (!['call_expression', 'new_expression'].includes(node.type)) return null;
    return { callee: field(node, 'function')?.text ?? field(node, 'constructor')?.text ?? '', ...argumentFacts(field(node, 'arguments'), n => this.expression(n)) };
  }
  protected expression(node: Node): ExpressionFact {
    if (node.type === 'string') return { kind: 'string', text: node.text, value: named(node).filter(c => c.type === 'string_fragment').map(c => c.text).join('') };
    if (node.type === 'array') return { kind: 'array', text: node.text, elements: named(node).map(c => this.expression(c)) };
    const call = this.call(node); if (call) return { kind: 'call', text: node.text, ...call };
    return { kind: node.type === 'member_expression' ? 'member' : node.type, text: node.text };
  }
}
