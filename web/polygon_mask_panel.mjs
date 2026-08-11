export const POLYGON_MASK_MAX_VERTICES = 50;

export const POLYGON_PANEL_WIDGET_NAME = "polygon_canvas";

export const POLYGON_PANEL_MEMBER_WIDGET_NAMES = Object.freeze([
  POLYGON_PANEL_WIDGET_NAME,
  "vertex_count",
  "color",
  "fill_opacity",
  "outline_width",
  "text",
]);

export function collapsePolygonPanelInputs(inputs, nodeId) {
  if (!Array.isArray(inputs)) {
    return { inputs: [], changed: false };
  }

  const memberNames = new Set(POLYGON_PANEL_MEMBER_WIDGET_NAMES);
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
    && matchingEntries[0][1] === POLYGON_PANEL_WIDGET_NAME
  ) {
    return { inputs, changed: false };
  }

  const panelEntry = matchingEntries.find(
    (entry) => entry[1] === POLYGON_PANEL_WIDGET_NAME,
  );
  // Native-row sizing is too small for the full editor. Preserve only an
  // existing canvas-panel configuration; otherwise let App Builder use the
  // DOM widget's own dimensions.
  const config = panelEntry?.[2];
  const canonicalNodeId = matchingEntries[0][0];
  const canonicalEntry = config === undefined
    ? [canonicalNodeId, POLYGON_PANEL_WIDGET_NAME]
    : [canonicalNodeId, POLYGON_PANEL_WIDGET_NAME, config];

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
