import { fileKind } from './markdown.js';
import { visionCatalog } from './vision.js';

const base = '/knowledge';
function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function bytes(req, limit) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit)
      throw Object.assign(new Error('This file exceeds the upload limit.'), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function body(req) {
  return JSON.parse((await bytes(req, 8 * 1024 * 1024)).toString('utf8'));
}

export function knowledgeRoute(library, connection) {
  return {
    kind: 'prefix',
    path: base,
    async handler(req, res) {
      try {
        // A raw webServer route owns admission. Use Harness's signed browser
        // session and trusted-host policy for downloads as well as mutations.
        const rejection = connection.requestRejection(req);
        if (rejection)
          return json(res, rejection, {
            error: 'Open Knowledge from your signed-in Harness window.',
          });
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname.slice(base.length);
        const method = req.method;
        if (req.headers['sec-fetch-site'] === 'cross-site') {
          return json(res, 403, { error: 'Open Knowledge inside Harness.' });
        }
        if (method !== 'GET' && req.headers['x-knowledge-ui'] !== '1')
          return json(res, 403, { error: 'Missing Knowledge request header.' });
        if (path === '/state' && method === 'GET') return json(res, 200, library.snapshot());
        if (path === '/models' && method === 'GET')
          return json(res, 200, await visionCatalog(library.ctx));
        if (path === '/setup' && method === 'POST')
          return json(res, 202, library.engine.start(url.searchParams.get('check') === '1'));
        if (path === '/settings' && method === 'PATCH')
          return json(res, 200, await library.configure(await body(req)));
        if (path === '/notes' && method === 'POST') {
          const { title, text } = await body(req);
          if (typeof text !== 'string' || !text.trim()) throw new Error('Paste some text first.');
          return json(res, 202, library.add(title, 'txt', Buffer.from(text)));
        }
        if (path === '/files' && method === 'POST') {
          const name = url.searchParams.get('name') || '';
          const kind = fileKind(name);
          return json(res, 202, library.add(name, kind, await bytes(req, 32 * 1024 * 1024)));
        }
        if (path === '/search' && method === 'POST')
          return json(res, 200, await library.search((await body(req)).query));
        const doc = path.match(/^\/documents\/([a-f0-9-]{36})\/(markdown|retry)$/);
        if (doc && doc[2] === 'retry' && method === 'POST') {
          library.retry(doc[1]);
          return json(res, 202, { queued: true });
        }
        if (doc && doc[2] === 'markdown' && method === 'GET') {
          const row = library.store.markdown(doc[1]);
          if (!row?.markdown) return json(res, 404, { error: 'Markdown is not available yet.' });
          const name = row.title.replace(/\.(pdf|txt|md|markdown|png|webp|jpe?g)$/i, '') + '.md';
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
            'content-disposition':
              "attachment; filename*=UTF-8''" + encodeURIComponent(name).replace(/'/g, '%27'),
          });
          return res.end(row.markdown);
        }
        json(res, 404, { error: 'Unknown Knowledge route.' });
      } catch (error) {
        json(res, error.status || 400, { error: error.message });
      }
    },
  };
}
