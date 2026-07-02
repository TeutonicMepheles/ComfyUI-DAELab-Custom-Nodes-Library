# ComfyUI-DAELab-Custom-Nodes-Library

Custom ComfyUI nodes maintained by DAELab.

## Nodes

- `BooleanList` / `Boolean List`
- `GPTImageStylePromptPreset` / `GPT Image Style Prompt Preset`
- `LoadImageBooleanBBox` / `Load Image + BBox`
- `BBoxPromptReroute` / `BBox Prompt Reroute`

## Install

Clone this repository into `ComfyUI/custom_nodes`:

```powershell
cd <ComfyUI>\custom_nodes
git clone https://github.com/<your-user>/ComfyUI-DAELab-Custom-Nodes-Library.git
```

Restart ComfyUI after installing or updating.

## Update

```powershell
cd <ComfyUI>\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library
git pull
```

## Notes

- Node IDs are kept stable for workflow compatibility.
- This repository does not include local modifications to `comfyui-sam3`, including `SAM3OpenAIMaskedRedraw`.
- Do not install the old separate local copies of these nodes at the same time, or ComfyUI may see duplicate node IDs.
