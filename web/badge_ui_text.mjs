import { messages } from './badge_ui_catalog.mjs?v=20260917-simple-1';

// Synchronous, single-pass formatting preserves control initialization and user text.
export function badgeText(key, values = {}) {
    if (!Object.hasOwn(messages, key)) throw new Error(`Unknown Badge UI text: ${key}`);
    return messages[key].replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, name) => {
        if (!Object.hasOwn(values, name)) throw new Error(`Missing Badge UI variable: ${key}.${name}`);
        return String(values[name]);
    });
}
