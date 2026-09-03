#!/usr/bin/env node
// scripts/snapshot-opencode.mjs
//
// Reads the freshly generated (gitignored) JSON model catalogs for
// `opencode` and `opencode-go` and writes a TRACKED, diff-friendly
// snapshot to packages/ai/src/providers/opencode-snapshot.json.
//
// The data dir under src/providers/data/ is .gitignored, so we need
// a tracked artifact to detect catalog changes in CI. This snapshot
// is that artifact.
//
// Usage:
//   node scripts/snapshot-opencode.mjs
//   node scripts/snapshot-opencode.mjs --output path/to/snapshot.json
//
// Exit codes:
//   0  success (snapshot written)
//   1  data dir missing or unparsable (snapshot unchanged)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/ lives at packages/ai/scripts/, data dir is packages/ai/src/providers/data/
const packageRoot = resolve(__dirname, "..");

function parseArgs(argv) {
	const srcData = join(packageRoot, "src", "providers", "data");
	const distData = join(packageRoot, "dist", "providers", "data");
	// Prefer the source data dir (regenerated each CI run). Fall back to the
	// built dist dir (what the published package ships) so the script is
	// usable in ad-hoc local checks.
	const args = {
		dataDir: existsSync(join(srcData, "opencode.json")) ? srcData : distData,
		output: join(packageRoot, "src", "providers", "opencode-snapshot.json"),
	};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--output" || arg === "-o") {
			args.output = resolve(argv[++i]);
		} else if (arg === "--data-dir" || arg === "-d") {
			args.dataDir = resolve(argv[++i]);
		} else if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: node scripts/snapshot-opencode.mjs " +
					"[--data-dir path/to/data] [--output path/to/snapshot.json]\n" +
					"\n" +
					"Reads opencode.json and opencode-go.json from --data-dir\n" +
					"(default: src/providers/data, fallback dist/providers/data)\n" +
					"and writes a tracked, diff-friendly snapshot.\n",
			);
			process.exit(0);
		} else {
			console.error(`Unknown argument: ${arg}`);
			process.exit(2);
		}
	}
	return args;
}

/**
 * Flatten the by-API grouping produced by generate-models.ts into
 * a { modelId: model } map, filtered by `provider === providerId`.
 */
function flattenProvider(jsonBlob, providerId) {
	const out = {};
	for (const apiGroup of Object.values(jsonBlob)) {
		for (const [modelId, model] of Object.entries(apiGroup)) {
			if (model.provider === providerId) {
				out[modelId] = model;
			}
		}
	}
	return out;
}

/**
 * Reduce a model to the fields that matter for catalog tracking.
 * Drop `provider` (constant), keep enough to detect meaningful changes.
 */
function projectModel(model) {
	const projected = {
		name: model.name,
		api: model.api,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning === true,
		input: model.input,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		cost: model.cost,
	};
	if (model.compat !== undefined) projected.compat = model.compat;
	if (model.thinkingLevelMap !== undefined) projected.thinkingLevelMap = model.thinkingLevelMap;
	return projected;
}

/**
 * Sort object keys recursively so that two semantically identical
 * snapshots produce byte-identical JSON. Without this, regenerating
 * the same data yields noisy diffs.
 */
function sortKeysDeep(value) {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value && typeof value === "object") {
		const sorted = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortKeysDeep(value[key]);
		}
		return sorted;
	}
	return value;
}

function loadProviderData(dataDirArg, providerId) {
	const file = join(dataDirArg, `${providerId}.json`);
	if (!existsSync(file)) {
		throw new Error(
			`Missing ${file}. Run 'bun run generate-models' (or 'npm run generate-models') first, ` +
				`or pass --data-dir pointing at a directory that contains ${providerId}.json.`,
		);
	}
	return JSON.parse(readFileSync(file, "utf8"));
}

function main() {
	const { dataDir: dataDirArg, output } = parseArgs(process.argv);
	const opencodeRaw = loadProviderData(dataDirArg, "opencode");
	const opencodeGoRaw = loadProviderData(dataDirArg, "opencode-go");

	const opencodeModels = flattenProvider(opencodeRaw, "opencode");
	const opencodeGoModels = flattenProvider(opencodeGoRaw, "opencode-go");

	const snapshot = sortKeysDeep({
		generatedAt: new Date().toISOString(),
		opencode: Object.fromEntries(
			Object.entries(opencodeModels)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([id, m]) => [id, projectModel(m)]),
		),
		opencodeGo: Object.fromEntries(
			Object.entries(opencodeGoModels)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([id, m]) => [id, projectModel(m)]),
		),
	});

	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, JSON.stringify(snapshot, null, "\t") + "\n");

	const ocCount = Object.keys(snapshot.opencode).length;
	const ogCount = Object.keys(snapshot.opencodeGo).length;
	console.log(
		`Wrote snapshot to ${output} ` +
			`(opencode: ${ocCount} models, opencode-go: ${ogCount} models, ` +
			`generatedAt: ${snapshot.generatedAt})`,
	);
}

try {
	main();
} catch (err) {
	console.error("snapshot-opencode failed:", err.message);
	process.exit(1);
}
