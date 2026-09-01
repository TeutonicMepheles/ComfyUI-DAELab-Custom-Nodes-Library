export const BADGE_RELIEF_PANEL_WIDGET_NAME = "badge_relief_prompt_panel";
export const BADGE_RELIEF_NATIVE_WIDGET_NAME = "relief_level";

export const BADGE_RELIEF_LEVELS = Object.freeze([
  Object.freeze({ value: 0, label: "平面", title: "完全平面" }),
  Object.freeze({ value: 1, label: "微", title: "微浮雕" }),
  Object.freeze({ value: 2, label: "浅", title: "浅浮雕" }),
  Object.freeze({ value: 3, label: "中", title: "中浮雕" }),
  Object.freeze({ value: 4, label: "深", title: "深浮雕" }),
  Object.freeze({ value: 5, label: "高", title: "高浮雕" }),
]);

export const BADGE_RELIEF_MEMBER_WIDGET_NAMES = Object.freeze([
  BADGE_RELIEF_PANEL_WIDGET_NAME,
  BADGE_RELIEF_NATIVE_WIDGET_NAME,
]);

export function normalizeReliefLevel(value, fallback = 2) {
  const numeric = Number(value);
  const normalizedFallback = Math.max(0, Math.min(5, Math.round(Number(fallback) || 0)));
  if (!Number.isFinite(numeric)) return normalizedFallback;
  return Math.max(0, Math.min(5, Math.round(numeric)));
}

export function getReliefLevelSpec(value) {
  return BADGE_RELIEF_LEVELS[normalizeReliefLevel(value)];
}

export function collapseBadgeReliefPanelInputs(inputs, nodeId) {
  if (!Array.isArray(inputs)) {
    return { inputs: [], changed: false };
  }

  const memberNames = new Set(BADGE_RELIEF_MEMBER_WIDGET_NAMES);
  const matchesNode = (entry) => (
    Array.isArray(entry)
    && String(entry[0]) === String(nodeId)
    && memberNames.has(entry[1])
  );
  const matchingEntries = inputs.filter(matchesNode);

  if (!matchingEntries.length) {
    return { inputs, changed: false };
  }
  if (
    matchingEntries.length === 1
    && matchingEntries[0][1] === BADGE_RELIEF_PANEL_WIDGET_NAME
  ) {
    return { inputs, changed: false };
  }

  const panelEntry = matchingEntries.find(
    (entry) => entry[1] === BADGE_RELIEF_PANEL_WIDGET_NAME,
  );
  const configuredEntry = matchingEntries.find((entry) => entry[2] !== undefined);
  const config = panelEntry?.[2] ?? configuredEntry?.[2];
  const canonicalNodeId = matchingEntries[0][0];
  const canonicalEntry = config === undefined
    ? [canonicalNodeId, BADGE_RELIEF_PANEL_WIDGET_NAME]
    : [canonicalNodeId, BADGE_RELIEF_PANEL_WIDGET_NAME, config];

  let inserted = false;
  const nextInputs = [];
  for (const entry of inputs) {
    if (!matchesNode(entry)) {
      nextInputs.push(entry);
      continue;
    }
    if (!inserted) {
      nextInputs.push(canonicalEntry);
      inserted = true;
    }
  }

  return { inputs: nextInputs, changed: true };
}
