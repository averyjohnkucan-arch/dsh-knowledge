# Fork status

This repository preserves the upstream dsh-knowledge history and AGPL-3.0 license, plus the local rebuild source used in Avery's DSH plugin directory. No user documents, knowledge databases, model weights, local Python environments, or credentials are published.

The local CPU/Intel accelerator and PP-Structure integration is development work. Source publication is not a claim that every hardware/backend combination, OCR quality benchmark, or end-to-end model retrieval path has been qualified. Consult docs/local-pipeline.md for the current implementation and configuration.

The fork uses published DSH 0.2.1-rc.2 packages rather than a sibling source checkout. Generated JavaScript is included so the standard DSH GitHub installer can load the plugin without running a build. Keep source and generated output together when publishing updates. The installed development checkout remains linked locally; publishing does not restart DSH or alter running imports.
