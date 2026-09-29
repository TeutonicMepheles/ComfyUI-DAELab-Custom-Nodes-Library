import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const scanner = fileURLToPath(new URL("./audit_frontend_layout.mjs", import.meta.url));

async function fixture(t, files, name = "checkout") {
  const temporary = await mkdtemp(path.join(tmpdir(), "comfy-skill-scan-"));
  t.after(async () => {
    // Cleanup is restricted to this test's newly created temporary directory.
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith("comfy-skill-scan-"));
    await rm(temporary, { recursive: true, force: true });
  });
  const root = path.join(temporary, name);
  await mkdir(root);
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

function scan(root, ...options) {
  return JSON.parse(execFileSync(process.execPath, [scanner, root, "--json", ...options], { encoding: "utf8" }));
}

const canvasFiles = {
  "package.json": '{"name":"daelab-creative-canvas"}',
  "web/creative_panel_state.mjs": "export function bindPanelAvailability() {}",
};
const businessFiles = {
  "nodes/example.py": 'NODE_CLASS_MAPPINGS = {\n    "DAELAB.Example": Example,\n}\n',
  "web/app_mode_bypass.js": 'import { DAELAB_NODE_TYPES } from "./app_mode_bypass_model.mjs";\n// restore original state\n',
  "web/app_mode_bypass_model.mjs": 'export const DAELAB_NODE_TYPES = ["DAELAB.Example"];',
  "tests/app_mode_bypass_model.test.mjs": 'assert.deepEqual(DAELAB_NODE_TYPES, ["DAELAB.Example"]);\nisNodeAvailableInAppMode({mode: 0});\nisNodeAvailableInAppMode({mode: 2});\nisNodeAvailableInAppMode({mode: 4});\n// restores original state\n',
};

test("renamed canvas is recognized without requiring business App Mode files", async (t) => {
  const result = scan(await fixture(t, canvasFiles));
  assert.equal(result.appMode.contract, "canvas");
  assert.equal(result.appMode.structuralPass, true);
  assert.equal(result.appMode.runtimeVerificationRequired, true);
  assert.equal(result.findings.some((item) => item.rule.startsWith("missing-app-mode")), false);
  assert.ok(result.findings.some((item) => item.rule === "canvas-mode-runtime-review"));
});

test("canvas with a missing owned helper fails its own structural check", async (t) => {
  const root = await fixture(t, { "package.json": canvasFiles["package.json"] });
  const result = scan(root);
  assert.equal(result.appMode.contract, "canvas");
  assert.equal(result.appMode.structuralPass, false);
  assert.ok(result.findings.some((item) => item.rule === "missing-canvas-panel-state"));
});

test("a DAELab-like name alone does not impose a business contract", async (t) => {
  const result = scan(await fixture(t, { "web/widget.js": "node.size = [200, 80];" }, "DAELab-experiment"));
  assert.equal(result.appMode.contract, "generic");
  assert.equal(result.appMode.applicable, false);
  assert.ok(result.findings.some((item) => item.rule === "direct-size-write"));
});

test("known business repository still fails when all App Mode files are absent", async (t) => {
  const result = scan(await fixture(t, {}, "ComfyUI-DAELab-Custom-Nodes-Library"));
  assert.equal(result.appMode.contract, "business");
  assert.equal(result.appMode.structuralPass, false);
  assert.equal(result.findings.filter((item) => item.rule.startsWith("missing-app-mode")).length, 3);
});

test("business coverage passes when aligned and detects a new uncovered export", async (t) => {
  const root = await fixture(t, businessFiles);
  assert.equal(scan(root).appMode.structuralPass, true);
  await writeFile(path.join(root, "nodes/added.py"), 'NODE_CLASS_MAPPINGS = {\n    "DAELAB.Added": Added,\n}\n');
  const result = scan(root);
  assert.equal(result.appMode.structuralPass, false);
  assert.ok(result.findings.some((item) => item.rule === "exported-node-missing-from-app-mode"));
});

test("explicit profiles resolve ambiguous checkouts and reject unknown values", async (t) => {
  const root = await fixture(t, {});
  assert.equal(scan(root, "--profile", "business").appMode.structuralPass, false);
  assert.equal(scan(root, "--profile=canvas").appMode.contract, "canvas");
  assert.equal(scan(root, "--profile", "generic").appMode.applicable, false);
  const invalid = spawnSync(process.execPath, [scanner, root, "--profile", "typo"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Profile must be/);
});

test("business ownership rules identify a renamed checkout with missing implementation", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "DAELab business nodes reuse web/app_mode_bypass.js." });
  assert.equal(scan(root).appMode.contract, "business");
  assert.equal(scan(root).appMode.structuralPass, false);
});

test("dynamic registrations are uncertain rather than falsely stale or passed", async (t) => {
  const root = await fixture(t, {
    ...businessFiles,
    "nodes/example.py": 'NODE_ID = "DAELAB.Example"\nNODE_CLASS_MAPPINGS = {NODE_ID: Example}\nNODE_CLASS_MAPPINGS["DAELAB.Other"] = Other\n',
    "web/app_mode_bypass_model.mjs": 'export const DAELAB_NODE_TYPES = ["DAELAB.Example", "DAELAB.Other"];',
    "tests/app_mode_bypass_model.test.mjs": businessFiles["tests/app_mode_bypass_model.test.mjs"].replace('["DAELAB.Example"]', '["DAELAB.Example", "DAELAB.Other"]'),
  });
  const result = scan(root);
  assert.equal(result.appMode.inventoryComplete, false);
  assert.equal(result.appMode.structuralPass, null);
  assert.ok(result.appMode.exported.includes("DAELAB.Other"));
  assert.ok(result.findings.some((item) => item.rule === "backend-inventory-incomplete"));
  assert.equal(result.findings.some((item) => item.rule === "stale-app-mode-node-type"), false);
  await writeFile(path.join(root, "nodes/example.py"), 'NODE_CLASS_MAPPINGS = {NODE_ID: Example}\n');
  assert.equal(scan(root).appMode.structuralPass, null);
});
