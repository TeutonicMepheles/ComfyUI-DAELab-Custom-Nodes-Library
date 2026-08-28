#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".pytest_cache",
  "__pycache__",
  "node_modules",
]);
const FRONTEND_EXTENSIONS = new Set([".js", ".mjs", ".ts"]);
const PYTHON_EXTENSIONS = new Set([".py"]);

const RULES = [
  {
    id: "current-height-input",
    severity: "HIGH",
    pattern: /\b(?:node|this)\.size\?*\.\[1\]|\b(?:node|this)\.size\[1\]/,
    message: "Current node height is read; check for a restored-height feedback loop.",
  },
  {
    id: "monotonic-height-growth",
    severity: "HIGH",
    pattern: /Math\.max\([^\n;]{0,240}(?:node|this)\.size\?*\.\[1\]/,
    message: "Initialization may preserve every oversized height instead of measuring minimum content.",
  },
  {
    id: "direct-size-write",
    severity: "REVIEW",
    pattern: /\b(?:node|this)\.size\s*=\s*\[/,
    message: "Direct size assignment should be lifecycle-safe and must not reuse stretched DOM measurements.",
  },
  {
    id: "dom-widget",
    severity: "INFO",
    pattern: /\baddDOMWidget\s*\(/,
    message: "DOM widget requires refresh/reopen, sizing, App Mode, and serialization checks.",
  },
  {
    id: "layout-size",
    severity: "INFO",
    pattern: /\bcomputeLayoutSize\s*=/,
    message: "Verify fixed rows provide maxHeight and flexible rows expand intentionally.",
  },
  {
    id: "compute-size",
    severity: "INFO",
    pattern: /\bcomputeSize\s*(?:=|\?*\.)/,
    message: "Verify computeSize returns content requirements independent of restored surplus height.",
  },
  {
    id: "resize-hook",
    severity: "REVIEW",
    pattern: /\bonResize\b/,
    message: "Distinguish user resize from programmatic auto-fit with a guard when persisting dimensions.",
  },
  {
    id: "deferred-layout",
    severity: "REVIEW",
    pattern: /\b(?:requestAnimationFrame|setTimeout)\s*\(/,
    message: "Deferred installation or sizing must coalesce and remain idempotent across lifecycle hooks.",
  },
  {
    id: "unversioned-local-model-import",
    severity: "REVIEW",
    pattern: /from\s+["']\.\/.+\.(?:mjs|js)["']\s*;/,
    message: "If this imported frontend module changed, consider a versioned URL for refresh-safe loading.",
  },
  {
    id: "thumbnail-grid",
    severity: "INFO",
    pattern: /grid-template-columns\s*:\s*repeat\(/,
    message: "Check supported widths, row count, maximum card size, and JS/CSS height agreement.",
  },
  {
    id: "aspect-ratio",
    severity: "INFO",
    pattern: /aspect-ratio\s*:/,
    message: "Measure the rendered card ratio and include label/padding behavior in visual QA.",
  },
];

function usage() {
  return [
    "Usage: node audit_frontend_layout.mjs [path] [--json]",
    "",
    "Read-only scan for ComfyUI frontend sizing, lifecycle, and DAELab App Mode review points.",
    "Defaults to the current directory and scans web/ when that folder exists.",
  ].join("\n");
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readIfPresent(target) {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

async function walkFiles(root, extensions) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

async function collectFiles(target) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) {
    return FRONTEND_EXTENSIONS.has(path.extname(target).toLowerCase()) ? [target] : [];
  }

  const webDirectory = path.join(target, "web");
  const root = await exists(webDirectory) ? webDirectory : target;
  return walkFiles(root, FRONTEND_EXTENSIONS);
}

function scanSource(file, source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        file,
        line: index + 1,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        excerpt: line.trim().slice(0, 220),
      });
    }
  }

  if (source.includes("addDOMWidget(")) {
    const coverage = {
      computeSize: /\bcomputeSize\s*=/.test(source),
      computeLayoutSize: /\bcomputeLayoutSize\s*=/.test(source),
      getHeight: /\bgetHeight\s*:/.test(source),
      getMinHeight: /\bgetMinHeight\s*:/.test(source),
      maxHeight: /\bmaxHeight\s*:/.test(source),
    };
    const missing = Object.entries(coverage)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    if (missing.length) {
      findings.push({
        file,
        line: 1,
        rule: "dom-widget-sizing-coverage",
        severity: "REVIEW",
        message: `DOM widget file lacks explicit ${missing.join(", ")}; confirm inherited behavior is intentional.`,
        excerpt: "",
      });
    }
  }
  return findings;
}

function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function findDelimitedBlock(source, start, openCharacter, closeCharacter) {
  const open = source.indexOf(openCharacter, start);
  if (open < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    else if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return { open, close: index, text: source.slice(open + 1, index) };
    }
  }
  return null;
}

function quotedValues(source) {
  const values = [];
  const pattern = /(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g;
  for (const match of source.matchAll(pattern)) values.push(match[2]);
  return values;
}

function extractDaelabNodeTypes(source) {
  const match = /\bDAELAB_NODE_TYPES\s*=/.exec(source);
  if (!match) return { values: [], line: 1 };
  const block = findDelimitedBlock(source, match.index + match[0].length, "[", "]");
  return {
    values: block ? quotedValues(block.text) : [],
    line: lineNumber(source, match.index),
  };
}

function extractCoverageAssertion(source) {
  const match = /assert\.deepEqual\s*\(\s*DAELAB_NODE_TYPES\s*,/.exec(source);
  if (!match) return { values: [], line: 1 };
  const block = findDelimitedBlock(source, match.index + match[0].length, "[", "]");
  return {
    values: block ? quotedValues(block.text) : [],
    line: lineNumber(source, match.index),
  };
}

function extractPythonNodeMappings(source) {
  const entries = [];
  const marker = /\bNODE_CLASS_MAPPINGS\s*=\s*\{/g;
  for (const match of source.matchAll(marker)) {
    const block = findDelimitedBlock(source, match.index + match[0].length - 1, "{", "}");
    if (!block) continue;
    const keyPattern = /^\s*["']([^"']+)["']\s*:/gm;
    for (const keyMatch of block.text.matchAll(keyPattern)) entries.push(keyMatch[1]);
  }
  return entries;
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function makeFinding(file, line, rule, severity, message, excerpt = "") {
  return { file, line, rule, severity, message, excerpt };
}

async function collectExportedNodeTypes(repository) {
  const nodesDirectory = path.join(repository, "nodes");
  if (!await exists(nodesDirectory)) return [];
  const files = await walkFiles(nodesDirectory, PYTHON_EXTENSIONS);
  const types = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const type of extractPythonNodeMappings(source)) {
      if (!types.includes(type)) types.push(type);
    }
  }
  return types;
}

async function auditDaelabAppMode(target) {
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) return { applicable: false, findings: [] };

  const runtimePath = path.join(target, "web", "app_mode_bypass.js");
  const modelPath = path.join(target, "web", "app_mode_bypass_model.mjs");
  const testPath = path.join(target, "tests", "app_mode_bypass_model.test.mjs");
  const agentsPath = path.join(target, "AGENTS.md");
  const [runtimeSource, modelSource, testSource, agentsSource] = await Promise.all([
    readIfPresent(runtimePath),
    readIfPresent(modelPath),
    readIfPresent(testPath),
    readIfPresent(agentsPath),
  ]);
  const applicable = /daelab/i.test(path.basename(target))
    || Boolean(runtimeSource || modelSource || testSource)
    || /DAELab[\s\S]{0,500}App mode Bypass behavior/i.test(agentsSource || "");
  if (!applicable) return { applicable: false, findings: [] };

  const findings = [];
  for (const [file, source, rule, label] of [
    [runtimePath, runtimeSource, "missing-app-mode-runtime", "web/app_mode_bypass.js"],
    [modelPath, modelSource, "missing-app-mode-model", "web/app_mode_bypass_model.mjs"],
    [testPath, testSource, "missing-app-mode-test", "tests/app_mode_bypass_model.test.mjs"],
  ]) {
    if (source === null) {
      findings.push(makeFinding(file, 1, rule, "HIGH", `${label} is required for the shared DAELab App Mode Bypass contract.`));
    }
  }

  const exported = await collectExportedNodeTypes(target);
  const registeredResult = modelSource ? extractDaelabNodeTypes(modelSource) : { values: [], line: 1 };
  const assertedResult = testSource ? extractCoverageAssertion(testSource) : { values: [], line: 1 };
  const registered = [...new Set(registeredResult.values)];
  const asserted = [...new Set(assertedResult.values)];

  if (!exported.length) {
    findings.push(makeFinding(path.join(target, "nodes"), 1, "backend-node-map-unreadable", "HIGH", "No backend NODE_CLASS_MAPPINGS keys were found; App Mode coverage cannot be proven."));
  }
  if (modelSource && !registered.length) {
    findings.push(makeFinding(modelPath, registeredResult.line, "missing-daelab-node-types", "HIGH", "DAELAB_NODE_TYPES is missing or empty."));
  }
  if (testSource && !asserted.length) {
    findings.push(makeFinding(testPath, assertedResult.line, "missing-app-mode-coverage-assertion", "HIGH", "The test must assert the exact DAELAB_NODE_TYPES list."));
  }

  const missingFromRegistry = exported.filter((type) => !registered.includes(type));
  const staleRegistryEntries = registered.filter((type) => !exported.includes(type));
  if (missingFromRegistry.length) {
    findings.push(makeFinding(modelPath, registeredResult.line, "exported-node-missing-from-app-mode", "HIGH", `Exported node types missing from DAELAB_NODE_TYPES: ${missingFromRegistry.join(", ")}.`));
  }
  if (staleRegistryEntries.length) {
    findings.push(makeFinding(modelPath, registeredResult.line, "stale-app-mode-node-type", "HIGH", `DAELAB_NODE_TYPES entries not found in backend mappings: ${staleRegistryEntries.join(", ")}.`));
  }
  if (registered.length && asserted.length && !sameMembers(registered, asserted)) {
    const missingFromAssertion = registered.filter((type) => !asserted.includes(type));
    const staleAssertionEntries = asserted.filter((type) => !registered.includes(type));
    findings.push(makeFinding(
      testPath,
      assertedResult.line,
      "app-mode-coverage-assertion-out-of-sync",
      "HIGH",
      `Coverage assertion differs from DAELAB_NODE_TYPES; missing: ${missingFromAssertion.join(", ") || "none"}; extra: ${staleAssertionEntries.join(", ") || "none"}.`,
    ));
  }

  if (runtimeSource && !/from\s+["']\.\/app_mode_bypass_model\.mjs(?:\?[^"']*)?["']/.test(runtimeSource)) {
    findings.push(makeFinding(runtimePath, 1, "shared-app-mode-model-not-reused", "HIGH", "The App Mode runtime must import and reuse web/app_mode_bypass_model.mjs."));
  }
  if (runtimeSource && !(/\boriginal\b/i.test(runtimeSource) && /\brestore/i.test(runtimeSource))) {
    findings.push(makeFinding(runtimePath, 1, "active-state-restoration-not-evident", "HIGH", "Shared App Mode runtime must preserve original UI state and restore it when the node returns to Active."));
  }

  if (testSource) {
    const requiredModes = [0, 2, 4].filter((mode) => !new RegExp(`mode\\s*:\\s*${mode}\\b`).test(testSource));
    if (!testSource.includes("isNodeAvailableInAppMode") || requiredModes.length) {
      findings.push(makeFinding(testPath, 1, "app-mode-state-matrix-incomplete", "HIGH", `App Mode tests must cover Active (0), Muted (2), and Bypassed (4); missing: ${requiredModes.join(", ") || "classification assertion"}.`));
    }
    if (!/restore(?:s|d|ing)?\b.{0,100}\boriginal|\boriginal\b.{0,100}\brestore/is.test(testSource)) {
      findings.push(makeFinding(testPath, 1, "active-restoration-test", "REVIEW", "No obvious regression assertion restores original UI state after returning to Active; verify this in a DOM or App Mode integration test."));
    }
  }

  return {
    applicable: true,
    exported,
    registered,
    asserted,
    structuralPass: !findings.some((finding) => finding.severity === "HIGH"),
    runtimeVerificationRequired: true,
    findings,
  };
}

function renderText(target, files, findings, appMode) {
  const counts = findings.reduce((result, finding) => {
    result[finding.severity] = (result[finding.severity] || 0) + 1;
    return result;
  }, {});
  console.log("DAE Custom Node Frontend Layout Audit");
  console.log(`Target: ${target}`);
  console.log(`Frontend files: ${files.length}`);
  console.log(`Findings: HIGH ${counts.HIGH || 0}, REVIEW ${counts.REVIEW || 0}, INFO ${counts.INFO || 0}`);
  if (appMode.applicable) {
    console.log(`App Mode structural gate: ${appMode.structuralPass ? "PASS" : "FAIL"} (backend ${appMode.exported.length}, registry ${appMode.registered.length}, test ${appMode.asserted.length})`);
    console.log("App Mode runtime gate: manual final-page Active/Muted/Bypassed restoration check required");
  }
  console.log("");

  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }
  for (const [file, fileFindings] of byFile) {
    console.log(path.relative(target, file) || path.basename(file));
    for (const finding of fileFindings) {
      console.log(`  [${finding.severity}] L${finding.line} ${finding.rule}: ${finding.message}`);
      if (finding.excerpt) console.log(`    ${finding.excerpt}`);
    }
    console.log("");
  }

  if (!findings.length) console.log("No matching review patterns found.");
  console.log("Findings are review leads; verify behavior in a loaded workflow before editing.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  const json = args.includes("--json");
  const positional = args.filter((value) => !value.startsWith("--"));
  const target = path.resolve(positional[0] || process.cwd());
  const files = await collectFiles(target);
  const findings = [];
  for (const file of files) {
    findings.push(...scanSource(file, await readFile(file, "utf8")));
  }
  const appMode = await auditDaelabAppMode(target);
  findings.push(...appMode.findings);
  if (json) {
    console.log(JSON.stringify({
      target,
      files: files.length,
      appMode: {
        applicable: appMode.applicable,
        structuralPass: appMode.structuralPass ?? null,
        runtimeVerificationRequired: appMode.runtimeVerificationRequired ?? false,
        exported: appMode.exported ?? [],
        registered: appMode.registered ?? [],
        asserted: appMode.asserted ?? [],
      },
      findings,
    }, null, 2));
  } else {
    renderText(target, files, findings, appMode);
  }
}

main().catch((error) => {
  console.error(`audit_frontend_layout: ${error.message}`);
  process.exitCode = 1;
});
