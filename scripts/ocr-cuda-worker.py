"""PP-OCRv5 on explicit NVIDIA CUDA; CPU fallback is never reported as CUDA."""
import argparse,base64,contextlib,json,pathlib,sys,time
import numpy as np
import onnxruntime as ort
from rapidocr import RapidOCR,EngineType,OCRVersion
import rapidocr.inference_engine.onnxruntime as backend

class CudaSession:
 def __init__(self,cfg):
  options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.log_severity_level=3
  self.session=ort.InferenceSession(str(cfg['model_path']),sess_options=options,providers=[('CUDAExecutionProvider',{'device_id':0,'gpu_mem_limit':1024**3,'cudnn_conv_algo_search':'HEURISTIC'})])
  if 'CUDAExecutionProvider' not in self.session.get_providers():raise RuntimeError('NVIDIA CUDA session unavailable; refusing silent CPU fallback')
 def have_key(self,key='character'):return False
 def __call__(self,x):return self.session.run(None,{self.session.get_inputs()[0].name:x})[0]

def create_pipeline(models,cache):
 ort.preload_dlls(directory='')
 if 'CUDAExecutionProvider' not in ort.get_available_providers():raise RuntimeError('CUDA execution provider unavailable')
 root=pathlib.Path(models);folder=pathlib.Path(cache);folder.mkdir(parents=True,exist_ok=True)
 lines=(root/'ppocrv5_dict.txt').read_text(encoding='utf-8').splitlines()
 if lines and not lines[0]:lines=lines[1:]
 dictionary=folder/'ppocrv5-rapid-dict-cuda.txt';dictionary.write_text('\n'.join(lines)+'\n',encoding='utf-8')
 params={'Global.log_level':'warning','Global.use_cls':False,'Rec.rec_keys_path':str(dictionary),'Rec.rec_batch_num':8,'Det.limit_side_len':1536,'Det.limit_type':'max','Det.mean':[.485,.456,.406],'Det.std':[.229,.224,.225]}
 for role,filename in [('Det','ppocrv5_det.onnx'),('Rec','ppocrv5_rec.onnx')]:
  params.update({role+'.engine_type':EngineType.ONNXRUNTIME,role+'.ocr_version':OCRVersion.PPOCRV5,role+'.model_path':str(root/filename)})
 backend.OrtInferSession=CudaSession
 pipeline=RapidOCR(params=params);pipeline._load_det_model();pipeline._load_rec_model();return pipeline

if __name__=='__main__':
 import cv2
 cv2.setNumThreads(1)
 parser=argparse.ArgumentParser();parser.add_argument('--models',required=True);parser.add_argument('--cache',required=True)
 args=parser.parse_args();pipeline=None
 for line in sys.stdin:
  request=None
  try:
   request=json.loads(line)
   if not isinstance(request.get('png'),str) or len(request['png'])>96*1024*1024:raise ValueError('Invalid OCR image request')
   start=time.perf_counter()
   with contextlib.redirect_stdout(sys.stderr):
    if pipeline is None:pipeline=create_pipeline(args.models,args.cache)
    image=cv2.imdecode(np.frombuffer(base64.b64decode(request['png'],validate=True),dtype=np.uint8),cv2.IMREAD_COLOR)
    if image is None or image.size>96*1024*1024:raise ValueError('Invalid or oversized OCR image')
    result=pipeline(image,use_cls=False);text='\n'.join(result.txts or [])
   response={'id':request['id'],'ok':True,'text':text,'elapsedMs':(time.perf_counter()-start)*1000,'provider':'CUDAExecutionProvider'}
  except Exception as error:response={'id':request.get('id') if isinstance(request,dict) else None,'ok':False,'error':str(error)[:1000]}
  print('DSH_OCR_RESULT '+json.dumps(response),flush=True)
