import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function imageUrl(image) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "input",
    rand: String(Date.now()),
  });
  return api.apiURL(`/view?${query.toString()}`);
}

async function imageAsBase64(image) {
  const response = await fetch(imageUrl(image));
  if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

app.registerExtension({
  name: "DAELab.ArchiveScreenshotRestore20260930HD",
  async afterConfigureGraph() {
    const config = app.graph?.extra?.daelabArchiveScreenshotHD;
    if (!config) return;

    window.setTimeout(async () => {
      const preview = config.previewImage;
      for (const nodeId of config.previewNodes || []) {
        api.dispatchEvent(
          new CustomEvent("executed", {
            detail: { node: String(nodeId), output: { images: [preview] } },
          }),
        );
      }

      try {
        const base64 = await imageAsBase64(config.bboxImage);
        for (const nodeId of config.bboxNodes || []) {
          const node = app.graph.getNodeById(nodeId);
          node?.onExecuted?.({ bg_image: [base64] });
        }
      } catch (error) {
        console.error("[DAELab archive screenshot] failed to restore bbox image", error);
      }

      for (const node of app.graph?._nodes || []) {
        node.has_errors = false;
        node.bgcolor = node.bgcolor === "#C33" ? undefined : node.bgcolor;
      }
      app.graph?.setDirtyCanvas(true, true);
    }, 900);
  },
});
