# CCE Pi adapter — experimental alpha

Thin host adapter for CCE. Tested with Pi 1.5.0. Compiled ESM entry is declared in the `pi` manifest; host-provided packages use optional `*` peers and are not bundled. Install the CCE core dependency at the same alpha version.

Load the installed package with `pi -e ./node_modules/@sanmen87/pi-extension`. Default observe-only. Select CCE_CONFIG explicitly to enable assist/recovery. Alpha.3 adds `lifecycle.currentWorkPolicy.actionRecommendation`: `off` removes only current `next_action`, `observe` computes it for `onCurrentWorkDiagnostic` without model delivery, and `assist` preserves the recommendation default. CWS state, Task Contract and recovery remain available. `currentWorkEnabled: false` disables the whole CWS. See bundled QUICKSTART.md.

No claims of automatic loop prevention, general coding advantage or token savings. Plain shell PASS and SHA are not independent acceptance. Apache-2.0; third-party MIT notices retained.
