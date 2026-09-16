// Shared ComfyUI upload transport; callers own selection/lifecycle validation.
export async function uploadBadgeImage(api, blob) {
    if (!blob?.type?.startsWith('image/')) throw new Error('请选择图片文件。');
    const form = new FormData();
    form.append('image', blob); form.append('type', 'input');
    const response = await api.fetchApi('/upload/image', { method: 'POST', body: form });
    if (!response.ok) throw new Error('上传失败，请重试。');
    const data = await response.json();
    if (!data.name) throw new Error('上传未返回图片文件名。');
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}
