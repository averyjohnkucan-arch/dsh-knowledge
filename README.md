# Knowledge for DeepSeek Harness

Paste text or drop in a document. Knowledge saves a Markdown copy, indexes passages from that copy, and lets you search them from the library or from Harness chat.

## Install

Use the **web profile** of DeepSeek Harness 0.2.2-rc.4 or rc.5 with Node.js 24.9 or newer. The plugin installer and model downloads need internet access the first time.

1. In Harness, open **Plugins → Add plugin**. Paste the full path to the downloaded `dsh-knowledge-1.0.0.tgz` on the computer running Harness, or the HTTPS address of a published release tarball. Click **Install**.
2. If Harness asks about native dependencies, select **onnxruntime-node** and **openvino-node** and click **Allow these scripts and retry**. When Harness shows **Installed**, click **Enable now**. Follow any reload or restart prompt.
3. Open **Knowledge** in the sidebar. Click **Set up Knowledge** once. The checklist shows both downloads, verifies a real search on CPU, checks the available accelerator, and displays the device selected for indexing. You can close the panel while setup runs.
4. When **Local search is ready** appears, open **Paste text** or **Add files**. Ask a question under **Search your documents**, or ask Harness chat to search the Knowledge library.

The same package can be installed from a terminal on the Harness host.

```sh
dsh plugin --profile web add /absolute/path/to/dsh-knowledge-1.0.0.tgz
```

The standard models take about **2.23 GB** to download. Intel acceleration adds up to **1.19 GB** of model files. Allow additional space for the native runtimes and library. A retry verifies cached files and downloads the remaining files.

## Reading scans and charts

Text files and pasted notes get a Markdown heading and keep their paragraphs. Existing Markdown keeps its structure and whitespace, with line endings normalized to LF. Uploads support Markdown, UTF-8 text, PDF, PNG, JPEG and WebP, up to 32 MiB per file.

Open **Reading images** to choose either or both of the two Harness-registered models. A local or hosted image-capable model can serve either role. If the list is empty, register one in **Harness Settings → Models**, then click **Refresh model list**.

| Choice                       | Content added to Markdown                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| OCR model                    | Transcribes visible text and tables from scans, including embedded images on PDF pages that already have native text. |
| Image and chart descriptions | Describes diagrams, legends, axes, labels, values and trends visible on each relevant page or standalone image.       |

The two readers are optional for plain text, Markdown and text-only PDFs. Pages sent for OCR or description go to the provider you choose. Embedding and reranking run on the Harness computer. Review **Download Markdown** to check the transcription or use it as input to another pipeline. An import that requires a reader can be retried after selecting one.

## How retrieval works

1. Save the canonical Markdown. PDF headings retain the original page numbers.
2. Split that Markdown into passages at paragraph, line or word boundaries. Store their character offsets and normalized 1,024-dimensional Qwen3 embeddings in SQLite.
3. On a query, retrieve up to eight passages by cosine similarity. Qwen3 Reranker scores each query and passage together and returns up to five results. Harness chat uses the same search through the `knowledge_search` tool.
4. Publish a document to search when all its passages are ready. Interrupted indexing resumes at the last saved passage when Harness restarts.

The Qwen model revisions, artifact sizes and SHA-256 checksums are pinned in [the weight manifest](src/runtime/weights.json). The embedding export uses FP16 weights and last-token pooling. The reranker uses a Q4 export and scores the model's yes/no logits. [Qwen3 Embedding 0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) · [Qwen3 Reranker 0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)

## Hardware and scheduling

Leave **Advanced hardware and scheduling** closed for automatic setup. Automatic mode establishes a CPU reference, looks for a free CUDA device, checks driver-visible Intel devices, and tries a system GPU where supported. It compares the accelerator's vectors to CPU on three passages before selecting it. ONNX GPU sessions must also show model computation on the requested provider. A driver or model failure falls back to CPU. Query embeddings and reranking run on CPU to keep search in the same reference space.

| Hardware                                  | Indexing path                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Intel, AMD or Arm CPU                     | ONNX Runtime CPU on platforms with a compatible native binary.                                                                      |
| Intel integrated or discrete graphics     | OpenVINO selects the device reported by the Intel graphics driver.                                                                  |
| Intel NPU                                 | OpenVINO uses an NPU exposed by its installed driver. Passages over its compiled token limit use CPU.                               |
| NVIDIA discrete GPU                       | CUDA where the Node runtime and driver support it. A busy NVIDIA device is skipped during setup.                                    |
| Other system GPUs, including AMD graphics | Automatic or GPU mode tries DirectML on Windows and native WebGPU where available. Compatibility depends on the adapter and driver. |
| Other NPUs, including AMD Ryzen AI        | CPU fallback. The plugin currently has an Intel OpenVINO NPU adapter.                                                               |

Advanced settings let you choose a device preference, cap CPU threads and unload idle models. Indexing can run any time, wait for chat to become idle, pause, or run in a daily time window on the host's local clock. Overnight windows work across midnight. While a chat is active, Knowledge gives up its accelerator. The daily window also respects the after-chat quiet period.

## Storage and upgrades

This version starts a new library at `$DSH_HOME/storages/knowledge-markdown-v1`. The default Harness home is `~/.dsh`. The library is shared across workspaces in that Harness home. It stores the database and verified model files locally. Download Markdown from Knowledge to keep portable copies of individual documents.

An existing 0.5.x installation keeps its own storage. Export documents you want to carry over as Markdown and import them into this version. Model downloads and setup progress can be checked again from **Setup details**.

## Development

```sh
npm ci
npm run check
npm pack
```

The repository includes the browser bundle so a packaged installation can load immediately. Source is organized by responsibility.

| Directory     | Contents                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/client`  | Harness sidebar action, settings panel, setup progress, document import and search                           |
| `src/host`    | Authenticated Harness routes, model registry integration, Markdown conversion, SQLite library and scheduling |
| `src/runtime` | Verified downloads, isolated native inference workers, ONNX Runtime and OpenVINO adapters                    |
| `test`        | Offline regression tests including generated PDFs, persistence, model routing and scheduling                 |
| `scripts`     | Browser build and a real-model CPU smoke test                                                                |

For an end-to-end CPU check, run `npm run smoke -- /path/to/a/disposable-library`. It uses the production downloader and local inference workers, adds a known document and checks its search result. Allow the standard model download on the first run. Use the same disposable directory to reuse the verified weights later.

The plugin is licensed under [AGPL-3.0](LICENSE). Model weights retain their upstream licenses.
