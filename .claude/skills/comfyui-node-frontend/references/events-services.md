# Execution events, server messages, toasts, dialogs, or manager services

Use only the sections needed for the current task.

Contents:
- API Events
- Server-to-Client Communication
- Toast Notifications
- Dialogs
- ExtensionManager Utilities

## API Events

Listen to execution events:

```javascript
// Node execution completed
app.api.addEventListener("executed", ({ detail }) => {
    const { node, output } = detail;
    // output contains images, text, etc.
});

// Execution progress
app.api.addEventListener("progress", ({ detail }) => {
    const { value, max, node } = detail;
});

// Execution started/completed
app.api.addEventListener("execution_start", ({ detail }) => {});
app.api.addEventListener("execution_success", ({ detail }) => {});
app.api.addEventListener("execution_error", ({ detail }) => {});

// Status updates
app.api.addEventListener("status", ({ detail }) => {
    const { exec_info } = detail;
});
```

## Server-to-Client Communication

### Python (server side):

```python
from server import PromptServer

PromptServer.instance.send_sync(
    "my_extension.update",
    {"status": "complete", "data": result}
)
```

### JavaScript (client side):

```javascript
app.api.addEventListener("my_extension.update", ({ detail }) => {
    console.log("Received:", detail);
});
```

## Toast Notifications

```javascript
app.extensionManager.toast.add({
    severity: "info",  // "success", "info", "warn", "error"
    summary: "Title",
    detail: "Message content",
    life: 3000,  // auto-dismiss after ms
});
```

## Dialogs

```javascript
// Confirmation dialog
const result = await app.extensionManager.dialog.confirm({
    title: "Confirm Action",
    message: "Are you sure?",
});

// Prompt dialog
const value = await app.extensionManager.dialog.prompt({
    title: "Enter Value",
    message: "Provide a name:",
    defaultValue: "default",
});
```

## ExtensionManager Utilities

### Setting Access

```javascript
// Read a setting value
const val = app.extensionManager.setting.get("my.ext.mySetting");

// Write a setting value
app.extensionManager.setting.set("my.ext.mySetting", newValue);
```

### Execution Errors (read-only)

```javascript
// Last node-level errors (keyed by node ID)
const nodeErrors = app.extensionManager.lastNodeErrors;

// Last execution-level error
const execError = app.extensionManager.lastExecutionError;
```

### Markdown Rendering

```javascript
// Render markdown to sanitized HTML (marked + DOMPurify, safe for innerHTML)
const html = app.extensionManager.renderMarkdownToHtml(markdownStr, baseUrl);
```
