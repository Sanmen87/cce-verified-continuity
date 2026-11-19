// Deliberate regression used to prove a source edit invalidates the saved PASS.
export function listContacts(rows, tenantId) {
 return rows.filter(row => row.tenantId === tenantId && !row.archived);
}
export function archiveContact(rows, _tenantId, id) {
 const row = rows.find(row => row.id === id);
 if (!row) return false;
 row.archived = true;
 return true;
}
