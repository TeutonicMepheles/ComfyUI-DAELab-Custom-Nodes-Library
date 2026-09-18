"""Read-only authoritative selection preview. No model calls or filesystem writes."""
import asyncio
import base64
from io import BytesIO
import numpy as np
from PIL import Image


def preview_geometry(request):
    from .region_materials import prepare
    request = dict(request)
    request.update(stage='local', workflow_version='8.7', interaction_revision=2, apply=False)
    if request.get('edit_mode') not in ('material','region_materials'):
        raise ValueError('Geometry preview requires local material selection.')
    prepared = prepare(request)
    labels = np.zeros(prepared['mask'].shape[1:], np.uint8)
    ids = []
    for index,(mask,_,group) in enumerate(prepared['regions']):
        labels[mask[0].numpy() > .5] = index+1
        ids.append(group['id'])
    output = BytesIO()
    Image.fromarray(labels).save(output,format='PNG')
    g = prepared['region_geometry']
    return dict(labels='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode(),
                ids=ids, fingerprint=g['fingerprint'], version=g['version'], stats=g['stats'])


def register():
    from server import PromptServer
    from aiohttp import web
    @PromptServer.instance.routes.post('/daelab/badge87/region-geometry')
    async def geometry(request):
        try:
            payload = await request.json()
            return web.json_response(await asyncio.to_thread(preview_geometry,payload))
        except (ValueError,KeyError,TypeError) as error:
            return web.json_response({'error':str(error)},status=400)
