# Publishing an alpha

The repository and npm scope must belong to the publisher. The default `@cce` scope is provisional and unconfirmed. No automated command in this checkout publishes by default.

The owner selected `Sanmen87/cce-verified-continuity`; an empty private preparation repository was created on 2026-11-19 (Europe/Moscow). Repository creation is separate from source upload, public visibility, GitHub Release and npm publication. A repository name is scoped to its GitHub owner; existing repositories named CCE elsewhere do not reserve this owner's path. This is not trademark clearance.

An npm scope comes with a user account or organization. An organization is optional: register/sign in at [npm signup](https://www.npmjs.com/signup), enable the required account security, and use the owned lowercase username scope (for example `@sanmen87` only if registration grants it). GitHub login does not create an npm account. `npm whoami` confirms the active npm username; never paste credentials/tokens into issue logs or commit `.npmrc`. A package returning registry 404 does not prove that its scope can be registered. See [npm scopes](https://docs.npmjs.com/about-scopes/).

Name check on 2026-11-19: the unscoped package `cce` exists; `code-context-engine`, `@cce/core` and `@sanmen87/core` returned registry 404. Names remain unreserved; no npm scope ownership is claimed. README examples continue to use provisional `@cce` until the actual owner scope is chosen.

1. Review the generated public source tree listed in `release-artifacts/public-source.json`. It is an explicit allowlist and has no copied Git history. Preserve research artifacts separately; do not push the research working directory.
2. Set the owned scope and real credential-free HTTPS GitHub URL in `release/config.json`, then mark its identity status `CONFIRMED` after ownership review. Set `CCE_RELEASE_SCOPE` and `CCE_RELEASE_REPOSITORY` to these same values; the gate rejects environment/config mismatches. Rebuild archives and source export.
3. Run `typecheck`, public unit/integration tests, build, no-LLM Pi smoke, release scanner, `npm pack --dry-run`/pack and clean consumer install. Inspect `exports`, types, files, grammar licenses and dependency audit.
4. Commit the reviewed source export to the intended repository. Run Windows/Linux CI. Actual hosted CI must be green; local Docker execution does not prove Windows/Linux GitHub runners passed.
5. Tag `v0.1.0-alpha.1`. Set up npm Trusted Publishing for the exact owner/repository/workflow/environment and explicitly allow direct `npm publish` for this workflow (stage-only trust is insufficient). Protect the `npm-alpha` environment with a reviewer. Bootstrap new package identity through npm's supported flow if required; do not add a long-lived token to this repo.
6. Trigger `release.yml` explicitly, selecting publish and the tag. It checks the tag/version, exact reviewed source contents and archive hashes bound to the clean-install report before npm/GitHub writes. Alpha goes to the `alpha` dist-tag, never `latest`.
7. Ask an external user to install the archives/package and record platform/version issues before promoting to 0.1.0.

OIDC needs a supported npm version and `id-token: write`; npm generates provenance for supported trusted publishing. Match the package repository to the workflow repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/). Creating repository settings, npm trust and the public release requires explicit owner action after review.

Root/workspace manifests are private development packages with TS source entries. Public tarballs are generated from built output with compiled ESM exports and declarations. Host-provided Pi packages keep `*` peer ranges; docs name the actually tested security-patched host. Third-party source notices remain under their own licenses.

## Evaluation publication

The public source allowlist includes `evaluation/`: derived reports/protocols, explicitly projected JSON, authored MCP fixture/scorer, minimal captured source bodies, extracted usage receipts, provenance and a SHA inventory. Run `npm run test:evaluation` before export and in CI. Keep full `.bench`, raw sessions/SSE, private snapshots and hidden acceptance code outside the export. The source audit scans every included evaluation file; this is an allowlisted addition, not a general exception for benchmark directories. npm tarballs continue to exclude evaluation data.

The offline verifier recomputes historical MCP scoring and published counter arithmetic. It does not rerun the independent native CRM oracle or prove model interpretation. Preserve original FAIL/NOT_EVALUATED/UNKNOWN values and separate post-hoc retries. New live reproductions require their own frozen inputs and blind evaluation. See the [evaluation scope](../../evaluation/README.md).
