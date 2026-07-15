import { app } from "../../scripts/app.js";

function chainCallback(object, property, callback) {
  const original = object[property];
  if (original) {
    object[property] = function () {
      const result = original.apply(this, arguments);
      callback.apply(this, arguments);
      return result;
    };
  } else {
    object[property] = callback;
  }
}

app.registerExtension({
  name: "comfyui_bbox_loader.BBoxPromptReroute",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === "BBoxPromptReroute") {
      if (typeof LiteGraph !== "undefined") {
        nodeType.title_mode = LiteGraph.NO_TITLE;
      }
      nodeType.collapsable = false;

      chainCallback(nodeType.prototype, "onNodeCreated", function () {
        this.title = "BBox";
        this.color = "#273447";
        this.bgcolor = "#18202b";
        this.size = [170, 58];

        if (this.inputs?.[0]) {
          this.inputs[0].label = "bboxes";
        }
        if (this.inputs?.[1]) {
          this.inputs[1].label = "neg";
        }
        if (this.outputs?.[0]) {
          this.outputs[0].label = "bboxes";
        }
        if (this.outputs?.[1]) {
          this.outputs[1].label = "neg";
        }

        for (const slot of [...(this.inputs || []), ...(this.outputs || [])]) {
          if (slot) {
            slot.color_on = slot.name === "neg_bboxes" ? "#ff6b6b" : "#4aa3ff";
            slot.color_off = slot.color_on;
          }
        }
      });

      chainCallback(nodeType.prototype, "onConnectionsChange", function () {
        for (const slot of [...(this.inputs || []), ...(this.outputs || [])]) {
          if (slot) {
            slot.color_on = slot.name === "neg_bboxes" ? "#ff6b6b" : "#4aa3ff";
            slot.color_off = slot.color_on;
          }
        }
      });
    }
  },
});
