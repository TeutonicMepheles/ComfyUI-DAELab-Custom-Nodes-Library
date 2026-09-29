# Commands, settings, panels, menus, or badges

Use only the sections needed for the current task.

Contents:
- Declarative Extension Properties
- Context Menu Items

These icon-class examples assume the existing Remix Icon font/CSS is loaded and the host slot accepts classes. If the package bundles SVGs instead, use its shared icon renderer for owned DOM; inspect the host icon contract rather than passing an SVG URL as a class. Preserve the icon license.

## Declarative Extension Properties

### Commands

```javascript
app.registerExtension({
    name: "my.ext",
    commands: [
        {
            id: "my.ext.doSomething",
            label: "Do Something",
            icon: "ri-flashlight-line",
            function: () => { console.log("Executed!"); },
        },
    ],
});
```

### Keybindings

```javascript
keybindings: [
    {
        commandId: "my.ext.doSomething",
        combo: { key: "d", ctrl: true, shift: true },
    },
],
```

### Settings

```javascript
settings: [
    {
        id: "my.ext.mySetting",
        name: "My Setting",
        type: "boolean",
        defaultValue: true,
        onChange: (value) => { console.log("Setting changed:", value); },
    },
    {
        id: "my.ext.mode",
        name: "Processing Mode",
        type: "combo",
        options: ["fast", "quality", "balanced"],
        defaultValue: "balanced",
    },
],
```

**Setting types**: `boolean`, `number`, `slider`, `knob`, `combo`, `radio`, `text`, `image`, `color`, `url`, `hidden`, `backgroundImage`

### Sidebar Tabs

```javascript
async setup(app) {
    app.extensionManager.registerSidebarTab({
        id: "my-sidebar",
        title: "My Panel",
        icon: "ri-settings-3-line",
        type: "custom",
        render: (container) => {
            container.innerHTML = "<h3>My Custom Panel</h3>";
        },
        destroy: () => {
            // Cleanup
        },
    });
},
```

### Bottom Panel Tabs

```javascript
bottomPanelTabs: [
    {
        id: "my-panel",
        title: "My Panel",
        type: "custom",
        render: (container) => {
            container.innerHTML = "<div>Panel content</div>";
        },
    },
],
```

### Menu Commands

```javascript
menuCommands: [
    {
        path: ["My Extension"],
        commands: ["my.ext.doSomething"],
    },
],
```

### About Page Badges

```javascript
aboutPageBadges: [
    { label: "v1.0.0", url: "https://github.com/...", icon: "ri-github-line", severity: "warn" },
    // severity is optional: "danger" | "warn"
],
```

### Top Bar Badges

```javascript
topbarBadges: [
    {
        text: "My Extension",        // required
        label: "BETA",               // optional badge label
        variant: "info",             // "info" | "warning" | "error"
        icon: "ri-star-line",          // optional icon
        tooltip: "Extension info",   // optional tooltip
    },
],
```

### Action Bar Buttons

```javascript
actionBarButtons: [
    {
        icon: "ri-flashlight-line",           // required
        label: "My Action",           // optional label
        tooltip: "Run my action",     // optional tooltip
        onClick: () => { /* ... */ },  // required click handler
    },
],
```

## Context Menu Items

```javascript
app.registerExtension({
    name: "my.ext",

    // Canvas right-click menu
    getCanvasMenuItems(canvas) {
        return [{
            content: "My Action",
            callback: () => { console.log("Canvas menu clicked"); },
        }];
    },

    // Node right-click menu
    getNodeMenuItems(node) {
        if (node.comfyClass === "MyNode") {
            return [{
                content: "Custom Action",
                callback: () => { console.log("Node:", node.id); },
            }];
        }
        return [];
    },
});
```
