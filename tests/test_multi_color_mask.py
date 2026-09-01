import importlib.util
import json
import pathlib
import unittest

import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "multi_color_mask" / "node.py"
SPEC = importlib.util.spec_from_file_location("multi_color_mask_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def metadata(config, node_id=2):
    return {
        "workflow": {
            "nodes": [
                {
                    "id": node_id,
                    "properties": {
                        MODULE.CONFIG_PROPERTY: json.dumps(config),
                    },
                }
            ]
        }
    }


class MultiColorMaskTests(unittest.TestCase):
    def test_invalid_config_falls_back_to_one_group_and_combined_output(self):
        config = MODULE._normalize_config("not-json")

        self.assertEqual(config, MODULE._default_config())
        self.assertEqual(len(config["groups"]), 1)

    def test_config_normalizes_shorthand_colors_limits_and_output(self):
        groups = [
            {"enabled": "false", "color": "#Fa0", "threshold": -8, "invert": "true"},
            {"color": "#123456", "threshold": 999},
        ]
        config = MODULE._normalize_config({"groups": groups, "output": "mask_2"})

        self.assertEqual(config["groups"][0], {
            "enabled": False,
            "color": "#ffaa00",
            "threshold": 0,
            "invert": True,
        })
        self.assertEqual(config["groups"][1]["threshold"], 255)
        self.assertEqual(config["output"], "mask_2")

    def test_selected_group_mask_uses_rmbg_rgb_distance_semantics(self):
        images = torch.tensor(
            [[[[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]]]],
            dtype=torch.float32,
        )
        config = {
            "groups": [
                {"enabled": True, "color": "#ff0000", "threshold": 0, "invert": False},
                {"enabled": True, "color": "#0000ff", "threshold": 0, "invert": False},
            ],
            "output": "mask_2",
        }

        result = MODULE.DAELabMultiColorMask().make_mask(
            images,
            unique_id=2,
            extra_pnginfo=metadata(config),
        )[0]

        torch.testing.assert_close(result, torch.tensor([[[0.0, 1.0, 0.0]]]))

    def test_combined_output_unions_only_enabled_groups(self):
        images = torch.tensor(
            [[[[255.0, 0.0, 0.0], [0.0, 0.0, 255.0], [0.0, 255.0, 0.0]]]],
            dtype=torch.float32,
        )
        config = {
            "groups": [
                {"enabled": True, "color": "#ff0000", "threshold": 0, "invert": False},
                {"enabled": False, "color": "#0000ff", "threshold": 0, "invert": False},
                {"enabled": True, "color": "#00ff00", "threshold": 0, "invert": False},
            ],
            "output": "combined_mask",
        }

        result = MODULE.DAELabMultiColorMask().make_mask(
            images,
            unique_id="2",
            extra_pnginfo=metadata(config),
        )[0]

        torch.testing.assert_close(result, torch.tensor([[[1.0, 0.0, 1.0]]]))

    def test_invert_applies_to_the_selected_mask(self):
        images = torch.tensor([[[[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]]], dtype=torch.float32)
        config = {
            "groups": [
                {"enabled": True, "color": "#ff0000", "threshold": 0, "invert": True},
            ],
            "output": "mask_1",
        }

        result = MODULE.DAELabMultiColorMask().make_mask(
            images,
            unique_id=2,
            extra_pnginfo=metadata(config),
        )[0]

        torch.testing.assert_close(result, torch.tensor([[[0.0, 1.0]]]))

    def test_rejects_non_comfy_image_shapes(self):
        with self.assertRaisesRegex(ValueError, "shape"):
            MODULE._make_masks(torch.zeros((8, 8, 3)), MODULE._default_config())

    def test_cache_fingerprint_changes_with_persisted_config(self):
        image = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
        first = MODULE.DAELabMultiColorMask.IS_CHANGED(
            image,
            unique_id=2,
            extra_pnginfo=metadata(MODULE._default_config()),
        )
        changed = MODULE._default_config()
        changed["groups"][0]["threshold"] = 31
        second = MODULE.DAELabMultiColorMask.IS_CHANGED(
            image,
            unique_id=2,
            extra_pnginfo=metadata(changed),
        )

        self.assertNotEqual(first, second)

    def test_registration_uses_stable_daelab_node_id(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELabMultiColorMask"],
            MODULE.DAELabMultiColorMask,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["DAELabMultiColorMask"],
            "Multi Color Mask (DAELab)",
        )


if __name__ == "__main__":
    unittest.main()
