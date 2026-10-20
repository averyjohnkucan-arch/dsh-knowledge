"""Pinned optional accelerated embedding setup inside the knowledge plugin cache."""
import pathlib,sys,runpy,subprocess,json,hashlib,urllib.request,shutil,os
cache=pathlib.Path(sys.argv[1]).resolve();scripts=pathlib.Path(__file__).parent
subprocess.run([sys.executable,str(scripts/'setup-ocr-accelerators.py'),str(cache/'ocr-accelerators')],check=True)
root=cache/'embedding-fp16-accelerators';models=root/'models';models.mkdir(parents=True,exist_ok=True)
manifest=json.loads((scripts/'qwen-fp16-manifest.json').read_text());repository=manifest['repository'];revision=manifest['revision']
for item in manifest['files']:
 target=models/item['name'];target.parent.mkdir(parents=True,exist_ok=True)
 def valid(path):return path.exists() and path.stat().st_size==item['size'] and hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==item['sha256']
 if valid(target):continue
 existing=cache/repository/item['name']
 if valid(existing):
  try:os.link(existing,target)
  except OSError:shutil.copyfile(existing,target)
  continue
 partial=target.with_name(target.name+'.part');print('Downloading '+item['name'],flush=True)
 with urllib.request.urlopen(f'https://huggingface.co/{repository}/resolve/{revision}/'+item['name'],timeout=120) as response,partial.open('wb') as out:
  while data:=response.read(1024*1024):out.write(data)
 if not valid(partial):raise RuntimeError('FP16 embedding checksum mismatch')
 partial.replace(target)
# CUDA dependencies are optional and isolated from the Intel/OCR runtime.
if sys.platform in ('linux','win32') and shutil.which('nvidia-smi'):
 try:
  uv,python,env=runpy.run_path(str(scripts/'python-runtime.py'))['bootstrap'](cache/'embedding-gpu-runtime')
  subprocess.run([str(uv),'pip','install','--python',str(python),'-r',str(scripts/'embedding-gpu-requirements.txt')],env=env,check=True)
 except Exception as error:
  print('Optional NVIDIA runtime unavailable; CPU/NPU remain available: '+str(error),flush=True)
(root/'installed.json').write_text(json.dumps({'schema':1,'revision':revision}))
print('DSH_FP16_EMBEDDING_INSTALLED',flush=True)
