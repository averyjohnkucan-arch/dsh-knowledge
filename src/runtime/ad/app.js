'use strict'
const root = '/knowledge/reader/'
const el = id => document.getElementById(id)
const trail = []
let expires, generation = 0, authVersion = 0
function signIn() {
  authVersion++; generation++
  clearTimeout(expires)
  trail.length = 0
  for (const id of ['items','hits','identity','status']) el(id).replaceChildren()
  el('fields').replaceChildren(); el('groupFields').replaceChildren(); el('admin').hidden = true
  el('results').hidden = el('logout').hidden = el('library').hidden = true
  el('login').hidden = false
}
async function api(path, body) {
  const version = authVersion
  const response = await fetch(root + path, { credentials: 'same-origin', cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  if (version !== authVersion) throw new Error('The sign-in session changed.')
  if (!response.ok) {
    if (response.status === 401) signIn()
    throw new Error(value.error || 'The reader is unavailable.')
  }
  return value
}
function error(e) { el('status').textContent = e.message }
function link(label, href) {
  const a = document.createElement('a')
  a.textContent = label; a.href = href; a.target = '_blank'; a.rel = 'noopener'
  return a
}
async function browse() {
  const current = trail.at(-1), request = ++generation
  el('items').replaceChildren()
  el('folder').textContent = current?.name || 'Knowledge bases'
  el('back').hidden = !current
  const params = new URLSearchParams()
  if (current) params.set('baseId', trail[0].id)
  if (current?.kind === 'folder') params.set('folderId', current.id)
  const rows = await api('browse?' + params)
  if (request !== generation) return
  for (const row of rows) {
    const li = document.createElement('li')
    if (row.kind === 'file') {
      li.append(link(row.name, row.href), ' · ', link('Download Markdown',row.href + '?download=1'), ' · ', link('Original',row.href.replace(/\/markdown$/, '/original')))
    } else {
      const btn = document.createElement('button'); btn.textContent = row.name
      btn.onclick = () => { trail.push(row); browse().catch(error) }; li.append(btn)
    }
    el('items').append(li)
  }
  el('status').textContent = rows.length ? '' : 'No accessible items here.'
}
async function showSession(session) {
  authVersion++
  el('identity').textContent = session.name
  el('login').hidden = true
  el('logout').hidden = el('library').hidden = false
  clearTimeout(expires)
  expires = setTimeout(signIn, Math.max(0, session.expires - Date.now()))
  const settingsOnly = new URL(location.href).searchParams.get('view') === 'settings'
  el('library').hidden = settingsOnly || !session.permissions.includes('read')
  if (!el('library').hidden) await browse()
  await showAdmin(session.permissions)
  if (settingsOnly && el('admin').hidden) el('status').textContent = 'Your AD groups have no Knowledge administration permissions.'
}
el('login').onsubmit = async event => {
  event.preventDefault()
  const form = event.currentTarget, body = Object.fromEntries(new FormData(form))
  form.elements.password.value = ''
  try { await showSession(await api('login', body)) } catch (e) { error(e) }
}
el('logout').onclick = async () => {
  try { await api('logout', {}); signIn() } catch (e) { error(e) }
}
el('back').onclick = () => { trail.pop(); browse().catch(error) }
el('search').onsubmit = async event => {
  event.preventDefault()
  const query = new FormData(event.currentTarget).get('query'), request = ++generation
  el('hits').replaceChildren(); el('results').hidden = false; el('status').textContent = 'Searching…'
  try {
    const { hits } = await api('search', { query, ...(trail[0] ? { baseId: trail[0].id } : {}) })
    if (request !== generation) return
    for (const hit of hits) {
      const li = document.createElement('li'), p = document.createElement('p')
      p.textContent = hit.text; li.append(link(hit.title,hit.citation),p); el('hits').append(li)
    }
    el('status').textContent = hits.length ? '' : 'No accessible matches.'
  } catch (e) { error(e) }
}
api('session').then(showSession).catch(e => { signIn(); if (!e.message.startsWith('Sign in')) error(e) })


const permissionNames = {read:'Read knowledge',settings:'Change KB settings',sync:'Sync Windows folders',models:'Set up OCR and search models'}
const fieldNames = {searchMode:'Search mode',topK:'Results per search',similarityThreshold:'Minimum relevance',siblingChunks:'Surrounding chunks',
  chunkSize:'Chunk size',chunkOverlap:'Chunk overlap',keepInternalMarkdown:'Keep internal Markdown',ocrEnabled:'Enable OCR'}
let permissions = [], policyVersion = '', settingsView = 0
function field(container, name, label, control) {
  const wrapper = document.createElement('label'); wrapper.textContent = label
  control.name = name; wrapper.append(control); container.append(wrapper); return control
}
function option(select, value, text) {
  const o = document.createElement('option'); o.value = value; o.textContent = text; select.append(o)
}
async function showAdmin(grants) {
  permissions = grants
  const managed = grants.some(g => ['settings','sync','models'].includes(g))
  el('admin').hidden = !managed && !grants.includes('policy')
  el('scopeLabel').hidden = !managed
  el('policy').hidden = !grants.includes('policy')
  el('groupFields').replaceChildren()
  if (grants.includes('policy')) {
    const policy = await api('admin/policy'); policyVersion = policy.version
    for (const [key,label] of Object.entries(permissionNames)) {
      const area = field(el('groupFields'),key,label,document.createElement('textarea'))
      area.rows = 2; area.value = policy.groups[key].join('\n')
    }
  }
  el('scope').replaceChildren()
  if (managed) {
    if (grants.includes('settings')) option(el('scope'),'','Global defaults')
    for (const base of await api('admin/bases')) option(el('scope'),base.id,base.name)
  }
  await loadSettings()
}
async function loadSettings() {
  const seq = ++settingsView, id = el('scope').value
  el('sync').hidden = !id || !permissions.includes('sync')
  el('models').hidden = !id || !permissions.includes('models')
  el('settings').hidden = !permissions.includes('settings')
  el('fields').replaceChildren()
  if (el('settings').hidden) return
  const data = await api('admin/settings' + (id ? '?baseId=' + encodeURIComponent(id) : ''))
  if (seq !== settingsView || el('admin').hidden) return
  for (const [key,label] of Object.entries(fieldNames)) {
    const control = field(el('fields'),key,label,document.createElement(key === 'searchMode' ? 'select' : 'input'))
    if (key === 'searchMode') {
      for (const v of ['auto','hybrid','vector','lexical']) option(control,v,v)
      control.value = data[key]
    } else if (typeof data[key] === 'boolean') {
      control.type = 'checkbox'; control.checked = data[key]
    } else {
      control.type = 'number'; control.step = key === 'similarityThreshold' ? '0.01' : '1'; control.required = true; control.value = data[key]
    }
  }
}
el('scope').onchange = () => loadSettings().catch(error)
el('settings').onsubmit = async event => {
  event.preventDefault(); const changes = {}
  for (const input of el('fields').querySelectorAll('[name]')) {
    changes[input.name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.valueAsNumber : input.value
  }
  try { await api('admin/settings',{baseId:el('scope').value || undefined,changes}); el('status').textContent = 'Settings saved.' } catch(e) { error(e) }
}
el('policy').onsubmit = async event => {
  event.preventDefault()
  const groups = Object.fromEntries([...el('groupFields').querySelectorAll('textarea')].map(area => [area.name,area.value.split('\n').map(x => x.trim()).filter(Boolean)]))
  try {
    const result = await api('admin/policy',{version:policyVersion,groups}); policyVersion = result.version
    el('status').textContent = 'AD group permissions saved.'
    await showAdmin((await api('session')).permissions)
  } catch(e) { error(e) }
}
for (const key of ['sync','models']) el(key).onclick = async () => {
  try {
    const res = await api('admin/' + key,{baseId:el('scope').value})
    el('status').textContent = key === 'sync' ? 'Folder sync queued.' : 'Model setup: ' + res.status
  } catch(e) { error(e) }
}
