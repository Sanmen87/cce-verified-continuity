import type { projectTaskState } from './task-state.ts';
import type { TaskContractRevision } from './task-contract.ts';
import { sha256 } from '../workspace.ts';
import {validateTaskContract} from '../quality/tracker.ts';

export type VerifiedTaskState = Awaited<ReturnType<typeof projectTaskState>>;

/** A compact view of the same scoped snapshot. The compiler supplies ONLY a
 * preserved contract original from this handoff. Missing or ambiguous links
 * cannot establish mandatory coverage. */
export function mandatoryTaskState(state: VerifiedTaskState, eventId: string, original: string) {
  const binding = state.contract;
  if (!binding || eventId !== binding.eventId || state.completeness !== 'SCOPED_OBSERVATIONS') return null;
  let revision: TaskContractRevision;
  try { revision = JSON.parse(original); } catch { return null; }
  if (!revision || revision.schemaVersion !== 1 || revision.revisionId !== binding.revisionId ||
      revision.contractId !== binding.id || revision.contract?.id !== binding.id ||
      revision.sourceEventId !== binding.sourceEventId || revision.confirmation !== binding.confirmation ||
      revision.supersedes !== binding.supersedes || !Array.isArray(revision.contract?.requirements)) return null;
  const {revisionId,...originalFields}=revision;
  if(sha256(JSON.stringify(originalFields))!==revisionId)return null;
  try {validateTaskContract(revision.contract);}catch{return null;}
  if(!Array.isArray(state.requirements) || !state.requirements.every(r=>r && typeof r==='object' &&
    typeof r.id==='string' && typeof r.clause==='string' &&
    ['UNKNOWN','NOT_CHECKED','CONTEXT_FOUND','IMPLEMENTED_UNVERIFIED','VERIFIED_PASS','VERIFIED_FAIL','BLOCKED'].includes(r.status) &&
    typeof r.eventId==='string' && typeof r.sourceEventId==='string' && typeof r.revisionId==='string'))return null;
  const clauses = new Map(revision.contract.requirements.map(r => [r.id, r.clause]));
  if (clauses.size !== revision.contract.requirements.length || clauses.size !== state.requirements.length ||
      new Set(state.requirements.map(r => r.id)).size !== clauses.size ||
      state.requirements.some(r => clauses.get(r.id) !== r.clause)) return null;

  const requirements = state.requirements.map(r => r.eventId === eventId && r.revisionId === binding.revisionId &&
    r.sourceEventId === binding.sourceEventId ? { id: r.id, status: r.status } : r);
  const { currentWork, ...facts } = state;
  return { ...facts, contract:{id:binding.id,eventId,revisionId:binding.revisionId}, requirements, projection: 'MANDATORY' as const,
    requirementDefaults: 'Resolve contract lineage and clauses by id in ACTIVE TASK CONTRACT. Requirements inherit its provenance unless explicitly overridden.',
    omittedSections: currentWork ? ['currentWork'] : [] };
}
