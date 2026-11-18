export interface CceConfig {
  lifecycle: {
    enabled:boolean; ledgerEnabled:boolean; projectionEnabled:boolean; historyRecallEnabled:boolean; capabilityContractEnabled:boolean; currentWorkEnabled:boolean;
    compactionMode:'native'|'observe'|'deterministic'|'hybrid-mini-llm'; handoffBudgetTokens:number; recoveryReserveTokens:number;
    recoveryPolicy:'legacy'|'explicit'|'explicit-hint'|'verified-state';
    sufficiencyMode:'observe'|'assist'|'guarded'; externalizeToolOutputs:boolean; externalizeMinBytes:number;
    maxBlobBytes:number; maxStoreBytes:number; retentionDays:number;
    miniLlm:{enabled:boolean;endpoint:string;model:string;timeoutMs:number};
  };
  quality: { profile: 'legacy-v04' | 'elara-compatible' | 'definitions-first' | 'structural-balanced' | 'hybrid-quality'; guardEnabled: boolean; coverageEnabled: boolean;packing:'legacy'|'quality-aware';selection:'legacy'|'evidence-aware' };
  schemaVersion: 1;
  enabled: boolean;
  mode: 'observe-only' | 'assist';
  assist: { strategy: 'tools-only' | 'auto-context-only' | 'combined' };
  context: {
    windowTokens: number; reserveTokens: number; retrievalBudgetTokens: number;
    maxAutoContextTokens: number; tokenEstimateSafetyFactor: number;
  };
  retrieval: {
    backend: 'ripgrep' | 'hybrid-native'; topK: number; maxFileBytes: number; maxSearchResults: number;
    exclude: string[]; includeMigrationsByDefault: boolean;
  };
  hybrid: {
    symbolResolution:'legacy'|'scoped';
    intentPolicy:'legacy'|'relationships';
    graphStrategy: 'legacy' | 'off' | 'always' | 'selective';
    lazyHydration:boolean;
    enableBM25: boolean; enableVector: boolean; enableLiteral: boolean; enableGraph: boolean;
    enableCompression: boolean; enableMemory: boolean; confidenceThreshold: number;
    vectorStorage: 'auto' | 'sqlite-vec' | 'exact';
    keywordMode: 'fts5' | 'code-bm25';
    embedding: { endpoint: string; protocol: 'openai' | 'ollama'; model: string; revision: string; dimension: number };
  };
  freshness: { readBeforeEdit: true; sha256Check: true; checkGitStateOnResume: true };
  storage: { driver: 'sqlite'; stateDir: string };
  telemetry: { enabled: boolean; storeRawPrompts: false };
}
export const defaults: CceConfig = {
  lifecycle:{enabled:false,ledgerEnabled:false,projectionEnabled:false,historyRecallEnabled:false,capabilityContractEnabled:false,currentWorkEnabled:true,
    compactionMode:'native',handoffBudgetTokens:2048,recoveryReserveTokens:0,recoveryPolicy:'legacy',sufficiencyMode:'observe',externalizeToolOutputs:false,externalizeMinBytes:16384,
    maxBlobBytes:2097152,maxStoreBytes:67108864,retentionDays:30,miniLlm:{enabled:false,endpoint:'http://127.0.0.1:1234/v1',model:'',timeoutMs:10000}},
  quality: { profile: 'legacy-v04', guardEnabled: false, coverageEnabled: false,packing:'legacy',selection:'legacy' },
  schemaVersion: 1, enabled: true, mode: 'observe-only',
  assist: { strategy: 'combined' },
  context: { windowTokens: 65536, reserveTokens: 16384, retrievalBudgetTokens: 12000,
    maxAutoContextTokens: 4000, tokenEstimateSafetyFactor: 1.25 },
  retrieval: { backend: 'ripgrep', topK: 12, maxFileBytes: 524288,
    maxSearchResults: 100, exclude: [], includeMigrationsByDefault: false },
  hybrid: { symbolResolution:'legacy',intentPolicy:'legacy',graphStrategy: 'legacy',lazyHydration:false, enableBM25: true, enableVector: false, enableLiteral: true, enableGraph: true, enableCompression: true, enableMemory: true,
    confidenceThreshold: 0, vectorStorage: 'auto', keywordMode: 'fts5', embedding: { endpoint: 'http://127.0.0.1:1234/v1', protocol: 'openai', model: '', revision: '', dimension: 0 } },
  freshness: { readBeforeEdit: true, sha256Check: true, checkGitStateOnResume: true },
  storage: { driver: 'sqlite', stateDir: '.context-engine' },
  telemetry: { enabled: true, storeRawPrompts: false },
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
export function parseJson(text: string): unknown {
  if (Buffer.byteLength(text) > 65536) throw new Error('JSON input exceeds 64 KiB');
  try { return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown; }
  catch { throw new Error('Invalid JSON input'); }
}
export function boundedString(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error('Invalid string');
  }
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('Invalid integer');
  }
  return value;
}
function mergeKnown(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key)) throw new Error('Unknown configuration key');
    const previous = base[key];
    if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
      out[key] = mergeKnown(object(previous), object(value));
    } else {
      if (typeof previous !== typeof value || Array.isArray(previous) !== Array.isArray(value)) {
        throw new Error(`Invalid configuration type: ${key}`);
      }
      out[key] = value;
    }
  }
  return out;
}
export function parseConfig(input: unknown = {}): CceConfig {
  const c = mergeKnown(object(structuredClone(defaults)), object(input)) as unknown as CceConfig;
  const life=c.lifecycle;
  if(!['native','observe','deterministic','hybrid-mini-llm'].includes(life.compactionMode)||!['observe','assist','guarded'].includes(life.sufficiencyMode))throw Error('Invalid lifecycle mode');
  if(!['legacy','explicit','explicit-hint','verified-state'].includes(life.recoveryPolicy))throw Error('Invalid recovery policy');
  integer(life.handoffBudgetTokens,1,65536);integer(life.recoveryReserveTokens,0,65536);integer(life.maxBlobBytes,1024,16777216);integer(life.maxStoreBytes,life.maxBlobBytes,1073741824);integer(life.retentionDays,1,3650);integer(life.externalizeMinBytes,1024,16777216);integer(life.miniLlm.timeoutMs,1,120000);
  if(life.enabled&&(!life.ledgerEnabled||(!life.projectionEnabled&&life.sufficiencyMode==='guarded')))throw Error('Lifecycle requires ledger; guarded mode requires projection');
  if(life.miniLlm.enabled){boundedString(life.miniLlm.model,256);const url=new URL(life.miniLlm.endpoint);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Mini LLM must be explicit unauthenticated loopback');}
  if (!['legacy-v04','elara-compatible','definitions-first','structural-balanced','hybrid-quality'].includes(c.quality.profile)) throw new Error('Invalid quality profile');
  if (!['legacy','off','always','selective'].includes(c.hybrid.graphStrategy)) throw new Error('Invalid graph strategy');
  if(!['legacy','scoped'].includes(c.hybrid.symbolResolution)||!['legacy','relationships'].includes(c.hybrid.intentPolicy))throw new Error('Invalid graph correctness policy');
  if(!['legacy','quality-aware'].includes(c.quality.packing))throw new Error('Invalid packing policy');
  if(!['legacy','evidence-aware'].includes(c.quality.selection))throw new Error('Invalid selection policy');
  if (c.schemaVersion !== 1 || !['observe-only', 'assist'].includes(c.mode) ||
    !['tools-only', 'auto-context-only', 'combined'].includes(c.assist.strategy) ||
    !['ripgrep', 'hybrid-native'].includes(c.retrieval.backend) || c.storage.driver !== 'sqlite' ||
    !c.freshness.readBeforeEdit || !c.freshness.sha256Check || !c.freshness.checkGitStateOnResume ||
    c.telemetry.storeRawPrompts !== false) throw new Error('Unsupported or unsafe configuration');
  const x = c.context;
  for (const n of [x.windowTokens, x.reserveTokens, x.retrievalBudgetTokens, x.maxAutoContextTokens]) integer(n, 1, 1048576);
  if (x.reserveTokens >= x.windowTokens || !Number.isFinite(x.tokenEstimateSafetyFactor) ||
    x.tokenEstimateSafetyFactor < 1 || x.tokenEstimateSafetyFactor > 4) throw new Error('Invalid context budget');
  integer(c.retrieval.topK, 1, 100);
  integer(c.retrieval.maxFileBytes, 1, 2097152);
  integer(c.retrieval.maxSearchResults, 1, 1000);
  if (c.retrieval.exclude.length > 100) throw new Error('Too many exclusions');
  c.retrieval.exclude.forEach(v => boundedString(v, 256));
  if (!['auto', 'sqlite-vec', 'exact'].includes(c.hybrid.vectorStorage) || !['fts5','code-bm25'].includes(c.hybrid.keywordMode) || !['openai', 'ollama'].includes(c.hybrid.embedding.protocol) ||
    !Number.isFinite(c.hybrid.confidenceThreshold) || c.hybrid.confidenceThreshold < 0 || c.hybrid.confidenceThreshold > 1) throw new Error('Invalid hybrid configuration');
  integer(c.hybrid.embedding.dimension, 0, 65536);
  if (c.hybrid.enableVector) {
    boundedString(c.hybrid.embedding.model, 256); boundedString(c.hybrid.embedding.revision, 256); integer(c.hybrid.embedding.dimension, 1, 65536);
    const endpoint = new URL(c.hybrid.embedding.endpoint);
    if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Embedding endpoint must be unauthenticated loopback');
  }
  boundedString(c.storage.stateDir, 256);
  if (!/^\.context-engine(?:\/[a-zA-Z0-9_-]+)*$/.test(c.storage.stateDir)) {
    throw new Error('stateDir must be .context-engine or its dedicated subdirectory');
  }
  return c;
}
