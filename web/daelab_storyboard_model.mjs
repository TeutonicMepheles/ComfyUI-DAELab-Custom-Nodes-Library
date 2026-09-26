export const STORYBOARD_SCHEMA_VERSION = 3;
export const STORYBOARD_PANEL_HEIGHT = 520;
export const STORYBOARD_MIN_WIDTH = 920;
export const STORYBOARD_DEFAULT_WIDTH = 1080;
export const STORYBOARD_COLUMNS = ['shot_no','time_range','image_prompt','camera_notes','image_url'];

export function normalizeColumnOrder(order) {
    return [...new Set([...(Array.isArray(order)?order:[]).filter(k=>STORYBOARD_COLUMNS.includes(k)), ...STORYBOARD_COLUMNS])];
}

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

export function timeRangeNeedsReview(value) {
    const source = text(value).normalize("NFKC").toLowerCase();
    const token = "\\d+(?::\\d{1,2}){0,2}(?:\\.\\d+)?";
    const range = source.match(new RegExp(`^(${token})\\s*(?:-|~|至|到)\\s*(${token})(?:s|秒)?$`));
    const seconds = part => part.split(":").reduce((total, item) => total * 60 + Number(item), 0);
    const single = source.match(new RegExp(`^(${token})\\s*(?:s|秒|sec|seconds?)?$`));
    const duration = range ? seconds(range[2]) - seconds(range[1]) : single ? seconds(single[1]) : 0;
    return duration <= 0 || duration > 3600;
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
    const prompt = text(source.image_prompt ?? source.prompt);
    return {
        id: text(source.id) || `shot-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
        shot_no: text(source.shot_no) || String(index + 1).padStart(2, "0"),
        time_range: timeRange,
        duration: durationFromTimeRange(timeRange),
        prompt,
        image_prompt: prompt,
        camera_notes: text(source.camera_notes),
        image_url: text(source.image_url),
        source: source.source || null,
        original_fields: Array.isArray(source.original_fields) ? source.original_fields : [],
        input_changed: Boolean(source.input_changed),
        selected: source.selected !== false,
        group_refs: source.group_refs && typeof source.group_refs === 'object' ? source.group_refs : {},
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
        column_order: normalizeColumnOrder(source?.column_order),
        asset_groups: Array.isArray(source?.asset_groups) ? source.asset_groups : [],
        shots: rawShots.map(normalizeShot),
    };
}

export function serializeStoryboard(state) {
    return JSON.stringify({
        schema_version: STORYBOARD_SCHEMA_VERSION,
        document_title: text(state?.document_title),
        source_filename: text(state?.source_filename),
        column_order: normalizeColumnOrder(state?.column_order),
        asset_groups: state?.asset_groups || [],
        shots: (state?.shots || []).map((shot, index) => ({
            id: shot.id,
            source: shot.source || null,
            original_fields: shot.original_fields || [],
            input_changed: Boolean(shot.input_changed),
            selected: shot.selected !== false,
            group_refs: shot.group_refs || {},
            shot_no: text(shot.shot_no) || String(index + 1).padStart(2, "0"),
            time_range: text(shot.time_range),
            duration: durationFromTimeRange(shot.time_range),
            prompt: text(shot.image_prompt ?? shot.prompt),
            image_prompt: text(shot.image_prompt ?? shot.prompt),
            camera_notes: text(shot.camera_notes),
            image_url: text(shot.image_url),
        })),
    });
}

export function draftTable(result, table, mapping = table.mapping, headerIndex = table.header_index) {
    const headers = table.rows[headerIndex] || [];
    return table.rows.slice(headerIndex + 1).flatMap((row, index) => {
        const ri = headerIndex + index + 1;
        const refs = [...new Set(Object.entries(table.images || {}).filter(([key]) => key.startsWith(`${ri}:`)).flatMap(([, ids]) => ids))];
        if (!row.some(value => String(value).trim()) && !refs.length) return [];
        const field = name => row[mapping[name]] || "";
        return [{...normalizeShot({shot_no: field("shot_no"), time_range: field("time_range"), image_prompt: field("image_prompt"), camera_notes: field("camera_notes"), image_url: field("reference_image").startsWith("/view?") ? field("reference_image") : ""}, index),
            asset_id: refs.length === 1 ? refs[0] : "", candidate_assets: refs,
            source: {filename: result.filename, table: table.id, row: ri + 1},
            original_fields: row.map((value, ci) => ({column: ci, name: headers[ci] || `列 ${ci + 1}`, value})),
        }];
    });
}

export function applyImportedShots(state, result, mode) {
    if (!["append", "replace"].includes(mode)) throw new Error("请选择追加或替换");
    const shots = result.shots.map(normalizeShot);
    state.shots = mode === "append" ? [...state.shots, ...shots] : shots;
    state.document_title = result.document_title;
    state.source_filename = result.filename;
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
