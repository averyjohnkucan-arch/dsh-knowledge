"""Install verified public dependencies into a relocatable project directory."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

from . import runtime

SUPPORT = runtime.ROOT / "runtime-support"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def publish_json(path, data):
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as stream:
        tmp = Path(stream.name)
        json.dump(data, stream, indent=2)
        stream.write("\n")
    try:
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def get_uv(spec, work):
    wheel = work / "bootstrap.whl"
    if not wheel.is_file() or sha256(wheel) != spec["sha256"]:
        download = wheel.with_suffix(".part")
        with urllib.request.urlopen(spec["url"], timeout=90) as response, download.open("wb") as output:
            shutil.copyfileobj(response, output, 1 << 20)
        if download.stat().st_size != spec["bytes"] or sha256(download) != spec["sha256"]:
            raise ValueError("The uv bootstrap download failed its published SHA-256 check.")
        os.replace(download, wheel)
    command = work / "uv"
    with zipfile.ZipFile(wheel) as archive, archive.open(f"uv-{spec['uv_version']}.data/scripts/uv") as stream:
        with command.open("wb") as dst:
            shutil.copyfileobj(stream, dst)
    command.chmod(0o755)
    return command


def install_python(uv, root, version, env):
    executable = root / "python/bin/python3.12"
    if executable.is_file():
        actual = subprocess.check_output([executable, "-c", "import platform; print(platform.python_version())"], text=True).strip()
        if actual == version:
            return executable
        raise ValueError(f"Python under {root / 'python'} is {actual}. This installer requires {version}.")
    folder = root / "interpreters"
    subprocess.run([uv, "--no-config", "python", "install", version, "--no-bin", "--install-dir", folder], env=env, check=True)
    choices = sorted(folder.glob(f"cpython-{version}-*/bin/python3.12"))
    if len(choices) != 1:
        raise RuntimeError(f"Expected one installed CPython {version} under {folder}.")
    (root / "python").symlink_to(choices[0].parents[1].relative_to(root), target_is_directory=True)
    return executable


def install_packages(root, work, python, uv, requirements, env, compact):
    # Separate environments keep a failed or interrupted update from replacing a working install.
    env_id = sha256(requirements)[:20]
    packages = root / "environments" / env_id / "site-packages"
    if (packages.parent / "ready.json").is_file():
        return packages
    staged = work / (env_id + "-packages")
    staged.mkdir(exist_ok=True)
    base = [uv, "--no-config", "pip", "install", "--python", python, "--target", staged, "--link-mode", "copy",
            "--index-url", "https://pypi.org/simple", "--no-deps"]
    subprocess.run([*base, "-r", requirements], env=env, check=True)
    # The declared vLLM runtime includes both distributions providing the onnxruntime module.
    if not compact:
        cuda = next(line for line in requirements.read_text().splitlines() if line.startswith("onnxruntime-gpu=="))
        subprocess.run([*base, "--reinstall-package", "onnxruntime-gpu", cuda], env=env, check=True)
    pyenv = dict(env, PYTHONPATH=str(staged), PYTHONNOUSERSITE="1")
    provider = "CPUExecutionProvider" if compact else "CUDAExecutionProvider"
    subprocess.run([python, "-c", f"import onnxruntime as o; assert {provider!r} in o.get_available_providers()"],
                   env=pyenv, check=True)
    packages.parent.mkdir(parents=True, exist_ok=True)
    if packages.exists():
        # This directory is private to this exact lockfile version and was renamed at the last interrupted install.
        backup = work / (env_id + "-unpublished")
        if backup.exists():
            shutil.rmtree(backup)
        packages.rename(backup)
    staged.rename(packages)
    publish_json(packages.parent / "ready.json", {"lock_sha256": sha256(requirements)})
    return packages


def make_launchers_relative(root, work, packages):
    interpreter = (root / "python").resolve()
    for alias in interpreter.parent.glob("cpython-3.12-*"):
        if alias.is_symlink() and alias.readlink().is_absolute() and alias.readlink().name == interpreter.name:
            staged = work / "interpreter-alias"
            staged.unlink(missing_ok=True)
            staged.symlink_to(interpreter.name)
            os.replace(staged, alias)
    # uv-generated console scripts embed the original install path. Tools invoked
    # by subprocesses also need to find their colocated Python after relocation.
    prologue = b'''#!/bin/sh
""":"
bindir=$(dirname -- "$(readlink -f -- "$0")")
export PYTHONPATH="$bindir/..${PYTHONPATH:+:$PYTHONPATH}"
exec "$bindir/../../../../python/bin/python3.12" "$0" "$@"
":"""
'''
    for path in (packages / "bin").glob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open("rb") as src:
            first = src.readline(256)
            if first == b"#!/bin/sh\n":
                command = src.readline(4096)
                if not (command.startswith(b"'''exec' ") and b"/python/bin/python3.12" in command
                        and src.readline() == b"' '''\n"):
                    continue
            elif not (first.startswith(b"#!/") and first.rstrip().endswith(b"/python/bin/python3.12")):
                continue
            remaining = src.read()
        staged = work / "python-console-script"
        staged.write_bytes(prologue + remaining)
        staged.chmod(path.stat().st_mode & 0o777)
        os.replace(staged, path)


def install_server(root, work, spec):
    destination = root / "servers" / spec["build"]
    if not (destination / "llama-server").is_file():
        archive = work / "llama.tar.gz"
        if not archive.is_file() or sha256(archive) != spec["sha256"]:
            req = urllib.request.Request(spec["url"], headers={"User-Agent": "document-ocr-installer"})
            try:
                stream = urllib.request.urlopen(req, timeout=90)
            except urllib.error.HTTPError as exc:
                if exc.code != 403:
                    raise
                api = urllib.request.Request(spec["api"] + "?download=1", headers={"Accept": "application/octet-stream",
                                                                                  "User-Agent": "document-ocr-installer"})
                stream = urllib.request.urlopen(api, timeout=90)
            with stream, archive.open("wb") as output:
                shutil.copyfileobj(stream, output, 1 << 20)
            if archive.stat().st_size != spec["bytes"] or sha256(archive) != spec["sha256"]:
                raise ValueError("llama.cpp download failed its published SHA-256 check.")
        with tempfile.TemporaryDirectory(dir=work) as temp:
            stage = Path(temp) / "server"
            stage.mkdir()
            with tarfile.open(archive, "r:gz") as tar:
                for member in tar:
                    name = Path(member.name).name
                    if name not in {"llama-server", "LICENSE"} and not (
                        name.startswith(("libggml", "libllama.so", "libllama-common.so", "libllama-server-impl.so", "libmtmd.so"))
                        and ".so" in name):
                        continue
                    if member.issym() and Path(member.linkname).name == member.linkname:
                        (stage / name).symlink_to(member.linkname)
                    elif member.isfile():
                        with tar.extractfile(member) as source, (stage / name).open("xb") as out:
                            shutil.copyfileobj(source, out, 1 << 20)
                        (stage / name).chmod(0o755 if name != "LICENSE" else 0o644)
            subprocess.run([stage / "llama-server", "--version"], check=True)
            destination.parent.mkdir(exist_ok=True)
            stage.rename(destination)
    link = work / "active-server"
    link.unlink(missing_ok=True)
    link.symlink_to(destination.relative_to(root), target_is_directory=True)
    os.replace(link, root / "llama")


def install_models(root, work, manifest):
    from huggingface_hub import hf_hub_download

    def fetch(task):
        model, item = task
        target = root / model["directory"] / item["path"]
        if target.is_file() and target.stat().st_size == item["bytes"] and sha256(target) == item["sha256"]:
            return
        staged = Path(hf_hub_download(model["repo"], item["path"], revision=model["revision"],
                                      local_dir=work / "downloads" / model["revision"]))
        if staged.stat().st_size != item["bytes"] or sha256(staged) != item["sha256"]:
            staged.unlink(missing_ok=True)
            raise ValueError(f"Downloaded file failed verification: {model['repo']}/{item['path']}")
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staged, target)
        print(f"Verified {model['repo']}/{item['path']}", flush=True)

    tasks = [(model, item) for model in manifest["models"] for item in model["files"]]
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch, tasks))


def main(argv):
    parser = argparse.ArgumentParser(prog="ocr install", description=__doc__)
    parser.add_argument("--plan", action="store_true", help="show dependencies and exact model bytes before installing")
    parser.add_argument("--mode", choices=("ovis", "ovis-bf16"), required=True,
                        help="OvisOCR2 quantized or CUDA BF16 runtime")
    args = parser.parse_args(argv)
    bootstrap = json.loads((SUPPORT / "bootstrap.json").read_bytes())
    compact = args.mode == "ovis"
    manifest_name = f"models-{args.mode}.json"
    manifest = json.loads((SUPPORT / manifest_name).read_bytes())
    requirements = SUPPORT / (f"requirements-linux-{args.mode}.txt" if compact else "requirements-linux-cu130.txt")
    models = [{"repo": m["repo"], "revision": m["revision"], "bytes": sum(f["bytes"] for f in m["files"])} for m in manifest["models"]]
    plan = {"platform": bootstrap["platform"], "python": bootstrap["python_version"], "backend": args.mode,
            "runtime": "llama.cpp Q4_K_M / Vulkan or CPU" if compact else "vLLM BF16 / CUDA 13",
            "model_bytes": sum(m["bytes"] for m in models), "models": models, "package_lock_sha256": sha256(requirements)}
    if args.plan:
        print(json.dumps(plan, indent=2))
        return 0
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise ValueError("This release installer targets Linux x86-64. The BF16 backend requires an NVIDIA CUDA 13 driver.")
    root = runtime.RUNTIME
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".install.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        work = root / "install-work"
        work.mkdir(exist_ok=True)
        env = dict(os.environ, UV_CACHE_DIR=str(work / "wheels"), UV_NO_MODIFY_PATH="1", HF_HOME=str(work / "hub"),
                   HF_HUB_DISABLE_TELEMETRY="1", HF_XET_CHUNK_CACHE_SIZE_BYTES="0", PYTHONNOUSERSITE="1")
        python = root / "python/bin/python3.12"
        packages = root / "environments" / sha256(requirements)[:20] / "site-packages"
        if not (python.is_file() and (packages.parent / "ready.json").is_file()):
            print("Installing the pinned Python packages", flush=True)
            uv = Path(os.environ["DSH_OCR_UV"]) if os.environ.get("DSH_OCR_UV") else get_uv(bootstrap, work)
            python = install_python(uv, root, bootstrap["python_version"], env)
            packages = install_packages(root, work, python, uv, requirements, env, compact)
        make_launchers_relative(root, work, packages)
        if compact:
            print("Installing the local model server", flush=True)
            install_server(root, work, manifest["server"])
        print("Downloading and verifying OvisOCR2 model files", flush=True)
        env["PYTHONPATH"] = os.pathsep.join([str(runtime.ROOT), str(packages)])
        subprocess.run([python, "-m", "document_ocr.install", "--fetch-pinned-models", manifest_name],
                       env=env, cwd=runtime.ROOT, check=True)
        receipt = dict(plan, schema_version=1, packages=str(packages.relative_to(root)))
        publish_json(root / "installed.json", receipt)
        shutil.rmtree(work)
    print(f"Installed in {root}. OCR runtime is ready.")
    return 0


if __name__ == "__main__" and sys.argv[1:2] == ["--fetch-pinned-models"]:
    name = sys.argv[2] if len(sys.argv) == 3 else "models.json"
    if name not in {"models-ovis.json", "models-ovis-bf16.json"}:
        raise ValueError("Unknown model manifest.")
    install_models(runtime.RUNTIME, runtime.RUNTIME / "install-work", json.loads((SUPPORT / name).read_bytes()))

elif __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
