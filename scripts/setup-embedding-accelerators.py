"""One-click plugin-owned OpenVINO runtime and pinned model; no global packages."""
import pathlib,sys,subprocess,json,hashlib,urllib.request,os,runpy
cache=pathlib.Path(sys.argv[1]).resolve();runtime=cache/'ocr-accelerators'
subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('setup-ocr-accelerators.py')),str(runtime)],check=True)
helper=runpy.run_path(str(pathlib.Path(__file__).with_name('python-runtime.py')));uv,python,env=helper['bootstrap'](runtime)
subprocess.run([str(uv),'pip','install','--python',str(python),'tokenizers==0.22.2'],env=env,check=True)
root=cache/'embedding-accelerators';models=root/'models'/'qwen3-openvino-int8';models.mkdir(parents=True,exist_ok=True)
manifest=json.loads(pathlib.Path(__file__).with_name('openvino-embedding-manifest.json').read_text())
for item in manifest['files']:
 target=models/item['name']
 if target.exists():
  with target.open('rb') as file:digest=hashlib.file_digest(file,'sha256').hexdigest()
  if digest==item['sha256']:continue
 partial=target.with_suffix(target.suffix+'.part');print('Downloading '+item['name'],flush=True)
 with urllib.request.urlopen('https://huggingface.co/'+manifest['repository']+'/resolve/'+manifest['revision']+'/'+item['name'],timeout=120) as response,partial.open('wb') as out:
  while data:=response.read(1024*1024):out.write(data)
 with partial.open('rb') as file:digest=hashlib.file_digest(file,'sha256').hexdigest()
 if partial.stat().st_size!=item['size'] or digest!=item['sha256']:raise RuntimeError('Embedding model checksum mismatch')
 partial.replace(target)
(root/'installed.json').write_text(json.dumps({'schema':1,'revision':manifest['revision']}))
print('DSH_EMBEDDING_ACCELERATORS_INSTALLED',flush=True)
