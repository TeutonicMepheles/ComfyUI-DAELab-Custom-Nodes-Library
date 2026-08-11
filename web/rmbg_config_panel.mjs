export const RMBG_CONFIG_PANEL_WIDGET_NAME = "rmbg_config_panel";

export const RMBG_CONFIG_MEMBER_WIDGET_NAMES = Object.freeze([
  RMBG_CONFIG_PANEL_WIDGET_NAME,
  "background",
  "background_color",
]);

export function collapseRMBGConfigPanelInputs(inputs, nodeId) {
  if (!Array.isArray(inputs)) {
    return { inputs: [], changed: false };
  }

  const memberNames = new Set(RMBG_CONFIG_MEMBER_WIDGET_NAMES);
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
    && matchingEntries[0][1] === RMBG_CONFIG_PANEL_WIDGET_NAME
  ) {
    return { inputs, changed: false };
  }

  const panelEntry = matchingEntries.find(
    (entry) => entry[1] === RMBG_CONFIG_PANEL_WIDGET_NAME,
  );
  const configuredEntry = matchingEntries.find((entry) => entry[2] !== undefined);
  const config = panelEntry?.[2] ?? configuredEntry?.[2];
  const canonicalNodeId = matchingEntries[0][0];
  const canonicalEntry = config === undefined
    ? [canonicalNodeId, RMBG_CONFIG_PANEL_WIDGET_NAME]
    : [canonicalNodeId, RMBG_CONFIG_PANEL_WIDGET_NAME, config];

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

export function normalizeRMBGColor(value, fallback = "#FFFFFF") {
  const text = String(value || "").trim();
  const match = text.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : fallback;
}
