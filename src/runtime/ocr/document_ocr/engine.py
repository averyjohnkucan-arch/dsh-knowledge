"""OvisOCR2 recognition and reproducible pipeline fingerprints."""
import hashlib
import json
from pathlib import Path
from . import ovis, runtime


def load(profile="adaptive", workers=16):
    return ovis


def recognize(candidate, path, endpoint, cache, profile):
    return candidate.recognize(path, endpoint, recover=profile == "adaptive")


def fingerprint(candidate, identity, workers, profile):
    details = candidate.fingerprint()
    details["ocr_model"]["weight_sha256"] = runtime.verify_weights()
    details["ocr_model"]["verification"] = "Local weight bytes verified for the current file identity."
    if runtime.COMPACT:
        files = runtime.GGUF_SPEC
        details["ocr_model"].update(format="GGUF", quantization="Q4_K_M", projector="Q8_0",
                                    distribution=files["repo"], distribution_revision=files["revision"],
                                    projector_sha256=files["files"][1]["sha256"],
                                    generation_policy="llama.cpp greedy decoding")
    sources = sorted(Path(__file__).parent.glob("*.py"))
    details["document_pipeline"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    details.update(server=identity, workers=workers, profile=profile)
    return hashlib.sha256(json.dumps(details, sort_keys=True).encode()).hexdigest(), details
