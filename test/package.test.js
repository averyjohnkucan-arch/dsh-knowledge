import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';

// Harness reads these resources before the plugin's JavaScript is mounted.
test('the installable package includes the display metadata and icon Harness resolves', async () => {
  const metadata = JSON.parse(
    await readFile(new URL(import.meta.resolve('dsh-knowledge/locale/en.json'))),
  );
  assert.equal(metadata.meta.title, 'Knowledge');
  assert.match(metadata.meta.description, /Markdown/);
  const icon = await readFile(new URL(import.meta.resolve('dsh-knowledge/icon')), 'utf8');
  assert.match(icon, /<svg\b/);
  const npm = process.env.npm_execpath;
  const executable = npm ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [...(npm ? [npm] : []), 'pack', '--dry-run', '--json', '--ignore-scripts'];
  const { stdout } = await promisify(execFile)(executable, args);
  const files = new Set(JSON.parse(stdout)[0].files.map((file) => file.path));
  for (const resource of ['locale/en.json', 'locale/zh.json', 'icon.svg', 'dist/client.js']) {
    assert.ok(files.has(resource), 'Missing ' + resource);
  }
});
