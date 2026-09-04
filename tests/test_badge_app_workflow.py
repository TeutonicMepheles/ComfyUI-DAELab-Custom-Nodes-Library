import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_app_workflow" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_app_workflow_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BadgeAppWorkflowTests(unittest.TestCase):
    def test_prompt_route_previews_action_before_apply_without_enabling_gpt(self):
        result = MODULE.resolve_edit_action(
            semantic_mode=False,
            material_mode=True,
            requested_apply=False,
            material_prompt="Apply glitter only inside the mask.",
            material_id="glitter",
        )

        self.assertEqual(result[0], "Apply glitter only inside the mask.")
        self.assertEqual(result[1], "material")
        self.assertFalse(result[2])
        self.assertEqual(result[3], MODULE.build_action_digest(
            "material", "Apply glitter only inside the mask.", "glitter"
        ))
        self.assertEqual(json.loads(result[4])["reason"], "not_requested")

    def setUp(self):
        MODULE._CONFIRMATION_STATE.clear()

    def test_route_2_letterboxes_without_crop_and_builds_support_mask(self):
        source = torch.zeros((1, 32, 64, 3), dtype=torch.float32)
        source[..., 0] = 0.5
        master, support, status_json = MODULE.normalize_effect_canvas(source)
        self.assertEqual(tuple(master.shape), (1, 1024, 1024, 3))
        self.assertEqual(tuple(support.shape), (1, 1024, 1024))
        self.assertEqual(int(support.sum()), 1024 * 512)
        self.assertEqual(float(master[0, 0, 0].min()), 1.0)
        self.assertAlmostEqual(float(master[0, 512, 512, 0]), 0.5, places=5)
        status = json.loads(status_json)
        self.assertEqual(status["fit_policy"], "contain_white_letterbox_no_crop")
        self.assertEqual(status["support_policy"], "valid_letterbox_content")

    def test_route_2_uses_alpha_as_edit_support(self):
        source = torch.zeros((1, 16, 16, 4), dtype=torch.float32)
        source[..., :3] = 0.25
        source[:, 4:12, 5:11, 3] = 1.0
        master, support, status_json = MODULE.normalize_effect_canvas(source)
        self.assertGreater(int(support.sum()), 0)
        self.assertLess(int(support.sum()), 1024 * 1024)
        self.assertEqual(json.loads(status_json)["support_policy"], "source_alpha")
        self.assertEqual(float(master[0, 0, 0].min()), 1.0)

    def test_route_contract_rejects_noncanonical_or_misaligned_inputs(self):
        master = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)
        reference = master.clone()
        support = torch.ones((1, 1024, 1024), dtype=torch.float32)
        selected = MODULE._validate_canonical_route(master, reference, support, "effect")
        self.assertEqual(tuple(selected[0].shape), tuple(master.shape))
        with self.assertRaisesRegex(ValueError, "share one canvas"):
            MODULE._validate_canonical_route(master, reference[:, :512], support, "effect")
        with self.assertRaisesRegex(ValueError, "1024x1024"):
            MODULE._validate_canonical_route(master[:, :512, :512], reference[:, :512, :512], support[:, :512, :512], "effect")

    def test_color_id_map_key_is_stable_and_revision_invalidates_it(self):
        master = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)
        first = MODULE.color_id_map_cache_key(master, "prompt", "high", 6, 0)
        second = MODULE.color_id_map_cache_key(master.clone(), "prompt", "high", 6, 0)
        rerolled = MODULE.color_id_map_cache_key(master, "prompt", "high", 6, 1)
        changed = master.clone()
        changed[:, 0, 0] = 1.0
        self.assertEqual(first, second)
        self.assertNotEqual(first, rerolled)
        self.assertNotEqual(first, MODULE.color_id_map_cache_key(changed, "prompt", "high", 6, 0))

    def test_color_id_map_cache_round_trip_is_lossless(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.environ.get("DAELAB_TEST_OUTPUT_DIR")
            os.environ["DAELAB_TEST_OUTPUT_DIR"] = directory
            try:
                image = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)
                image[:, 100:200, 300:400, 1] = 1.0
                key = MODULE.color_id_map_cache_key(image, "prompt", "high", 6, 0)
                path = MODULE.store_cached_map(image, key)
                self.assertTrue(path.is_file())
                restored = MODULE.load_cached_map(key)
                torch.testing.assert_close(restored, image)
            finally:
                if old is None:
                    os.environ.pop("DAELAB_TEST_OUTPUT_DIR", None)
                else:
                    os.environ["DAELAB_TEST_OUTPUT_DIR"] = old

    def test_guard_requires_preview_then_new_confirmation_revision(self):
        master = torch.zeros((1, 32, 32, 3), dtype=torch.float32)
        reference = master.clone()
        reference[:, 8:24, 8:24, 1] = 1.0
        mask = torch.zeros((1, 32, 32), dtype=torch.float32)
        mask[:, 8:24, 8:24] = 1.0
        support = torch.ones_like(mask)
        guard = MODULE.BadgeLocalSelectionGuardV1()
        common = dict(
            pre_edit_master=master,
            selection_reference=reference,
            candidate_mask=mask,
            edit_support_mask=support,
            route_id="effect",
            map_mode=False,
            map_cache_key="",
            picker_node_id="69",
            picker_config='{"groups":[{"color":"#00ff00","threshold":12}]}',
            edit_mode="semantic",
            action_digest=MODULE.build_action_digest("semantic", "keep exact geometry"),
            minimum_region_pixels=16,
            unique_id="guard-1",
        )
        preview = guard.validate(requested_apply=False, confirmation_revision=0, **common)
        self.assertFalse(preview[2])
        self.assertEqual(json.loads(preview[4])["reason"], "preview_ready")
        confirmed = guard.validate(requested_apply=True, confirmation_revision=1, **common)
        self.assertTrue(confirmed[2])
        self.assertEqual(json.loads(confirmed[4])["reason"], "confirmed_current_snapshot")
        changed = reference.clone()
        changed[:, 0, 0, 2] = 1.0
        stale = guard.validate(
            requested_apply=True,
            confirmation_revision=1,
            **{**common, "selection_reference": changed},
        )
        self.assertFalse(stale[2])
        self.assertEqual(json.loads(stale[4])["reason"], "snapshot_changed_confirmation_cleared")

    def test_guard_clips_to_support_and_skips_tiny_selection(self):
        master = torch.zeros((1, 16, 16, 3), dtype=torch.float32)
        mask = torch.ones((1, 16, 16), dtype=torch.float32)
        support = torch.zeros_like(mask)
        support[:, 2:4, 2:4] = 1.0
        result = MODULE.BadgeLocalSelectionGuardV1().validate(
            master,
            master,
            mask,
            support,
            False,
            0,
            "flat_height",
            False,
            "",
            "69",
            "{}",
            "semantic",
            "digest",
            16,
            unique_id="guard-2",
        )
        self.assertEqual(int(result[0].sum()), 4)
        self.assertFalse(result[2])
        self.assertEqual(json.loads(result[4])["reason"], "selection_below_threshold")

    def test_guard_allows_direct_reference_route_without_map_cache_key(self):
        schema = MODULE.BadgeLocalSelectionGuardV1.INPUT_TYPES()
        self.assertNotIn("map_cache_key", schema["required"])
        self.assertIn("map_cache_key", schema["optional"])

        master = torch.zeros((1, 8, 8, 3), dtype=torch.float32)
        mask = torch.ones((1, 8, 8), dtype=torch.float32)
        result = MODULE.BadgeLocalSelectionGuardV1().validate(
            pre_edit_master=master,
            selection_reference=master,
            candidate_mask=mask,
            edit_support_mask=mask,
            requested_apply=False,
            confirmation_revision=0,
            route_id="effect",
            map_mode=False,
            picker_config="{}",
            edit_mode="material",
            action_digest="material-digest",
            minimum_region_pixels=16,
            unique_id="guard-direct-reference",
        )
        self.assertEqual(json.loads(result[4])["reason"], "preview_ready")

    def test_workflow_picker_config_is_authoritative(self):
        extra = {
            "workflow": {
                "nodes": [{
                    "id": 69,
                    "properties": {"multi_color_mask_v1_config": "authoritative"},
                }]
            }
        }
        self.assertEqual(MODULE._workflow_picker_config(extra, "69", "fallback"), "authoritative")

    def test_all_app_workflow_nodes_are_registered(self):
        self.assertEqual(set(MODULE.NODE_CLASS_MAPPINGS), {
            "DAELAB.BadgeRoute2CanvasV1",
            "DAELAB.BadgeEntryRouteV1",
            "DAELAB.BadgeEditPromptRouteV1",
            "DAELAB.BadgeLazyImageSwitchV1",
            "DAELAB.BadgeColorIdMapV1",
            "DAELAB.BadgeColorIdMapCacheStoreV1",
            "DAELAB.BadgeLocalSelectionGuardV1",
        })


if __name__ == "__main__":
    unittest.main()
