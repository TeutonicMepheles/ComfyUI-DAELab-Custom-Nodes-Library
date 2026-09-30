// Only the server determines the actual region; the browser displays its labels.
export async function fetchRegionGeometry87(api, request) {
    const response = await api.fetchApi('/daelab/badge87/region-geometry', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(request),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Region preview failed (${response.status})`);
    const image = new Image(); image.src = result.labels; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const context=canvas.getContext('2d',{willReadFrequently:true}); context.drawImage(image,0,0);
    return {...result,width:image.width,height:image.height,pixels:context.getImageData(0,0,image.width,image.height).data};
}

export function renderRegionGeometry87(source, geometry, view, selectedId=null) {
    if (source.length !== geometry.pixels.length) throw new Error('Region preview canvas mismatch.');
    const selected = selectedId ? geometry.ids.indexOf(selectedId)+1 : 0;
    const output = new Uint8ClampedArray(source);
    for (let i=0;i<source.length;i+=4) {
        const owner=geometry.pixels[i];
        const hit=owner>0 && (!selectedId || (selected>0 && owner===selected));
        if (view==='mask') { output[i]=output[i+1]=output[i+2]=hit?255:0; output[i+3]=255; }
        else if (view==='overlay' && hit) [20,220,180].forEach((v,c)=>output[i+c]=Math.round(source[i+c]*.55+v*.45));
        else if (view==='overlay' && selectedId) for(let c=0;c<3;c++)output[i+c]*=.4;
    }
    return output;
}
