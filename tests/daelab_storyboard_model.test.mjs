import assert from "node:assert/strict";
import test from "node:test";

import {
    appendShot,
    durationFromTimeRange,
    moveShot,
    normalizeStoryboard,
    removeShot,
    replaceImportedShots,
    serializeStoryboard,
    storyboardPanelLayout,
} from "../web/daelab_storyboard_model.mjs";

test("normalizes business storyboard rows without voiceover fields", () => {
    const state = normalizeStoryboard(JSON.stringify({
        shots: [{
            shot_no: "01",
            time_range: "00-08s",
            image_prompt: "浩瀚星空铺开",
            camera_notes: "全景慢推",
            dialogue: "不会进入节点数据",
        }],
    }));
    assert.equal(state.shots[0].duration, 8);
    assert.equal(state.shots[0].image_prompt, "浩瀚星空铺开");
    assert.equal(Object.hasOwn(state.shots[0], "dialogue"), false);
    assert.equal(Object.hasOwn(JSON.parse(serializeStoryboard(state)).shots[0], "dialogue"), false);
});

test("supports blank camera notes and reference images", () => {
    const state = normalizeStoryboard({ shots: [{
        prompt: "红色招牌特写",
        camera_notes: "",
        image_url: "/view?filename=ref.png&type=input",
    }] });
    const row = JSON.parse(serializeStoryboard(state)).shots[0];
    assert.equal(row.camera_notes, "");
    assert.equal(row.image_url, "/view?filename=ref.png&type=input");
});

test("list edits preserve stable shot content", () => {
    const state = normalizeStoryboard({ shots: [{ prompt: "A" }, { prompt: "B" }] });
    appendShot(state, { prompt: "C" });
    moveShot(state, 2, -1);
    removeShot(state, 0);
    assert.deepEqual(state.shots.map((shot) => shot.prompt), ["C", "B"]);
});

test("document replacement keeps title, filename, and parsed references", () => {
    const state = normalizeStoryboard({ shots: [] });
    replaceImportedShots(state, {
        filename: "分镜表.xlsx",
        document_title: "第一篇章",
        shots: [{ shot_no: "03", image_prompt: "研究所外景", image_url: "/view?filename=x.png&type=input" }],
    });
    assert.equal(state.source_filename, "分镜表.xlsx");
    assert.equal(state.document_title, "第一篇章");
    assert.equal(state.shots[0].shot_no, "03");
});

test("duration parser handles ranges and safe fallback", () => {
    assert.equal(durationFromTimeRange("08-18s"), 10);
    assert.equal(durationFromTimeRange("00:25-00:30"), 5);
    assert.equal(durationFromTimeRange(""), 3);
});

test("panel layout is fixed-height and independent of a restored oversized height", () => {
    assert.deepEqual(storyboardPanelLayout(640, 2200), { width: 920, panelHeight: 520 });
    assert.deepEqual(storyboardPanelLayout(1180, 400), { width: 1180, panelHeight: 520 });
});
