import {
    cloneItems,
    normalizeItems,
} from "./boolean_list_hierarchy_model.mjs";

export function cloneHierarchyState(value) {
    return cloneItems(normalizeItems(value)).map((item) => ({
        ...item,
        requires_ids: [...(item.requires_ids || [])],
    }));
}

export function createBooleanHierarchyApiController({ readItems, commitItems }) {
    if (typeof readItems !== "function" || typeof commitItems !== "function") {
        throw new TypeError("Boolean hierarchy API requires readItems and commitItems callbacks.");
    }

    const listeners = new Set();
    let disposed = false;

    const getState = () => cloneHierarchyState(readItems());
    const api = Object.freeze({
        getState,
        getItemValue(itemId) {
            const item = getState().find((candidate) => candidate.id === String(itemId));
            return item ? Boolean(item.value) : undefined;
        },
        setItemValue(itemId, value) {
            if (disposed) return false;
            const id = String(itemId ?? "").trim();
            const items = getState();
            const item = items.find((candidate) => candidate.id === id);
            if (!item) return false;

            const nextValue = Boolean(value);
            if (Boolean(item.value) === nextValue) return false;
            item.value = nextValue;
            return Boolean(commitItems(items, {
                preferredItemId: nextValue ? id : null,
            }));
        },
        subscribe(listener) {
            if (disposed || typeof listener !== "function") return () => {};
            listeners.add(listener);
            let active = true;
            return () => {
                if (!active) return;
                active = false;
                listeners.delete(listener);
            };
        },
    });

    return {
        api,
        notify(items = readItems()) {
            if (disposed) return;
            for (const listener of [...listeners]) {
                try {
                    listener(cloneHierarchyState(items));
                } catch (error) {
                    console.error("DAELab Boolean hierarchy subscriber failed", error);
                }
            }
        },
        dispose() {
            disposed = true;
            listeners.clear();
        },
    };
}
