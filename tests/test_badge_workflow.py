import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest

import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_workflow" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_workflow_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BadgeWorkflowTests(unittest.TestCase):
    def test_design_canvas_uses_load_image_transparency_as_inverse_foreground(self):
        image = torch.zeros((1, 2, 4, 3), dtype=torch.float32)
        image[:, :, 1:3] = 1.0
        transparency = torch.tensor([[[1.0, 0.0, 0.0, 1.0], [1.0, 0.0, 0.0, 1.0]]])
        normalized, foreground, width, height, report = MODULE.BadgeDesignCanvas().normalize(
            image, 8, 8, "bicubic", "Auto: alpha, else explicit colors", "#000000", "#ff00ff", 0, transparency
        )
        self.assertEqual(normalized.shape, (1, 8, 8, 3))
        self.assertEqual(foreground.shape, (1, 8, 8))
        self.assertEqual((width, height), (8, 8))
        self.assertEqual(json.loads(report)["foreground_source"], "load_image_alpha")
        self.assertEqual(float(foreground[:, 2:6, 2:6].sum()), 16.0)

    def test_design_canvas_explicit_colors_preserves_aspect_ratio(self):
        image = torch.ones((1, 2, 4, 3), dtype=torch.float32)
        image[:, :, 1:3] = torch.tensor([1.0, 0.0, 0.0])
        _, foreground, _, _, report = MODULE.BadgeDesignCanvas().normalize(
            image, 8, 8, "nearest", "Explicit colors", "#ffffff", "#ff00ff", 0
        )
        info = json.loads(report)
        self.assertEqual(info["content_box"], [0, 2, 8, 4])
        self.assertEqual(float(foreground.sum()), 16.0)

    def test_design_canvas_clamps_bicubic_edge_overshoot(self):
        image = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        image[:, :, 1, :] = 1.0
        normalized, _, _, _, _ = MODULE.BadgeDesignCanvas().normalize(
            image, 31, 31, "bicubic", "Explicit colors", "#000000", "#ff00ff", 0
        )
        self.assertTrue(torch.isfinite(normalized).all().item())
        self.assertGreaterEqual(float(normalized.amin().item()), 0.0)
        self.assertLessEqual(float(normalized.amax().item()), 1.0)
        self.assertEqual(float(normalized[:, :, 0, :].amin().item()), 0.0)
        self.assertEqual(float(normalized[:, :, -1, :].amax().item()), 1.0)

    def test_design_canvas_ignores_mismatched_empty_loader_placeholder_mask_in_auto_mode(self):
        image = torch.ones((1, 8, 12, 3), dtype=torch.float32)
        image[:, 2:6, 3:9] = torch.tensor([0.0, 1.0, 0.0])
        placeholder = torch.zeros((1, 64, 64), dtype=torch.float32)
        _, foreground, _, _, report = MODULE.BadgeDesignCanvas().normalize(
            image, 12, 8, "nearest", "Auto: alpha, else explicit colors", "#ffffff", "#ff00ff", 0, placeholder
        )
        self.assertEqual(json.loads(report)["foreground_source"], "explicit_background_and_cutout_colors")
        self.assertEqual(float(foreground.sum()), 24.0)

    def test_design_canvas_rejects_mismatched_nonempty_mask(self):
        image = torch.ones((1, 8, 12, 3), dtype=torch.float32)
        bad_mask = torch.ones((1, 64, 64), dtype=torch.float32)
        with self.assertRaisesRegex(ValueError, "identical spatial dimensions"):
            MODULE.BadgeDesignCanvas().normalize(
                image, 12, 8, "nearest", "Auto: alpha, else explicit colors", "#ffffff", "#ff00ff", 0, bad_mask
            )

    def test_registration_recovers_translation_with_provided_mask(self):
        design = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        design_mask = torch.zeros((1, 64, 64), dtype=torch.float32)
        design_mask[:, 20:44, 20:44] = 1.0
        design[:, 20:44, 20:44, 1] = 1.0
        candidate = torch.zeros_like(design)
        candidate_mask = torch.zeros_like(design_mask)
        candidate_mask[:, 24:48, 15:39] = 1.0
        candidate[:, 24:48, 15:39, 0] = 1.0
        registered, transform, iou, _, _, valid = MODULE.BadgeMasterRegistration().register(
            design,
            design_mask,
            candidate,
            0.95,
            0.0,
            0.1,
            0.08,
            True,
            candidate_mask,
        )
        self.assertTrue(valid)
        self.assertGreaterEqual(iou, 0.95)
        self.assertGreater(float(registered[:, 20:44, 20:44, 0].mean()), 0.9)
        self.assertIn("matrix", json.loads(transform)["batch"][0])

    def test_mask_validator_short_circuits_empty_and_blocks_full(self):
        image = torch.zeros((1, 4, 4, 3), dtype=torch.float32)
        foreground = torch.ones((1, 4, 4), dtype=torch.float32)
        empty = torch.zeros_like(foreground)
        result = MODULE.BadgeEditMaskValidator().validate(empty, foreground, image, 1.0, 0.97, False, 0.995)
        self.assertFalse(result[1])
        self.assertEqual(result[2], 0.0)
        with self.assertRaisesRegex(ValueError, "Full-mask"):
            MODULE.BadgeEditMaskValidator().validate(foreground, foreground, image, 1.0, 0.97, False, 0.995)

    def test_mask_validator_intersects_with_foreground(self):
        image = torch.zeros((1, 3, 4, 3), dtype=torch.float32)
        foreground = torch.tensor([[[0.0, 1.0, 1.0, 0.0]] * 3])
        edit = torch.tensor([[[1.0, 1.0, 0.0, 0.0]] * 3])
        validated, should_edit, coverage, *_ = MODULE.BadgeEditMaskValidator().validate(
            edit, foreground, image, 1.0, 0.97, False, 0.995
        )
        self.assertTrue(should_edit)
        self.assertEqual(float(validated.sum()), 3.0)
        self.assertEqual(coverage, 0.5)

    def test_height_patch_updates_absolute_level_and_topology(self):
        height = torch.full((1, 2, 3), 0.4)
        foreground = torch.ones_like(height)
        mask = torch.tensor([[[0.0, 1.0, 0.0], [0.0, 1.0, 0.0]]])
        patched, _, patched_foreground, _, report = MODULE.BadgeHeightPatch().patch(
            height, foreground, mask, True, "Cut Out (0.0)"
        )
        torch.testing.assert_close(patched[:, :, 1], torch.zeros((1, 2)))
        torch.testing.assert_close(patched_foreground[:, :, 1], torch.zeros((1, 2)))
        self.assertEqual(json.loads(report)["outside_height_max_abs_diff"], 0.0)
        restored, _, restored_foreground, _, _ = MODULE.BadgeHeightPatch().patch(
            patched, patched_foreground, mask, True, "Layer 5 (1.0)"
        )
        torch.testing.assert_close(restored[:, :, 1], torch.ones((1, 2)))
        torch.testing.assert_close(restored_foreground[:, :, 1], torch.ones((1, 2)))

    def test_non_height_patch_is_explicit_pass_through(self):
        height = torch.rand((1, 3, 3))
        foreground = torch.ones_like(height)
        mask = torch.ones_like(height)
        patched, _, patched_foreground, _, report = MODULE.BadgeHeightPatch().patch(
            height, foreground, mask, False, "Layer 5 (1.0)"
        )
        torch.testing.assert_close(patched, height)
        torch.testing.assert_close(patched_foreground, foreground)
        self.assertEqual(json.loads(report)["action"], "pass_through_non_height_operation")

    def test_deterministic_composite_preserves_every_outside_pixel(self):
        previous = torch.zeros((1, 4, 4, 3), dtype=torch.float32)
        candidate = torch.ones_like(previous)
        mask = torch.zeros((1, 4, 4), dtype=torch.float32)
        mask[:, 1:3, 1:3] = 1.0
        edited, outside_max, outside_mean, _, _ = MODULE.BadgeDeterministicComposite().composite(
            previous, candidate, mask
        )
        self.assertEqual(outside_max, 0.0)
        self.assertEqual(outside_mean, 0.0)
        self.assertEqual(float(edited.sum()), 12.0)

    def test_prompts_keep_master_and_presentation_responsibilities_separate(self):
        validation_mask = torch.zeros((1, 2, 2))
        foreground = torch.ones((1, 2, 2))
        base_prompt = MODULE.BadgeRenderPromptBuilder().build(
            True, True, 0.5, "", "satin gold", validation_mask, foreground
        )[0]
        presentation_prompt = MODULE.BadgePresentationPromptBuilder().build("macro display")[0]
        self.assertIn("no crop", base_prompt)
        self.assertIn("Do not use studio drama", base_prompt)
        self.assertIn("depth of field", presentation_prompt)
        self.assertIn("presentation result", presentation_prompt)

    def test_state_package_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            stub = types.SimpleNamespace(get_output_directory=lambda: directory)
            previous = sys.modules.get("folder_paths")
            sys.modules["folder_paths"] = stub
            try:
                image = torch.rand((1, 3, 4, 3))
                mask = torch.ones((1, 3, 4))
                height = torch.full((1, 3, 4), 0.6)
                path, _ = MODULE.BadgeEditStateSave().save(
                    image,
                    image,
                    mask,
                    True,
                    '{"iou": 1.0}',
                    "prompt",
                    True,
                    "Badge_8_2/test",
                    height,
                    {"workflow": {"nodes": []}},
                )
                loaded = MODULE.BadgeEditStateLoad().load(path)
                torch.testing.assert_close(loaded[0], image)
                torch.testing.assert_close(loaded[2], height)
                self.assertTrue(loaded[4])
            finally:
                if previous is None:
                    sys.modules.pop("folder_paths", None)
                else:
                    sys.modules["folder_paths"] = previous

    def test_all_nodes_are_registered(self):
        expected = {
            "BadgeDesignCanvas",
            "BadgeRenderPromptBuilder",
            "BadgeMasterRegistration",
            "BadgeEditMaskValidator",
            "BadgeLocalEditPromptBuilder",
            "BadgeHeightPatch",
            "BadgeDeterministicComposite",
            "BadgePresentationPromptBuilder",
            "BadgeEditStateSave",
            "BadgeEditStateLoad",
        }
        self.assertEqual(set(MODULE.NODE_CLASS_MAPPINGS), expected)


if __name__ == "__main__":
    unittest.main()
