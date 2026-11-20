import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import styles from './panel.css';

function Setup({ state, run, busy }) {
  const { setup, steps } = state;
  const ready = setup.status === 'ready';
  const active = setup.status === 'running';
  return (
    <section className="kn-section">
      <h3>{ready ? 'Local search is ready' : 'Set up local search'}</h3>
      {ready ? (
        <p>Using {setup.device} for indexing. Qwen3 reranks search results locally.</p>
      ) : (
        <p>
          Download the two Qwen3 models once. The standard download is about 2.23 GB. Some
          accelerators need an extra 1.19 GB.
        </p>
      )}
      {setup.status === 'error' && <p role="alert">{setup.error}</p>}
      {!ready && (
        <button
          className="kn-primary"
          disabled={busy || active}
          onClick={() => run(() => request('/setup', 'POST'))}
        >
          {active ? 'Setting up…' : setup.status === 'error' ? 'Retry setup' : 'Set up Knowledge'}
        </button>
      )}
      <details open={!ready || undefined}>
        <summary>{ready ? 'Setup details' : 'Setup steps'}</summary>
        <ol className="kn-steps">
          {steps.map((name, i) => {
            const current = i === setup.step;
            const progress = current && active && setup.progress;
            const done = ready || i < setup.step;
            const label = done
              ? 'Done'
              : current && setup.status === 'error'
                ? 'Failed'
                : current && active
                  ? 'Working'
                  : 'Waiting';
            return (
              <li key={name}>
                <span>{name}</span>
                <small>
                  {progress
                    ? Math.min(100, Math.floor((100 * progress.received) / progress.total)) + '%'
                    : label}
                </small>
              </li>
            );
          })}
        </ol>
        {setup.notes?.map((note) => (
          <p className="kn-note" key={note}>
            {note}
          </p>
        ))}
        {ready && (
          <button disabled={busy} onClick={() => run(() => request('/setup?check=1', 'POST'))}>
            Check setup again
          </button>
        )}
      </details>
    </section>
  );
}

function Models({ settings, catalog, run, busy, refresh }) {
  const selector = (key, label, empty) => (
    <label>
      {label}
      <select
        value={settings[key]}
        disabled={busy}
        onChange={(e) => {
          const value = e.target.value;
          void run(() => request('/settings', 'PATCH', { [key]: value }));
        }}
      >
        <option value="">{empty}</option>
        {settings[key] && !catalog.models.some((m) => m.id === settings[key]) && (
          <option value={settings[key]}>{settings[key]} (unavailable)</option>
        )}
        {catalog.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.verified ? '' : ' (vision unconfirmed)'}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="kn-section">
      <h3>Reading images</h3>
      <p>
        Text and Markdown work immediately after setup. For scans and figures, choose the Harness
        models that receive those images.
      </p>
      <div className="kn-pair">
        {selector('ocrModel', 'OCR model', 'Skip OCR')}
        {selector('descriptionModel', 'Image and chart descriptions', 'Skip descriptions')}
      </div>
      {!catalog.models.length && (
        <p>Register an image-capable model in Harness Settings → Models to enable these choices.</p>
      )}
      {catalog.unavailable.length > 0 && (
        <p>Could not list models from {catalog.unavailable.join(', ')}.</p>
      )}
      <button className="kn-link" onClick={refresh}>
        Refresh model list
      </button>
    </section>
  );
}

function Advanced({ settings, run, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [JSON.stringify(settings)]);
  const select = (key, label, options) => (
    <label>
      {label}
      <select value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  const number = (key, label, max) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={max}
        required
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  const time = (key, label) => (
    <label>
      {label}
      <input
        type="time"
        required
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  const save = (e) => {
    e.preventDefault();
    const { device, schedule, threads, unloadSeconds, quietSeconds, windowStart, windowEnd } =
      draft;
    void run(() =>
      request('/settings', 'PATCH', {
        device,
        schedule,
        windowStart,
        windowEnd,
        threads: Number(threads),
        unloadSeconds: Number(unloadSeconds),
        quietSeconds: Number(quietSeconds),
      }),
    );
  };
  return (
    <details className="kn-section" onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary>Advanced hardware and scheduling</summary>
      {expanded && (
        <form onSubmit={save}>
          <div className="kn-pair">
            {select('device', 'Preferred indexing device', [
              ['auto', 'Automatic'],
              ['cpu', 'CPU'],
              ['npu', 'NPU'],
              ['gpu', 'GPU'],
              ['igpu', 'Integrated GPU'],
            ])}
            {select('schedule', 'When to index', [
              ['background', 'When Harness chat is idle'],
              ['always', 'Any time'],
              ['window', 'During a daily window'],
              ['paused', 'Pause indexing'],
            ])}
            {draft.schedule === 'window' && (
              <>
                {time('windowStart', 'Start (local time)')}
                {time('windowEnd', 'End (local time)')}
              </>
            )}
            {number('threads', 'CPU threads (0 = automatic)', 64)}
            {number('unloadSeconds', 'Unload models after idle seconds (0 = keep loaded)', 86400)}
            {number('quietSeconds', 'Wait after chat ends (seconds)', 3600)}
          </div>
          <button disabled={busy}>Save preferences</button>
        </form>
      )}
    </details>
  );
}

function Documents({ state, run, busy }) {
  const [title, setTitle] = useState(''),
    [text, setText] = useState('');
  const pick = useRef(null);
  const upload = (files) =>
    run(async () => {
      for (const file of files)
        await request('/files?name=' + encodeURIComponent(file.name), 'POST', file);
    });
  return (
    <section
      className="kn-section"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files.length) void upload([...e.dataTransfer.files]);
      }}
    >
      <h3>Documents</h3>
      <div className="kn-actions">
        <button disabled={busy} onClick={() => pick.current?.click()}>
          Add files
        </button>
        <span>Or drop Markdown, text, PDFs or images here · up to 32 MiB each</span>
      </div>
      <input
        ref={pick}
        hidden
        type="file"
        multiple
        accept=".md,.markdown,.txt,.text,.log,.pdf,.png,.jpg,.jpeg,.webp"
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          void upload(files);
        }}
      />
      <details>
        <summary>Paste text</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await request('/notes', 'POST', { title, text });
              setTitle('');
              setText('');
            });
          }}
        >
          <label>
            Title
            <input
              required
              maxLength={240}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Text
            <textarea required rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button disabled={busy}>Add text</button>
        </form>
      </details>
      {state.activity && <p role="status">{state.activity}</p>}
      {state.documents.length > 0 && (
        <ul className="kn-docs">
          {state.documents.map((doc) => (
            <li key={doc.id}>
              <div>
                <strong>{doc.title}</strong>
                <small>
                  {doc.status === 'ready'
                    ? doc.passages + (doc.passages === 1 ? ' passage' : ' passages')
                    : doc.status}
                </small>
                {doc.error && <p role="alert">{doc.error}</p>}
              </div>
              <div className="kn-actions">
                {doc.hasMarkdown ? (
                  <a href={'/knowledge/documents/' + doc.id + '/markdown'} download>
                    Download Markdown
                  </a>
                ) : null}
                {doc.status === 'error' && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => request('/documents/' + doc.id + '/retry', 'POST'))}
                  >
                    Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Search({ ready }) {
  const [query, setQuery] = useState(''),
    [hits, setHits] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function search(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setHits(null);
    try {
      setHits(await request('/search', 'POST', { query }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="kn-section">
      <h3>Search your documents</h3>
      <form className="kn-search" onSubmit={search}>
        <input
          aria-label="Search query"
          placeholder="Ask about your documents"
          required
          maxLength={2400}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button disabled={!ready || busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {hits?.length === 0 && <p>No indexed passages yet.</p>}
      {hits?.map((hit) => (
        <article key={hit.document + '/' + hit.ordinal}>
          <strong>{hit.title}</strong>
          <small>Passage {hit.ordinal + 1}</small>
          <p>{hit.text}</p>
        </article>
      ))}
    </section>
  );
}

export function Knowledge() {
  const [state, setState] = useState(null),
    [error, setError] = useState(''),
    [pollError, setPollError] = useState('');
  const [catalog, setCatalog] = useState({ models: [], unavailable: [] }),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const data = await request('/state');
    setState(data);
    setPollError('');
  }, []);
  const models = useCallback(() => {
    request('/models')
      .then(setCatalog)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let mounted = true,
      timer;
    const poll = async () => {
      try {
        const data = await request('/state');
        if (mounted) {
          setState(data);
          setPollError('');
        }
      } catch (e) {
        if (mounted) setPollError(e.message);
      } finally {
        if (mounted) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    models();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [models]);
  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="kn-app">
      <style>{styles}</style>
      <h2>Knowledge</h2>
      {(error || pollError) && <p role="alert">{error || pollError}</p>}
      {state ? (
        <>
          <Setup state={state} run={run} busy={busy} />
          {(state.setup.status === 'ready' || state.documents.length > 0) && (
            <>
              <Documents state={state} run={run} busy={busy} />
              <Search ready={state.setup.status === 'ready'} />
            </>
          )}
          <Models
            settings={state.settings}
            catalog={catalog}
            refresh={models}
            run={run}
            busy={busy}
          />
          <Advanced settings={state.settings} run={run} busy={busy} />
        </>
      ) : (
        <p>Opening your library…</p>
      )}
    </div>
  );
}
