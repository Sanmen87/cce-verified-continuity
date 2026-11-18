import { boundedString } from '../config.ts';
import { sha256 } from '../workspace.ts';
import { validateTaskContract } from '../quality/tracker.ts';
import type { ExplicitTaskContract } from '../quality/contracts.ts';
import type { ContextEvent } from './contracts.ts';
import type { ContextLedger } from './ledger.ts';

export interface TaskContractRevision {
  schemaVersion: 1; contractId: string; revisionId: string; sourceEventId: string;
  supersedes: string | null; confirmation: ExplicitTaskContract['source']; contract: ExplicitTaskContract;
}
export async function contractRevisions(ledger: ContextLedger, session: string, branch: string) {
  const events = ledger.contractEvents(session, branch);
  if(events.length>=1024)throw Error('Contract history event limit; completeness unknown');
  const revisions: Array<{ event: ContextEvent; revision: TaskContractRevision }> = [];
  for (const event of events) {
    if (!event.mandatory || !['user', 'host'].includes(event.origin)) continue;
    const revision = JSON.parse((await ledger.original(session, branch, event.id)).text) as TaskContractRevision;
    const { revisionId, ...body } = revision;
    if (body.schemaVersion !== 1 || sha256(JSON.stringify(body)) !== revisionId || body.contractId !== body.contract.id ||
        body.confirmation !== body.contract.source) throw Error('Invalid contract revision');
    validateTaskContract(body.contract);
    const previous = revisions.at(-1);
    if ((previous?.revision.revisionId ?? null) !== revision.supersedes ||
        (previous?.event.id ?? undefined) !== event.supersedes || event.messageId !== revision.sourceEventId)
      throw Error('Invalid or concurrent contract revision chain');
    revisions.push({ event, revision });
  }
  return revisions;
}
/** Trusted host API only; no model tool can confirm or supersede a task contract. */
export async function confirmTaskContract(
  ledger: ContextLedger, session: string, branch: string, input: ExplicitTaskContract,
  confirmation: { sourceEventId: string; supersedes: string | null },
) {
  const contract = validateTaskContract(input);
  boundedString(confirmation.sourceEventId, 256);
  const revisions = await contractRevisions(ledger, session, branch);
  const duplicate = revisions.find(r => r.revision.sourceEventId === confirmation.sourceEventId);
  if (duplicate) {
    if (JSON.stringify(duplicate.revision.contract) !== JSON.stringify(contract) || duplicate.revision.supersedes !== confirmation.supersedes)
      throw Error('Conflicting source event');
    return { ...duplicate, created: false };
  }
  const active = revisions.at(-1);
  if ((active?.revision.revisionId ?? null) !== confirmation.supersedes) throw Error('Explicit current revision confirmation required');
  if (active && active.revision.contractId !== contract.id) throw Error('Contract identity cannot change in a revision');
  const body = { schemaVersion: 1 as const, contractId: contract.id, sourceEventId: confirmation.sourceEventId,
    supersedes: confirmation.supersedes, confirmation: contract.source, contract };
  const revision: TaskContractRevision = { ...body, revisionId: sha256(JSON.stringify(body)) };
  const event = await ledger.append(session, branch, {
    externalId: 'contract-revision:' + revision.revisionId, kind: 'TASK_CONTRACT',
    origin: contract.source === 'user' ? 'user' : 'host', mandatory: true, messageId: confirmation.sourceEventId,
    ...(active ? { supersedes: active.event.id } : {}), text: JSON.stringify(revision),
  });
  return { event, revision, created: true };
}
