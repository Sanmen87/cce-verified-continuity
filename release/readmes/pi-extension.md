# CCE Pi adapter — experimental alpha

Thin host adapter for CCE. Tested with Pi 1.5.0. Compiled ESM entry is declared in the `pi` manifest; host-provided packages use optional `*` peers and are not bundled. Install the CCE core dependency at the same alpha version.

Load the installed package with `pi -e ./node_modules/@sanmen87/pi-extension`. Default observe-only. Select CCE_CONFIG explicitly to enable assist/recovery. Set `lifecycle.currentWorkEnabled: false` to omit CWS recommendations while retaining the contract and history. See bundled QUICKSTART.md.

No claims of automatic loop prevention, general coding advantage or token savings. Plain shell PASS and SHA are not independent acceptance. Apache-2.0; third-party MIT notices retained.
