export const STORYBOARD_SCHEMA_VERSION = 1;
export const STORYBOARD_PANEL_HEIGHT = 520;
export const STORYBOARD_MIN_WIDTH = 920;
export const STORYBOARD_DEFAULT_WIDTH = 1080;

export function storyboardPanelLayout(width) {
    const numericWidth = Number(width);
    return {
        width: Math.max(
            STORYBOARD_MIN_WIDTH,
            Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : STORYBOARD_DEFAULT_WIDTH,
        ),
        panelHeight: STORYBOARD_PANEL_HEIGHT,
    };
}

function text(value) {
    return String(value ?? "").trim();
}

export function durationFromTimeRange(value) {
    const source = text(value).normalize("NFKC").toLowerCase();
    if (!source) return 3;
    const token = "\\d+(?::\\d{1,2}){0,2}(?:\\.\\d+)?";
    const range = source.match(new RegExp(`(${token})\\s*(?:-|~|至|到)\\s*(${token})`));
    const seconds = (part) => part.split(":").reduce((total, item) => total * 60 + Number(item), 0);
    if (range) {
        const result = seconds(range[2]) - seconds(range[1]);
        if (Number.isFinite(result) && result > 0) return Math.max(1, Math.min(3600, Math.round(result)));
    }
    const single = source.match(new RegExp(`(${token})\\s*(?:s|秒|sec|seconds?)?\\s*$`));
    if (single) {
        const result = seconds(single[1]);
        if (Number.isFinite(result) && result > 0) return Math.max(1, Math.min(3600, Math.round(result)));
    }
    return 3;
}

export function normalizeShot(source = {}, index = 0) {
    const timeRange = text(source.time_range);
    const prompt = text(source.image_prompt || source.prompt);
    return {
        id: text(source.id) || `shot-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
        shot_no: text(source.shot_no) || String(index + 1).padStart(2, "0"),
        time_range: timeRange,
        duration: durationFromTimeRange(timeRange),
        prompt,
        image_prompt: prompt,
        camera_notes: text(source.camera_notes),
        image_url: text(source.image_url),
    };
}

export function normalizeStoryboard(value) {
    let source = value;
    if (typeof value === "string" && value.trim()) {
        try {
            source = JSON.parse(value);
        } catch {
            source = {};
        }
    }
    const rawShots = Array.isArray(source?.shots) ? source.shots : [];
    return {
        schema_version: STORYBOARD_SCHEMA_VERSION,
        document_title: text(source?.document_title),
        source_filename: text(source?.source_filename),
        shots: rawShots.map(normalizeShot),
    };
}

export function serializeStoryboard(state) {
    return JSON.stringify({
        schema_version: STORYBOARD_SCHEMA_VERSION,
        document_title: text(state?.document_title),
        source_filename: text(state?.source_filename),
        shots: (state?.shots || []).map((shot, index) => ({
            shot_no: text(shot.shot_no) || String(index + 1).padStart(2, "0"),
            time_range: text(shot.time_range),
            duration: durationFromTimeRange(shot.time_range),
            prompt: text(shot.image_prompt || shot.prompt),
            image_prompt: text(shot.image_prompt || shot.prompt),
            camera_notes: text(shot.camera_notes),
            image_url: text(shot.image_url),
        })),
    });
}

export function appendShot(state, source = {}) {
    const shots = Array.isArray(state?.shots) ? state.shots : [];
    shots.push(normalizeShot(source, shots.length));
    return state;
}

export function removeShot(state, index) {
    if (Array.isArray(state?.shots) && index >= 0 && index < state.shots.length) {
        state.shots.splice(index, 1);
    }
    return state;
}

export function moveShot(state, index, offset) {
    if (!Array.isArray(state?.shots)) return state;
    const destination = index + offset;
    if (index < 0 || index >= state.shots.length || destination < 0 || destination >= state.shots.length) {
        return state;
    }
    const [shot] = state.shots.splice(index, 1);
    state.shots.splice(destination, 0, shot);
    return state;
}

export function replaceImportedShots(state, result) {
    state.document_title = text(result?.document_title);
    state.source_filename = text(result?.filename);
    state.shots = (result?.shots || []).map(normalizeShot);
    return state;
}
