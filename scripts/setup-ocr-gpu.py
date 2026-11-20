"""Optional private CUDA runtime shared with embeddings; no system Python changes."""
import pathlib,runpy,subprocess,sys,shutil
if not shutil.which('nvidia-smi'):
 print('No NVIDIA driver detected; OCR uses CPU/Intel devices',flush=True);sys.exit(0)
root=pathlib.Path(sys.argv[1]).resolve();scripts=pathlib.Path(__file__).parent
uv,python,env=runpy.run_path(str(scripts/'python-runtime.py'))['bootstrap'](root/'embedding-gpu-runtime')
subprocess.run([str(uv),'pip','install','--python',str(python),'-r',str(scripts/'ocr-gpu-requirements.txt')],env=env,check=True)
print('DSH_OCR_CUDA_INSTALLED',flush=True)
