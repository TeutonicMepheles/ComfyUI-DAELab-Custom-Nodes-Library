// Decorative icons only; the existing buttons retain their names and handlers.
const paths = {
    color: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6.4 17 3 12 3ZM7 10h.01M10 7h.01M15 7h.01M18 10h.01',
    brush: 'm14 4 6 6M4 20l5-1L21 7l-4-4L5 15l-1 5ZM5 15l4 4',
    text: 'M4 5h16v12H9l-5 4V5ZM8 9h8M8 13h5',
    material: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
    image: 'M3 4h18v16H3V4Zm0 12 5-5 4 4 3-3 6 6M15 8h.01',
    map: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
};
export function decorateExclusivePair(container, buttons, icons) {
    container.classList.add('badge-exclusive-pair');
    buttons.forEach((button, i) => {
        const label = document.createElement('span'); label.textContent = button.textContent;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(key,value);
        const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d',paths[icons[i]]); svg.append(path);
        button.replaceChildren(svg,label);
    });
}
