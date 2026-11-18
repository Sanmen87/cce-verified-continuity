import type { CodeChunk, FrameworkAdapter, FrameworkEnrichment, ParsedFile, ProjectDescription } from '../contracts.ts';
/** Optional AST enrichment. No Django conventions appear in the index/ranker/store. */
export class DjangoAdapter implements FrameworkAdapter {
  readonly id = 'django'; readonly version = 'django-ast-v2';
  private roles = new Map<string, string>();
  prepare(chunks: readonly CodeChunk[]): void { this.roles = this.infer(chunks, new Map()); }
  private infer(chunks: readonly CodeChunk[], initial: Map<string, string>): Map<string, string> {
    const roles = new Map(initial), modules = new Map(chunks.filter(c => c.kind === 'module').map(c => [c.path, c]));
    const classes = chunks.filter(c => c.kind === 'class');
    for (let pass = 0; pass <= classes.length; pass++) {
      let changed = false;
      for (const chunk of classes) {
        if (roles.has(chunk.qualifiedName)) continue;
        const module = modules.get(chunk.path);
        for (const base of chunk.syntax.bases) {
          const [head, ...tail] = base.split('.');
          const imported = module?.syntax.imports.find(i => (i.alias ?? i.name ?? i.module.split('.')[0]) === head);
          const resolved = imported ? [imported.module, imported.name, ...tail].filter(Boolean).join('.') : `${module?.qualifiedName}.${base}`;
          const role = resolved === 'django.db.models.Model' ? 'model' : resolved === 'django.db.models.Manager' ? 'manager' :
            resolved.startsWith('django.views.') || resolved.startsWith('rest_framework.views.') || resolved.startsWith('rest_framework.viewsets.') ? 'view' :
            resolved.startsWith('rest_framework.serializers.') ? 'serializer' : roles.get(resolved);
          if (role) { roles.set(chunk.qualifiedName, role); changed = true; break; }
        }
      }
      if (!changed) break;
    }
    return roles;
  }
  detects(project: ProjectDescription): boolean {
    return Object.values(project.manifests).some(text => /\bdjango(?:[<=>\s"']|$)/i.test(text)) ||
      (project.files.includes('manage.py') && project.files.some(p => p.endsWith('settings.py')));
  }
  enrich(file: ParsedFile): FrameworkEnrichment {
    const out: FrameworkEnrichment = { metadata: {}, relations: [] };
    if (file.language !== 'python') return out;
    const module = file.chunks.find(c => c.kind === 'module');
    const imports = module?.syntax.imports ?? [];
    const resolve = (name: string): string => {
      const [head, ...tail] = name.split('.');
      const imported = imports.find(i => (i.alias ?? i.name ?? i.module.split('.')[0]) === head);
      return imported ? [imported.module, imported.name, ...tail].filter(Boolean).join('.') : name;
    };
    const roles = this.infer(file.chunks, this.roles), models = new Set<string>();
    for (const chunk of file.chunks) if (chunk.kind === 'class') {
      const role = roles.get(chunk.qualifiedName);
      if (role) out.metadata[chunk.id] = { framework: 'django', role };
      if (role === 'model') models.add(chunk.id);
    }
    for (const chunk of file.chunks) {
      const assigned = chunk.syntax.assignment;
      if (chunk.parentId && models.has(chunk.parentId) && assigned?.value.kind === 'call') {
        const field = resolve(assigned.value.callee ?? '');
        if (['django.db.models.ForeignKey', 'django.db.models.ManyToManyField', 'django.db.models.OneToOneField', 'django.contrib.contenttypes.fields.GenericRelation'].includes(field)) {
          const target = assigned.value.arguments?.[0];
          if (!target) continue;
          const owner = file.chunks.find(c => c.id === chunk.parentId)!;
          let targetName = target.value ?? target.text;
          if (target.kind === 'string') {
            if (target.value === 'self') targetName = owner.qualifiedName;
            else {
              const [app, model] = targetName.includes('.') ? targetName.split('.') : [owner.path.split('/')[0], targetName];
              const matches = [...roles].filter(([qualified, role]) => role === 'model' && qualified.startsWith(`${app}.`) && qualified.endsWith(`.${model}`));
              targetName = matches.length === 1 ? matches[0]![0] : `${targetName.includes('.') ? app + '.models' : module?.qualifiedName ?? ''}.${model}`;
            }
          }
          const relation = field.split('.').at(-1)!;
          const metadata = { framework: 'django', role: 'relation', relation, targetExpression: target.text,
            onDelete: assigned.value.keywords?.on_delete?.text ?? null, relatedName: assigned.value.keywords?.related_name?.value ?? null };
          out.metadata[chunk.id] = metadata;
          out.relations.push({ source: chunk.id, targetName, relation: `ORM_${relation.toUpperCase()}`, confidence: 'syntax', metadata });
        }
      }
      const parent = file.chunks.find(c => c.id === chunk.parentId);
      if (assigned?.target === 'permissions' && parent?.name === 'Meta' && parent.parentId && models.has(parent.parentId)) out.metadata[chunk.id] = { framework: 'django', role: 'permissions', declarations: assigned.value };
      for (const call of chunk.syntax.calls) if (['django.urls.path', 'django.urls.re_path'].includes(resolve(call.callee)) && call.arguments[1]) {
        out.relations.push({ source: chunk.id, targetName: call.arguments[1].text, relation: 'ROUTES_TO', confidence: 'syntax',
          metadata: { framework: 'django', route: call.arguments[0]?.value ?? null } });
      }
    }
    return out;
  }
}
