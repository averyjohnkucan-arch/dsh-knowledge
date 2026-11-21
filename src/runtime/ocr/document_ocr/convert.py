"""Convert documents, recording the source, every attempt and the selected Markdown."""

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import ExitStack
from dataclasses import dataclass, field
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from PIL.Image import DecompressionBombError

from . import engine, pages, runtime


def atomic_text(path, value, *, replace=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as scratch:
        name = Path(scratch.name)
        try:
            scratch.write(value)
            scratch.flush()
            if replace:
                os.replace(name, path)
            else:
                os.link(name, path)
        finally:
            name.unlink(missing_ok=True)


def save(path, data):
    atomic_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def digest(data):
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def destinations(args):
    inputs = []
    for item in args.inputs:
        path = item.expanduser().resolve()
        if path.is_dir():
            inputs.extend(p.resolve() for p in sorted(path.iterdir())
                          if p.is_file() and p.suffix.lower() in pages.SUPPORTED and not p.name.startswith("."))
        elif path.is_file():
            inputs.append(path)
        else:
            raise ValueError(f"Input does not exist: {item}")
    inputs = list(dict.fromkeys(inputs))
    if not inputs:
        raise ValueError("No supported PDFs or images found.")
    if args.output and len(inputs) != 1:
        raise ValueError("Use --output-dir with multiple inputs.")
    targets = []
    for path in inputs:
        out = args.output or ((args.output_dir or path.parent) / (path.stem + ".md"))
        out = out.expanduser()
        out = out.parent.resolve() / out.name
        if out.suffix.lower() not in {".md", ".markdown"}:
            raise ValueError(f"Choose a Markdown output file ending in .md or .markdown: {out}")
        if out.resolve() in inputs:
            raise ValueError(f"Output would overwrite a source: {out}")
        if out.is_symlink() or out.is_dir():
            raise ValueError(f"Output must be a regular file: {out}")
        if out.exists() and not (args.force or args.resume):
            raise ValueError(f"Output already exists: {out}. Use --force to replace it or --resume to reuse matching work.")
        targets.append(out)
    if len({p.resolve() for p in targets}) != len(targets):
        raise ValueError("Input basenames would produce colliding Markdown files. Choose distinct output paths.")
    if args.report:
        report = args.report.expanduser()
        report = report.parent.resolve() / report.name
        protected = set(inputs + targets)
        if args.password_file:
            protected.add(args.password_file.resolve())
        if (report.suffix.lower() != ".json" or report.is_symlink() or report.is_dir()
                or report.resolve() in protected or any(report.is_relative_to(evidence_path(p, args)) for p in targets)):
            raise ValueError(f"Choose a separate batch report ending in .json: {report}")
        if report.exists() and not (args.force or args.resume):
            raise ValueError(f"Batch report already exists: {report}. Use --force or --resume.")
        args.report = report
    return list(zip(inputs, targets))


@dataclass
class Document:
    source: Path
    output: Path
    evidence: Path
    run: Path
    source_hash: str
    pages: list = field(default_factory=list)
    records: dict = field(default_factory=dict)
    prior: list = field(default_factory=list)


class Model:
    def __init__(self, stack, args):
        self.stack = stack
        self.args = args
        self.endpoint = args.endpoint
        self.candidate = None
        self.identity = None
        self.signature = None
        self.details = None
        self.startup = 0.0

    def ensure(self):
        if self.candidate is not None:
            return
        if self.endpoint:
            self.identity = runtime.local_identity(self.endpoint)
        else:
            began = time.monotonic()
            self.endpoint, self.identity = self.stack.enter_context(runtime.local_server(*runtime.python_and_environment()))
            self.startup = time.monotonic() - began
        self.candidate = engine.load(self.args.profile, self.args.workers)
        self.signature, self.details = engine.fingerprint(self.candidate, self.identity, self.args.workers, self.args.profile)


def evidence_path(output, args):
    if args.evidence_dir:
        return args.evidence_dir.resolve() / (output.stem + "-" + digest(str(output))[:12])
    return output.with_suffix(".ocr")


def begin(source, output, args, locks):
    evidence = evidence_path(output, args)
    if evidence.is_symlink():
        raise ValueError(f"Choose an evidence directory that is not a symbolic link: {evidence}")
    evidence.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = locks.enter_context((output.parent / ("." + output.name + ".ocr.lock")).open("a"))
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise ValueError(f"Another conversion is writing {output}") from exc
    source_hash = pages.sha_file(source)
    if output.exists() and args.resume:
        # A process can exit between publishing Markdown and updating the latest
        # report. Its run-specific report was safely published before the output.
        output_hash = pages.sha_file(output)
        alternatives = [evidence / "report.json", *evidence.glob("run-*/report.json")]
        for last in alternatives:
            if last.is_file():
                previous = json.loads(last.read_bytes())
                if previous.get("source_sha256") == source_hash and previous.get("markdown_sha256") == output_hash:
                    break
        else:
            raise ValueError(f"No report matches the source and existing Markdown. Use --force to replace {output}.")
    run = Path(tempfile.mkdtemp(prefix="run-", dir=evidence))
    return Document(source, output, evidence, run, source_hash)


def initialize(doc, args, model):
    needs_model = any(p.image for p in doc.pages)
    if needs_model:
        model.ensure()
        save(doc.run / "pipeline-fingerprint.json", model.details)
    config = {"source": doc.source_hash, "ocr": model.signature if needs_model else None, "dpi": args.dpi,
              "ocr_only": args.ocr_only, "page_reader": pages.sha_file(Path(pages.__file__)),
              "native_table_reader": pages.sha_file(Path(pages.ruled.__file__)),
              "page_writer": pages.sha_file(Path(__file__)), "profile": args.profile}
    signature = digest(config)
    doc.prior = []
    if args.resume and (not needs_model or model.identity.get("serving_arguments")):
        for meta in sorted(doc.evidence.glob("run-*/run.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            if json.loads(meta.read_bytes()).get("signature") == signature:
                doc.prior.append(meta.parent)
    save(doc.run / "run.json", {"source": str(doc.source), "output": str(doc.output), "signature": signature,
                                "settings": config, "pages": len(doc.pages)})


def recognize(doc, page, model, profile):
    name = f"{page.number:05}.json"
    identity = pages.sha_file(page.image) if page.image else digest(page.text)
    for other in doc.prior:
        saved = other / "pages" / name
        if saved.is_file():
            item = json.loads(saved.read_bytes())
            if (item.get("input_sha256") == identity and item.get("complete") and not item.get("error")
                    and item.get("text_sha256") == hashlib.sha256(item["text"].encode()).hexdigest()
                    and not any(a.get("result", {}).get("error") for a in item.get("attempts", []))):
                item["resumed_from"] = str(saved.relative_to(doc.evidence))
                save(doc.run / "pages" / name, item)
                return item
    began = time.monotonic()
    if page.text is not None:
        item = {"text": page.text, "complete": True, "attempts": [], "review_reasons": []}
    else:
        try:
            item = engine.recognize(model.candidate, page.image, model.endpoint,
                                    doc.run / "views" / f"{page.number:05}", profile)
        except Exception as exc:
            item = {"text": "", "complete": False, "attempts": [],
                    "review_reasons": ["pipeline_error"], "error": f"{type(exc).__name__}: {exc}"}
    if not item["complete"] and not item["review_reasons"]:
        item["review_reasons"] = ["incomplete_page"]
    item.update(number=page.number, input_sha256=identity, source_sha256=doc.source_hash, preparation=page.details,
                text_sha256=hashlib.sha256(item["text"].encode()).hexdigest(),
                prepared_image=str(page.image.relative_to(doc.evidence)) if page.image else None,
                page_seconds=time.monotonic()-began, resumed_from=None)
    save(doc.run / "pages" / name, item)
    return item


def finish(doc, args, result_sink=None):
    records = [doc.records[p.number] for p in doc.pages]
    completed = sum(p["complete"] for p in records)
    pending = {str(p["number"]): p["review_reasons"] for p in records if p["review_reasons"]}
    section = []
    spans = []
    offset = 0  # JavaScript document offsets use UTF-16 code units.

    def append(value):
        nonlocal offset
        start = offset + (2 if section else 0)
        section.append(value)
        offset = start + len(value.encode("utf-16-le")) // 2
        return start, offset

    for p in records:
        body = p["text"].strip("\r\n")
        if len(records) > 1:
            append(f'<!-- Page {p["number"]} -->')
        if not p["complete"]:
            append(f'<!-- OCR incomplete on page {p["number"]}. See the review report. -->')
        if body:
            start, end = append(body)
            spans.append({"page": p["number"], "start": start, "end": end})
    markdown = "\n\n".join(section) + "\n"
    report = {"source": str(doc.source), "source_sha256": doc.source_hash, "output": str(doc.output),
              "markdown_sha256": hashlib.sha256(markdown.encode()).hexdigest(), "pages": len(records),
              "page_spans": spans, "complete_pages": completed, "status": "complete" if completed == len(records) else "partial",
              "review_required": bool(pending), "review_pages": pending,
              "figures": [{"page": p["number"], "bbox": box} for p in records for box in p.get("figures", [])],
              "native_pages": sum(p["preparation"]["method"] == "native_pdf" for p in records),
              "requests": sum(len(p["attempts"]) for p in records if not p["resumed_from"]),
              "resumed_pages": sum(bool(p["resumed_from"]) for p in records), "evidence_run": doc.run.name,
              "page_records": [f'{doc.run.name}/pages/{p["number"]:05}.json' for p in records]}
    save(doc.run / "report.json", report)
    atomic_text(doc.output, markdown, replace=args.force or args.resume)
    save(doc.evidence / "report.json", report)
    if result_sink is not None:
        result_sink.append((report, markdown, doc.run / "report.json"))
    flag = f', review pages {", ".join(pending)}' if pending else ""
    print(f"{doc.output}  ({completed}/{len(records)} pages complete{flag})", flush=True)
    return report


def run(args, started, *, shared_model=None, result_sink=None):
    sources = destinations(args)
    password = args.password_file.read_text().rstrip("\r\n") if args.password_file else None
    reports, failures = [], []
    with ExitStack() as services, ThreadPoolExecutor(max_workers=args.workers) as pool:
        model = shared_model if shared_model is not None else Model(services, args)
        previous_startup = model.startup
        pending = {}
        locks = {}

        def collect():
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                doc, page = pending.pop(future)
                doc.records[page.number] = future.result()
                if len(doc.records) == len(doc.pages):
                    reports.append(finish(doc, args, result_sink))
                    locks.pop(doc.output).close()

        try:
            for source, output in sources:
                doc = None
                locks[output] = ExitStack()
                try:
                    doc = begin(source, output, args, locks[output])
                    doc.pages = list(pages.prepare(source, doc.run / "inputs", ocr_only=args.ocr_only,
                                                   password=password, dpi=args.dpi))
                    if not doc.pages:
                        raise ValueError("The input contains no readable pages.")
                except (OSError, ValueError, RuntimeError, DecompressionBombError) as exc:
                    failure = {"source": str(source), "error": str(exc)}
                    if doc:
                        save(doc.run / "error.json", failure)
                    failures.append(failure)
                    print(f"{source}: {exc}", file=sys.stderr)
                    locks.pop(output).close()
                    continue
                initialize(doc, args, model)
                for page in doc.pages:
                    while len(pending) >= args.workers * 3:
                        collect()
                    job = pool.submit(recognize, doc, page, model, args.profile)
                    pending[job] = (doc, page)
            while pending:
                collect()
        finally:
            # Wait for any in-flight evidence writes before releasing their locks.
            pool.shutdown(wait=True, cancel_futures=True)
            for stack in locks.values():
                stack.close()
        # Capture elapsed time before releasing the job-owned server.
        elapsed = time.monotonic() - started
        startup = model.startup - previous_startup
    total = sum(r["pages"] for r in reports)
    complete = sum(r["complete_pages"] for r in reports)
    resumed = sum(r["resumed_pages"] for r in reports)
    summary = {"documents": len(reports), "pages": total, "complete_pages": complete, "failed_inputs": failures,
               "review_documents": sum(r["review_required"] for r in reports), "resumed_pages": resumed,
               "fresh_requests": sum(r["requests"] for r in reports),
               "wall_seconds_to_markdown": elapsed, "owned_server_startup_seconds": startup,
               "warm_seconds_per_completed_page": (elapsed-startup)/complete if complete and not resumed and not failures else None}
    if args.report:
        save(args.report, summary)
    print(f"{complete}/{total} pages complete in {elapsed:.2f}s to Markdown, including {startup:.2f}s server startup.", file=sys.stderr)
    if failures:
        return 1
    return 0 if complete == total else 3
