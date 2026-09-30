import { badgeText } from './badge_ui_text.mjs?v=20260917-simple-1';
// Shared ComfyUI upload transport; callers own selection/lifecycle validation.
export async function uploadBadgeImage(api, blob) {
    if (!blob?.type?.startsWith('image/')) throw new Error(badgeText("image_upload.text_001"));
    const form = new FormData();
    form.append('image', blob); form.append('type', 'input');
    const response = await api.fetchApi('/upload/image', { method: 'POST', body: form });
    if (!response.ok) throw new Error(badgeText("image_upload.text_002"));
    const data = await response.json();
    if (!data.name) throw new Error(badgeText("image_upload.text_003"));
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}
