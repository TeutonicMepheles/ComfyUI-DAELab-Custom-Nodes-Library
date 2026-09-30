# Public imports and API stability boundaries

Use only the sections needed for the current task.

Contents:
- Frontend Scripts API

## Frontend Scripts API

Custom node JavaScript can import from the frontend's `src/scripts/` modules. Imports use the Vite shim pattern:

```javascript
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
```

Symbols are also accessible via `window.comfyAPI.<module>.<export>`.

### Stability Levels

| Level | Modules | Notes |
|---|---|---|
| **Stable** | `scripts/app`, `scripts/api` | Guaranteed public API |
| **Internal** (console warning) | `scripts/widgets`, `scripts/domWidget`, `scripts/utils`, `scripts/pnginfo`, `scripts/changeTracker`, `scripts/defaultGraph`, `scripts/metadata/*` | Usable but may change |
| **Deprecated** | `scripts/ui` | Will be removed; use Vue alternatives |

### Key Modules

- **`scripts/api`** — `ComfyApi` class: `fetchApi()`, `queuePrompt()`, `getNodeDefs()`, WebSocket events, settings, user data, system stats
- **`scripts/app`** — `ComfyApp` singleton (`app`): graph operations, `registerExtension()`, `extensionManager`, clipboard, coordinate conversion
- **`scripts/widgets`** — `ComfyWidgets` registry (INT, FLOAT, STRING, BOOLEAN, COMBO, IMAGEUPLOAD, etc.), `addValueControlWidgets()`
- **`scripts/domWidget`** — `addDOMWidget()`, `DOMWidgetImpl`, `ComponentWidgetImpl` (Vue component wrapper)
- **`scripts/utils`** — `clone()`, `addStylesheet()`, `uploadFile()`, `downloadBlob()`, storage helpers
- **`scripts/pnginfo`** — `getPngMetadata()`, `getWebpMetadata()`, `importA1111()`, format-specific extractors

For full API details, see the [API Reference](../api-reference.md).
