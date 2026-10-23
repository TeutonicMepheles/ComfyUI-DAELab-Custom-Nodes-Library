"""Validate generated graphs against an installed ComfyUI, without enqueueing.

Usage: python tools/comfy_credit_validate.py COMFY_ROOT EVIDENCE_DIRECTORY
"""
import asyncio
import importlib
import json
from pathlib import Path
import sys
import types

core, evidence = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
sys.argv = [sys.argv[0], '--cpu']
sys.path.insert(0, str(core))
import comfy.options
comfy.options.enable_args_parsing()
import execution
import folder_paths
import nodes
from server import PromptServer
from app.assets.manager import default_asset_manager
from PIL import Image

root = Path(__file__).resolve().parents[1]
package = types.ModuleType('credit_validation')
package.__path__ = [str(root / 'nodes/libtv_bridge')]
sys.modules[package.__name__] = package


async def main():
    evidence.mkdir(parents=True, exist_ok=True)
    folder_paths.set_input_directory(str(evidence))
    folder_paths.set_output_directory(str(evidence / 'output'))
    PromptServer(asyncio.get_running_loop(), default_asset_manager())
    await nodes.init_extra_nodes(init_custom_nodes=False)
    video = importlib.import_module('credit_validation.table_comfy_video')
    image = importlib.import_module('credit_validation.table_comfy_image')
    Image.new('RGB', (512, 512), (40, 60, 80)).save(evidence / 'frame.png')
    media = dict(kind='image', path=str(evidence / 'frame.png'))
    results = []
    for models, adapter_class in ((video.MODELS, video.ComfyVideo), (image.MODELS, image.ComfyImage)):
        for model in models:
            adapter = adapter_class(model=model)
            caps = adapter.capabilities(model)
            for mode, limits in caps['schema']['properties']['modeType']['items'].items():
                refs = [media] * limits[0]
                adapter.validate_request(caps['schema'], mode, 'A blue sphere', {}, refs)
                graph = adapter.build_prompt('A blue sphere', {}, refs, 'validation')
                valid = await execution.validate_prompt('validation', graph, None)
                results.append(dict(model=model, mode=mode, valid=valid[0], errors=valid[3] or valid[1]))
                (evidence / (model.replace(' ', '_') + '-' + mode + '.json')).write_text(json.dumps(graph, indent=2), encoding='utf-8')
    (evidence / 'validation.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    for result in results:
        print(json.dumps(result, ensure_ascii=False))
    if not all(r['valid'] for r in results):
        raise SystemExit(1)


asyncio.run(main())
