# Fork notes: hhamud/pi

This is a personal fork of [earendil-works/pi](https://github.com/earendil-works/pi).
It exists for **one purpose**: keep the OpenCode model catalog inside
`@hhamud/pi-ai` up to date automatically, without waiting for
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
2. **Auto-publish** a new `@hhamud/pi-ai` to npm when the catalog
   changes.

## What changed vs upstream

| Change | Purpose |
|---|---|
| Mass rename `@earendil-works/pi-ai` → `@hhamud/pi-ai` across the monorepo (283 source files, 4 lockfiles, 1 shrinkwrap) | So the package can be published to npm without colliding with the upstream `@earendil-works/pi-ai`. |
| `packages/ai/scripts/snapshot-opencode.mjs` | Reads the gitignored `src/providers/data/opencode{,-go}.json` after `generate-models` runs, writes a tracked `opencode-snapshot.json` so diffs are visible in commits. |
| `packages/ai/src/providers/opencode-snapshot.json` | The tracked snapshot. Tracked (despite the data dir being gitignored) so changes show up in commits. |
| `.github/workflows/refresh-opencode.yml` | Daily cron. Runs `npm --prefix packages/ai run generate-models`, snapshots the result, opens a PR via `peter-evans/create-pull-request` if anything changed. |
| `.github/workflows/publish-pi-ai.yml` | On merge of the refresh PR (push to `main`), bumps patch version, rebuilds, and runs `npm publish --provenance --access public`. |
| `packages/ai/tsconfig.build.json` | Now extends the root `tsconfig.json` (which has the workspace `paths` map) instead of only `tsconfig.base.json`. This is required so `tsgo` can resolve workspace deps (`@earendil-works/pi-telemetry`, etc.) when the build is invoked from `packages/ai`. |
| `repository.url` in every `package.json` | Points to `github.com/hhamud/pi` instead of `github.com/earendil-works/pi`. |
| `packages/ai/package.json` adds `publishConfig: { access: public, provenance: true }` | Enables npm provenance attestation. |

## Workflow behavior

### `Refresh OpenCode Model Catalog`

- **Trigger**: `schedule: 0 6 * * *` (06:00 UTC daily) + `workflow_dispatch`.
- **Steps**: checkout → `npm ci` → `npm --prefix packages/ai run generate-models` →
  `node packages/ai/scripts/snapshot-opencode.mjs` → detect diff → open a
  PR via `peter-evans/create-pull-request@v8` (if changed) →
  no-op (otherwise).
- **Merging** the PR triggers `Publish @hhamud/pi-ai`.

### `Publish @hhamud/pi-ai to npm`

- **Trigger**: `push` to `main` matching `packages/ai/**`,
  `packages/ai/src/providers/opencode-snapshot.json`, or this workflow
  file. Also `workflow_dispatch`.
- **Steps**: checkout → `npm ci` → bump patch version (e.g. 0.84.4 →
  0.84.5) → commit + push the version bump → `npm --prefix packages/ai
  run build` (regenerates from models.dev, bakes data into `dist/`) →
  `npm publish --provenance --access public` with `NODE_AUTH_TOKEN`
  pulled from the `NPM_PUBLISH_TOKEN` repo secret.

## Required secrets

| Secret | What | Why |
|---|---|---|
| `NPM_PUBLISH_TOKEN` | An npm automation token with publish scope on the `@hhamud` org, OR a fine-grained PAT with `packages:write` on `@hhamud` | Used by `publish-pi-ai.yml` to run `npm publish`. |

## Important caveat: the CLI bundle

`@earendil-works/pi-coding-agent`'s **bundle** hardcodes the
opencode catalog directly into
`dist/bundle/chunks/chunk-OMWWHBTG.js`. So even after
`bun add -g @hhamud/pi-ai`, the global `pi` CLI will continue to show
the upstream-bundled catalog unless the CLI bundle itself is
rebuilt against the new pi-ai dist.

The fork does **not** rebuild the bundle as part of the automated
pipeline. To actually surface new models in the `pi` CLI picker, you
have two options:

1. **Reinstall `@earendil-works/pi-coding-agent` from upstream** after
   upstream picks up the new models — but this defeats the purpose of
   the fork.
2. **Rebuild the CLI bundle locally** from this fork and reinstall:
   ```sh
   git clone https://github.com/hhamud/pi
   cd pi
   bun install
   npm --prefix packages/ai run build
   npm --prefix packages/coding-agent run build
   # Then install the locally-built bundle, e.g.
   npm install -g ./packages/coding-agent
   ```

The first option is what the spec asks for; the second is the only
real way to get new models into the local `pi` picker today.

## Install

After the first `@hhamud/pi-ai` release lands on npm:

```sh
bun add -g @hhamud/pi-ai
```

This installs the auto-updated package globally, replacing whatever
bundled version of `@hhamud/pi-ai` (or `@earendil-works/pi-ai`) was
previously installed.

To pick up a new release:

```sh
bun update -g @hhamud/pi-ai
```

### Verifying the install

After install, run `pi` and open the model picker. New models added
by the fork (e.g. `claude-fable-5-1`) should appear alongside the
upstream catalog. To prove the fork is fresh, compare against the
fork's snapshot:

```sh
cat $(npm root -g)/@hhamud/pi-ai/dist/providers/data/opencode.json | jq 'keys'
# vs
curl -s https://raw.githubusercontent.com/hhamud/pi/main/packages/ai/src/providers/opencode-snapshot.json | jq '.opencode | keys'
```

The global `pi-ai` should be a strict superset of (or equal to) the
fork snapshot.

## Caveats

- This fork is **not** intended to track upstream closely. The
  package.json `version` field bumps locally on every publish run,
  independent of upstream. Re-syncing from upstream after a rename
  is a manual `git merge earendil-works/pi/main` operation.
- The refresh cron runs against `models.dev/api.json`, which is a
  third-party service. If `models.dev` is down, the workflow fails
  silently (no diff, no PR). Run it manually with
  `gh workflow run refresh-opencode.yml --repo hhamud/pi` when
  models.dev is back.
- The mass-rename will conflict with any future upstream merge. You
  will need to either re-do the rename on each sync, or use a
  codemod tool to keep both name conventions in sync.