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
        return io.Schema(node_id=NODE_ID, display_name='DAELAB · LibTV 分镜批量生成', category='DAELab/LibTV',
            description='选中行串行生成。仅使用 LibTV 积分；相同批次编号恢复原任务。每行使用这里设置的统一视频时长。',
            is_output_node=True, not_idempotent=True,
            inputs=[io.String.Input('storyboard_json', force_input=True),
                    *[i for i in shared.inputs if i.id in ('project_uuid', 'request_id', 'model', 'mode', 'duration', 'resolution', 'ratio', 'sound')]],
            outputs=[io.String.Output('batch_report'), io.String.Output('video_paths')])

    @classmethod
    def execute(cls, storyboard_json, project_uuid, request_id, model, mode, duration, resolution, ratio, sound=False):
        from server import PromptServer
        import comfy.model_management
        settings = dict(duration=duration, resolution=resolution, ratio=ratio)
        if model != 'Minimax H3':
            settings['enableSound'] = 'on' if sound else 'off'
        elif sound:
            raise ValueError('H3 不支持声音开关')
        output = Path(folder_paths.get_output_directory()).resolve()
        bridge = Bridge(Path(folder_paths.get_user_directory()) / 'daelab/libtv/jobs', output / 'daelab/libtv')
        from .media_snapshot import recovery_context
        rows = compile_rows(storyboard_json, local_media, dict(model=model, mode=mode, duration=duration),
                            recovery_context(bridge, project_uuid, request_id))
        def public(report):
            for row in report['rows']:
                if row.get('file'):
                    path = Path(row['file'])
                    row['url'] = '/view?' + urlencode(dict(filename=path.name, subfolder=path.parent.relative_to(output).as_posix(), type='output'))
            return report
        def progress(report):
            PromptServer.instance.send_sync('daelab.libtv.batch', public(report), PromptServer.instance.client_id)
        report = public(run_batch(bridge, project_uuid, request_id, model, mode, settings, rows, progress,
                                  comfy.model_management.throw_exception_if_processing_interrupted))
        payload = json.dumps(report, ensure_ascii=False)
        previews = [ui.SavedResult(Path(r['file']).name, Path(r['file']).parent.relative_to(output).as_posix(), io.FolderType.output)
                    for r in report['rows'] if r.get('file')]
        preview = ui.PreviewVideo(previews).as_dict() if previews else {}
        return io.NodeOutput(payload, json.dumps([r['url'] for r in report['rows'] if r.get('url')]),
                             ui={**preview, 'batch_report': [payload]})
