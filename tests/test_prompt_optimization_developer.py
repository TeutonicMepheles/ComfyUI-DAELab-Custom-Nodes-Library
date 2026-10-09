"""Two-message capability and quote contract; no provider or credential access."""
from enum import Enum
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('developer_helpers', ROOT / 'tests/test_prompt_optimization.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
from promptopt.transport import native_capabilities


class AcceptedMessage:
    def __init__(self, *, role, content):
        self.role = role

    def model_dump(self, **kwargs):
        return {'role': self.role}


def native_modules(message_type):
    class Models(Enum):
        MINI = 'gpt-4.1-mini'
    values = {}
    for name in ('comfy_api_nodes', 'comfy_api_nodes.apis', 'comfy_api_nodes.apis.openai',
                 'comfy_api_nodes.nodes_openai', 'comfy_api_nodes.util', 'nodes'):
        values[name] = ModuleType(name)
    values['nodes'].NODE_CLASS_MAPPINGS = {'OpenAIChatNode': object()}
    values['comfy_api_nodes.nodes_openai'].SupportedOpenAIModel = Models
    schema = values['comfy_api_nodes.apis.openai']
    schema.OpenAICreateResponse = SimpleNamespace(model_fields={'max_output_tokens': None, 'input': None})
    schema.InputMessage = message_type
    schema.InputTextContent = lambda **kwargs: kwargs
    values['comfy_api_nodes.util'].request_logger = SimpleNamespace(
        _redact_headers=lambda headers: {k: '***' for k in headers})
    return values


class DeveloperCapabilityTests(unittest.TestCase):
    def test_accepts_schema_that_serializes_developer_role(self):
        with patch.dict(sys.modules, native_modules(AcceptedMessage)):
            self.assertEqual(native_capabilities(), ['gpt-4.1-mini'])

    def test_rejects_schema_that_rejects_or_drops_developer_role(self):
        def reject(**kwargs):
            raise ValueError('unsupported role')
        class DropsRole(AcceptedMessage):
            def model_dump(self, **kwargs):
                return {'role': 'user'}
        for message_type in (reject, DropsRole):
            with self.subTest(message_type=message_type), patch.dict(sys.modules, native_modules(message_type)):
                self.assertEqual(native_capabilities(), [])


class DeveloperPricingTests(unittest.IsolatedAsyncioTestCase):
    async def test_quote_counts_two_message_framing_and_explains_algorithm(self):
        snapshot = helpers.snapshot()
        count, _ = helpers.tokens(snapshot, helpers.INSTRUCTIONS)
        expected = len(helpers.INSTRUCTIONS.encode('utf-8')) + len(snapshot['inputText'].encode('utf-8')) + 64
        self.assertEqual(count, expected)
        with tempfile.TemporaryDirectory() as directory:
            service = helpers.Service(directory, transport=helpers.Transport(), pricing=helpers.Price(),
                                      models=lambda: ['gpt-4.1-mini'])
            try:
                quote = await service.estimate({'rows': [snapshot]})
                self.assertEqual(quote['inputTokens'], expected)
                self.assertEqual(quote['tokenAlgorithm'],
                    'utf8-byte-conservative-v2; two messages; framing +64; approximate, not actual usage')
                self.assertEqual(quote['budgetUpperCredits'],
                    round((expected * 84.4 + 1024 * 337.6) / 1_000_000, 6))
            finally:
                service.ledger.db.close()


if __name__ == '__main__':
    unittest.main()
