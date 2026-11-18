import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import type {Workspace} from './workspace.ts';

export class CheckpointError extends Error {
  readonly code:string;
  constructor(code:string,message:string){super(message);this.name='CheckpointError';this.code=code;}
}

/** Native agents use absolute paths; retain Workspace's traversal/link/exclusion rules. */
export async function checkpointPath(workspace:Workspace,input:string,allowed:ReadonlySet<string>):Promise<string>{
  if(!input||input.includes('\0')||input.split(/[\\/]/).includes('..')||/^[/\\]{2}/.test(input))throw new CheckpointError('INVALID_SOURCE_PATH','Use a relative source path or an absolute path inside this workspace; traversal and UNC paths are forbidden.');
  let relative=input;
  if(path.isAbsolute(input)||path.win32.isAbsolute(input)){
    if(process.platform!=='win32'&&!path.isAbsolute(input)&&path.win32.isAbsolute(input))throw new CheckpointError('SOURCE_OUTSIDE_WORKSPACE','Source path is outside this workspace.');
    const absolute=path.resolve(input);let current=path.parse(absolute).root;
    try{for(const part of absolute.slice(current.length).split(path.sep)){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error('Linked source');}relative=path.relative(workspace.root,await realpath(absolute));}
    catch{throw new CheckpointError('SOURCE_UNAVAILABLE','Source is missing or linked; use a current ordinary source file inside the workspace.');}
    if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw new CheckpointError('SOURCE_OUTSIDE_WORKSPACE','Source path is outside this workspace.');
  }
  try{relative=workspace.normalize(relative);}catch{throw new CheckpointError('INVALID_SOURCE_PATH','Invalid source path; use workspace-relative paths, without drive prefixes or traversal.');}
  const canonical=process.platform==='win32'?[...allowed].find(p=>p.toLowerCase()===relative.toLowerCase()):allowed.has(relative)?relative:undefined;
  if(!canonical)throw new CheckpointError('SOURCE_EXCLUDED','Evidence must reference an existing, indexed, non-excluded source file.');
  try{await workspace.resolve(canonical);}catch{throw new CheckpointError('SOURCE_UNAVAILABLE','Source is missing, excluded, linked, or outside this workspace.');}
  return canonical;
}
