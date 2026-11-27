import { badgeText } from './badge_ui_text.mjs?v=20261119-zh-controls';
import { buildImageViewPath, normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';

export function referenceImageIcon(make, button, parent, label, icon, action) {
    const control = button('', parent, action);
    control.className = 'badge-build-icon-button';
    control.setAttribute('aria-label', label);
    control.title = label;
    const glyph = make('img', '', control);
    glyph.alt = '';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.src = new URL(`./vendor/remixicon/${icon}.svg`, import.meta.url).href;
    return control;
}

export function createReferenceImageGallery({ make, button, sourceNode, imageWidget, live, select, imageURL, opener }) {
    const dialog = make('dialog');
    dialog.className = 'badge-build-gallery';
    dialog.setAttribute('aria-label', badgeText('build_prototype.text_013'));
    const header = make('div', '', dialog);
    header.className = 'badge-build-bar';
    make('strong', badgeText('build_prototype.text_014'), header);
    button(badgeText('build_prototype.text_015'), header, () => dialog.close());
    const search = make('input', '', dialog);
    search.type = 'search';
    search.placeholder = badgeText('build_prototype.text_016');
    search.setAttribute('aria-label', badgeText('build_prototype.text_017'));
    const count = make('p', '', dialog);
    count.setAttribute('role', 'status');
    const grid = make('div', '', dialog);
    grid.className = 'badge-build-gallery-grid';
    let values = [], target;

    function render() {
        grid.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        const matching = values.filter(value => String(value).toLocaleLowerCase().includes(query));
        count.textContent = matching.length ? badgeText('build_prototype.text_018', { p0: matching.length }) :
            badgeText('build_prototype.text_019');
        const current = JSON.stringify(normalizeImageSelection(imageWidget()?.value));
        for (const value of matching) {
            const selection = normalizeImageSelection(value);
            const selected = JSON.stringify(selection) === current;
            const card = button('', grid, () => {
                if (live() && sourceNode() === target) select(value);
                dialog.close();
            });
            card.className = 'badge-build-image-card';
            card.title = String(value);
            card.setAttribute('aria-pressed', String(selected));
            const thumb = make('img', '', card);
            thumb.alt = '';
            thumb.loading = 'lazy';
            thumb.decoding = 'async';
            thumb.src = imageURL(buildImageViewPath(selection));
            thumb.onerror = () => {
                thumb.hidden = true;
                make('span', badgeText('build_prototype.text_020'), card);
            };
            make('span', String(value), card);
            if (selected) make('span', badgeText('build_prototype.text_021'), card).setAttribute('aria-hidden', 'true');
        }
    }
    search.oninput = render;
    dialog.onkeydown = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
    };
    dialog.onclick = event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    };
    dialog.onclose = () => { if (live()) opener().focus(); };
    return {
        dialog,
        open() {
            if (!live()) return;
            target = sourceNode();
            const widget = imageWidget();
            const items = widget?.options?.values;
            values = [...new Set([widget?.value, ...(Array.isArray(items) ? items : [])].filter(Boolean))];
            search.value = '';
            render();
            dialog.showModal();
            search.focus();
        },
    };
}
