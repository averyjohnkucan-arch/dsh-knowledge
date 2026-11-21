#!/usr/bin/env node
// Exercise a running local Harness through the same endpoints as base Settings,
// Upload file, indexed Markdown and Recall Test. Use a small PDF with a known phrase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [origin, file, phrase] = process.argv.slice(2);
if (!origin || !file || !phrase) throw new Error('Usage: node scripts/smoke-document-setup.mjs http://127.0.0.1:PORT sample.pdf "expected phrase"');
const url = new URL(origin);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password)
  throw new Error('Use a loopback Harness URL.');
const source = await readFile(file);
if (source.subarray(0,5).toString() !== '%PDF-') throw new Error('Expected a PDF file.');

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const result = await fetch(new URL('/knowledge' + path, url.origin), { method,
    headers: { 'content-type':'application/json', 'x-dsh-mineru-management':'1' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await result.json();
  if (!result.ok || !data.ok) throw new Error(data.error?.message || 'Harness returned HTTP ' + result.status);
  return data.value;
}
async function poll(path, complete) {
  const deadline = Date.now() + 60 * 60_000;
  let previous;
  while (Date.now() < deadline) {
    const state = await api(path);
    const label = state.stage || state.indexingPhase || state.status;
    if (label !== previous) { console.log(label); previous = label; }
    if (['error','failed'].includes(state.status)) throw new Error(state.error || state.embeddingError || state.status);
    if (state.status === complete) return state;
    await delay(1500);
  }
  throw new Error('Timed out waiting for ' + complete);
}

const { id } = await api('/bases', { name: 'OCR smoke ' + new Date().toISOString() });
try {
  const setup = '/local-setup/bases/' + id;
  await api(setup, {});
  const ready = await poll(setup, 'ready');
  const imported = await api('/bases/' + id + '/files-batch', { conflict:'rename',
    files:[{fileName:basename(file), mimeType:'application/pdf', contentBase64:source.toString('base64')}] });
  const doc = imported.accepted[0].id;
  await poll('/documents/' + doc + '/status', 'completed');
  const document = (await api('/bases/' + id + '/documents')).find(row => row.id === doc);
  const snapshot = await api('/documents/' + doc + '/markdown/' + document.markdownRevision + '?format=json');
  assert.ok(snapshot.text.includes(phrase), 'Expected phrase missing from indexed Markdown');
  const chunks = await api('/documents/' + doc + '/chunks');
  assert.ok(chunks.length && chunks.every(row => row.embedding?.length === 1024), 'Missing Qwen vectors');
  const search = await api('/search', {baseId:id, query:phrase, topK:5, threshold:0});
  assert.ok(search.hits.some(hit => hit.docId === doc && hit.vectorScore !== undefined), 'No vector-backed hit for the PDF');
  assert.equal(document.processing.provider, 'ovis-local');
  console.log(JSON.stringify({backend:ready.backend, pages:document.processing.pageCount, chunks:chunks.length,
    dimensions:chunks[0].embedding.length, reranked:search.reranked},null,2));
} finally {
  await api('/bases/' + id, undefined, 'DELETE');
}
