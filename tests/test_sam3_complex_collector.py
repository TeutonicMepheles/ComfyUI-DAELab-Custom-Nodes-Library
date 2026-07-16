import importlib.util
import json
import pathlib
import sys
import types
import unittest


class RoutesStub:
    def post(self, _path):
        return lambda function: function


class PromptQueueStub:
    def __init__(self):
        self.remaining = 0

    def get_tasks_remaining(self):
        return self.remaining


prompt_server_instance = types.SimpleNamespace(routes=RoutesStub(), prompt_queue=PromptQueueStub())
server_stub = types.ModuleType("server")
server_stub.PromptServer = types.SimpleNamespace(instance=prompt_server_instance)
sys.modules.setdefault("server", server_stub)


shared_stub = types.ModuleType("daelab_test.nodes._shared_sam3")
shared_stub._empty_mask_for_image = lambda image: "empty-mask"
shared_stub._has_sam3_prompt_content = lambda prompts: any(
    prompt.get(key)
    for prompt in prompts
    if isinstance(prompt, dict)
    for key in ("positive_points", "negative_points", "positive_boxes", "negative_boxes")
)
shared_stub._pil_to_base64 = lambda image: f"base64:{image}"
shared_stub._pil_to_tensor = lambda image: image
shared_stub._prepare_sam3_session = lambda config, image: {"config": config, "image": image}
shared_stub._render_sam3_session_results = lambda session, masks, scores: (masks, scores, "overlay")
shared_stub._run_sam3_session_prompts = lambda session, prompts: ([prompts[0]["id"]], [0.9])
shared_stub._tensor_to_pil = lambda image: image


for package_name in ("daelab_test", "daelab_test.nodes", "daelab_test.nodes.sam3_complex_collector"):
    package = types.ModuleType(package_name)
    package.__path__ = []
    sys.modules.setdefault(package_name, package)
sys.modules["daelab_test.nodes._shared_sam3"] = shared_stub


NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "sam3_complex_collector" / "node.py"
SPEC = importlib.util.spec_from_file_location("daelab_test.nodes.sam3_complex_collector.node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def prompt(prompt_id, x=1, name="Prompt"):
    return {
        "id": prompt_id,
        "name": name,
        "positive_points": [{"x": x, "y": 2}],
        "negative_points": [],
        "positive_boxes": [],
        "negative_boxes": [],
    }


class SAM3ComplexCollectorCacheTests(unittest.TestCase):
    def setUp(self):
        MODULE._SESSION_CACHE.clear()
        self.original_run_prompts = MODULE._run_sam3_session_prompts

    def tearDown(self):
        MODULE._run_sam3_session_prompts = self.original_run_prompts

    def test_prompt_fingerprint_tracks_geometry_not_label(self):
        first = prompt("one", name="First")
        renamed = prompt("different-id", name="Renamed")
        moved = prompt("one", x=9)

        self.assertEqual(MODULE._prompt_fingerprint(first), MODULE._prompt_fingerprint(renamed))
        self.assertNotEqual(MODULE._prompt_fingerprint(first), MODULE._prompt_fingerprint(moved))

    def test_session_cache_is_lru_bounded(self):
        first = MODULE._store_session({"name": "first"}, {})
        second = MODULE._store_session({"name": "second"}, {})
        MODULE._get_session(first)
        third = MODULE._store_session({"name": "third"}, {})

        self.assertIn(first, MODULE._SESSION_CACHE)
        self.assertNotIn(second, MODULE._SESSION_CACHE)
        self.assertIn(third, MODULE._SESSION_CACHE)

    def test_expired_session_is_removed(self):
        token = MODULE._store_session({"name": "old"}, {})
        MODULE._SESSION_CACHE[token]["last_access"] = 0

        MODULE._prune_session_cache(now=MODULE._SESSION_CACHE_TTL_SECONDS + 1)

        self.assertNotIn(token, MODULE._SESSION_CACHE)

    def test_segment_reconciles_deleted_and_changed_prompts(self):
        old_a = prompt("a", x=1)
        old_b = prompt("b", x=2)
        entry = {
            "session": {},
            "prompt_results": {
                "a": {"fingerprint": MODULE._prompt_fingerprint(old_a), "masks": ["old-a"], "scores": [0.1]},
                "b": {"fingerprint": MODULE._prompt_fingerprint(old_b), "masks": ["old-b"], "scores": [0.2]},
            },
            "last_access": 0,
        }
        changed_a = prompt("a", x=7)
        active_c = prompt("c", x=3)

        result = MODULE._segment_cached_prompt(entry, [changed_a, active_c], "c")

        self.assertNotIn("b", entry["prompt_results"])
        self.assertNotIn("a", entry["prompt_results"])
        self.assertEqual(entry["prompt_results"]["c"]["masks"], ["c"])
        self.assertEqual(result, {"overlay": "base64:overlay", "num_masks": 1, "computed_masks": 1})

    def test_bbox_prompts_preserve_stable_ids_and_negative_boxes(self):
        prompts = MODULE._bbox_store_to_prompts(
            json.dumps([
                {"id": "stable", "x1": 1, "y1": 2, "x2": 10, "y2": 20},
                {"x1": 3, "y1": 4, "x2": 12, "y2": 24},
            ]),
            json.dumps([{"x1": 5, "y1": 6, "x2": 8, "y2": 9}]),
        )

        self.assertEqual([item["id"] for item in prompts], ["bbox:stable", "bbox:legacy-1"])
        self.assertEqual(prompts[0]["positive_boxes"][0], {"x1": 1.0, "y1": 2.0, "x2": 10.0, "y2": 20.0})
        self.assertEqual(prompts[0]["negative_boxes"], prompts[1]["negative_boxes"])

    def test_batch_scope_reuses_unchanged_prompts(self):
        cached = prompt("bbox:a", x=1)
        added = prompt("bbox:b", x=2)
        calls = []
        MODULE._run_sam3_session_prompts = lambda session, prompts: (calls.append(prompts[0]["id"]) or [prompts[0]["id"]], [0.9])
        entry = {
            "session": {},
            "prompt_results": {
                "bbox:a": {
                    "fingerprint": MODULE._prompt_fingerprint(cached),
                    "masks": ["bbox:a"],
                    "scores": [0.8],
                },
            },
            "last_access": 0,
        }

        result = MODULE._segment_cached_prompt(entry, [cached, added], run_scope="all")

        self.assertEqual(calls, ["bbox:b"])
        self.assertEqual(result["num_masks"], 2)
        self.assertEqual(result["computed_masks"], 1)

    def test_negative_box_change_recomputes_all_bbox_prompts(self):
        first = prompt("bbox:a", x=1)
        second = prompt("bbox:b", x=2)
        for item in (first, second):
            item["negative_boxes"] = [{"x1": 1, "y1": 1, "x2": 4, "y2": 4}]
        entry = {
            "session": {},
            "prompt_results": {
                item["id"]: {
                    "fingerprint": MODULE._prompt_fingerprint(item),
                    "masks": [item["id"]],
                    "scores": [0.8],
                }
                for item in (first, second)
            },
            "last_access": 0,
        }
        changed = json.loads(json.dumps([first, second]))
        for item in changed:
            item["negative_boxes"][0]["x2"] = 9
        calls = []
        MODULE._run_sam3_session_prompts = lambda session, prompts: (calls.append(prompts[0]["id"]) or [prompts[0]["id"]], [0.9])

        result = MODULE._segment_cached_prompt(entry, changed, run_scope="all")

        self.assertEqual(calls, ["bbox:a", "bbox:b"])
        self.assertEqual(result["computed_masks"], 2)

    def test_node_is_partial_execution_target(self):
        schema = MODULE.SAM3ComplexCollector.INPUT_TYPES()

        self.assertTrue(MODULE.SAM3ComplexCollector.OUTPUT_NODE)
        self.assertEqual(schema["hidden"]["unique_id"], "UNIQUE_ID")

    def test_execute_returns_cache_token_for_interactive_prompt(self):
        result = MODULE.SAM3ComplexCollector().execute(
            "model-config",
            ["image"],
            collector_mode=MODULE.COLLECTOR_MODE_INTERACTIVE,
            multi_prompts_store=json.dumps([prompt("interactive")]),
            unique_id="node-7",
        )

        self.assertEqual(result["result"], (["interactive"], [0.9]))
        self.assertEqual(result["ui"]["overlay_image"], ["base64:overlay"])
        self.assertEqual(len(result["ui"]["cache_token"][0]), 32)


if __name__ == "__main__":
    unittest.main()
