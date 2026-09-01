import importlib.util
import json
import pathlib
import unittest

import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_height_layer" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_height_layer_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def metadata(config, node_id=7):
    return {
        "workflow": {
            "nodes": [
                {
                    "id": node_id,
                    "properties": {MODULE.CONFIG_PROPERTY: json.dumps(config)},
                }
            ]
        }
    }


class BadgeHeightLayerTests(unittest.TestCase):
    def test_invalid_config_falls_back_to_one_group(self):
        self.assertEqual(MODULE._normalize_config("not-json"), MODULE._default_config())

    def test_config_normalizes_color_threshold_and_layer(self):
        config = MODULE._normalize_config({
            "groups": [{
                "enabled": "false",
                "color": "#Fa0",
                "threshold": 999,
                "layer": "Cut Out (0.0)",
            }]
        })
        self.assertEqual(config["groups"][0], {
            "enabled": False,
            "color": "#ffaa00",
            "threshold": 255,
            "layer": 0,
        })

    def test_layers_use_fixed_one_fifth_steps(self):
        image = torch.tensor([[[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]]])
        config = {
            "groups": [
                {"enabled": True, "color": "#ff0000", "threshold": 0, "layer": 1},
                {"enabled": True, "color": "#00ff00", "threshold": 0, "layer": 3},
                {"enabled": True, "color": "#0000ff", "threshold": 0, "layer": 5},
            ]
        }
        height, image_output, unmatched = MODULE._make_height_map(image, MODULE._normalize_config(config))
        torch.testing.assert_close(height, torch.tensor([[[0.2, 0.6, 1.0]]]))
        torch.testing.assert_close(image_output[..., 0], height)
        torch.testing.assert_close(image_output[..., 1], height)
        torch.testing.assert_close(unmatched, torch.zeros_like(height))

    def test_closest_color_wins_when_thresholds_overlap(self):
        image = torch.tensor([[[[0.48, 0.0, 0.0]]]])
        config = MODULE._normalize_config({
            "groups": [
                {"color": "#660000", "threshold": 100, "layer": 2},
                {"color": "#800000", "threshold": 100, "layer": 5},
            ]
        })
        height, _, unmatched = MODULE._make_height_map(image, config)
        torch.testing.assert_close(height, torch.tensor([[[1.0]]]))
        torch.testing.assert_close(unmatched, torch.zeros_like(height))

    def test_profile_counts_only_the_final_overlap_winner(self):
        image = torch.tensor([[[[0.48, 0.0, 0.0]]]])
        config = MODULE._normalize_config({
            "groups": [
                {"color": "#660000", "threshold": 100, "layer": 2},
                {"color": "#800000", "threshold": 100, "layer": 5},
            ]
        })
        _, _, _, profile = MODULE._make_height_map_with_profile(image, config)
        self.assertEqual(profile["present_layers"], [5])
        self.assertEqual(profile["missing_layers"], [2])
        self.assertEqual(profile["layer_counts"], {"2": 0, "5": 1})

    def test_unmatched_pixels_remain_cutout_and_are_reported(self):
        image = torch.tensor([[[[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]]]])
        config = MODULE._normalize_config({
            "groups": [{"color": "#000000", "threshold": 0, "layer": 4}]
        })
        height, _, unmatched = MODULE._make_height_map(image, config)
        torch.testing.assert_close(height, torch.tensor([[[0.8, 0.0]]]))
        torch.testing.assert_close(unmatched, torch.tensor([[[0.0, 1.0]]]))

    def test_rgba_transparency_forces_cutout(self):
        image = torch.tensor([[[[1.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 1.0]]]])
        config = MODULE._normalize_config({
            "groups": [{"color": "#ff0000", "threshold": 0, "layer": 5}]
        })
        height, _, unmatched = MODULE._make_height_map(image, config)
        torch.testing.assert_close(height, torch.tensor([[[0.0, 1.0]]]))
        torch.testing.assert_close(unmatched, torch.zeros_like(height))

    def test_profile_distinguishes_configured_present_and_empty_layers(self):
        image = torch.tensor([[[[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]]])
        config = MODULE._normalize_config({
            "groups": [
                {"color": "#ff0000", "threshold": 0, "layer": 1},
                {"color": "#00ff00", "threshold": 0, "layer": 3},
                {"color": "#0000ff", "threshold": 0, "layer": 5},
            ]
        })
        _, _, _, profile = MODULE._make_height_map_with_profile(image, config)
        self.assertEqual(profile["configured_layers"], [1, 3, 5])
        self.assertEqual(profile["present_layers"], [1, 5])
        self.assertEqual(profile["missing_layers"], [3])
        self.assertEqual(profile["layer_counts"], {"1": 1, "3": 0, "5": 1})
        self.assertEqual(profile["alpha_values"], {"1": 0.2, "5": 1.0})

    def test_transparency_does_not_claim_an_explicit_cutout_level(self):
        image = torch.tensor([[[[1.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 1.0]]]])
        config = MODULE._normalize_config({
            "groups": [{"color": "#ff0000", "threshold": 0, "layer": 5}]
        })
        _, _, _, profile = MODULE._make_height_map_with_profile(image, config)
        self.assertEqual(profile["present_layers"], [5])
        self.assertEqual(profile["transparent_pixels"], 1)

    def test_prompt_lists_only_layers_that_reached_final_pixels(self):
        profile = {
            "version": 1,
            "configured_layers": [0, 1, 3, 5],
            "present_layers": [0, 1, 5],
            "missing_layers": [3],
            "layer_counts": {"0": 2, "1": 4, "3": 0, "5": 3},
            "unmatched_pixels": 1,
            "transparent_pixels": 10,
        }
        prompt = MODULE.build_height_establish_prompt(profile)
        report = MODULE.build_height_profile_report(profile)
        self.assertIn("exactly 2 matched solid height levels", prompt)
        self.assertIn("Alpha/grayscale 0.0: Cut Out", prompt)
        self.assertIn("Alpha/grayscale 0.2: Layer 1", prompt)
        self.assertIn("Alpha/grayscale 1.0: Layer 5", prompt)
        self.assertNotIn("Alpha/grayscale 0.6: Layer 3", prompt)
        self.assertIn("Do not invent missing layers", prompt)
        self.assertIn("MANDATORY NUMERIC HEIGHT ENCODING — NON-NEGOTIABLE", prompt)
        self.assertIn("Z = Alpha = grayscale / 255", prompt)
        self.assertIn("51/255 = 0.2 = Layer 1", prompt)
        self.assertIn("255/255 = 1.0 = Layer 5", prompt)
        self.assertIn("A numerically larger encoded value MUST always be physically higher", prompt)
        self.assertIn("Do not reorder, invert, normalize, rescale, compress, smooth, blend, interpolate", prompt)
        self.assertIn("Every Alpha/grayscale 0.0 region in Image 2 represents empty space", prompt)
        self.assertIn("must remain a true through-cut opening", prompt)
        self.assertIn("do not fill, cap, bridge, emboss, or place material across it", prompt)
        self.assertNotIn("material semantics", prompt.lower())
        self.assertIn("Configured but empty: Layer 3 (0.6)", report)

    def test_prompt_builder_rejects_profile_without_solid_pixels(self):
        with self.assertRaisesRegex(ValueError, "no matched solid height level"):
            MODULE.build_height_establish_prompt({
                "version": 1,
                "configured_layers": [0],
                "present_layers": [0],
                "missing_layers": [],
                "layer_counts": {"0": 4},
            })

    def test_registration_uses_stable_node_id(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELabBadgeHeightLayer"],
            MODULE.DAELabBadgeHeightLayer,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["DAELabBadgeHeightLayer"],
            "Badge Height Layer (DAELab)",
        )
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["BadgeHeightEstablishPromptBuilder"],
            MODULE.BadgeHeightEstablishPromptBuilder,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["BadgeHeightEstablishPromptBuilder"],
            "Badge Height Establish Prompt Builder",
        )


if __name__ == "__main__":
    unittest.main()
