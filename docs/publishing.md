# Publishing an alpha

## Current channel policy — alpha.3

The owner explicitly selected **latest** for `0.1.0-alpha.3`. `release/config.json` records `distTag: "latest"`; package manifests, the publisher and archive review gate must agree. Publish reviewed immutable archives with this explicit tag. Earlier alpha versions remain unchanged; `@alpha` may continue to reference the earlier alpha until separately promoted. Exact-version installation is recommended for reproducibility. npm latest is a distribution channel, not a stability guarantee: this release is still experimental.

The owner also requested the current release as GitHub Latest. GitHub does not allow its prerelease flag together with Latest, so `githubLatest: true` selects a normal GitHub release marked **experimental alpha** in its title/body and alpha semver tag. This UI flag does not change the project's alpha support or evidence claims. The remaining text includes historical bootstrap policy; use the current version/channel configuration for a new release.

The repository and npm scope belong to the publisher's chosen identities: `Sanmen87/cce-verified-continuity` and the owner-confirmed npm username/scope `sanmen87` / `@sanmen87`. No automated command in this checkout publishes by default. Identity confirmation is separate from npm authentication and publication approval.

The owner selected `Sanmen87/cce-verified-continuity`; a private preparation repository was created on 2026-11-19 (Europe/Moscow), then made public on the owner's explicit request after Windows/Linux CI passed. GitHub Release and npm publication are still separate steps. A repository name is scoped to its GitHub owner; existing repositories named CCE elsewhere do not reserve this owner's path. This is not trademark clearance.

An npm scope comes with a user account or organization. The owner registered `sanmen87` and confirmed that username in this session; an organization is not needed. GitHub login does not authenticate npm. Use `npm login --registry=https://registry.npmjs.org` interactively, then `npm whoami --registry=https://registry.npmjs.org` must report `sanmen87`. Never commit `.npmrc` or credentials. See [npm scopes](https://docs.npmjs.com/about-scopes/).

Name check on 2026-11-19: the unscoped package `cce` exists; `code-context-engine` and `@sanmen87/core` returned registry 404. A registry 404 is not a reservation. New archives and documentation use `@sanmen87/core`, `@sanmen87/pi-extension`, `@sanmen87/mcp`. Old provisional archives remain historical artifacts; do not publish them.

1. Review the generated public source tree listed in `release-artifacts/public-source.json`. It is an explicit allowlist and has no copied Git history. Preserve research artifacts separately; do not push the research working directory.
2. `release/config.json` records the confirmed scope/repository. Set the GitHub repository variable `NPM_SCOPE` to `@sanmen87`; the release workflow passes it as `CCE_RELEASE_SCOPE`. `CCE_RELEASE_REPOSITORY` must match `https://github.com/Sanmen87/cce-verified-continuity`. The gate rejects environment/config mismatches. Rebuild archives and source export after any identity change.
3. Run `typecheck`, public unit/integration tests, build, no-LLM Pi smoke, release scanner, `npm pack --dry-run`/pack and clean consumer install. Inspect `exports`, types, files, grammar licenses and dependency audit.
4. Commit the reviewed source export to the intended repository. Run Windows/Linux CI. Actual hosted CI must be green; local Docker execution does not prove Windows/Linux GitHub runners passed.
5. Tag `v0.1.0-alpha.1`. Set up npm Trusted Publishing for the exact owner/repository/workflow/environment and explicitly allow direct `npm publish` for this workflow (stage-only trust is insufficient). Protect the `npm-alpha` environment with a reviewer. Bootstrap new package identity through npm's supported flow if required; do not add a long-lived token to this repo.
6. Trigger `release.yml` explicitly, selecting publish and the tag. It checks the tag/version, exact reviewed source contents and archive hashes bound to the clean-install report before npm/GitHub writes. The command explicitly selects the `alpha` dist-tag. During the first bootstrap npm also assigned `latest` to `0.1.0-alpha.1`; removing that alias returned HTTP 400, so the registry-assigned aliases were preserved. This version remains an experimental prerelease. Consumers should select `@alpha` or pin the exact version.
7. Ask an external user to install the archives/package and record platform/version issues before promoting to 0.1.0.

OIDC needs a supported npm version and `id-token: write`; npm generates provenance for supported trusted publishing. Match the package repository to the workflow repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/). Creating repository settings, npm trust and the public release requires explicit owner action after review.

`0.1.0-alpha.1` was bootstrapped through the owner's npm CLI after explicit release approval and npm browser authentication. All three public registry installs were verified on Node 22.19.0 without npm credentials, including core AST, MCP and Pi compiled loader. The bootstrap has no OIDC provenance. This immutable version must not be republished: bump every package/release version for the next alpha and configure Trusted Publishing before using the OIDC workflow.

Root/workspace manifests are private development packages with TS source entries. Public tarballs are generated from built output with compiled ESM exports and declarations. Host-provided Pi packages keep `*` peer ranges; docs name the actually tested security-patched host. Third-party source notices remain under their own licenses.

## Evaluation publication

The public source allowlist includes `evaluation/`: derived reports/protocols, explicitly projected JSON, authored MCP fixture/scorer, minimal captured source bodies, extracted usage receipts, provenance and a SHA inventory. Run `npm run test:evaluation` before export and in CI. Keep full `.bench`, raw sessions/SSE, private snapshots and hidden acceptance code outside the export. The source audit scans every included evaluation file; this is an allowlisted addition, not a general exception for benchmark directories. npm tarballs continue to exclude evaluation data.

The offline verifier recomputes historical MCP scoring and published counter arithmetic. It does not rerun the independent native CRM oracle or prove model interpretation. Preserve original FAIL/NOT_EVALUATED/UNKNOWN values and separate post-hoc retries. New live reproductions require their own frozen inputs and blind evaluation. See the [evaluation scope](../../evaluation/README.md).
