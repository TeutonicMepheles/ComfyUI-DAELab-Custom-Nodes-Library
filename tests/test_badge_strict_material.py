import importlib.util
import json
import pathlib
import unittest

import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_strict_material" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_strict_material_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BadgeStrictMaterialTests(unittest.TestCase):
    def make_square(self, size=64):
        mask = torch.zeros((1, size, size), dtype=torch.float32)
        mask[:, 12:size - 12, 12:size - 12] = 1.0
        height = mask * 0.6
        flat = torch.ones((1, size, size, 3), dtype=torch.float32)
        flat[:, 12:size - 12, 12:size - 12] = torch.tensor([0.12, 0.62, 0.48])
        return flat, mask, height

    def test_height_alignment_preserves_legal_levels_and_passes_exact_reference(self):
        _, foreground, height = self.make_square()
        unmatched = torch.zeros_like(height)
        result = MODULE.BadgeHeightReferenceAlignV1().align(
            foreground, height, unmatched, 0.985, 1.5, 0.5, True
        )
        self.assertTrue(result[5])
        self.assertGreaterEqual(result[3], 0.985)
        self.assertLessEqual(result[4], 1.5)
        self.assertEqual(set(torch.unique(result[0]).tolist()), {0.0, 0.6000000238418579})
        self.assertEqual(json.loads(result[6])["legal_levels"], [0.0, 0.2, 0.4, 0.6, 0.8, 1.0])

    def test_height_alignment_blocks_unmatched_foreground_before_api(self):
        _, foreground, height = self.make_square()
        unmatched = foreground.clone()
        with self.assertRaisesRegex(ValueError, "before GPT execution"):
            MODULE.BadgeHeightReferenceAlignV1().align(
                foreground, height, unmatched, 0.985, 1.5, 0.5, True
            )

    def test_height_alignment_conforms_support_without_creating_illegal_levels(self):
        design = torch.zeros((1, 64, 64), dtype=torch.float32)
        design[:, 10:54, 10:54] = 1.0
        height = torch.zeros_like(design)
        height[:, 12:52, 12:52] = 0.6
        height[:, 26:30, 26:30] = 0.0
        result = MODULE.BadgeHeightReferenceAlignV1().align(
            design, height, torch.zeros_like(height), 0.985, 1.5, 0.5, True
        )
        self.assertEqual(result[3], 1.0)
        self.assertEqual(result[4], 0.0)
        torch.testing.assert_close((result[0] > 0).float(), design)
        self.assertEqual(set(torch.unique(result[0]).tolist()), {0.0, 0.6000000238418579})
        report = json.loads(result[6])
        self.assertLess(report["prerepair_iou"], 1.0)
        self.assertTrue(report["support_conformed_to_design"])

    def test_height_locked_base_is_deterministic_and_keeps_canvas(self):
        flat, foreground, height = self.make_square()
        node = MODULE.BadgeHeightLockedBaseV1()
        first = node.render(flat, height, foreground, 5.0, 0.78, 0.24, 0.08, False)
        second = node.render(flat, height, foreground, 5.0, 0.78, 0.24, 0.08, False)
        torch.testing.assert_close(first[0], second[0])
        self.assertEqual(tuple(first[0].shape), tuple(flat.shape))
        self.assertEqual(float(first[0][0, 0, 0].min()), 1.0)

    def test_material_constraint_repairs_dark_color_drift_and_has_zero_spill(self):
        flat, foreground, height = self.make_square(96)
        base = MODULE.BadgeHeightLockedBaseV1().render(
            flat, height, foreground, 5.0, 0.78, 0.24, 0.08, False
        )[0]
        region = torch.zeros_like(foreground)
        region[:, 22:74, 22:74] = 1.0
        candidate = torch.full_like(base, 0.03)
        candidate[:, 22:74, 22:74, 0] = 0.8
        result = MODULE.BadgeMaterialConstraintV1().constrain(
            base, candidate, flat, height, region, "preserve", "#808080",
            0.02, 0.05, 0.03, 0.35,
        )
        self.assertTrue(result[2], json.loads(result[7]))
        self.assertLessEqual(result[3], 0.02)
        self.assertLessEqual(result[4], 0.05)
        self.assertLessEqual(result[5], 0.03)
        self.assertEqual(result[6], 0.0)
        outside = (1.0 - region).unsqueeze(-1)
        self.assertEqual(float(((result[0] - base).abs() * outside).max()), 0.0)

    def test_invalid_candidate_uses_visible_deterministic_material_fallback(self):
        flat, foreground, height = self.make_square()
        base = flat.clone()
        candidate = flat.clone()
        candidate[0, 20, 20, 0] = float("nan")
        result = MODULE.BadgeMaterialConstraintV1().constrain(
            base, candidate, flat, height, foreground, "preserve", "#808080",
            0.02, 0.05, 0.03, 1.0, "glitter", 1.0,
        )
        self.assertFalse(result[2])
        report = json.loads(result[7])
        self.assertEqual(report["output_source"], "deterministic_material_fallback")
        self.assertEqual(report["fallback_reason"], "candidate_invalid")
        self.assertGreaterEqual(report["output_visible_mean"], report["required_visible_mean"])
        self.assertGreaterEqual(report["output_visible_p95"], report["required_visible_p95"])
        self.assertGreater(float((result[0] - base).abs().max()), 0.05)

    def test_unchanged_candidate_is_rejected_as_too_weak_without_losing_material(self):
        flat, foreground, height = self.make_square(96)
        base = MODULE.BadgeHeightLockedBaseV1().render(
            flat, height, foreground, 5.0, 0.78, 0.24, 0.08, False
        )[0]
        region = torch.zeros_like(foreground)
        region[:, 22:74, 22:74] = 1.0
        result = MODULE.BadgeMaterialConstraintV1().constrain(
            base, base.clone(), flat, height, region, "preserve", "#808080",
            0.02, 0.05, 0.03, 1.0, "rhinestone", 1.0,
        )
        report = json.loads(result[7])
        self.assertFalse(result[2])
        self.assertEqual(report["fallback_reason"], "candidate_material_signal_too_weak")
        self.assertEqual(report["output_source"], "deterministic_material_fallback")
        self.assertGreaterEqual(report["output_visible_mean"], report["required_visible_mean"])
        self.assertGreaterEqual(report["output_visible_p95"], report["required_visible_p95"])
        outside = (1.0 - region).unsqueeze(-1)
        self.assertEqual(float(((result[0] - base).abs() * outside).max()), 0.0)

    def test_material_strength_changes_visible_output_without_spill(self):
        flat, foreground, height = self.make_square(96)
        base = MODULE.BadgeHeightLockedBaseV1().render(
            flat, height, foreground, 5.0, 0.78, 0.24, 0.08, False
        )[0]
        region = torch.zeros_like(foreground)
        region[:, 22:74, 22:74] = 1.0
        low = MODULE.BadgeMaterialConstraintV1().constrain(
            base, base.clone(), flat, height, region, "preserve", "#808080",
            0.02, 0.05, 0.03, 1.0, "glitter", 0.5,
        )
        high = MODULE.BadgeMaterialConstraintV1().constrain(
            base, base.clone(), flat, height, region, "preserve", "#808080",
            0.02, 0.05, 0.03, 1.0, "glitter", 1.25,
        )
        low_report, high_report = json.loads(low[7]), json.loads(high[7])
        self.assertGreater(high_report["output_visible_p95"], low_report["output_visible_p95"])
        self.assertEqual(high_report["outside_max_abs_diff"], 0.0)

    def test_region_prompt_requires_normal_view_material_visibility(self):
        prompt = MODULE.build_region_edit_prompt(
            {"material_id": "glitter", "material_strength": 1.1},
            {"semantic": "fine glitter", "application": "follow light", "avoid": "spill"},
        )
        self.assertIn("MATERIAL VISIBILITY", prompt)
        self.assertIn("110%", prompt)
        self.assertIn("unmistakably recognizable", prompt)

    def test_region_preflight_blocks_five_billable_regions_and_skips_clear(self):
        groups = []
        masks = []
        for index in range(5):
            groups.append({
                "id": f"r{index}",
                "matched_pixels": 100,
                "material_id": "glitter",
            })
            masks.append(torch.ones((1, 8, 8)))
        region_set = {"assignment": {"groups": groups}, "region_masks": masks}
        with self.assertRaisesRegex(ValueError, "budget exceeded"):
            MODULE._executor_preflight(region_set, 4, 1)
        groups[-1]["material_id"] = "transparent_lacquer"
        active, skipped = MODULE._executor_preflight(region_set, 4, 1)
        self.assertEqual(len(active), 4)
        self.assertEqual(skipped[-1]["reason"], "transparent_lacquer")

    def test_studio_composite_keeps_white_background_and_deterministic_shadow(self):
        flat, foreground, _ = self.make_square()
        result = MODULE.BadgeStudioCompositeV1().composite(
            flat, foreground, "#FFFFFF", 0.10, 4, 0, 3, 0.04, False
        )
        self.assertEqual(tuple(result[0].shape), tuple(flat.shape))
        torch.testing.assert_close(result[0][0, 0, 0], torch.ones(3))
        self.assertGreater(float(result[1].sum()), 0.0)
        self.assertFalse(json.loads(result[2])["generative_repaint"])
        with self.assertRaisesRegex(ValueError, "fixed to #FFFFFF"):
            MODULE.BadgeStudioCompositeV1().composite(
                flat, foreground, "#FEFEFE", 0.10, 4, 0, 3, 0.04, False
            )

    def test_visible_gpt_channels_resolve_only_active_material_regions(self):
        masks = [torch.ones((1, 8, 8)), torch.ones((1, 8, 8))]
        region_set = {
            "assignment": {"groups": [
                {"id": "clear", "matched_pixels": 64, "material_id": "transparent_lacquer"},
                {"id": "glitter", "matched_pixels": 64, "material_id": "glitter", "reroll_revision": 2},
                {"id": "empty", "matched_pixels": 0, "material_id": "rhinestone"},
                {"id": "rhinestone", "matched_pixels": 64, "material_id": "rhinestone"},
            ]},
            "region_masks": [masks[0], masks[0], masks[1], masks[1]],
        }
        first, active, skipped = MODULE._material_channel_plan(region_set, 1, 4, 16)
        second, _, _ = MODULE._material_channel_plan(region_set, 2, 4, 16)
        inactive, _, _ = MODULE._material_channel_plan(region_set, 3, 4, 16)
        self.assertEqual([item[0]["id"] for item in active], ["glitter", "rhinestone"])
        self.assertEqual(first[0]["id"], "glitter")
        self.assertEqual(second[0]["id"], "rhinestone")
        self.assertIsNone(inactive)
        self.assertEqual({item["reason"] for item in skipped}, {"transparent_lacquer", "empty"})

    def test_visible_channel_status_explicitly_reports_native_gpt_use(self):
        group = {
            "id": "green-glitter",
            "material_id": "glitter",
            "material_strength": 1.15,
            "reroll_revision": 3,
        }
        active = json.loads(MODULE._channel_status(
            group, 1, "medium", active_count=1, skipped=[], gpt_used=True
        ))
        inactive = json.loads(MODULE._channel_status(
            None, 2, "medium", active_count=1, skipped=[], gpt_used=False
        ))
        self.assertTrue(active["gpt_node_used"])
        self.assertTrue(active["billable_api_request_on_cache_miss"])
        self.assertEqual(active["native_gpt_node_type"], "OpenAIGPTImageNodeV2")
        self.assertEqual(active["gpt_node_id"], "gpt_green-glitter")
        self.assertEqual(active["reroll_revision"], 3)
        self.assertFalse(inactive["gpt_node_used"])
        self.assertIsNone(inactive["gpt_node_id"])

    def test_visible_channel_merge_is_strict_and_reports_call_count(self):
        base = torch.zeros((1, 32, 32, 3), dtype=torch.float32)
        first_image = base.clone()
        first_image[:, 4:12, 4:12] = 0.8
        first_mask = torch.zeros((1, 32, 32), dtype=torch.float32)
        first_mask[:, 4:12, 4:12] = 1.0
        second_image = base.clone()
        second_image[:, 18:26, 18:26] = 0.6
        second_mask = torch.zeros_like(first_mask)
        second_mask[:, 18:26, 18:26] = 1.0
        empty = torch.zeros_like(first_mask)
        active_status = json.dumps({"gpt_node_used": True})
        inactive_status = json.dumps({"gpt_node_used": False})
        node = MODULE.BadgeMaterialRegionMergeV1()
        result, report_json = node.merge(
            base,
            region_1_image=first_image,
            region_1_mask=first_mask,
            region_1_status=active_status,
            region_2_image=second_image,
            region_2_mask=second_mask,
            region_2_status=active_status,
            region_3_image=base,
            region_3_mask=empty,
            region_3_status=inactive_status,
            region_4_image=base,
            region_4_mask=empty,
            region_4_status=inactive_status,
        )
        report = json.loads(report_json)
        self.assertEqual(report["gpt_node_use_count"], 2)
        self.assertEqual(report["maximum_channel_overlap"], 0.0)
        self.assertEqual(report["outside_max_abs_diff"], 0.0)
        self.assertEqual(float(result[:, :2, :2].max()), 0.0)
        self.assertGreater(float(result.max()), 0.0)

    def test_visible_channel_merge_rejects_overlapping_masks(self):
        base = torch.zeros((1, 8, 8, 3), dtype=torch.float32)
        mask = torch.ones((1, 8, 8), dtype=torch.float32)
        status = json.dumps({"gpt_node_used": True})
        with self.assertRaisesRegex(ValueError, "overlap"):
            MODULE._merge_material_channels(base, [
                (base, mask, status),
                (base, mask, status),
                (base, torch.zeros_like(mask), status),
                (base, torch.zeros_like(mask), status),
            ])

    def test_all_strict_nodes_are_registered(self):
        self.assertEqual(set(MODULE.NODE_CLASS_MAPPINGS), {
            "BadgeHeightReferenceAlignV1",
            "BadgeHeightLockedBaseV1",
            "BadgeMaterialConstraintV1",
            "BadgeMaterialRegionGPTChannelV1",
            "BadgeMaterialRegionMergeV1",
            "BadgeMaterialRegionExecutorV1",
            "BadgeStudioCompositeV1",
        })


if __name__ == "__main__":
    unittest.main()
