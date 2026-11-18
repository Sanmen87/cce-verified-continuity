export interface Order { id: string }
export class BaseService {}
export function lookupOrder(id: string): Order { return { id }; }
