import { imagePoint } from './badge_build_preview_model.mjs';
// In-page picker avoids depending on the embedded browser's native color popup.
export function attachBadgeColorPicker(root, canvas, prepareSource, sample, live) {
    let target=null, sampling=false;
    const loupe = document.createElement('div'); loupe.hidden = true; loupe.setAttribute('aria-hidden', 'true');
    loupe.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;background:#20262d;border:2px solid white;border-radius:8px;padding:4px;color:white;box-shadow:0 3px 14px #0009;font:12px monospace';
    const zoom = document.createElement('canvas'); zoom.width = zoom.height = 132; zoom.style.display = 'block';
    const pixelLabel = document.createElement('div'); pixelLabel.style.textAlign = 'center'; loupe.append(zoom, pixelLabel); document.body.append(loupe);
    const cursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 27l3-8L21 5l6 6L13 25z" fill="white" stroke="black" stroke-width="2"/><path d="M18 5l9 9M4 27l5-2" stroke="black" stroke-width="3"/></svg>')}") 4 27, crosshair`;
    function move(e) {
        if (!sampling || !live()) { loupe.hidden = true; return; }
        const r = canvas.getBoundingClientRect();
        const point = imagePoint(e.clientX-r.left, e.clientY-r.top, r.width, r.height, canvas.width, canvas.height);
        const value = point && sample(e);
        if (!value) { loupe.hidden = true; return; }
        const ctx = zoom.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#333'; ctx.fillRect(0,0,132,132);
        const [x,y] = point;
        const left = Math.max(0,x-5), top = Math.max(0,y-5), right = Math.min(canvas.width,x+6), bottom = Math.min(canvas.height,y+6);
        ctx.drawImage(canvas,left,top,right-left,bottom-top,(left-x+5)*12,(top-y+5)*12,(right-left)*12,(bottom-top)*12);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(60,60,12,12); ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.strokeRect(59,59,14,14);
        pixelLabel.textContent = value.toUpperCase(); loupe.hidden = false;
        loupe.style.left = `${Math.max(4,Math.min(e.clientX+22,innerWidth-148))}px`;
        loupe.style.top = `${Math.max(4,Math.min(e.clientY+22,innerHeight-170))}px`;
    }
    const leave = () => { loupe.hidden = true; };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
    const panel=document.createElement('div');panel.className='badge-color-popup';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','选择区域颜色');
    panel.innerHTML='<strong>选择颜色</strong><canvas width="240" height="130" aria-label="颜色面板"></canvas><label>色相 <input type="range" min="0" max="360" value="180"></label><label>色号 <input type="text" maxlength="7" aria-label="选色色号"></label><div><button type="button" data-pick>从参考图吸色</button><button type="button" data-apply>应用</button><button type="button" data-close>取消</button></div>';
    document.body.append(panel);
    const palette=panel.querySelector('canvas'),hue=panel.querySelector('input[type=range]'),hex=panel.querySelector('input[type=text]');
    function paint(){const c=palette.getContext('2d');c.fillStyle=`hsl(${hue.value} 100% 50%)`;c.fillRect(0,0,240,130);let g=c.createLinearGradient(0,0,240,0);g.addColorStop(0,'white');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,240,130);g=c.createLinearGradient(0,0,0,130);g.addColorStop(0,'transparent');g.addColorStop(1,'black');c.fillStyle=g;c.fillRect(0,0,240,130);}
    function close(){loupe.hidden=true;panel.hidden=true;sampling=false;canvas.style.cursor='';target=null;}
    function apply(value){if(!/^#[0-9a-f]{6}$/i.test(value)){hex.setCustomValidity('请输入六位色号');hex.reportValidity();return;}if(target?.isConnected&&live()){target.value=value;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));}close();}
    function open(e){const input=e.target.closest?.('input[type=color]');if(!input||!root.contains(input)||input.disabled)return;e.preventDefault();e.stopImmediatePropagation();prepareSource();target=input;hex.value=input.value;hex.setCustomValidity('');panel.hidden=false;loupe.hidden=true;sampling=false;canvas.style.cursor='';const r=input.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(r.left,innerWidth-280))}px`;panel.style.top=`${Math.max(8,Math.min(r.bottom+6,innerHeight-275))}px`;paint();}
    root.addEventListener('click',open,true);
    hue.oninput=paint;hex.oninput=()=>hex.setCustomValidity('');
    palette.onclick=e=>{const r=palette.getBoundingClientRect(),x=Math.min(239,Math.max(0,Math.floor((e.clientX-r.left)*240/r.width))),y=Math.min(129,Math.max(0,Math.floor((e.clientY-r.top)*130/r.height)));hex.value='#'+[...palette.getContext('2d').getImageData(x,y,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');};
    panel.querySelector('[data-apply]').onclick=()=>apply(hex.value);
    panel.querySelector('[data-close]').onclick=close;
    panel.querySelector('[data-pick]').onclick=()=>{sampling=true;panel.hidden=true;prepareSource();canvas.style.cursor=cursor;};
    const pick=e=>{if(!sampling)return;const value=sample(e);if(value){e.preventDefault();e.stopImmediatePropagation();apply(value);}};
    canvas.addEventListener('click',pick,true);
    const key=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',key);
    return {close,dispose(){close();loupe.remove();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);panel.remove();root.removeEventListener('click',open,true);canvas.removeEventListener('click',pick,true);document.removeEventListener('keydown',key);}};
}
