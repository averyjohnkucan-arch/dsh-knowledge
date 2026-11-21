"""Locate installed models and manage the local recognition server."""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ.get("OCR2_RUNTIME", ROOT / ".ocr-runtime")).expanduser().resolve()
MODELS = RUNTIME / "models"


def installed_environment():
    receipt = RUNTIME / "installed.json"
    if not receipt.is_file():
        return None, "ovis"
    entry = json.loads(receipt.read_bytes())
    path = (RUNTIME / entry["packages"]).resolve()
    if entry.get("schema_version") != 1 or not path.is_relative_to(RUNTIME):
        raise ValueError(f"Invalid installation receipt: {receipt}")
    if entry.get("backend") not in {"ovis", "ovis-bf16"}:
        raise ValueError("Unknown OCR backend in installation receipt")
    return path, entry["backend"]

PUBLIC_SITE, BACKEND = installed_environment()
COMPACT = BACKEND == "ovis"
WEIGHTS = MODELS / "ovis-ocr2-bf16"
WEIGHT_NAME = "model.safetensors"
MODEL_ID = "OvisOCR2"
WEIGHT_SHA = "9270560288656ece5cb3a6989001afcf5af8d223bceed4a423c33a008861d009"
GGUF_SPEC = None
if COMPACT:
    manifest = json.loads((ROOT / "runtime-support" / f"models-{BACKEND}.json").read_bytes())
    GGUF_SPEC = manifest["models"][0]
GGUF_DIR = MODELS / Path(GGUF_SPEC["directory"]).name if COMPACT else None
GGUF_FILES = tuple(item["path"] for item in GGUF_SPEC["files"]) if COMPACT else ()
LLAMA = RUNTIME / "llama/llama-server"

def python_and_environment():
    python = RUNTIME / "python/bin/python3.12"
    site = PUBLIC_SITE
    if site is None or not site.is_dir() or not python.is_file():
        raise ValueError("Install PDF OCR and local search in knowledge base Settings.")
    required = [LLAMA, *(GGUF_DIR / n for n in GGUF_FILES)] if COMPACT else [WEIGHTS / WEIGHT_NAME]
    for path in required:
        if not path.is_file():
            raise ValueError(f"Missing OCR asset {path.name}. Run setup again in knowledge base Settings.")
    cache = RUNTIME / "cache"
    cache.mkdir(exist_ok=True, parents=True)
    cuda = site / "nvidia/cu13"
    libs = [str(p) for p in sorted((site / "nvidia").glob("*/lib"))] + [str(site / "torch/lib")]
    packages = [site] if COMPACT else [site / "nvidia_cutlass_dsl/dsl_packages", site]
    bins = [str(python.parent), str(site / "bin")]
    env = dict(os.environ)
    env.update(
        PYTHONPATH=os.pathsep.join(map(str, packages)),
        PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1",
        LD_LIBRARY_PATH=os.pathsep.join(libs + [p for p in env.get("LD_LIBRARY_PATH", "").split(os.pathsep) if p]),
        PATH=os.pathsep.join([*bins, str(cuda / "bin"), env.get("PATH", "")]),
        CUDA_HOME=str(cuda), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HOME=str(cache / "huggingface"),
        TRITON_ALLOW_NON_CONSTEXPR_GLOBALS="1", TOKENIZERS_PARALLELISM="false",
        OMP_NUM_THREADS="4", TRITON_CACHE_DIR=str(cache / "triton"),
        TORCHINDUCTOR_CACHE_DIR=str(cache / "inductor"), VLLM_CACHE_ROOT=str(cache / "vllm"),
        CUDA_CACHE_PATH=str(cache / "cuda"), TORCH_EXTENSIONS_DIR=str(cache / "extensions"),
        FLASHINFER_WORKSPACE_BASE=str(cache / "flashinfer"),
        XDG_CACHE_HOME=str(cache / "xdg"), VLLM_NO_USAGE_STATS="1", DO_NOT_TRACK="1",
    )
    if not COMPACT:
        env["VLLM_USE_FLASHINFER_SAMPLER"] = "0"
    return str(python), env


def verified_asset(weight, expected, name):
    stat = weight.stat()
    identity = [str(weight), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]
    receipt = RUNTIME / "cache" / name
    receipt.parent.mkdir(parents=True, exist_ok=True)
    if receipt.is_file():
        saved = json.loads(receipt.read_bytes())
        if saved.get("identity") == identity and saved.get("sha256") == expected:
            return expected
    with weight.open("rb") as f:
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    if digest != expected:
        raise ValueError(f"OCR weight bytes differ from the official pinned revision: {weight}")
    with tempfile.NamedTemporaryFile(mode="w", dir=receipt.parent, delete=False) as temp:
        json.dump({"identity": identity, "sha256": digest}, temp)
    os.replace(temp.name, receipt)
    return digest


def verify_weights():
    if COMPACT:
        result = [verified_asset(GGUF_DIR / item["path"], item["sha256"], f"verified-{item['path']}.json")
                  for item in GGUF_SPEC["files"]]
        return result[0]
    return verified_asset(WEIGHTS / WEIGHT_NAME, WEIGHT_SHA, "verified-ocr-weights.json")


def local_identity(endpoint):
    parts = urlsplit(endpoint)
    if parts.scheme != "http" or parts.hostname not in ("127.0.0.1", "localhost", "::1") or parts.username or parts.password or parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ValueError("Use the local server base URL, for example http://127.0.0.1:31087")
    base = endpoint.rstrip("/")
    with urllib.request.urlopen(base + "/v1/models", timeout=5) as stream:
        models = json.load(stream)["data"]
    model = next((m for m in models if m["id"] == MODEL_ID), None)
    if model is None:
        raise ValueError(f"{base} does not serve {MODEL_ID}.")
    with urllib.request.urlopen(base + ("/props" if COMPACT else "/version"), timeout=5) as stream:
        version = json.load(stream)
    info = {"model": model["id"], "model_root": model.get("root"),
            "max_model_len": model.get("max_model_len"), "managed_local_process": False}
    if COMPACT:
        info["llama_cpp"] = version["build_info"]
    else:
        info["vllm"] = version["version"]
    record = RUNTIME / f"service-{parts.port or 80}.json"
    if record.is_file():
        try:
            saved = json.loads(record.read_bytes())
            proc = Path("/proc") / str(int(saved["pid"]))
            if (proc / "stat").read_text().rsplit(")",1)[1].split()[19] == saved["start_ticks"]:
                args = saved["command"][1 if COMPACT else 3:]
                pos = args.index("--port")
                info["serving_arguments"] = args[:pos] + args[pos+2:]
                info["managed_local_process"] = True
        except (KeyError, ValueError, OSError):
            pass
    return info


def server_command(python, port):
    if COMPACT:
        args = [str(LLAMA), "--model", str(GGUF_DIR / GGUF_FILES[0]), "--mmproj", str(GGUF_DIR / GGUF_FILES[1]),
                "--alias", MODEL_ID, "--host", "127.0.0.1", "--port", str(port),
                "--no-warmup", "--no-webui", "--poll", "0"]
        slots = int(os.environ.get("OCR2_SLOTS", "2"))
        if not 1 <= slots <= 16:
            raise ValueError("OCR2_SLOTS must be between 1 and 16.")
        args.extend(["--ctx-size", str(32768 * slots), "--parallel", str(slots), "--reasoning", "off"])
        device = os.environ.get("OCR2_DEVICE", "auto")
        if device == "auto":
            available = subprocess.check_output([LLAMA, "--list-devices"], text=True, stderr=subprocess.STDOUT)
            for line in available.splitlines():
                name, _, description = line.strip().partition(":")
                if name.startswith("Vulkan") and any(marker in description for marker in ("NVIDIA", "Radeon RX", "Radeon PRO", "Arc(TM) A", "Arc(TM) B")):
                    device = name
                    break
        if device == "cpu":
            args.extend(["--device", "none", "-ngl", "0", "--no-mmproj-offload"])
        elif device != "auto":
            if not device.startswith("Vulkan") or not device[6:].isdigit():
                raise ValueError("OCR2_DEVICE must be auto, cpu, or a llama.cpp device name such as Vulkan0.")
            args.extend(["--device", device, "--mmproj-device", device, "-ngl", "all"])
        return args
    return [python, "-m", "vllm.entrypoints.openai.api_server", "--model", str(WEIGHTS),
            "--served-model-name", MODEL_ID, "--dtype", "bfloat16", "--tensor-parallel-size", "1",
            "--gpu-memory-utilization", "0.78", "--max-model-len", "26000", "--max-num-seqs", "24",
            "--max-num-batched-tokens", "8192", "--no-enable-prefix-caching", "--mm-processor-cache-gb", "0",
            "--limit-mm-per-prompt", '{"image":1}', "--stream-interval", "12", "--generation-config", "vllm",
            "--host", "127.0.0.1", "--port", str(port)]


_active_server = None


def interrupt_server():
    if _active_server is not None:
        try:
            os.killpg(_active_server.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


@contextmanager
def local_server(python, env, port=0, extra_options=()):
    verify_weights()
    # Keep simultaneous job-owned model loads from competing for the same VRAM.
    # An explicit ./ocr serve endpoint can service multiple clients instead.
    with (RUNTIME / "server.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("Another local OCR job owns the GPU. Wait for it to finish and retry.") from exc
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
            port = sock.getsockname()[1]
        endpoint = f"http://127.0.0.1:{port}"
        logs = RUNTIME / "logs"
        logs.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", prefix="server-", suffix=".log", dir=logs, delete=False) as log:
            print(f"Starting {MODEL_ID} at {endpoint}. Server log: {log.name}", file=sys.stderr, flush=True)
            command = server_command(python, port) + list(extra_options)
            child = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True)
            _active_server = child
            record = RUNTIME / f"service-{port}.json"
            try:
                ticks = Path(f"/proc/{child.pid}/stat").read_text().rsplit(")",1)[1].split()[19]
                record.write_text(json.dumps({"pid": child.pid, "start_ticks": ticks, "command": command}))
                deadline = time.monotonic() + 720
                while True:
                    if child.poll() is not None:
                        raise RuntimeError(f"Local model server exited with status {child.returncode}. See {log.name}")
                    try:
                        identity = local_identity(endpoint)
                        args = command[1 if COMPACT else 3:]
                        pos = args.index("--port")
                        identity["serving_arguments"] = args[:pos] + args[pos+2:]
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() > deadline:
                            raise RuntimeError(f"Local model server startup timed out. See {log.name}")
                        time.sleep(1)
                yield endpoint, identity
            finally:
                _active_server = None
                record.unlink(missing_ok=True)
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=25)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait()
