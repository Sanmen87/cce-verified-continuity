import type { CodeChunk, ContextCompressor } from './contracts.ts';
/** AST-extracted source, not a generated paraphrase or executable replacement. */
export class SignatureCompressor implements ContextCompressor {
  preview(chunk: CodeChunk): ReturnType<ContextCompressor['preview']> {
    const omittedFields: string[] = [];
    const field = (name: string, value: string, limit: number) => {
      if (Buffer.byteLength(value) <= limit) return value;
      omittedFields.push(name); return '';
    };
    const all = Array.isArray(chunk.metadata.members) ? chunk.metadata.members.filter((m): m is string => typeof m === 'string') : [];
    const members: string[] = []; let bytes = 0;
    for (const member of all) {
      const size = Buffer.byteLength(member);
      if (members.length < 32 && bytes + size <= 2048) { members.push(member); bytes += size; }
    }
    return { representation: 'signature-docstring', signature: field('signature', chunk.signature, 4096),
      docstring: field('docstring', chunk.docstring, 2048), members, omittedFields, omittedMembers: all.length - members.length };
  }
}
