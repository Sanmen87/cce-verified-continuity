import { cp, mkdir } from 'node:fs/promises';
const source = new URL('../packages/core/assets/', import.meta.url);
const target = new URL('../dist/packages/core/assets/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
