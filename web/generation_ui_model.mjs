export const INITIAL_COUNT_MAX = 4;
export const LEGACY_COUNT_MAX = 8;
export const DEFAULT_COUNT = 1;

export function validGenerationCount(value, max = INITIAL_COUNT_MAX) {
    return Number.isInteger(value) && value >= DEFAULT_COUNT && value <= max;
}

export function normalizeCountDraft(draft, max = INITIAL_COUNT_MAX) {
    const number = Number(draft);
    return Number.isFinite(number) ? Math.max(DEFAULT_COUNT, Math.min(max, Math.round(number))) : DEFAULT_COUNT;
}

export function generationUiState(graph) {
    graph.extra ??= {};
    return graph.extra.daelabGenerationUiV1 ??= { version: 1, stages: {}, migrations: {} };
}

export function changeGenerationGraph(graph, change, captureHistory) {
    graph.beforeChange?.();
    try { return change(); }
    finally {
        graph.afterChange?.();
        captureHistory?.();
        graph.setDirtyCanvas?.(true, true);
    }
}

// App Mode can detach the canvas that normally forwards graph changes to history.
export function captureGenerationHistory(app, graph) {
    if (app.isGraphReady === false || app.rootGraph !== graph) return;
    const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
    if (typeof tracker?.captureCanvasState === 'function') tracker.captureCanvasState();
    else tracker?.checkState?.();
}

export function migrateInitialCount(graph, value, write, notify, captureHistory) {
    const load = generationLoad(graph);
    if (load.countChecked) return false;
    const migrated = !graph.extra?.daelabGenerationUiV1?.migrations?.initialCountV1 &&
        validGenerationCount(value, LEGACY_COUNT_MAX) && value > INITIAL_COUNT_MAX;
    if (migrated) {
        changeGenerationGraph(graph, () => {
            write(INITIAL_COUNT_MAX);
            (generationUiState(graph).migrations ??= {}).initialCountV1 = true;
        }, captureHistory);
    }
    load.countChecked = true;
    if (migrated) notify?.(value, INITIAL_COUNT_MAX);
    return migrated;
}

export function generationFold(graph, key, captureHistory) {
    return {
        collapsed: (fallback = false) => graph.extra?.daelabGenerationUiV1?.stages?.[key]?.collapsed ?? fallback,
        setCollapsed(collapsed) {
            changeGenerationGraph(graph, () => {
                (generationUiState(graph).stages ??= {})[key] = { collapsed };
            }, captureHistory);
        },
    };
}

// The host can configure the same graph repeatedly. Its synthetic inspector refresh
// events do not represent a new load, so the extension hook advances this identity.
const loads = new WeakMap();
function generationLoad(graph) {
    if (!loads.has(graph)) loads.set(graph, { epoch: 0, countChecked: false });
    return loads.get(graph);
}

export function generationLoadIdentity(graph) {
    return generationLoad(graph).epoch;
}

export function markGenerationGraphLoaded(graph, restoringHistory = false) {
    const load = generationLoad(graph);
    load.epoch += 1;
    load.countChecked = restoringHistory;
}
