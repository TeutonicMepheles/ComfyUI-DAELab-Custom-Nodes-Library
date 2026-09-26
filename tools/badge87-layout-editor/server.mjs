import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const base = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(base, '../..');
const workflowFile = path.resolve(repo, '../../user/default/workflows/#8.7 - Badge Workflow.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/model.mjs', ['model.mjs', 'text/javascript']],
  ['/editor.css', ['editor.css', 'text/css']],
  ['/vendor/grapes.min.js', ['node_modules/grapesjs/dist/grapes.min.js', 'text/javascript']],
  ['/vendor/grapes.min.css', ['node_modules/grapesjs/dist/css/grapes.min.css', 'text/css']],
]);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Local, read-only service: no workflow mutation, queue proxy or filesystem write API.
  if (req.method !== 'GET') { res.writeHead(405); res.end('Read only'); return; }
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/source.json') {
      const [raw, text] = await Promise.all([
        readFile(workflowFile, 'utf8'), readFile(path.join(repo, 'content/badge87/ui.zh-CN.json'), 'utf8'),
      ]);
      const graph = JSON.parse(raw), layout = graph.extra?.daelabAppLayoutV1;
      if (graph.extra?.daelabBadgeExecutionV1?.version !== 1 || !layout) throw new Error('Expected Badge 8.7 workflow');
      const local = layout.tabs.find(tab => tab.id === 'local');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // Do not expose prompt values, image paths, keys or unrelated graph metadata.
      res.end(JSON.stringify({
        workflowName: path.basename(workflowFile), workflowHash: hash(raw), textHash: hash(text),
        stage: 'local', stageTitle: local.title, inputKeys: local.inputKeys,
        nodes: graph.nodes.filter(n => local.inputKeys.some(k => k.includes(`:${n.id}:`)))
          .map(n => ({ id: n.id, type: n.type })),
        messages: JSON.parse(text).messages,
      }));
      return;
    }
    const route = routes.get(pathname);
    if (!route) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(path.join(base, route[0]));
    res.setHeader('Content-Type', `${route[1]}; charset=utf-8`); res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Editor source unavailable: ${error.message}`);
  }
});
const port = Number(process.env.BADGE_EDITOR_PORT || 8177);
server.listen(port, '127.0.0.1', () => console.log(`Badge 8.7 Layout Studio: http://127.0.0.1:${port}`));
