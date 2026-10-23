import json
from comfy_api.latest import io
from .table_adapter import validated_table


class DataTable(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.Table', display_name='DAELAB - 多维表格', category='DAELab/Table',
                         inputs=[io.String.Input('table_data', default='', socketless=True, extra_dict={'hidden': True}),
                                 io.String.Input('source_table', optional=True, force_input=True)],
                         outputs=[io.String.Output('table_json')], is_output_node=True)

    @classmethod
    def execute(cls, table_data='', source_table=None):
        table = validated_table(json.loads(table_data or '{"fields":[],"records":[]}'))
        if source_table is not None:
            from .table_source import project_selected_source
            table = project_selected_source(table, validated_table(json.loads(source_table)))
        elif table.get('meta', {}).get('liveSource'):
            raise ValueError('上游表格已断开，请重新连接')
        return io.NodeOutput(json.dumps(table, ensure_ascii=False))
