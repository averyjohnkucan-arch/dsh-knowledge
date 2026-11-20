window.__ModuleLoader__.load({id:"dsh-knowledge",factory(require){const module={exports:{}};
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react2 = require("react");

// src/client/Knowledge.jsx
var import_react = require("react");

// src/client/api.js
async function request(path, method = "GET", data) {
  const file = typeof File !== "undefined" && data instanceof File;
  const headers = method === "GET" ? {} : { "x-knowledge-ui": "1" };
  if (data !== void 0 && !file) headers["content-type"] = "application/json";
  const response = await fetch("/knowledge" + path, {
    method,
    headers,
    body: file ? data : data === void 0 ? void 0 : JSON.stringify(data)
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Harness could not reach Knowledge.");
  }
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

// src/client/panel.css
var panel_default = ".kn-app {\n  --kn-rule: color-mix(in srgb, currentColor 18%, transparent);\n  --kn-muted: color-mix(in srgb, currentColor 76%, transparent);\n  font:\n    14px/1.5 system-ui,\n    sans-serif;\n  color: inherit;\n  max-width: 48rem;\n  margin: 0 auto;\n  padding: 1.2rem;\n  text-align: left;\n}\n.kn-app h2 {\n  font-size: 1.55rem;\n  margin: 0 0 1rem;\n}\n.kn-app h3 {\n  font-size: 1.05rem;\n  margin: 0 0 0.5rem;\n}\n.kn-app p {\n  margin: 0.4rem 0 0.7rem;\n}\n.kn-app .kn-section {\n  padding: 1rem 0;\n  border-top: 1px solid var(--kn-rule);\n}\n.kn-app input,\n.kn-app select,\n.kn-app textarea,\n.kn-app button {\n  font: inherit;\n  color: inherit;\n}\n.kn-app input:not([hidden]),\n.kn-app select,\n.kn-app textarea {\n  background: transparent;\n  border: 1px solid var(--kn-rule);\n  border-radius: 0.4rem;\n  padding: 0.45rem 0.6rem;\n  min-width: 0;\n  width: 100%;\n  box-sizing: border-box;\n}\n.kn-app option {\n  color: CanvasText;\n  background: Canvas;\n}\n.kn-app button,\n.kn-close {\n  background: transparent;\n  color: inherit;\n  border: 1px solid var(--kn-rule, currentColor);\n  border-radius: 0.45rem;\n  padding: 0.4rem 0.8rem;\n  cursor: pointer;\n}\n.kn-app button:disabled {\n  opacity: 0.52;\n  cursor: default;\n}\n.kn-app .kn-primary {\n  background: #385bb4;\n  border-color: #385bb4;\n  color: white;\n  font-weight: 600;\n}\n.kn-app label {\n  display: grid;\n  gap: 0.25rem;\n  margin: 0.5rem 0;\n}\n.kn-app summary {\n  cursor: pointer;\n  font-weight: 600;\n  margin: 0.55rem 0;\n}\n.kn-pair,\n.kn-search {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 0 0.8rem;\n}\n.kn-search {\n  grid-template-columns: minmax(0, 1fr) auto;\n}\n.kn-steps {\n  padding-left: 1.6rem;\n}\n.kn-steps li {\n  margin: 0.25rem 0;\n}\n.kn-app small {\n  color: var(--kn-muted);\n  margin-left: 0.55rem;\n}\n.kn-actions {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 0.65rem;\n}\n.kn-actions span,\n.kn-app .kn-note {\n  color: var(--kn-muted);\n  font-size: 0.85rem;\n}\n.kn-docs {\n  padding: 0;\n  list-style: none;\n}\n.kn-docs li {\n  border-top: 1px solid var(--kn-rule);\n  padding: 0.65rem 0;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 0.5rem;\n  flex-wrap: wrap;\n}\n.kn-app strong,\n.kn-app p {\n  overflow-wrap: anywhere;\n}\n.kn-app a,\n.kn-app .kn-link {\n  text-decoration: underline;\n  color: inherit;\n}\n.kn-app .kn-link {\n  border: 0;\n  padding: 0.2rem 0;\n}\n.kn-app article {\n  border-left: 2px solid var(--kn-rule);\n  padding: 0.2rem 0.8rem;\n  margin-top: 0.75rem;\n}\n.kn-dialog {\n  background: Canvas;\n  color: CanvasText;\n  color-scheme: light dark;\n  border: 1px solid color-mix(in srgb, currentColor 15%, transparent);\n  border-radius: 0.9rem;\n  padding: 0;\n  width: min(50rem, 94vw);\n  max-height: 88vh;\n}\n.kn-dialog::backdrop {\n  background: rgb(0 0 0/0.55);\n}\n.kn-dialog .kn-close {\n  position: absolute;\n  top: 1.1rem;\n  right: 1.1rem;\n}\n@media (max-width: 600px) {\n  .kn-pair {\n    grid-template-columns: 1fr;\n  }\n  .kn-app {\n    padding: 0.85rem;\n  }\n}\n\n.kn-app .kn-steps {\n  max-width: 32rem;\n}\n.kn-steps li {\n  border-bottom: 1px solid var(--kn-rule);\n  padding: 0.22rem 0;\n}\n.kn-steps li small {\n  float: right;\n  font-variant-numeric: tabular-nums;\n}\n";

// src/client/Knowledge.jsx
var import_jsx_runtime = require("react/jsx-runtime");
function Setup({ state, run, busy }) {
  const { setup, steps } = state;
  const ready = setup.status === "ready";
  const active = setup.status === "running";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "kn-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: ready ? "Local search is ready" : "Set up local search" }),
    ready ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
      "Using ",
      setup.device,
      " for indexing. Qwen3 reranks search results locally."
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Download the two Qwen3 models once. The standard download is about 2.23 GB. Some accelerators need an extra 1.19 GB." }),
    setup.status === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: setup.error }),
    !ready && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        className: "kn-primary",
        disabled: busy || active,
        onClick: () => run(() => request("/setup", "POST")),
        children: active ? "Setting up\u2026" : setup.status === "error" ? "Retry setup" : "Set up Knowledge"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { open: !ready || void 0, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: ready ? "Setup details" : "Setup steps" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "kn-steps", children: steps.map((name, i) => {
        const current = i === setup.step;
        const progress = current && active && setup.progress;
        const done = ready || i < setup.step;
        const label = done ? "Done" : current && setup.status === "error" ? "Failed" : current && active ? "Working" : "Waiting";
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: progress ? Math.min(100, Math.floor(100 * progress.received / progress.total)) + "%" : label })
        ] }, name);
      }) }),
      setup.notes?.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "kn-note", children: note }, note)),
      ready && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => run(() => request("/setup?check=1", "POST")), children: "Check setup again" })
    ] })
  ] });
}
function Models({ settings, catalog, run, busy, refresh }) {
  const selector = (key, label, empty) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
    label,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "select",
      {
        value: settings[key],
        disabled: busy,
        onChange: (e) => {
          const value = e.target.value;
          void run(() => request("/settings", "PATCH", { [key]: value }));
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: empty }),
          settings[key] && !catalog.models.some((m) => m.id === settings[key]) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: settings[key], children: [
            settings[key],
            " (unavailable)"
          ] }),
          catalog.models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: m.id, children: [
            m.name,
            m.verified ? "" : " (vision unconfirmed)"
          ] }, m.id))
        ]
      }
    )
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "kn-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Reading images" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Text and Markdown work immediately after setup. For scans and figures, choose the Harness models that receive those images." }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "kn-pair", children: [
      selector("ocrModel", "OCR model", "Skip OCR"),
      selector("descriptionModel", "Image and chart descriptions", "Skip descriptions")
    ] }),
    !catalog.models.length && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Register an image-capable model in Harness Settings \u2192 Models to enable these choices." }),
    catalog.unavailable.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
      "Could not list models from ",
      catalog.unavailable.join(", "),
      "."
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "kn-link", onClick: refresh, children: "Refresh model list" })
  ] });
}
function Advanced({ settings, run, busy }) {
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const [draft, setDraft] = (0, import_react.useState)(settings);
  (0, import_react.useEffect)(() => setDraft(settings), [JSON.stringify(settings)]);
  const select = (key, label, options) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
    label,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { value: draft[key], onChange: (e) => setDraft({ ...draft, [key]: e.target.value }), children: options.map(([id, name]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: id, children: name }, id)) })
  ] });
  const number = (key, label, max) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
    label,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "number",
        min: "0",
        max,
        required: true,
        value: draft[key],
        onChange: (e) => setDraft({ ...draft, [key]: e.target.value })
      }
    )
  ] });
  const time = (key, label) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
    label,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "time",
        required: true,
        value: draft[key],
        onChange: (e) => setDraft({ ...draft, [key]: e.target.value })
      }
    )
  ] });
  const save = (e) => {
    e.preventDefault();
    const { device, schedule, threads, unloadSeconds, quietSeconds, windowStart, windowEnd } = draft;
    void run(
      () => request("/settings", "PATCH", {
        device,
        schedule,
        windowStart,
        windowEnd,
        threads: Number(threads),
        unloadSeconds: Number(unloadSeconds),
        quietSeconds: Number(quietSeconds)
      })
    );
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "kn-section", onToggle: (e) => setExpanded(e.currentTarget.open), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Advanced hardware and scheduling" }),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: save, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "kn-pair", children: [
        select("device", "Preferred indexing device", [
          ["auto", "Automatic"],
          ["cpu", "CPU"],
          ["npu", "NPU"],
          ["gpu", "GPU"],
          ["igpu", "Integrated GPU"]
        ]),
        select("schedule", "When to index", [
          ["background", "When Harness chat is idle"],
          ["always", "Any time"],
          ["window", "During a daily window"],
          ["paused", "Pause indexing"]
        ]),
        draft.schedule === "window" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          time("windowStart", "Start (local time)"),
          time("windowEnd", "End (local time)")
        ] }),
        number("threads", "CPU threads (0 = automatic)", 64),
        number("unloadSeconds", "Unload models after idle seconds (0 = keep loaded)", 86400),
        number("quietSeconds", "Wait after chat ends (seconds)", 3600)
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, children: "Save preferences" })
    ] })
  ] });
}
function Documents({ state, run, busy }) {
  const [title, setTitle] = (0, import_react.useState)(""), [text, setText] = (0, import_react.useState)("");
  const pick = (0, import_react.useRef)(null);
  const upload = (files) => run(async () => {
    for (const file of files)
      await request("/files?name=" + encodeURIComponent(file.name), "POST", file);
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      className: "kn-section",
      onDragOver: (e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      },
      onDrop: (e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files.length) void upload([...e.dataTransfer.files]);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Documents" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "kn-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => pick.current?.click(), children: "Add files" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Or drop Markdown, text, PDFs or images here \xB7 up to 32 MiB each" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            ref: pick,
            hidden: true,
            type: "file",
            multiple: true,
            accept: ".md,.markdown,.txt,.text,.log,.pdf,.png,.jpg,.jpeg,.webp",
            onChange: (e) => {
              const files = [...e.target.files];
              e.target.value = "";
              void upload(files);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Paste text" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "form",
            {
              onSubmit: (e) => {
                e.preventDefault();
                void run(async () => {
                  await request("/notes", "POST", { title, text });
                  setTitle("");
                  setText("");
                });
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                  "Title",
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      required: true,
                      maxLength: 240,
                      value: title,
                      onChange: (e) => setTitle(e.target.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                  "Text",
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { required: true, rows: 5, value: text, onChange: (e) => setText(e.target.value) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, children: "Add text" })
              ]
            }
          )
        ] }),
        state.activity && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: state.activity }),
        state.documents.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "kn-docs", children: state.documents.map((doc) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: doc.title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: doc.status === "ready" ? doc.passages + (doc.passages === 1 ? " passage" : " passages") : doc.status }),
            doc.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: doc.error })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "kn-actions", children: [
            doc.hasMarkdown ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: "/knowledge/documents/" + doc.id + "/markdown", download: true, children: "Download Markdown" }) : null,
            doc.status === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                disabled: busy,
                onClick: () => run(() => request("/documents/" + doc.id + "/retry", "POST")),
                children: "Retry"
              }
            )
          ] })
        ] }, doc.id)) })
      ]
    }
  );
}
function Search({ ready }) {
  const [query, setQuery] = (0, import_react.useState)(""), [hits, setHits] = (0, import_react.useState)(null), [error, setError] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false);
  async function search(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setHits(null);
    try {
      setHits(await request("/search", "POST", { query }));
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "kn-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Search your documents" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "kn-search", onSubmit: search, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          "aria-label": "Search query",
          placeholder: "Ask about your documents",
          required: true,
          maxLength: 2400,
          value: query,
          onChange: (e) => setQuery(e.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: !ready || busy, children: busy ? "Searching\u2026" : "Search" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: error }),
    hits?.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "No indexed passages yet." }),
    hits?.map((hit) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: hit.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
        "Passage ",
        hit.ordinal + 1
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: hit.text })
    ] }, hit.document + "/" + hit.ordinal))
  ] });
}
function Knowledge() {
  const [state, setState] = (0, import_react.useState)(null), [error, setError] = (0, import_react.useState)(""), [pollError, setPollError] = (0, import_react.useState)("");
  const [catalog, setCatalog] = (0, import_react.useState)({ models: [], unavailable: [] }), [busy, setBusy] = (0, import_react.useState)(false);
  const refresh = (0, import_react.useCallback)(async () => {
    const data = await request("/state");
    setState(data);
    setPollError("");
  }, []);
  const models = (0, import_react.useCallback)(() => {
    request("/models").then(setCatalog).catch((e) => setError(e.message));
  }, []);
  (0, import_react.useEffect)(() => {
    let mounted = true, timer;
    const poll = async () => {
      try {
        const data = await request("/state");
        if (mounted) {
          setState(data);
          setPollError("");
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
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "kn-app", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: panel_default }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Knowledge" }),
    (error || pollError) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: error || pollError }),
    state ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Setup, { state, run, busy }),
      (state.setup.status === "ready" || state.documents.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Documents, { state, run, busy }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { ready: state.setup.status === "ready" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Models,
        {
          settings: state.settings,
          catalog,
          refresh: models,
          run,
          busy
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Advanced, { settings: state.settings, run, busy })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Opening your library\u2026" })
  ] });
}

// src/client/index.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["slots"];
function apply(ctx) {
  const slots = ctx.get("slots");
  const listeners = /* @__PURE__ */ new Set();
  let open = false;
  function change(value) {
    open = value;
    for (const notify of listeners) notify();
  }
  function subscribe(notify) {
    listeners.add(notify);
    return () => listeners.delete(notify);
  }
  function Action({ wide }) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "button",
      {
        type: "button",
        title: "Knowledge",
        "aria-label": "Knowledge",
        onClick: () => change(true),
        style: {
          background: "none",
          border: 0,
          color: "inherit",
          cursor: "pointer",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": "true", children: "\u25A4" }),
          wide && "Knowledge"
        ]
      }
    );
  }
  function Overlay() {
    const visible = (0, import_react2.useSyncExternalStore)(subscribe, () => open);
    const ref = (0, import_react2.useRef)(null);
    (0, import_react2.useEffect)(() => {
      if (visible) ref.current?.showModal();
    }, [visible]);
    return visible ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "dialog",
      {
        className: "kn-dialog",
        ref,
        "aria-label": "Knowledge library",
        onClose: () => change(false),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "kn-close", onClick: () => ref.current.close(), children: "Close" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Knowledge, {})
        ]
      }
    ) : null;
  }
  const add = (name, id, component) => slots.inject(
    name,
    () => slots.register({ name, id, order: 60, label: () => "Knowledge" }, component)
  );
  add("sidebar.footer.action", "knowledge", Action);
  add("shell.overlay", "knowledge", Overlay);
  add("settings.section", "knowledge-setup", Knowledge);
}
return module.exports;}});
