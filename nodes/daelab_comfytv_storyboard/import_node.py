import json
import uuid
from comfy_api.latest import io

NODE_ID = "DAELAB.StoryboardImport"


def validated_storyboard(value):
    data = json.loads(value or '{"shots": []}')
    if not isinstance(data, dict) or not isinstance(data.get("shots"), list):
        raise ValueError("分镜数据必须包含 shots 列表")
    ids = set()
    for shot in data["shots"]:
        if not isinstance(shot, dict):
            raise ValueError("分镜行格式错误")
        if not shot.get("id") or shot["id"] in ids:
            shot["id"] = str(uuid.uuid4())
        ids.add(shot["id"])
    data["schema_version"] = 2
    return data


class StoryboardImport(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id=NODE_ID, display_name="DAELAB - 剧本分镜导入", category="DAELab/ComfyTV",
                         inputs=[io.String.Input("storyboard_data", default="", socketless=True, extra_dict={"hidden": True})],
                         outputs=[io.String.Output("storyboard_json")], is_output_node=True)

    @classmethod
    def execute(cls, storyboard_data=""):
        return io.NodeOutput(json.dumps(validated_storyboard(storyboard_data), ensure_ascii=False))
