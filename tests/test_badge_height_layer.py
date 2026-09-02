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


def v1_metadata(config, node_id=17):
    return {
        "workflow": {
            "nodes": [
                {
                    "id": node_id,
                    "properties": {MODULE.V1_CONFIG_PROPERTY: json.dumps(config)},
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
        self.assertIn("Do not invent missing semantic layers", prompt)
        self.assertIn("OUTPUT REQUIREMENT — NEUTRAL GRAYSCALE RELIEF PROOF", prompt)
        self.assertIn("same neutral, uncolored matte base", prompt)
        self.assertIn("Do not reproduce any hue from Image 1", prompt)
        self.assertIn("not a replacement numeric height map", prompt)
        self.assertNotIn("and base colors", prompt)
        self.assertIn("CONTOUR PRIORITY — MANDATORY", prompt)
        self.assertIn("complete outer perimeter rim or outline", prompt)
        self.assertIn("highest active solid height level", prompt)
        self.assertIn("only permitted semantic override to Image 2", prompt)
        self.assertIn("does not promote broad filled motifs", prompt)
        self.assertIn("never razor-sharp or knife-edged", prompt)
        self.assertIn("BOUNDARY AND REGION-INTERIOR PROFILE", prompt)
        self.assertIn("crisp and accurately positioned in the XY plane", prompt)
        self.assertIn("continuous, planar or gently crowned like manufacturable coin relief", prompt)
        self.assertIn("small rounded fillet or restrained bevel", prompt)
        self.assertIn("Broad solid motifs must not become block-like miniature objects", prompt)
        self.assertIn("NOMINAL NUMERIC HEIGHT ENCODING — MANDATORY", prompt)
        self.assertIn("nominal Z = Alpha = grayscale / 255", prompt)
        self.assertIn("51/255 = 0.2 = Layer 1", prompt)
        self.assertIn("255/255 = 1.0 = Layer 5", prompt)
        self.assertIn("A numerically larger encoded value must always be physically higher", prompt)
        self.assertIn("Except for the explicit contour-priority promotion", prompt)
        self.assertIn("Local interpolation is allowed only within narrow transition bands", prompt)
        self.assertNotIn("Do not reorder, invert, normalize, rescale, compress, smooth, blend, interpolate", prompt)
        self.assertNotIn("For every pixel inside the Image 1 badge graphic", prompt)
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

    def test_v1_filters_legacy_disabled_groups_and_forces_active_groups(self):
        config = MODULE._normalize_v1_config({
            "groups": [
                {"enabled": False, "color": "#ff0000", "threshold": 0, "layer": 5},
                {"enabled": True, "color": "#00ff00", "threshold": 10, "layer": 2},
                {"color": "#0000ff", "threshold": 20, "layer": 4},
            ]
        })
        self.assertEqual(config["groups"], [
            {"id": "height_legacy_2", "color": "#00ff00", "threshold": 10, "layer": 2},
            {"id": "height_legacy_3", "color": "#0000ff", "threshold": 20, "layer": 4},
        ])

    def test_v1_reads_its_independent_property_and_preserves_outputs(self):
        image = torch.tensor([[[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]]])
        config = {
            "version": 1,
            "groups": [
                {"id": "low", "color": "#ff0000", "threshold": 0, "layer": 1},
                {"id": "high", "color": "#00ff00", "threshold": 0, "layer": 5},
            ],
        }
        node = MODULE.DAELabBadgeHeightLayerV1()
        height, image_output, unmatched, profile, applied, digest, report = node.make_height_map(
            image,
            unique_id=17,
            extra_pnginfo=v1_metadata(config),
        )
        torch.testing.assert_close(height, torch.tensor([[[0.2, 1.0]]]))
        torch.testing.assert_close(image_output[..., 0], height)
        torch.testing.assert_close(unmatched, torch.zeros_like(height))
        self.assertEqual(profile["present_layers"], [1, 5])
        self.assertEqual(applied, MODULE.encode_v1_config(config))
        self.assertEqual(digest, MODULE.v1_config_digest(config))
        self.assertIn("low: color=#ff0000, threshold=0, layer=1, height=0.2", report)

    def test_v1_explicit_prompt_config_overrides_stale_workflow_property(self):
        image = torch.tensor([[[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]]])
        stale = {
            "groups": [
                {"id": "old", "color": "#ff0000", "threshold": 0, "layer": 1},
            ],
        }
        current = {
            "groups": [
                {"id": "new-red", "color": "#ff0000", "threshold": 0, "layer": 5},
                {"id": "new-green", "color": "#00ff00", "threshold": 0, "layer": 3},
            ],
        }
        encoded = MODULE.encode_v1_config(current)
        outputs = MODULE.DAELabBadgeHeightLayerV1().make_height_map(
            image,
            height_layer_config=encoded,
            unique_id=17,
            extra_pnginfo=v1_metadata(stale),
        )
        torch.testing.assert_close(outputs[0], torch.tensor([[[1.0, 0.6]]]))
        self.assertEqual(outputs[4], encoded)
        self.assertEqual(outputs[5], MODULE.v1_config_digest(current))

    def test_v1_cache_key_changes_with_explicit_config(self):
        first = MODULE.encode_v1_config({
            "groups": [{"id": "a", "color": "#ff0000", "threshold": 0, "layer": 1}],
        })
        second = MODULE.encode_v1_config({
            "groups": [{"id": "a", "color": "#ff0000", "threshold": 0, "layer": 5}],
        })
        self.assertNotEqual(
            MODULE.DAELabBadgeHeightLayerV1.IS_CHANGED(None, first),
            MODULE.DAELabBadgeHeightLayerV1.IS_CHANGED(None, second),
        )

    def test_v1_schema_exposes_explicit_config_and_backend_echoes(self):
        schema = MODULE.DAELabBadgeHeightLayerV1.INPUT_TYPES()
        self.assertIn(MODULE.V1_CONFIG_INPUT, schema["optional"])
        self.assertEqual(MODULE.DAELabBadgeHeightLayerV1.RETURN_NAMES[:4], (
            "height_mask", "height_image", "unmatched_mask", "height_profile",
        ))
        self.assertEqual(MODULE.DAELabBadgeHeightLayerV1.RETURN_NAMES[4:], (
            "applied_config", "config_digest", "config_report",
        ))

    def test_v1_registration_does_not_replace_the_legacy_node(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELabBadgeHeightLayerV1"],
            MODULE.DAELabBadgeHeightLayerV1,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["DAELabBadgeHeightLayerV1"],
            "Badge Height Layer V1 (DAELab)",
        )
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELabBadgeHeightLayer"],
            MODULE.DAELabBadgeHeightLayer,
        )


if __name__ == "__main__":
    unittest.main()
