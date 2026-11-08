import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

_ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location("cnl_coexistence", _ROOT / "coexistence.py")
coexistence = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(coexistence)

_FIXTURE = json.loads((Path(__file__).with_name("coexistence_fixture.json")).read_text("utf-8"))


def valid_arbitration():
    return json.loads(json.dumps(_FIXTURE))


def write_arbitration(directory, data):
    user = Path(directory) / "daelab"
    user.mkdir(parents=True)
    (user / "coexistence.json").write_text(json.dumps(data), encoding="utf-8")
    return Path(directory)


class ArbitrationLoadingTests(unittest.TestCase):
    def test_missing_file_means_not_opted_in(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(coexistence.load_arbitration(Path(directory)))

    def test_valid_file_round_trips(self):
        with tempfile.TemporaryDirectory() as directory:
            write_arbitration(directory, valid_arbitration())
            self.assertEqual(coexistence.load_arbitration(Path(directory)), valid_arbitration())

    def test_malformed_json_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            user = Path(directory) / "daelab"
            user.mkdir()
            (user / "coexistence.json").write_text("{not json", encoding="utf-8")
            with self.assertRaises(ValueError):
                coexistence.load_arbitration(Path(directory))

    def test_non_object_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            write_arbitration(directory, ["not", "an", "object"])
            with self.assertRaises(ValueError):
                coexistence.load_arbitration(Path(directory))


class ValidationTests(unittest.TestCase):
    def test_complete_arbitration_has_no_errors(self):
        self.assertEqual(coexistence.validate_arbitration(valid_arbitration()), [])

    def test_missing_node_owner_is_an_error(self):
        data = valid_arbitration()
        del data["nodeOwners"]["DAELAB.Table"]
        self.assertTrue(any("nodeOwners" in error for error in coexistence.validate_arbitration(data)))

    def test_missing_route_owner_is_an_error(self):
        data = valid_arbitration()
        del data["routeOwners"]["POST /daelab/storyboard/import_document"]
        self.assertTrue(any("routeOwners" in error for error in coexistence.validate_arbitration(data)))

    def test_missing_extension_owner_is_an_error(self):
        data = valid_arbitration()
        del data["extensionOwners"]["DAELab.DataTable"]
        self.assertTrue(any("extensionOwners" in error for error in coexistence.validate_arbitration(data)))

    def test_missing_prompt_optimization_prefix_is_an_error(self):
        data = valid_arbitration()
        del data["routePrefixes"]
        self.assertTrue(any("routePrefixes" in error for error in coexistence.validate_arbitration(data)))

    def test_layer_name_as_owner_is_an_error(self):
        data = valid_arbitration()
        data["nodeOwners"]["DAELAB.Table"] = "business"
        errors = coexistence.validate_arbitration(data)
        self.assertTrue(any("DAELAB.Table" in error for error in errors))

    def test_unknown_owner_is_an_error(self):
        data = valid_arbitration()
        data["extensionOwners"]["DAELab.DataTable"] = "nobody"
        self.assertTrue(any("DAELab.DataTable" in error for error in coexistence.validate_arbitration(data)))

    def test_incomplete_action_list_is_an_error(self):
        data = valid_arbitration()
        data["routePrefixes"]["POST /daelab/prompt-optimization/"]["allowedActions"].pop()
        self.assertTrue(any("allowedActions" in error for error in coexistence.validate_arbitration(data)))


class AuthorisationTests(unittest.TestCase):
    def test_authorized_when_cnl_listed(self):
        self.assertTrue(coexistence.cnl_authorized(valid_arbitration()))

    def test_not_authorized_when_absent(self):
        self.assertFalse(coexistence.cnl_authorized({}))

    def test_not_authorized_when_only_cc_listed(self):
        data = valid_arbitration()
        data["allowLegacyPackages"] = ["ComfyUI-DAELab-Creative-Canvas"]
        self.assertFalse(coexistence.cnl_authorized(data))


class YieldDecisionTests(unittest.TestCase):
    def test_cnl_owned_node_is_not_yielded(self):
        state = coexistence.yielded_items(valid_arbitration())
        self.assertEqual(
            state["nodes"],
            {"DAELAB.Table", "DAELAB.ScriptParser", "DAELAB.LLMStylePreviewB"},
        )

    def test_all_literal_routes_and_wildcard_yielded(self):
        state = coexistence.yielded_items(valid_arbitration())
        self.assertEqual(state["routes"], set(coexistence.CONTESTED_ROUTES))
        self.assertTrue(state["prompt_optimization"])

    def test_all_extensions_yielded(self):
        state = coexistence.yielded_items(valid_arbitration())
        self.assertEqual(state["extensions"], set(coexistence.CONTESTED_EXTENSIONS))


class ResolveYieldTests(unittest.TestCase):
    def test_no_file_means_no_yield(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(coexistence.resolve_yield(Path(directory)))

    def test_authorized_file_yields(self):
        with tempfile.TemporaryDirectory() as directory:
            write_arbitration(directory, valid_arbitration())
            state = coexistence.resolve_yield(Path(directory))
            self.assertIsNotNone(state)
            self.assertEqual(
                state["nodes"],
                {"DAELAB.Table", "DAELAB.ScriptParser", "DAELAB.LLMStylePreviewB"},
            )

    def test_valid_but_not_authorized_means_no_yield(self):
        with tempfile.TemporaryDirectory() as directory:
            data = valid_arbitration()
            data["allowLegacyPackages"] = ["ComfyUI-DAELab-Creative-Canvas"]
            write_arbitration(directory, data)
            self.assertIsNone(coexistence.resolve_yield(Path(directory)))

    def test_malformed_file_raises(self):
        with tempfile.TemporaryDirectory() as directory:
            data = valid_arbitration()
            del data["nodeOwners"]
            write_arbitration(directory, data)
            with self.assertRaises(ValueError):
                coexistence.resolve_yield(Path(directory))


if __name__ == "__main__":
    unittest.main()
