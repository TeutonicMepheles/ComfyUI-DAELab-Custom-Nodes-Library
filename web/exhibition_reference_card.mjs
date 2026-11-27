import { buildImageViewPath, normalizeImageSelection } from './app_mode_load_image_preview_model.mjs';
import { isNodeAvailableInAppMode } from './app_mode_bypass_model.mjs';
import { localImageFromDrop } from './badge_image_drop_87.mjs';
import { createReferenceImageGallery, referenceImageIcon } from './reference_image_controls.mjs';
import { bindCreativeButton } from './vendor/generation-ui-shared/creative_button.mjs';

export function createExhibitionReferenceCard({ sourceNode, fold, live, imageURL, uploadImage, setImage }) {
    const card = document.createElement('section');
    card.className = 'cnl-expo-original';
    const releases = [];
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
    const heading = button('参考图配置', card, () => {
        fold.setCollapsed(!fold.collapsed());
        if (fold.collapsed()) gallery.dialog.close();
        update();
    });
    heading.className = 'cnl-expo-reference-heading';
    const body = make('div');
    const actions = make('div', '', body);
    actions.className = 'cnl-expo-reference-actions';
    const filename = make('span', '', actions);
    const file = make('input', '', body);
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    const upload = referenceImageIcon(make, button, actions, '上传 / 替换图片', 'upload-2-line', () => file.click());
    const browse = referenceImageIcon(make, button, actions, '浏览已上传图片', 'folder-image-line', () => gallery.open());
    browse.setAttribute('aria-haspopup', 'dialog');
    const frame = make('div', '', body);
    frame.className = 'cnl-expo-reference-frame';
    const preview = make('img', '', frame);
    preview.alt = '空间原图';
    const missing = make('span', '尚未上传空间原图', frame);
    const footer = make('div', '', body);
    footer.className = 'cnl-expo-reference-footer';
    const status = make('span', '', footer);
    status.setAttribute('role', 'status');
    const download = button('下载图片', footer, () => {
        const selection = normalizeImageSelection(widget()?.value);
        if (!live() || !selection || !preview.naturalWidth) return;
        const link = document.createElement('a');
        link.href = imageURL(buildImageViewPath(selection));
        link.download = selection.filename;
        link.click();
    });
    const gallery = createReferenceImageGallery({
        make, button, sourceNode, imageWidget: widget, live: available, select: selectImage, imageURL, opener: () => browse,
    });
    for (const control of [heading, upload, browse, download]) releases.push(bindCreativeButton(control));

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
    frame.ondragover = event => {
        if (!available()) return;
        event.preventDefault();
        frame.dataset.drag = 'true';
    };
    frame.ondragleave = () => delete frame.dataset.drag;
    frame.ondrop = event => {
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
        download.disabled = preview.hidden;
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
        const emptyMessage = selection ? '无法显示空间原图' : '尚未上传空间原图';
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
            releases.forEach(release => release());
            card.remove();
        },
    };
}
