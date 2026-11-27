import { buildImageViewPath, normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { localImageFromDrop } from './badge_image_drop_87.mjs';
import { createReferenceImageGallery, createReferenceImageToolbar } from './reference_image_controls.mjs?v=20261120-dialog-focus';
import { bindCreativeButton } from './vendor/generation-ui-shared/creative_button.mjs';

export function createReferenceImageCard({
    sourceNode, fold, live, imageURL, uploadImage, setImage,
    classPrefix = 'cnl-expo', title = '参考图配置', imageLabel = '空间原图',
    allowDownload = true, allowDrop = true,
}) {
    const card = document.createElement('section');
    card.className = `${classPrefix}-original`;
    const make = (tag, label, parent = card) => {
        const element = document.createElement(tag);
        if (label) element.textContent = label;
        parent.append(element);
        return element;
    };
    const button = (label, parent, action) => {
        const control = make('button', label, parent);
        control.type = 'button';
        control.onclick = action;
        return control;
    };
    const available = () => live() && card.isConnected && isNodeAvailableInAppMode(sourceNode());
    const widget = () => sourceNode()?.widgets?.find(item => item.name === 'image');
    let pending;
    const heading = button(title, card, () => {
        fold.setCollapsed(!fold.collapsed());
        if (fold.collapsed()) gallery.dialog.close();
        update();
    });
    heading.className = `${classPrefix}-reference-heading`;
    const body = make('div');
    const actions = make('div', '', body);
    actions.className = `${classPrefix}-reference-actions`;
    const file = make('input', '', body);
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    const toolbar = createReferenceImageToolbar({
        make, button, parent: actions, onBrowse: () => gallery.open(),
        onUpload: () => file.click(), onDownload: allowDownload ? downloadImage : null,
    });
    const { browse, upload, filename, download } = toolbar;
    const frame = make('div', '', body);
    frame.className = `${classPrefix}-reference-frame`;
    const preview = make('img', '', frame);
    preview.alt = imageLabel;
    const missing = make('span', '', frame);
    const status = make('div', '', body);
    status.className = `${classPrefix}-reference-status`;
    status.setAttribute('role', 'status');
    function downloadImage() {
        const selection = normalizeImageSelection(widget()?.value);
        if (!available() || !selection || !preview.complete || !preview.naturalWidth) return;
        const link = document.createElement('a');
        link.href = imageURL(buildImageViewPath(selection));
        link.download = selection.filename;
        link.click();
    }
    const gallery = createReferenceImageGallery({
        make, button, sourceNode, imageWidget: widget, live: available, select: selectImage, imageURL, opener: () => browse,
    });
    const releaseHeading = bindCreativeButton(heading);

    function selectImage(value) {
        if (!available()) return;
        pending = null;
        status.textContent = '';
        setImage(value);
        update();
    }
    async function uploadFile(blob) {
        if (!available() || !blob) return;
        const node = sourceNode();
        const previous = widget()?.value;
        const request = {};
        pending = request;
        const current = () => pending === request && available() && sourceNode() === node && widget()?.value === previous;
        status.textContent = '正在上传…';
        update();
        try {
            const value = await uploadImage(blob);
            if (current()) selectImage(value);
        } catch (error) {
            if (current()) status.textContent = error.message;
        } finally {
            if (pending === request) {
                pending = null;
                update();
            }
        }
    }
    file.onchange = () => {
        const blob = file.files[0];
        file.value = '';
        void uploadFile(blob);
    };
    if (allowDrop) frame.ondragover = event => {
        if (!available()) return;
        event.preventDefault();
        frame.dataset.drag = 'true';
    };
    if (allowDrop) frame.ondragleave = () => delete frame.dataset.drag;
    if (allowDrop) frame.ondrop = event => {
        event.preventDefault();
        event.stopPropagation();
        delete frame.dataset.drag;
        const blob = event.dataTransfer?.files[0];
        if (blob) void uploadFile(blob);
        else {
            const selection = localImageFromDrop(event.dataTransfer, location.href, ['input']);
            if (selection) selectImage([selection.subfolder, selection.filename].filter(Boolean).join('/'));
        }
    };
    function showPreview() {
        preview.hidden = !preview.naturalWidth;
        missing.hidden = !preview.hidden;
        if (download) download.disabled = !available() || !preview.complete || preview.hidden;
    }
    preview.onload = preview.onerror = showPreview;
    function update() {
        body.hidden = fold.collapsed();
        const expanded = String(!body.hidden);
        if (heading.getAttribute('aria-expanded') !== expanded) heading.setAttribute('aria-expanded', expanded);
        upload.disabled = !available() || !!pending;
        browse.disabled = !available();
        if (!available() && gallery.dialog.open) gallery.dialog.close();
        const selection = normalizeImageSelection(widget()?.value);
        const name = selection?.filename || '';
        const fullName = selection ? [selection.subfolder, name].filter(Boolean).join('/') : '';
        if (filename.textContent !== name) filename.textContent = name;
        if (filename.title !== fullName) filename.title = fullName;
        const emptyMessage = selection ? `无法显示${imageLabel}` : `尚未上传${imageLabel}`;
        if (missing.textContent !== emptyMessage) missing.textContent = emptyMessage;
        const url = selection ? imageURL(buildImageViewPath(selection)) : '';
        if ((preview.getAttribute('src') ?? '') !== url) {
            if (url) preview.src = url;
            else preview.removeAttribute('src');
        }
        showPreview();
    }
    return {
        element: card,
        update,
        dispose() {
            pending = null;
            gallery.dialog.close();
            releaseHeading();
            toolbar.dispose();
            card.remove();
        },
    };
}

export { createReferenceImageCard as createExhibitionReferenceCard };
