import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { knowledgeRoute } from '../src/host/http.js';

test('the library delegates reads and downloads to Harness admission and guards mutations', async (t) => {
  let checked = 0;
  const connection = {
    requestRejection(req) {
      checked++;
      return req.headers.cookie === 'fixture=owner' ? undefined : 401;
    },
  };
  const library = {
    snapshot: () => ({ documents: [] }),
    store: { markdown: () => ({ title: 'Notes', markdown: '# Notes\n' }) },
  };
  const route = knowledgeRoute(library, connection);
  const server = createServer(route.handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/knowledge';
  const id = '11111111-1111-1111-1111-111111111111';
  for (const path of ['/state', '/documents/' + id + '/markdown'])
    assert.equal((await fetch(url + path)).status, 401);
  const headers = { cookie: 'fixture=owner' };
  assert.equal((await fetch(url + '/state', { headers })).status, 200);
  assert.equal((await fetch(url + '/setup', { method: 'POST', headers })).status, 403);
  assert.equal(
    (await fetch(url + '/state', { headers: { ...headers, 'sec-fetch-site': 'cross-site' } }))
      .status,
    403,
  );
  assert.equal(
    await (await fetch(url + '/documents/' + id + '/markdown', { headers })).text(),
    '# Notes\n',
  );
  assert.equal(checked, 6);
});
