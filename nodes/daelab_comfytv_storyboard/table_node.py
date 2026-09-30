import json
from comfy_api.latest import io
from .table_adapter import validated_table


class DataTable(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.Table', display_name='DAELAB - 多维表格', category='DAELab/Table',
                         inputs=[io.String.Input('table_data', default='', socketless=True, extra_dict={'hidden': True})],
                         outputs=[io.String.Output('table_json')], is_output_node=True)

    @classmethod
    def execute(cls, table_data=''):
        return io.NodeOutput(json.dumps(validated_table(json.loads(table_data or '{"fields":[],"records":[]}')), ensure_ascii=False))
