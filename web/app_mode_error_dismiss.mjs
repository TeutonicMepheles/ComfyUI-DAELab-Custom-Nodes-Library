// Presentation only: never clear execution errors, history, or workflow inputs.
const CARD = '[data-testid="linear-validation-warning"]';
const DESCRIPTION = '[data-testid="linear-validation-warning-description"]';
const BUTTON = '[data-daelab-dismiss-error]';
export function installErrorDismiss(document, api, Observer = MutationObserver) {
    const key = '__daelabAppErrorDismiss';
    if (document[key]) return document[key];
    const records = new Map();
    const style = document.createElement('style');
    style.textContent = `
${CARD}[data-daelab-error-card] { position:relative; }
${CARD}[data-daelab-error-card] ${DESCRIPTION} { padding-right:32px; }
${CARD}[data-daelab-error-dismissed] { display:none!important; }
${BUTTON} { position:absolute;right:8px;top:8px;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer; }
${BUTTON}:hover { background:rgba(128,128,128,.2); }
${BUTTON}:focus-visible { outline:2px solid currentColor;outline-offset:2px; }
`;
    document.head.append(style);
    function sync() {
        for (const [card, record] of records) if (!card.isConnected) {
            record.button.remove();
            card.removeAttribute('data-daelab-error-dismissed');
            records.delete(card);
        }
        for (const card of document.querySelectorAll(CARD)) {
            const signature = card.querySelector(DESCRIPTION)?.textContent || '';
            let record = records.get(card);
            if (!record) {
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('data-daelab-dismiss-error', '');
                button.setAttribute('aria-label', '关闭本次错误提示');
                button.title = '关闭本次错误提示';
                button.textContent = '×';
                button.onclick = event => {
                    event.preventDefault(); event.stopPropagation();
                    card.setAttribute('data-daelab-error-dismissed', '');
                };
                card.setAttribute('data-daelab-error-card', '');
                card.append(button);
                record = {button, signature}; records.set(card, record);
            } else {
                if (signature !== record.signature) card.removeAttribute('data-daelab-error-dismissed');
                if (!card.contains(record.button)) card.append(record.button);
                record.signature = signature;
            }
        }
    }
    function reset() {
        for (const card of records.keys()) card.removeAttribute('data-daelab-error-dismissed');
        sync();
    }
    const observer = new Observer(sync);
    observer.observe(document.body, {childList:true, subtree:true, characterData:true});
    // Repeated identical errors must reappear too; text changes alone are insufficient.
    for (const name of ['execution_error', 'execution_start']) api.addEventListener(name, reset);
    const controller = {reset, sync, dispose() {
        observer.disconnect();
        for (const name of ['execution_error', 'execution_start']) api.removeEventListener(name, reset);
        for (const [card, {button}] of records) {
            button.remove(); card.removeAttribute('data-daelab-error-dismissed'); card.removeAttribute('data-daelab-error-card');
        }
        records.clear(); style.remove(); delete document[key];
    }};
    document[key] = controller;
    sync();
    return controller;
}
