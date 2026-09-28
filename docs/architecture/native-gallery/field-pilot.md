# Shared native fields — pilot acceptance

## Delivered

`web/creative_field.mjs` is shared by LibTV prompt, duration and model fields (8 controls across two video nodes and one batch node), and 5 native state specimens. The existing LibTV field factory, studio styling, capability adjustment, widget callbacks and serialization are reused. List icon controls were unsuitable for these native text fields; no second business-field implementation was introduced.

Lease activation adds capture validation and markers; release removes listeners and restores owned attributes. Empty/non-finite/out-of-range/fractional numeric values cannot commit. Disabled and inert controls reject dispatched input/change events. Native focus and scoped error outlines are shared. Model policy remains in LibTV. Existing values serialize through the original widget path.

The JSON now opts into a state specimen card via extra.daelabControlGallery. These local sample values do not execute or write business nodes. Default, disabled and invalid fields are immediately visible; clicking or tabbing exercises focus. Correcting 99 to an integer between 4 and 30 clears the error. The same binder and CSS serve real fields and specimens.

Installed separately as `user/default/workflows/DAELab/Creative Canvas Controls - Fields.json`, initially focused on specimens; use Fit to see all nodes. The previous saved gallery was not overwritten.

## Verification

- `node tools/creative_field_smoke.mjs`: 14 checks pass; independent prompt/model changes, numeric validation, disabled dispatch, capability adjustment, lease cleanup, repeated mode switching, serialization plus browser reload.
- Actual legacy workflows loaded in App Mode: #8.8 - Badge Workflow; #7-展厅工作流优化-OpenAI-分割单独描述版. Their reference/configuration panels render; no creative bindings remain. Screenshots inspected. This is a load/render/isolation smoke test, not an exhaustive legacy interaction or pixel-diff suite.
- `node tools/creative_button_smoke.mjs`: 15 button checks pass.
- 21 Node tests pass across creative_canvas_model, app_mode_bypass_model and libtv_canvas_result.
- No page errors or generation POSTs in the isolated test browsers. No paid generation tested. Startup workflow restoration must settle before reload assertions.

Evidence: field-pilot-verification.json, field-pilot.png, field-states.png, badge-app-regression.png, exhibition-app-regression.png.

Only creative scope was changed. No exhibition/badge source or ComfyTV upstream files were modified. Shared visual tokens and complex table/media migration remain future phases.
