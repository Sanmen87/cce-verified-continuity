import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngine, parseConfig } from '../packages/core/src/index.ts';
import { compileHandoff } from '../packages/core/src/lifecycle/compiler.ts';
import { fixture } from './helpers.ts';

test('CWS opt-out preserves the user contract and minimal recovery without emitting recommendations', async t => {
 const root = await fixture(t);
 const contract = { id: 'release', source: 'user' as const, text: 'Keep tenant isolation.', requirements: [{ id: 'isolation', clause: 'Keep tenant isolation.', needs: [], checks: [] }] };
 const engine = await ContextEngine.open(root, { taskContract: contract, config: { mode: 'assist', quality: { coverageEnabled: true }, lifecycle: { enabled: true, ledgerEnabled: true, projectionEnabled: true, recoveryPolicy: 'verified-state', currentWorkEnabled: false } } });
 t.after(() => engine.close()); const life = engine.lifecycle!;
 await life.userRequirement('goal', contract.text);
 const state = await life.taskState();
 assert.equal(Object.hasOwn(state, 'currentWork'), false);
 assert.equal(state.requirements[0]?.clause, contract.text);
 assert.equal(state.completion, 'UNKNOWN');
 const handoff = await compileHandoff(life.ledger, engine.sessionId, 'main', { budget: 4096, taskState: { ...state, continuation: { verbose: 'details'.repeat(10000) } } });
 assert.equal(handoff.taskStatePacking, 'MINIMAL');
 const projected = JSON.parse(handoff.text.split('TASK STATE PROJECTION\n')[1]!.split('\n')[0]!);
 assert.equal(Object.hasOwn(projected, 'currentWork'), false);
 assert.equal(projected.requirements[0].clause, contract.text);
 assert.equal(handoff.coverage, 'INCOMPLETE');
});

test('CWS is included only inside explicitly enabled lifecycle and rejects invalid configuration', () => {
 assert.equal(parseConfig().mode, 'observe-only');
 assert.equal(parseConfig().lifecycle.enabled, false);
 assert.equal(parseConfig().lifecycle.currentWorkEnabled, true);
 assert.equal(parseConfig({ lifecycle: { currentWorkEnabled: false } }).lifecycle.enabled, false);
 assert.throws(() => parseConfig({ lifecycle: { currentWorkEnabled: 'false' } }));
});
