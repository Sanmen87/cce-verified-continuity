import path from 'node:path';
import { sha256 } from '../workspace.ts';
import type { FrameworkAdapter, LanguageAdapter, ParsedFile, SyntaxFacts, ProjectDescription } from './contracts.ts';
export const CHUNKING_VERSION = 'cce-ast-v1';
export const emptySyntax = (): SyntaxFacts => ({ bases: [], decorators: [], imports: [], calls: [], references: [], assignment: null });
export function symbolId(file: string, language: string, kind: string, qualifiedName: string, ordinal = 0): string {
  return sha256(JSON.stringify([file.replaceAll('\\', '/'), language, kind, qualifiedName, ordinal]));
}
export class TextLanguageAdapter implements LanguageAdapter {
  readonly id = 'text'; readonly version = 'text-lines-v1';
  detects(): boolean { return true; }
  moduleName(file: string): string { return file; }
  resolveImport(): null { return null; }
  async parse(file: string, source: string, fileHash: string): Promise<ParsedFile> {
    const normalized = file.replaceAll('\\', '/');
    return { path: normalized, language: 'text', fileHash, diagnostics: [], chunks: [{
      id: symbolId(normalized, 'text', 'module', normalized), path: normalized, language: 'text', kind: 'module',
      name: path.posix.basename(normalized), qualifiedName: normalized, parentId: null,
      startLine: 1, endLine: Math.max(1, source.split('\n').length), definitionStartLine: 1,
      fileHash, chunkHash: sha256(source), signature: source.split('\n').find(l => l.trim())?.slice(0, 512) ?? '',
      docstring: '', text: source, parserVersion: this.version, algorithmVersion: CHUNKING_VERSION,
      retrievable: true, syntax: emptySyntax(), metadata: { fallback: true },
    }] };
  }
}
export class AdapterRegistry {
  private fallback = new TextLanguageAdapter();
  readonly languages: readonly LanguageAdapter[];
  readonly frameworks: readonly FrameworkAdapter[];
  constructor(languages: readonly LanguageAdapter[], frameworks: readonly FrameworkAdapter[] = []) {
    this.languages = languages; this.frameworks = frameworks;
    for (const adapters of [languages, frameworks]) if (new Set(adapters.map(a => a.id)).size !== adapters.length) throw new Error('Duplicate adapter id');
  }
  language(file: string): LanguageAdapter { return this.languages.find(adapter => adapter.detects(file)) ?? this.fallback; }
  detectFrameworks(project: ProjectDescription): FrameworkAdapter[] { return this.frameworks.filter(adapter => adapter.detects(project)); }
  fingerprint(): string { return sha256(JSON.stringify([...this.languages, ...this.frameworks].map(a => [a.id, a.version]).sort())); }
}
