import importlib.util
import json
import pathlib
import unittest

import torch
import torch.nn.functional as F


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

    def render_geometry(self, flat, height, foreground):
        return MODULE.BadgeReliefGeometryV1().render(
            flat,
            height,
            foreground,
            7,
            1.0,
            11.0,
            0.72,
            0.34,
            0.07,
            28.0,
            0.10,
            10,
            -135.0,
            45.0,
            False,
        )

    def transfer(self, candidate, geometry, flat, height, foreground, minimum_edge_coverage=0.0):
        return MODULE.BadgeGPTStructureTransferV1().transfer(
            candidate,
            geometry,
            flat,
            height,
            foreground,
            0.40,
            0.24,
            1,
            8,
            0.05,
            minimum_edge_coverage,
            False,
        )

    def test_registration_and_schema_use_stable_daelab_identifier(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELAB.BadgeReliefGeometryV1"],
            MODULE.BadgeReliefGeometryV1,
        )
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELAB.BadgeGPTStructureTransferV1"],
            MODULE.BadgeGPTStructureTransferV1,
        )
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

    def test_relief_geometry_builds_wide_bevel_normals_and_contact_occlusion(self):
        _, _, flat, height, foreground = self.make_inputs()
        relief, lightness, normal, ao, beveled, report_text = self.render_geometry(
            flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertEqual(tuple(relief.shape), tuple(flat.shape))
        self.assertEqual(tuple(lightness.shape), tuple(height.shape))
        self.assertEqual(tuple(normal.shape), tuple(flat.shape))
        self.assertEqual(tuple(ao.shape), tuple(height.shape))
        self.assertEqual(tuple(beveled.shape), tuple(height.shape))
        self.assertTrue(bool(torch.isfinite(relief).all()))
        self.assertGreater(int(((beveled - height).abs() > 1e-4).sum().item()), 100)
        self.assertGreater(float(ao.max().item()), 0.05)
        self.assertGreater(float(normal[..., :2].std().item()), 0.01)
        outside = (~(foreground > 0.5)).unsqueeze(-1).expand_as(relief)
        torch.testing.assert_close(relief[outside], torch.ones_like(relief[outside]))
        self.assertEqual(report["bevel_radius_px"], 7)
        self.assertTrue(report["deterministic"])

    def test_transfer_resizes_candidate_preserves_color_and_locks_boundaries(self):
        _, _, flat, height, foreground = self.make_inputs()
        geometry, geometry_light, *_ = self.render_geometry(flat, height, foreground)
        candidate = geometry_light.unsqueeze(-1).repeat(1, 1, 1, 3)
        candidate = F.interpolate(
            candidate.permute(0, 3, 1, 2),
            size=(80, 80),
            mode="bicubic",
            align_corners=False,
        ).permute(0, 2, 3, 1).clamp(0.0, 1.0)
        fused, _, accepted, aligned, detail, report_text = self.transfer(
            candidate, geometry, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertTrue(accepted, report)
        self.assertTrue(report["candidate_resized"])
        self.assertEqual(report["candidate_original_size"], [80, 80])
        self.assertEqual(tuple(fused.shape), tuple(flat.shape))
        self.assertEqual(tuple(aligned.shape), tuple(flat.shape))
        self.assertEqual(tuple(detail.shape), tuple(flat.shape))
        fused_lab = MODULE._rgb_to_oklab(fused)
        flat_lab = MODULE._rgb_to_oklab(flat)
        color_error = (fused_lab[..., 1:] - flat_lab[..., 1:]).abs()[
            foreground.unsqueeze(-1).expand_as(fused_lab[..., 1:]) > 0.5
        ]
        self.assertLess(float(color_error.mean().item()), 0.02)
        self.assertEqual(report["outside_max_abs_diff"], 0.0)
        self.assertEqual(report["locked_max_abs_diff"], 0.0)

    def test_transfer_estimates_small_candidate_translation(self):
        _, _, flat, height, foreground = self.make_inputs()
        geometry, geometry_light, *_ = self.render_geometry(flat, height, foreground)
        candidate = geometry_light.unsqueeze(-1).repeat(1, 1, 1, 3)
        candidate = MODULE._shift_single(candidate[0], 3, 2, 1.0).unsqueeze(0)
        _, _, accepted, _, _, report_text = self.transfer(
            candidate, geometry, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertTrue(accepted, report)
        self.assertNotEqual(report["translations"][0], {"x": 0, "y": 0})

    def test_transfer_rejects_flat_candidate_and_uses_geometry_fallback(self):
        _, _, flat, height, foreground = self.make_inputs()
        geometry, *_ = self.render_geometry(flat, height, foreground)
        candidate = torch.full_like(flat, 0.68)
        fused, _, accepted, _, _, report_text = self.transfer(
            candidate, geometry, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertFalse(accepted)
        self.assertEqual(report["fallback_reason"], "candidate_relief_signal_too_weak")
        torch.testing.assert_close(fused, geometry)

    def test_valid_candidate_restores_flat_color_and_preserves_protected_pixels(self):
        candidate, fallback, flat, height, foreground = self.make_inputs()
        image, lightness, accepted, report_text = self.constrain(
            candidate, fallback, flat, height, foreground
        )
        report = json.loads(report_text)
        self.assertTrue(accepted, report)
        self.assertEqual(tuple(image.shape), tuple(candidate.shape))
        self.assertEqual(tuple(lightness.shape), tuple(foreground.shape))
        self.assertGreater(float((image[..., 1] - image[..., 0]).abs().max().item()), 0.1)
        source_pixel = flat[0, 12, 12]
        output_pixel = image[0, 12, 12]
        channel_ratios = output_pixel / source_pixel
        torch.testing.assert_close(channel_ratios, channel_ratios.mean().expand_as(channel_ratios))
        self.assertEqual(report["outside_max_abs_diff"], 0.0)
        self.assertEqual(report["protected_max_abs_diff"], 0.0)
        self.assertEqual(report["output_source"], "gpt_structure_candidate")
        self.assertTrue(report["grayscale_candidate_forced"])
        self.assertTrue(report["flat_color_restored"])
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
        torch.testing.assert_close(image, fallback)

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

    def test_legacy_constraint_resizes_non_standard_candidate_instead_of_falling_back(self):
        candidate, fallback, flat, height, foreground = self.make_inputs()
        candidate = F.interpolate(
            candidate.permute(0, 3, 1, 2),
            size=(80, 80),
            mode="bicubic",
            align_corners=False,
        ).permute(0, 2, 3, 1)
        _, _, accepted, report_text = self.constrain(candidate, fallback, flat, height, foreground)
        report = json.loads(report_text)
        self.assertTrue(accepted, report)
        self.assertTrue(report["candidate_resized"])
        self.assertEqual(report["candidate_original_size"], [80, 80])

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
