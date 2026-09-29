# Registration, lifecycle hooks, DOM widgets, or node properties

Use only the sections needed for the current task.

Contents:
- Quick Start
- Extension Hooks (Lifecycle Order)
- Custom Widgets
- Node Instance Properties (LGraphNode Augmentations)

## Quick Start

### 1. Export WEB_DIRECTORY in Python

```python
# __init__.py
WEB_DIRECTORY = "./js"
__all__ = ["WEB_DIRECTORY"]
```

### 2. Create JavaScript Extension

```javascript
// js/my_extension.js
import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "my_nodes.my_extension",

    async setup() {
        console.log("Extension loaded!");
    },
});
```

All `.js` files in `WEB_DIRECTORY` are loaded automatically when ComfyUI starts.

## Extension Hooks (Lifecycle Order)

### init — After canvas created, before nodes

```javascript
app.registerExtension({
    name: "my.ext",
    async init(app) {
        // Modify core behavior, add global listeners
    },
});
```

### addCustomNodeDefs — Modify node definitions

```javascript
async addCustomNodeDefs(defs, app) {
    // defs is a dict of all node definitions
    // Can add or modify definitions before registration
    defs["MyFrontendNode"] = {
        input: { required: { text: ["STRING", {}] } },
        output: ["STRING"],
        output_name: ["text"],
        name: "MyFrontendNode",
        display_name: "My Frontend Node",
        category: "custom",
    };
},
```

### getCustomWidgets — Register custom widget types

```javascript
getCustomWidgets(app) {
    return {
        MY_WIDGET(node, inputName, inputData, app) {
            const widget = node.addWidget("text", inputName, "", () => {});
            widget.serializeValue = () => widget.value;
            return { widget };
        },
    };
},
```

### beforeRegisterNodeDef — Modify node prototype

```javascript
async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "MyNode") {
        // Chain onto prototype methods
        const origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated?.apply(this, arguments);
            // Add custom widget, modify behavior, etc.
            this.addWidget("button", "Run", null, () => {
                console.log("Button clicked!");
            });
        };
    }
},
```

### nodeCreated — After node instance created

```javascript
nodeCreated(node, app) {
    if (node.comfyClass === "MyNode") {
        // Modify this specific node instance
        node.color = "#335";
    }
},
```

### setup — After app fully loaded

```javascript
async setup(app) {
    // Add event listeners, register UI components
    app.api.addEventListener("executed", (event) => {
        console.log("Node executed:", event.detail);
    });
},
```

### loadedGraphNode — When loading saved graph

```javascript
loadedGraphNode(node, app) {
    if (node.comfyClass === "MyNode") {
        // Restore state from saved graph
    }
},
```

### registerCustomNodes — Register additional node types

```javascript
registerCustomNodes(app) {
    // Register custom LiteGraph node types
},
```

### beforeRegisterVueAppNodeDefs — Modify node defs before Vue registration

```javascript
beforeRegisterVueAppNodeDefs(defs, app) {
    // Modify definitions before they reach the Vue app
},
```

### beforeConfigureGraph / afterConfigureGraph

```javascript
async beforeConfigureGraph(graphData, missingNodeTypes, app) {
    // Before graph data is applied
},
async afterConfigureGraph(missingNodeTypes, app) {
    // After graph is fully configured
},
```

### getSelectionToolboxCommands — Add commands to selection toolbox

```javascript
getSelectionToolboxCommands(selectedItem) {
    // Return array of command IDs to show when item is selected
    return ["my.ext.doSomething"];
},
```

### Authentication Hooks

```javascript
onAuthUserResolved(user, app) {
    // Fires when user authentication resolves
},
onAuthTokenRefreshed() {
    // Fires when auth token is refreshed
},
onAuthUserLogout() {
    // Fires when user logs out
},
```

## Custom Widgets

### Adding DOM Widgets

```javascript
beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "MyNode") {
        const origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated?.apply(this, arguments);

            const container = document.createElement("div");
            container.innerHTML = `<input type="color" value="#ff0000">`;
            container.querySelector("input").addEventListener("change", (e) => {
                this.widgets.find(w => w.name === "color").value = e.target.value;
            });

            this.addDOMWidget("colorPicker", "custom", container, {
                serialize: true,
                getValue() { return container.querySelector("input").value; },
                setValue(v) { container.querySelector("input").value = v; },
            });
        };
    }
},
```

### Widget Hooks

```javascript
// Called before prompt is queued
widget.beforeQueued = function () {
    // Prepare widget value
};

// Called after prompt is queued
widget.afterQueued = function () {
    // Reset or update widget
};

// Custom serialization
widget.serializeValue = function (node, index) {
    return JSON.stringify(this.value);
};
```

## Node Instance Properties (LGraphNode Augmentations)

```javascript
// Available on node instances:
node.comfyClass       // ComfyUI node type name
node.isVirtualNode    // true for frontend-only nodes
node.imgs             // preview images array
node.imageIndex       // current preview image index

// Callbacks:
node.onExecuted = function(output) { /* execution result */ };
node.onExecutionStart = function() { /* about to execute */ };
node.onDragOver = function(event) { /* file drag over */ };
node.onDragDrop = function(event) { /* file dropped */ };
```
