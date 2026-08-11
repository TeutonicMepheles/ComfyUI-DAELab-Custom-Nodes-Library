export const GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME = "gpt_image2_config_panel";

export const GPT_IMAGE2_CONFIG_MEMBER_WIDGET_NAMES = Object.freeze([
  GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME,
  "size",
  "background",
  "quality",
]);

export function collapseGPTImage2ConfigPanelInputs(inputs, nodeId) {
  if (!Array.isArray(inputs)) {
    return { inputs: [], changed: false };
  }

  const memberNames = new Set(GPT_IMAGE2_CONFIG_MEMBER_WIDGET_NAMES);
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
    && matchingEntries[0][1] === GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME
  ) {
    return { inputs, changed: false };
  }

  const panelEntry = matchingEntries.find(
    (entry) => entry[1] === GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME,
  );
  const configuredEntry = matchingEntries.find((entry) => entry[2] !== undefined);
  const config = panelEntry?.[2] ?? configuredEntry?.[2];
  const canonicalNodeId = matchingEntries[0][0];
  const canonicalEntry = config === undefined
    ? [canonicalNodeId, GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME]
    : [canonicalNodeId, GPT_IMAGE2_CONFIG_PANEL_WIDGET_NAME, config];

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
