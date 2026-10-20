"""Bootstrap an isolated, pinned CPU environment using the official uv wheel."""
import sys, os, pathlib, urllib.request, json, hashlib, zipfile, platform, subprocess
ROOT = pathlib.Path(sys.argv[1]).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
os.environ['UV_PYTHON_INSTALL_DIR'] = str(ROOT / 'python')
os.environ['UV_CACHE_DIR'] = str(ROOT / 'uv-cache')
os.environ['PADDLE_PDX_CACHE_HOME'] = str(ROOT / 'models')
os.environ['HF_HOME'] = str(ROOT / 'hf-cache')
os.environ['CUDA_VISIBLE_DEVICES'] = ''
os.environ['HIP_VISIBLE_DEVICES'] = ''
os.environ['ROCR_VISIBLE_DEVICES'] = ''

def run(args):
    subprocess.run([str(x) for x in args], check=True, env=os.environ)

uv = ROOT / 'bootstrap' / 'uv-0.13.3.data' / 'scripts' / ('uv.exe' if os.name == 'nt' else 'uv')
if not uv.exists():
    print('Downloading verified uv bootstrap', flush=True)
    machine = platform.machine().lower()
    if sys.platform == 'win32' and machine in ('amd64', 'x86_64'): tag = 'win_amd64'
    elif sys.platform == 'linux' and machine in ('amd64', 'x86_64'): tag = 'manylinux_2_17_x86_64'
    elif sys.platform == 'linux' and machine in ('aarch64', 'arm64'): tag = 'manylinux_2_17_aarch64'
    else: raise RuntimeError('One-click PP-StructureV3 currently supports Windows x64 and Linux x64/ARM64')
    with urllib.request.urlopen('https://pypi.org/pypi/uv/0.13.3/json', timeout=30) as response:
        files = json.load(response)['urls']
    entry = next(f for f in files if f['filename'].endswith('.whl') and tag in f['filename'])
    wheel = ROOT / 'bootstrap.whl'
    digest = hashlib.sha256()
    with urllib.request.urlopen(entry['url'], timeout=60) as response, wheel.open('wb') as output:
        while data := response.read(1024*1024): digest.update(data); output.write(data)
    if digest.hexdigest() != entry['digests']['sha256']: raise RuntimeError('uv checksum mismatch')
    target = ROOT / 'bootstrap'
    with zipfile.ZipFile(wheel) as archive:
        for member in archive.infolist():
            path = (target / member.filename).resolve()
            if not path.is_relative_to(target.resolve()): raise RuntimeError('Unsafe bootstrap archive path')
        archive.extractall(target)
    wheel.unlink()
    uv.chmod(0o755)
uv.chmod(0o755)
print('Preparing isolated Python 3.12', flush=True)
run([uv, 'python', 'install', '3.12', '--no-bin'])
venv = ROOT / 'venv'
if not venv.exists(): run([uv, 'venv', '--python', '3.12', venv])
python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
print('Installing pinned CPU PaddleOCR dependencies', flush=True)
run([uv, 'pip', 'install', '--python', python, 'paddlepaddle==3.3.1', 'paddleocr[doc-parser]==3.7.0'])
print('Downloading and loading layout, table and chart models', flush=True)
run([python, pathlib.Path(__file__).with_name('structure-v3.py'), '--prepare'])
(ROOT / 'ready.json').write_text(json.dumps({'schema':1, 'paddleocr':'3.7.0', 'paddlepaddle':'3.3.1', 'device':'cpu'}), encoding='utf-8')
print('DSH_SETUP_READY', flush=True)
