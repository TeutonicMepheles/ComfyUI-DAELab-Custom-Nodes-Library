import json
from comfy_api.latest import io
from .script_contract import confirmed_table, storyboard_projection


class ScriptParser(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.ScriptParser', display_name='DAELAB - 分镜剧本解析器', category='DAELab/Table',
                         inputs=[io.String.Input('table_data', default='', socketless=True, extra_dict={'hidden': True})],
                         outputs=[io.String.Output('table_json'), io.String.Output('storyboard_json')], is_output_node=True)

    @classmethod
    def execute(cls, table_data=''):
        empty = {'fields': [], 'records': [], 'meta': {'script_parser': {'version': 1}}}
        table = confirmed_table(json.loads(table_data) if table_data else empty)
        return io.NodeOutput(json.dumps(table, ensure_ascii=False), json.dumps(storyboard_projection(table), ensure_ascii=False))
