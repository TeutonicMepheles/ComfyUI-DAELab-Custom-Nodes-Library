"""Verify real saved outputs, especially exact pixels outside local selections."""
import argparse
import importlib
import json
from pathlib import Path
import sys
import types
from unittest.mock import patch

import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--comfy-core', required=True)
    parser.add_argument('--results', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    workspace = Path(args.workspace)
    sys.path.insert(0, args.comfy_core)
    package = types.ModuleType('badge87_qa')
    package.__path__ = [str(Path(__file__).resolve().parents[1])]
    sys.modules[package.__name__] = package
    module = importlib.import_module('badge87_qa.nodes.badge_app_87.node')
    records = json.loads(Path(args.results).read_text(encoding='utf-8'))
    checks = []
    def source(selection):
        if isinstance(selection, dict):
            path = workspace / selection.get('type', 'input') / selection.get('subfolder', '') / selection['filename']
        else:
            path = workspace / 'input' / selection
        return np.array(Image.open(path).convert('RGBA'))
    for record in records:
        check = {'case': record['case'], 'task_passed': record['passed']}
        if record['request'].get('expected_error'):
            checks.append(check)
            continue
        result = record['result']
        assert len(result['images']) == record['request'].get('count',1)
        for index, ref in enumerate(result['images']):
            check = {'case': record['case'], 'task_passed': record['passed'], 'variant': index+1}
            path = workspace / ref['type'] / ref.get('subfolder', '') / ref['filename']
            output = np.array(Image.open(path).convert('RGB'))
            check.update(image=str(path), size=list(Image.open(path).size), quality=result['report']['quality'], count=len(result['images']))
            assert check['size'] == [1024,1024] and check['quality'] == 'low', check
            if record['request']['stage'] == 'local':
                with patch.object(module, 'load_source', side_effect=source):
                    prepared = module.prepare(record['request'])
                base = np.clip(prepared['base'][0].numpy()*255,0,255).astype(np.uint8)
                mask = prepared['mask'][0].numpy() > .5
                delta = np.abs(output.astype(int)-base.astype(int))
                check['outside_max_error'] = int(delta[~mask].max(initial=0))
                check['inside_changed_pixels'] = int(np.any(delta[mask] != 0,axis=-1).sum())
                check['selected_pixels'] = int(mask.sum())
                assert check['outside_max_error'] == 0 and check['inside_changed_pixels'] > 0, check
            checks.append(check)
    Path(args.report).write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
    assert all(check['task_passed'] for check in checks)
    print(f'{len(checks)} real output cases verified.')


if __name__ == '__main__': main()
