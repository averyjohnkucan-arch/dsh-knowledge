"""Start the worker under its private, offline Python environment."""
import os
import signal
import sys

from . import runtime, worker


def stop(*_):
    runtime.interrupt_server()
    raise KeyboardInterrupt


if __name__ == "__main__":
    if sys.argv[1:] != ["worker"]:
        raise SystemExit("Expected worker")
    python, env = runtime.python_and_environment()
    if not os.environ.get("DSH_OCR_WORKER_READY"):
        env["DSH_OCR_WORKER_READY"] = "1"
        os.execve(python, [python, "-m", "document_ocr", "worker"], env)
    signal.signal(signal.SIGTERM, stop)
    try:
        sys.exit(worker.serve(worker.parser().parse_args([])))
    except KeyboardInterrupt:
        sys.exit(0)
