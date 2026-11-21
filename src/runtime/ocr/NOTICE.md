# Local document OCR provenance

This directory contains the OvisOCR2 backend of the maintainer’s portable document-to-Markdown pipeline, adapted for the Knowledge plugin. It includes native-page routing, ruled table extraction, recognition quality checks, adaptive repetition recovery and the version 1 JSON Lines worker. The OCR prompt and both model manifests are pinned in `runtime-support/`.

| Dependency | Source and upstream notices |
| --- | --- |
| OvisOCR2 model and recognition prompt | [ATH-MaaS/OvisOCR2, Apache 2.0](https://huggingface.co/ATH-MaaS/OvisOCR2/tree/cbdede82e048659b83310476ff807da825f8fe78) |
| Quantized model and visual projector | [OvisOCR2-GGUF](https://huggingface.co/mradermacher/OvisOCR2-GGUF/tree/99b7522fe8b60154473e5224efff5b6ccae92d1c) |
| Compact inference server | [llama.cpp b12561, MIT](https://github.com/ggml-org/llama.cpp/releases/tag/b12561) |
| NVIDIA BF16 inference | [vLLM](https://github.com/vllm-project/vllm) |
| PDF reader | [PyMuPDF source and license](https://github.com/pymupdf/PyMuPDF) |
| Image reading | [Pillow](https://github.com/python-pillow/Pillow) |
| Python installer and interpreter | [Astral uv](https://github.com/astral-sh/uv) and [python-build-standalone](https://github.com/astral-sh/python-build-standalone) |

Installation downloads the matching model notices. The search-model sources, revisions and SHA-256 values are in the plugin’s `src/runtime/weights.json`.
