"""Local versioned JSON Lines interface for plugins and other applications."""
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import sys
import tempfile
import time

VERSION = 1
FIELDS = {"version", "id", "input", "output", "evidence_dir", "password_file", "ocr_only", "force", "resume", "dpi"}


def parser():
    p = argparse.ArgumentParser(prog="ocr worker", description=__doc__)
    p.add_argument("--profile", choices=("adaptive", "full", "direct"), default="adaptive")
    p.add_argument("--workers", type=int, choices=range(1, 33), default=16, metavar="1–32")
    p.add_argument("--endpoint", help="reuse an existing local recognition service")
    return p


def convert_request(request, settings, model):
    from . import convert
    from .cli import conversion_parser

    unknown = set(request) - FIELDS
    if unknown:
        raise ValueError("Unknown request fields: " + ", ".join(sorted(unknown)))
    if type(request.get("version")) is not int or request["version"] != VERSION:
        raise ValueError("Set version to 1.")
    if not isinstance(request.get("id"), (int, str)) or isinstance(request["id"], bool):
        raise ValueError("Provide an integer or string request id.")
    for field in ("input", "output", "password_file", "evidence_dir"):
        if field == "input" or field in request:
            if not isinstance(request.get(field), str) or not Path(request[field]).is_absolute():
                raise ValueError(f"{field} must be an absolute path.")
    if not Path(request["input"]).is_file():
        raise ValueError("input must identify one existing PDF or image file.")
    for field in ("ocr_only", "force", "resume"):
        if field in request and type(request[field]) is not bool:
            raise ValueError(f"{field} must be a boolean.")
    if request.get("force") and request.get("resume"):
        raise ValueError("Choose one of force and resume.")
    if any(field in request for field in ("evidence_dir", "resume", "force")) and "output" not in request:
        raise ValueError("Provide an output path for persistent evidence, force or resume.")
    dpi = request.get("dpi", 200)
    if type(dpi) is not int or not 72 <= dpi <= 400:
        raise ValueError("dpi must be an integer between 72 and 400.")
    with tempfile.TemporaryDirectory(prefix="document-ocr-") as temporary:
        folder = Path(temporary)
        output = Path(request.get("output", folder / "document.md"))
        batch_file = folder / "batch.json"
        args = conversion_parser().parse_args([request["input"], "-o", str(output), "--report", str(batch_file)])
        args.profile, args.workers, args.endpoint, args.dpi = settings.profile, settings.workers, settings.endpoint, dpi
        for field in ("ocr_only", "force", "resume"):
            setattr(args, field, request.get(field, False))
        for field in ("evidence_dir", "password_file"):
            if field in request:
                setattr(args, field, Path(request[field]))
        documents = []
        code = convert.run(args, time.monotonic(), shared_model=model, result_sink=documents)
        batch = json.loads(batch_file.read_bytes())
        if code == 1:
            raise RuntimeError(" / ".join(item["error"] for item in batch["failed_inputs"]))
        (report, markdown, report_path), = documents
        result = {"status": report["status"], "markdown": markdown, "pages": report["pages"],
                  "page_spans": report["page_spans"], "complete_pages": report["complete_pages"], "review_required": report["review_required"],
                  "review_pages": report["review_pages"], "native_pages": report["native_pages"], "figures": report["figures"],
                  "seconds": batch["wall_seconds_to_markdown"], "model_startup_seconds": batch["owned_server_startup_seconds"]}
        if "output" in request:
            result.update(output=str(output), report=str(report_path))
        return result


def serve(settings):
    from . import runtime
    # Reserve the protocol descriptor before any native OCR library can print to standard output.
    replies = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", errors="backslashreplace", buffering=1)
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    from .convert import Model
    with replies, ExitStack() as services:
        model = Model(services, settings)
        for line in sys.stdin.buffer:
            reply = {"version": VERSION, "id": None, "backend": runtime.BACKEND}
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError("The request must be a JSON object.")
                identifier = request.get("id")
                if type(identifier) in (str, int):
                    reply["id"] = identifier
                reply.update(convert_request(request, settings, model))
            except Exception as exc:
                reply.update(status="error", error={"type": type(exc).__name__, "message": str(exc)})
            replies.write(json.dumps(reply, ensure_ascii=False) + "\n")
    return 0
