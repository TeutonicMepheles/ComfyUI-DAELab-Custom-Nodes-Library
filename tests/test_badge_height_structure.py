import importlib.util
import json
import pathlib
import unittest

import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_height_structure" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_height_structure_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BadgeHeightStructureTests(unittest.TestCase):
    def make_inputs(self, size=64):
        foreground = torch.zeros((1, size, size), dtype=torch.float32)
        foreground[:, 8:size - 8, 8:size - 8] = 1.0
        height = foreground * 0.4
        height[:, 20:size - 20, 20:size - 20] = 0.8

        flat = torch.ones((1, size, size, 3), dtype=torch.float32)
        flat[:, 8:size - 8, 8:size - 8] = torch.tensor([0.12, 0.62, 0.48])
        flat[:, 20:size - 20, 20:size - 20] = torch.tensor([0.82, 0.25, 0.18])
        shading = (0.88 + height * 0.12).unsqueeze(-1)
        fallback = torch.where(foreground.unsqueeze(-1) > 0.5, flat * shading, flat)

        candidate = torch.ones_like(flat)
        candidate[:, 8:size - 8, 8:size - 8] = torch.tensor([0.54, 0.57, 0.55])
        candidate[:, 20:size - 20, 20:size - 20] = torch.tensor([0.78, 0.80, 0.79])
        return candidate, fallback, flat, height, foreground

    def constrain(self, candidate, fallback, flat, height, foreground):
        return MODULE.BadgeStructureConstraintV1().constrain(
            candidate,
            fallback,
            flat,
            height,
            foreground,
            1,
            0.08,
            0.015,
            0.60,
            True,
            False,
        )

    def test_registration_and_schema_use_stable_daelab_identifier(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELAB.BadgeStructureConstraintV1"],
            MODULE.BadgeStructureConstraintV1,
        )
        required = MODULE.BadgeStructureConstraintV1.INPUT_TYPES()["required"]
        self.assertEqual(list(required), [
            "candidate_image",
            "fallback_image",
            "flat_image",
            "height_map",
            "foreground_mask",
            "edge_protection_px",
            "minimum_relief_contrast",
            "minimum_boundary_contrast",
            "minimum_boundary_coverage",
            "enforce_grayscale",
            "enforce_1024",
        ])

    def test_valid_candidate_is_grayscale_and_preserves_protected_pixels(self):
        candidate, fallback, flat, height, foreground = self.make_inputs()
        image, lightness, accepted, report_text = self.constrain(
            candidate, fallback, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertTrue(accepted, report)
        self.assertEqual(tuple(image.shape), tuple(candidate.shape))
        self.assertEqual(tuple(lightness.shape), tuple(foreground.shape))
        torch.testing.assert_close(image[..., 0], image[..., 1])
        torch.testing.assert_close(image[..., 1], image[..., 2])
        self.assertEqual(report["outside_max_abs_diff"], 0.0)
        self.assertEqual(report["protected_max_abs_diff"], 0.0)
        self.assertEqual(report["output_source"], "gpt_structure_candidate")
        self.assertGreaterEqual(report["observed_relief_contrast"], 0.08)
        self.assertGreaterEqual(report["observed_boundary_coverage"], 0.60)

    def test_flat_candidate_falls_back_to_deterministic_neutral_structure(self):
        _, fallback, flat, height, foreground = self.make_inputs()
        candidate = torch.ones_like(flat)
        candidate[foreground.unsqueeze(-1).expand_as(candidate) > 0.5] = 0.68
        image, _, accepted, report_text = self.constrain(
            candidate, fallback, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertFalse(accepted)
        self.assertEqual(report["fallback_reason"], "candidate_relief_signal_too_weak")
        self.assertEqual(report["output_source"], "deterministic_height_fallback")
        torch.testing.assert_close(image[..., 0], image[..., 1])

    def test_non_finite_candidate_falls_back_without_poisoning_output(self):
        candidate, fallback, flat, height, foreground = self.make_inputs()
        candidate[0, 24, 24, 0] = float("nan")
        image, _, accepted, report_text = self.constrain(
            candidate, fallback, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertFalse(accepted)
        self.assertIn("non-finite", report["fallback_reason"])
        self.assertTrue(bool(torch.isfinite(image).all()))

    def test_illegal_height_value_is_rejected(self):
        candidate, fallback, flat, height, foreground = self.make_inputs()
        height[:, 24:28, 24:28] = 0.33
        with self.assertRaisesRegex(ValueError, "outside"):
            self.constrain(candidate, fallback, flat, height, foreground)

    def test_enforce_1024_rejects_non_standard_required_inputs(self):
        candidate, fallback, flat, height, foreground = self.make_inputs()
        with self.assertRaisesRegex(ValueError, "1024x1024"):
            MODULE.BadgeStructureConstraintV1().constrain(
                candidate,
                fallback,
                flat,
                height,
                foreground,
                1,
                0.08,
                0.015,
                0.60,
                True,
                True,
            )


if __name__ == "__main__":
    unittest.main()
