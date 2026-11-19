// Public acceptance of the authored contacts fixture. No dependency on CCE or Pi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
assert.ok(process.env.CCE_DEMO_MODULE, 'Run npm run demo:continuity to select an isolated fixture');
const { archiveContact, listContacts } = await import(pathToFileURL(process.env.CCE_DEMO_MODULE).href);
const sample = () => [
 { id: 1, tenantId: 'a', name: 'Alice', archived: false },
 { id: 2, tenantId: 'a', name: 'Ann', archived: false },
 { id: 3, tenantId: 'b', name: 'Bob', archived: false },
];
test('archives a contact owned by the requesting tenant', () => {
 const rows = sample(); assert.equal(archiveContact(rows, 'a', 1), true); assert.equal(rows[0].archived, true);
});
test('another tenant cannot archive the contact', () => {
 const rows = sample(), before = structuredClone(rows);
 assert.equal(archiveContact(rows, 'b', 1), false); assert.deepEqual(rows, before);
});
test('archiving retains the row and its original data', () => {
 const rows = sample(); archiveContact(rows, 'a', 1);
 assert.equal(rows.length, 3); assert.deepEqual(rows[0], { id: 1, tenantId: 'a', name: 'Alice', archived: true });
});
test('active list excludes the archived contact', () => {
 const rows = sample(); archiveContact(rows, 'a', 1); assert.deepEqual(listContacts(rows, 'a').map(row => row.id), [2]);
});
test('active list never includes another tenant', () => {
 assert.deepEqual(listContacts(sample(), 'b').map(row => row.id), [3]);
});
test('repeated archive is idempotent', () => {
 const rows = sample(); assert.equal(archiveContact(rows, 'a', 1), true); const before = structuredClone(rows);
 assert.equal(archiveContact(rows, 'a', 1), true); assert.deepEqual(rows, before);
});
