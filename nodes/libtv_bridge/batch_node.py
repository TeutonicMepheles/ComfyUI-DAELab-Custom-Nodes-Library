import json
from pathlib import Path
from urllib.parse import urlencode
import folder_paths
from comfy_api.latest import io, ui
from .node import LibTVVideo, local_media
from .runtime import Bridge
from .batch import compile_rows, run_batch

NODE_ID = 'DAELAB.LibTV.StoryboardBatch'


class LibTVStoryboardBatch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        shared = LibTVVideo.define_schema()
        defaults = dict(model='Seedance 2.0', mode='mixed2video', duration=5, resolution='720p')
        for item in shared.inputs:
            if item.id in defaults:
                item.default = defaults[item.id]
        return io.Schema(node_id=NODE_ID, display_name='DAELAB · 旧分镜批量（已停用）', category='DAELab/Legacy',
            description='旧 LibTV 入口已停用。请将表格导入生成节点，使用 Comfy 积分运行。',
            is_output_node=True, not_idempotent=True,
            inputs=[io.String.Input('storyboard_json', force_input=True),
                    *[i for i in shared.inputs if i.id in ('project_uuid', 'request_id', 'model', 'mode', 'duration', 'resolution', 'ratio', 'sound')]],
            outputs=[io.String.Output('batch_report'), io.String.Output('video_paths')])

    @classmethod
    def execute(cls, storyboard_json, project_uuid, request_id, model, mode, duration, resolution, ratio, sound=False):
        raise ValueError('旧 LibTV 分镜批量入口已停用；请将表格导入生成节点，使用 Comfy 积分运行')
