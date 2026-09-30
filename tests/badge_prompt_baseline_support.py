from contextlib import contextmanager
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

@contextmanager
def baseline_content(assembler):
    archive = json.loads((Path(__file__).parent / 'fixtures/badge87_content_baseline.json').read_text(encoding='utf-8'))
    with TemporaryDirectory() as folder:
        root = Path(folder)
        for name, text in archive.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        with patch.object(assembler, 'PROMPTS', root):
            yield
