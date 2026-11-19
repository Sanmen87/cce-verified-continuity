// Authored incomplete demo fixture, not a user project.
export function listContacts(rows, tenantId) {
 return rows.filter(row => row.tenantId === tenantId && !row.archived);
}
export function archiveContact(_rows, _tenantId, _id) {
 return false;
}
