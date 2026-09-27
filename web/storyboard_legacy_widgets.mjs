const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
function isStoryboardPayload(value) {
    if (typeof value !== "string" || !value.trim().startsWith("{")) return false;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed?.shots);
    } catch {
        return false;
    }
}

export function recoverShiftedWorkflowValues(node) {
    const mainPrompt = widget(node, "main_prompt");
    const storyboard = widget(node, "storyboard_data");
    if (!mainPrompt || !storyboard || !isStoryboardPayload(mainPrompt.value) || isStoryboardPayload(storyboard.value)) {
        return;
    }

    // ComfyUI serializes a seed control value immediately after `seed`. Early
    // DAELab workflow exports omitted that `fixed` entry, shifting the four
    // values below by one position. Repair those exports in memory before the
    // native widgets are hidden so copied workflows remain recoverable.
    const seedControl = widget(node, "control_after_generate");
    const selectedIndex = widget(node, "selected_index");
    const customParams = widget(node, "custom_params");
    const recoveredStyle = typeof seedControl?.value === "string" ? seedControl.value : "";
    const shiftedSelectedIndex = Number(storyboard.value);
    const shiftedCustomParams = selectedIndex?.value;

    storyboard.value = mainPrompt.value;
    mainPrompt.value = ["fixed", "increment", "decrement", "randomize"].includes(recoveredStyle)
        ? ""
        : recoveredStyle;
    if (Number.isFinite(shiftedSelectedIndex) && shiftedSelectedIndex >= 1 && selectedIndex) {
        selectedIndex.value = shiftedSelectedIndex;
    }
    if (customParams && typeof shiftedCustomParams === "string" && shiftedCustomParams.trim().startsWith("{")) {
        customParams.value = shiftedCustomParams;
    }
    if (seedControl) seedControl.value = "fixed";
}

