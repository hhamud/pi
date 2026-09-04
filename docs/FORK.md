# Fork notes: hhamud/pi

This is a personal fork of [earendil-works/pi](https://github.com/earendil-works/pi).
It exists for **one purpose**: keep the OpenCode model catalog inside
`@earendil-works/pi-ai` up to date automatically, without waiting for
upstream releases.

Upstream `@earendil-works/pi-ai` ships with a **vendored** model
catalog (see `packages/ai/src/providers/data/opencode.json` after
build). The catalog is regenerated from [models.dev](https://models.dev)
only when upstream re-runs its `generate-models` script and publishes
a new npm version — which means new OpenCode models appear in pi only
after a delay.

This fork closes that gap.

## What the fork does

1. **Daily refresh** (06:00 UTC) of the opencode + opencode-go catalogs
   from `https://models.dev/api.json`.
2. **GitHub Release** with a tarball of the rebuilt `pi-ai` package, so
   new models become installable immediately.

## What changed vs upstream

| Change | Purpose |
|---|---|
| `packages/ai/scripts/snapshot-opencode.mjs` | Reads the gitignored `src/providers/data/opencode{,-go}.json` after `generate-models` runs, writes a tracked `opencode-snapshot.json` so diffs are visible in commits. |
| `packages/ai/src/providers/opencode-snapshot.json` | The tracked snapshot. Tracked (despite the data dir being gitignored) so changes show up in commits. |
| `.github/workflows/refresh-opencode.yml` | Daily cron. Runs `npm --prefix packages/ai run generate-models`, snapshots the result, commits the snapshot to `main` if it changed. |
| `.github/workflows/publish-pi-ai.yml` | Push trigger on `packages/ai/**` and `opencode-snapshot.json`. Bumps patch version, builds, packs a tarball, uploads it as a workflow artifact, and creates a GitHub Release. |
| `packages/ai/tsconfig.build.json` | Now extends the root `tsconfig.json` (which has the workspace `paths` map) instead of only `tsconfig.base.json`. This is required so `tsgo` can resolve workspace deps (`@earendil-works/pi-telemetry`, etc.) when the build is invoked from `packages/ai`. |

## Workflow behavior

### `Refresh OpenCode Model Catalog`

- **Trigger**: `schedule: 0 6 * * *` (06:00 UTC daily) + `workflow_dispatch`.
- **Steps**: checkout → `npm ci` → `npm --prefix packages/ai run generate-models` →
  `node packages/ai/scripts/snapshot-opencode.mjs` → detect diff → commit
  to `main` (if changed).
- **Push to main** from this workflow then triggers `Publish @earendil-works/pi-ai`.

The refresh workflow **commits directly to `main`** rather than opening
a PR. GitHub disables PR creation from the workflow's `GITHUB_TOKEN` on
personal repos by default, and the controlling toggle
("Allow GitHub Actions to create and approve pull requests") lives in
the repo's Settings → Actions → General UI only — it has no public
REST or GraphQL API. To restore a PR-based flow, enable that toggle
and replace the `Commit and push` step with `peter-evans/create-pull-request@v8`.

### `Publish @earendil-works/pi-ai (fork build)`

- **Trigger**: `push` to `main` matching `packages/ai/**`,
  `packages/ai/src/providers/opencode-snapshot.json`, or this workflow
  file. Also `workflow_dispatch`.
- **Steps**: checkout → `npm ci` → bump patch version (e.g. 0.84.4 →
  0.84.5) → commit + push the version bump → `npm --prefix packages/ai
  run build` (regenerates from models.dev, bakes data into `dist/`) →
  `npm pack` → upload tarball as workflow artifact → create GitHub
  Release with the tarball.

The release workflow **uploads to GitHub Releases, not npm**. Reason:
the fork keeps the package name `@earendil-works/pi-ai` to avoid
invasive renames across the 270+ files in the monorepo that import it.
Publishing that name to npm would collide with the upstream package,
which the user does not own. A release tarball is the next-best
auto-distribution channel: fully automated, stable URLs, no name
collisions.

To switch to npm publish instead, mass-rename the package and all
internal imports to `@hhamud/pi-ai`, add an `NPM_PUBLISH_TOKEN` repo
secret, and replace the final `Create GitHub Release` step with
`npm publish --provenance --access public`.

## Install (consume the auto-updated package)

The tarball is at
`https://github.com/hhamud/pi/releases/download/v<version>/earendil-works-pi-ai-<version>.tgz`.

Install it **globally**, replacing the bundled `@earendil-works/pi-ai`
that ships with `@earendil-works/pi-coding-agent`:

```sh
bun add -g "https://github.com/hhamud/pi/releases/download/v0.84.7/earendil-works-pi-ai-0.84.7.tgz"
```

Then point the global `pi-coding-agent` at it by reinstalling:

```sh
bun remove -g @earendil-works/pi-coding-agent
bun add -g @earendil-works/pi-coding-agent
```

To stay current, repeat the install with the latest release tag each
time a new release lands (or write a tiny local script to do it).

### Verifying the install

After installing a release, the `pi` CLI's model picker should list
any new models that models.dev has added since the bundled
`@earendil-works/pi-ai` (e.g. a model whose id is present in
`packages/ai/src/providers/opencode-snapshot.json` but absent in
`node_modules/@earendil-works/pi-ai/dist/providers/data/opencode.json`
of the previous upstream version).

## Caveats

- This fork is **not** intended to track upstream closely. The
  package.json `version` field bumps locally on every publish run,
  independent of upstream.
- The refresh cron runs against `models.dev/api.json`, which is a
  third-party service. If `models.dev` is down, the workflow fails
  silently (no diff, no commit). Run it manually with
  `gh workflow run refresh-opencode.yml --repo hhamud/pi` when
  models.dev is back.
- The release workflow uses the auto-generated `GITHUB_TOKEN` for both
  pushing the version-bump commit and creating the release. No
  secrets are required.