# CCE core — experimental alpha

Local AST/FTS/graph, bounded context, source hashes, checkpoints and verified task state. Compiled ESM and TypeScript declarations are included. Requires Node >=22.19.0, Git and ripgrep; no Pi or model download.

```js
import { ContextEngine } from '@cce/core';
const engine = await ContextEngine.open('.');
try { console.log(await engine.searchCode('MyFunction')); } finally { engine.close(); }
```

See bundled QUICKSTART.md. Default observe-only; lifecycle and vector retrieval require explicit opt-in. CWS can be disabled with `lifecycle.currentWorkEnabled: false`. No proven general token savings, coding advantage or automatic loop prevention. Adapter-support internal exports are unstable.

Apache-2.0 for original CCE code; incorporated MIT notices retained.
