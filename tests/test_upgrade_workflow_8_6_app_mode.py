import importlib.util
import json
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).parents[3]
WORKFLOW_PATH = ROOT / "user" / "default" / "workflows" / "#8.6 - Badge Workflow.json"
UPGRADE_PATH = ROOT / "tools" / "upgrade_workflow_8_6_app_mode.py"


def load_upgrade_module():
    spec = importlib.util.spec_from_file_location("upgrade_workflow_8_6_app_mode", UPGRADE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class Badge86AppLayoutUpgradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upgrade = load_upgrade_module()
        cls.workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))

    def write_temp_workflow(self, workflow):
        directory = tempfile.TemporaryDirectory()
        path = pathlib.Path(directory.name) / "workflow.json"
        path.write_text(json.dumps(workflow, ensure_ascii=False), encoding="utf-8")
        return directory, path

    def test_upgrade_only_adds_layout_metadata_and_is_idempotent(self):
        source = json.loads(json.dumps(self.workflow))
        source["extra"].pop("daelabAppLayoutV1", None)
        before = json.loads(json.dumps(source))
        directory, path = self.write_temp_workflow(source)
        try:
            self.assertTrue(self.upgrade.update_workflow(path))
            upgraded = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(upgraded["nodes"], before["nodes"])
            self.assertEqual(upgraded["links"], before["links"])
            self.assertEqual(upgraded["groups"], before["groups"])
            self.assertEqual(upgraded["extra"]["linearData"], before["extra"]["linearData"])
            self.assertEqual(upgraded["revision"], before["revision"])
            self.assertIn("daelabAppLayoutV1", upgraded["extra"])
            self.assertFalse(self.upgrade.update_workflow(path))
        finally:
            directory.cleanup()

    def test_failed_preflight_leaves_file_unchanged(self):
        source = json.loads(json.dumps(self.workflow))
        source["nodes"] = source["nodes"][:-1]
        directory, path = self.write_temp_workflow(source)
        try:
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "no changes were written"):
                self.upgrade.update_workflow(path)
            self.assertEqual(path.read_bytes(), before)
        finally:
            directory.cleanup()


if __name__ == "__main__":
    unittest.main()
