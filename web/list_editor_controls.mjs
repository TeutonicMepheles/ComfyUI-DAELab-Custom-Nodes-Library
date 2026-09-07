export const LIST_EDITOR_ICONS = Object.freeze({
    addRoot: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>',
    addChild: '<svg viewBox="0 0 24 24"><path d="M5 5v14h5"/><path d="M14 15h6M17 12v6"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    indent: '<svg viewBox="0 0 24 24"><path d="M3 5h18M10 12h11M10 19h11M3 9l3 3-3 3"/></svg>',
    outdent: '<svg viewBox="0 0 24 24"><path d="M3 5h18M10 12h11M10 19h11M6 9l-3 3 3 3"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>',
    exclusive: '<svg viewBox="0 0 24 24"><path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg>',
    dependencies: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><path d="M8 6h3a4 4 0 0 1 4 4M8 18h3a4 4 0 0 0 4-4"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3"/></svg>',
});

export function stopCanvasPropagation(event) {
    event.stopPropagation();
}

export function createIconButton(icon, label, callback, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = disabled;
    button.innerHTML = icon;
    button.style.cssText = "width:24px;height:24px;padding:4px;display:inline-flex;align-items:center;justify-content:center;" +
        "border:1px solid #4b4b4b;border-radius:4px;background:#2b2b2b;color:#c9c9c9;cursor:pointer;box-sizing:border-box;";
    const svg = button.querySelector("svg");
    if (svg) {
        svg.setAttribute("width", "15");
        svg.setAttribute("height", "15");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
    }
    if (disabled) {
        button.style.opacity = "0.35";
        button.style.cursor = "not-allowed";
    } else {
        button.addEventListener("mouseenter", () => { button.style.background = "#3b3b3b"; });
        button.addEventListener("mouseleave", () => { button.style.background = "#2b2b2b"; });
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            callback();
        });
    }
    button.addEventListener("pointerdown", stopCanvasPropagation);
    button.addEventListener("pointerup", stopCanvasPropagation);
    return button;
}
