"""Isolated Python bootstrap; only official PyPI/uv sources, no global install."""
import os,pathlib,urllib.request,json,hashlib,zipfile,platform,subprocess,sys

def bootstrap(root):
    root=pathlib.Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
    env={**os.environ,'UV_PYTHON_INSTALL_DIR':str(root/'python'),'UV_CACHE_DIR':str(root/'uv-cache'),'CUDA_VISIBLE_DEVICES':'','HIP_VISIBLE_DEVICES':'','ROCR_VISIBLE_DEVICES':''}
    uv=root/'bootstrap'/'uv-0.13.3.data'/'scripts'/('uv.exe' if os.name=='nt' else 'uv')
    if not uv.exists():
        machine=platform.machine().lower()
        if sys.platform=='win32' and machine in ('amd64','x86_64'):tag='win_amd64'
        elif sys.platform=='linux' and machine in ('amd64','x86_64'):tag='manylinux_2_17_x86_64'
        else:raise RuntimeError('This optional accelerator runtime supports Linux and Windows x64')
        with urllib.request.urlopen('https://pypi.org/pypi/uv/0.13.3/json',timeout=30) as response:files=json.load(response)['urls']
        item=next(f for f in files if f['filename'].endswith('.whl') and tag in f['filename'])
        wheel=root/'bootstrap.whl';digest=hashlib.sha256()
        with urllib.request.urlopen(item['url'],timeout=60) as response,wheel.open('wb') as target:
            while data:=response.read(1024*1024):digest.update(data);target.write(data)
        if digest.hexdigest()!=item['digests']['sha256']:raise RuntimeError('uv checksum mismatch')
        destination=root/'bootstrap'
        with zipfile.ZipFile(wheel) as archive:
            if any(not (destination / m.filename).resolve().is_relative_to(destination.resolve()) for m in archive.infolist()):raise RuntimeError('Unsafe bootstrap archive')
            archive.extractall(destination)
        wheel.unlink()
    uv.chmod(0o755)
    subprocess.run([str(uv),'python','install','3.12.15','--no-bin'],env=env,check=True)
    venv=root/'venv'
    if not venv.exists():subprocess.run([str(uv),'venv','--python','3.12.15',str(venv)],env=env,check=True)
    python=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    return uv,python,env
