import { AdapterRegistry } from './registry.ts';
import { PythonAdapter } from './languages/python.ts';
import { TypeScriptAdapter } from './languages/typescript.ts';
import { DjangoAdapter } from './frameworks/django.ts';
/** Composition root only. Indexing, ranking, storage and context know no framework. */
export const defaultAdapters = (scopedBindings=false): AdapterRegistry => new AdapterRegistry([
  new PythonAdapter(scopedBindings), new TypeScriptAdapter('typescript',scopedBindings), new TypeScriptAdapter('javascript',scopedBindings), new TypeScriptAdapter('tsx',scopedBindings),
], [new DjangoAdapter()]);
