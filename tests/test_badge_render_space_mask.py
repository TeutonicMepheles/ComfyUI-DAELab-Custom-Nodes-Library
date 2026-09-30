import importlib.util
import json
import pathlib
import unittest

import cv2
import numpy as np
import torch


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_render_space_mask" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_render_space_mask_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BadgeRenderSpaceMaskTests(unittest.TestCase):
    def make_fixture(self, size=96):
        source = np.ones((size, size, 3), dtype=np.float32)
        foreground = np.zeros((size, size), dtype=np.uint8)
        cv2.circle(foreground, (48, 48), 30, 1, -1)
        cv2.circle(foreground, (48, 48), 10, 0, -1)
        region = np.zeros_like(foreground)
        region[30:48, 28:48] = foreground[30:48, 28:48]
        source[foreground > 0] = np.array([0.12, 0.58, 0.42], np.float32)
        source[region > 0] = np.array([0.72, 0.18, 0.22], np.float32)
        matrix = cv2.getRotationMatrix2D((48, 48), 4.0, 1.05)
        matrix[0, 2] += 5.0
        matrix[1, 2] -= 3.0
        target = np.zeros_like(source)
        target[:] = np.array([0.95, 0.05, 0.60], np.float32)
        warped_foreground = cv2.warpAffine(foreground, matrix, (size, size), flags=cv2.INTER_NEAREST)
        warped_region = cv2.warpAffine(region, matrix, (size, size), flags=cv2.INTER_NEAREST)
        target[warped_foreground > 0] = np.array([0.08, 0.43, 0.34], np.float32)
        target[warped_region > 0] = np.array([0.82, 0.56, 0.18], np.float32)
        return tuple(torch.from_numpy(value).unsqueeze(0) for value in (
            source, target, foreground.astype(np.float32), region.astype(np.float32),
            warped_foreground.astype(np.float32), warped_region.astype(np.float32),
        ))

    def test_registers_region_to_render_space_and_preserves_hole(self):
        source, target, foreground, region, expected_foreground, expected_region = self.make_fixture()
        result = MODULE.BadgeRenderSpaceMaskAlignV1().align(
            source,
            target,
            foreground,
            region,
            "auto_border",
            24.0,
            8.0,
            0.20,
            3,
            0,
            0.70,
        )
        report = json.loads(result[5])
        self.assertTrue(report["valid"], report)
        self.assertGreater(report["candidate_iou"], 0.90)
        self.assertGreater(MODULE._iou(result[0][0].numpy(), expected_foreground[0].numpy()), 0.94)
        self.assertGreater(MODULE._iou(result[1][0].numpy(), expected_region[0].numpy()), 0.88)
        self.assertEqual(float(result[0][0, 45, 53]), 0.0)
        self.assertEqual(tuple(result[3].shape), tuple(target.shape))
        self.assertEqual(tuple(result[4].shape), tuple(target.shape))
        self.assertEqual(tuple(result[6].shape), tuple(target.shape))
        self.assertEqual(tuple(result[8].shape), tuple(source.shape))
        palette = json.loads(result[7])
        self.assertGreaterEqual(len(palette["regions"]), 2)
        self.assertEqual(palette["background"], "#000000")
        colors = {entry["color"] for entry in palette["regions"]}
        self.assertEqual(len(colors), len(palette["regions"]))
        first_rgb = torch.tensor([1.0, 23.0 / 255.0, 68.0 / 255.0])
        exact_first = torch.all(torch.isclose(result[6][0], first_rgb, atol=1e-6), dim=-1)
        self.assertGreater(int(exact_first.sum()), 0)

    def test_source_prior_only_is_explicitly_reported_as_fallback(self):
        source, target, foreground, region, _, _ = self.make_fixture()
        result = MODULE.BadgeRenderSpaceMaskAlignV1().align(
            source, target, foreground, region, "source_prior_only", 24.0, 8.0, 0.20, 3, 0, 0.70
        )
        report = json.loads(result[5])
        self.assertTrue(report["extraction_fallback"])
        self.assertFalse(report["valid"])

    def test_disconnected_blocks_receive_distinct_color_region_ids(self):
        labels = np.zeros((32, 32), dtype=np.int32)
        labels[3:12, 3:12] = 1
        labels[20:29, 20:29] = 1
        split, clusters = MODULE._split_disconnected_regions(labels, 1, 16, 16)
        self.assertEqual(set(np.unique(split)), {0, 1, 2})
        self.assertEqual(clusters, [0, 0])

    def test_same_source_color_keeps_one_id_when_disconnected_splitting_is_off(self):
        source = np.ones((48, 48, 3), dtype=np.float32)
        foreground = np.zeros((48, 48), dtype=np.uint8)
        foreground[4:20, 4:20] = 1
        foreground[28:44, 28:44] = 1
        source[foreground > 0] = np.array([0.8, 0.1, 0.2], np.float32)
        labels, _ = MODULE._deterministic_color_labels(source, foreground, 8, 0)
        self.assertEqual(set(np.unique(labels)), {0, 1})
        self.assertEqual(int(labels[10, 10]), int(labels[34, 34]))

    def test_target_edge_snap_cannot_change_region_interior(self):
        labels = np.zeros((48, 48), dtype=np.int32)
        labels[4:44, 4:24] = 1
        labels[4:44, 24:44] = 2
        foreground = labels > 0
        target = np.zeros((48, 48, 3), dtype=np.float32)
        target[:, :34] = 0.1
        target[:, 34:] = 0.9
        snapped = MODULE._snap_color_labels(labels, target, foreground, 1, 3)
        self.assertEqual(int(snapped[20, 12]), 1)
        self.assertEqual(int(snapped[20, 36]), 2)

    def test_node_registration_is_stable(self):
        inputs = MODULE.BadgeRenderSpaceMaskAlignV1.INPUT_TYPES()["required"]
        self.assertFalse(inputs["split_disconnected_regions"][1]["default"])
        self.assertEqual(inputs["maximum_color_regions"][1]["default"], 32)
        self.assertEqual(inputs["id_map_basis"][0][0], "target_appearance")
        self.assertEqual(
            set(MODULE.NODE_CLASS_MAPPINGS),
            {"DAELAB.BadgeRenderSpaceMaskAlignV1"},
        )


if __name__ == "__main__":
    unittest.main()
