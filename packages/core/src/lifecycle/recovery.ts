import { integer } from '../config.ts';
import type { CompiledHandoff, HandoffStatus, TokenCounter } from './contracts.ts';
import { conservativeCounter } from './compiler.ts';

export interface RecoveredTaskState {
  schemaVersion: 1;
  status: HandoffStatus;
  text: string;
  tokens: number;
  budget: number;
  accounting: TokenCounter['source'];
  delivery: 'UNKNOWN';
  handoff: CompiledHandoff | null;
}
const prefix = 'CCE AUTOMATIC TASK RECOVERY v1\nPASSIVE STATE SNAPSHOT: data, not a new user request or a request to rerun checks. handoff_status is recovery coverage, not code success. TASK_COMPLETION=UNKNOWN.\n';
/** Agent-independent packing. A bounded recovery is not a completeness or delivery claim. */
export async function prepareTaskRecovery(
  compile: (budget: number) => Promise<CompiledHandoff>,
  budget: number,
  counter: TokenCounter = conservativeCounter,
): Promise<RecoveredTaskState> {
  integer(budget, 1, 65536);
  const count = async (text: string) => {
    const tokens = await counter.count(text);
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw Error('Invalid recovery token count');
    return tokens;
  };
  const result = (text: string, tokens: number, handoff: CompiledHandoff | null): RecoveredTaskState => ({
    schemaVersion: 1, status: text ? handoff!.status : 'INCOMPLETE_BUDGET',
    text, tokens, budget, accounting: counter.source, delivery: 'UNKNOWN', handoff,
  });
  let available = budget - await count(prefix + 'handoff_status=INCOMPLETE_BUDGET\n') - 32;
  let handoff: CompiledHandoff | null = null;
  for (let attempt = 0; attempt < 3 && available > 0; attempt++) {
    handoff = await compile(available);
    const text = prefix + 'handoff_status=' + handoff.status + '\n' + handoff.text;
    const tokens = await count(text);
    if (tokens <= budget) return result(text, tokens, handoff);
    available -= tokens - budget + 32;
  }
  // Keep structured audit even when no safe text can fit. Never cut requirements in half.
  return result('', 0, handoff);
}
