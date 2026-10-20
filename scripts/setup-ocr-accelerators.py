"""Download private user-space inference libraries. Never install kernel/system packages."""
import sys,os,pathlib,subprocess,json,hashlib,tarfile,urllib.request,runpy
helper=runpy.run_path(str(pathlib.Path(__file__).with_name('python-runtime.py')))
root=pathlib.Path(sys.argv[1]).resolve();uv,python,env=helper['bootstrap'](root)
subprocess.run([str(uv),'pip','install','--python',str(python),'openvino==2026.4.1','rapidocr==3.10.0'],env=env,check=True)
if sys.platform=='linux':
    manifest=json.loads(pathlib.Path(__file__).with_name('intel-runtime-manifest.json').read_text())
    downloads=root/'downloads';downloads.mkdir(exist_ok=True);destination=root/'intel';destination.mkdir(exist_ok=True)
    for item in manifest['assets']:
        target=downloads/item['name']
        if not target.exists() or hashlib.file_digest(target.open('rb'),'sha256').hexdigest()!=item['sha256']:
            print('Downloading '+item['name'],flush=True)
            partial=target.with_suffix(target.suffix+'.part')
            with urllib.request.urlopen(item['url'],timeout=90) as response,partial.open('wb') as out:
                while data:=response.read(1024*1024):out.write(data)
            if partial.stat().st_size!=item['size'] or hashlib.file_digest(partial.open('rb'),'sha256').hexdigest()!=item['sha256']:raise RuntimeError('Intel runtime checksum mismatch')
            partial.replace(target)
        if target.name.endswith('.deb'):subprocess.run(['dpkg-deb','--extract',str(target),str(destination)],check=True)
        else:
            extracted=downloads/'npu';extracted.mkdir(exist_ok=True)
            with tarfile.open(target) as archive:archive.extractall(extracted,filter='data')
            for package in extracted.rglob('*.deb'):
                # Firmware/kernel packages are not extracted or installed by this plugin.
                if package.name.startswith(('intel-driver-compiler-npu_','intel-level-zero-npu_','intel-compiler-npu_')):subprocess.run(['dpkg-deb','--extract',str(package),str(destination)],check=True)
    icd=root/'icd';icd.mkdir(exist_ok=True)
    library=destination/'usr/lib/x86_64-linux-gnu/intel-opencl/libigdrcl.so'
    (icd/'intel.icd').write_text(str(library)+'\n')
(root/'installed.json').write_text(json.dumps({'schema':1,'openvino':'2026.4.1','rapidocr':'3.10.0'}))
print('DSH_OCR_ACCELERATORS_INSTALLED',flush=True)
