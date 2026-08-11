import { app } from "../../scripts/app.js";
import {
  getConnectedLoadImageInfo,
  installConnectedLoadImageResolver,
} from "./polygon_mask_connection.mjs?v=20260805-4";


app.registerExtension({
  name: "DAELab.PolygonMaskAppModeLoadImageCompatibility",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PolygonMask") {
      return;
    }

    // Apply the override per instance so it is independent of extension
    // registration order: polygon_mask.js may finish loading before or after
    // this small compatibility entry point.
    installConnectedLoadImageResolver(
      nodeType,
      (node) => getConnectedLoadImageInfo(node, app.graph),
    );
  },
});
