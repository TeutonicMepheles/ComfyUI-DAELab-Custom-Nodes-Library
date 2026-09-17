import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
import { localTargets87, targetKey87, selectGeneratedTarget87 } from './badge_result_target_87.mjs?v=20260917-target87-1';
import { buildImageViewPath } from './app_mode_load_image_preview_model.mjs';

// Reuse the existing gallery card styles and LoadImage selection contract.
export function createResultPicker87(graph, {session, live, imageURL, onChange}) {
    const element = document.createElement('section');
    element.className = 'badge-result-picker';
    element.setAttribute('aria-label', badgeText("result_picker_87.text_001"));
    let signature = '';
    let expandedBatch = '';
    function update() {
        const targets = localTargets87(graph);
        element.hidden = targets.source !== 'generated';
        const batch = JSON.stringify(targets.results);
        const key = JSON.stringify([targets.source, targets.generated, targets.results, targets.pendingResults, Boolean(session.busy), expandedBatch]);
        if (key === signature) return;
        signature = key;
        const hadFocus = element.contains(document.activeElement);
        const scrollLeft = element.querySelector('.badge-result-grid')?.scrollLeft || 0;
        element.replaceChildren();
        const current = targets.results.findIndex(image => targetKey87(image) === targetKey87(targets.generated));
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        status.textContent = !targets.generated ? badgeText("result_picker_87.text_002") : current < 0 ? badgeText("result_picker_87.text_003") : badgeText("result_picker_87.text_004", {p0: (targets.results.length), p1: (current + 1)});
        if (session.busy) status.textContent += badgeText("result_picker_87.text_005");
        element.append(status);
        if (targets.pendingResults && expandedBatch !== batch) {
            const view = document.createElement('button'); view.type = 'button';
            view.textContent = badgeText("result_picker_87.text_006", {p0: (targets.results.length)});
            view.disabled = Boolean(session.busy);
            view.onclick = () => { if (!live() || session.busy) return; expandedBatch = batch; update(); };
            element.append(view);
            return;
        }
        if (targets.results.length < 2 && current >= 0) return;
        const grid = document.createElement('div'); grid.className = 'badge-build-gallery-grid badge-result-grid';
        grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', badgeText("result_picker_87.text_007"));
        element.append(grid);
        const images = current < 0 && targets.generated ? [targets.generated, ...targets.results] : targets.results;
        images.forEach((image, index) => {
            const selected = targetKey87(image) === targetKey87(targets.generated);
            const label = current < 0 && index === 0 ? badgeText("result_picker_87.text_008") : badgeText("result_picker_87.text_009", {p0: (current < 0 && targets.generated ? index : index + 1)});
            const card = document.createElement('button'); card.type = 'button'; card.className = 'badge-build-image-card';
            card.setAttribute('aria-pressed', String(selected)); card.setAttribute('aria-label', `${label}${selected ? badgeText("result_picker_87.text_010") : badgeText("result_picker_87.text_011")}`);
            card.disabled = Boolean(session.busy);
            const thumb = document.createElement('img'); thumb.alt = ''; thumb.loading = 'lazy'; thumb.src = imageURL(buildImageViewPath(image));
            const caption = document.createElement('span'); caption.textContent = `${selected ? '✓ ' : ''}${label}`;
            thumb.onerror = () => { thumb.hidden = true; caption.textContent += badgeText("result_picker_87.text_012"); };
            card.append(thumb, caption); grid.append(card);
            card.onclick = () => {
                if (!live() || session.busy) return;
                selectGeneratedTarget87(graph, image, session); update(); onChange();
            };
        });
        grid.scrollLeft = scrollLeft;
        const selectedCard = grid.querySelector('[aria-pressed="true"]');
        if (selectedCard && element.isConnected && !element.hidden) {
            if (hadFocus && !session.busy) selectedCard.focus({preventScroll: true});
            const cardBox = selectedCard.getBoundingClientRect(), gridBox = grid.getBoundingClientRect();
            if (cardBox.left < gridBox.left) grid.scrollLeft -= gridBox.left - cardBox.left;
            else if (cardBox.right > gridBox.right) grid.scrollLeft += cardBox.right - gridBox.right;
        }
    }
    return {element, update};
}
