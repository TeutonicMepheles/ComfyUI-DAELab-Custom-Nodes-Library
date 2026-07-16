export function isHexColorString(value) {
    if (typeof value !== "string") return false;
    return /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

function comparablePromptText(value) {
    if (typeof value !== "string") return "";
    return value
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/[。！？；，,\s]+$/gu, "");
}

export function normalizeBooleanValue(value, defaultValue = true) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    if (value === 0 || value === 1) return Boolean(value);
    return defaultValue;
}

export function repairPromptTextValues({
    basePrompt,
    additionalDetails,
    defaultBasePrompt,
    defaultAdditionalDetails,
}) {
    const repairedBase = typeof basePrompt !== "string" || isHexColorString(basePrompt)
        ? defaultBasePrompt
        : basePrompt;
    const comparableAdditional = comparablePromptText(additionalDetails);
    const additionalIsDuplicate = comparableAdditional.length > 0
        && comparableAdditional === comparablePromptText(repairedBase);
    const repairedAdditional = typeof additionalDetails !== "string"
        || isHexColorString(additionalDetails)
        || additionalIsDuplicate
        ? defaultAdditionalDetails
        : additionalDetails;

    return {
        basePrompt: repairedBase,
        additionalDetails: repairedAdditional,
    };
}

export function placeNonSerializingWidgetBefore(widgets, widget, targetName) {
    const next = (widgets || []).filter((item) => item !== widget);
    const targetIndex = next.findIndex((item) => item.name === targetName);
    next.splice(targetIndex >= 0 ? targetIndex : 0, 0, widget);
    return next;
}
