"""Plugin-owned PP-OCRv5 execution using explicit Intel/CPU devices.

RapidOCR supplies preprocessing/CTC decoding. OpenVINO owns bounded, cached
inference sessions. A GPU label is never accepted without checking its identity.
"""
import os,time,json,sys,pathlib,collections,math
import numpy as np,openvino as ov
from rapidocr import RapidOCR,EngineType,OCRVersion
import rapidocr.inference_engine.openvino as backend
requested = None
compiled_cache = None
class Session:
 def __init__(self,cfg):
  self.core=ov.Core();self.device=requested
  name=self.core.get_property(requested,'FULL_DEVICE_NAME')
  if requested.startswith('GPU') and 'intel' not in name.lower():raise RuntimeError('Refusing non-Intel GPU during active use')
  self.model=self.core.read_model(cfg['model_path']);self.cache=collections.OrderedDict();self.compiles=0;self.compile_s=0
  self.rec='rec' in pathlib.Path(cfg['model_path']).name
 def have_key(self,key='character'):return False
 def __call__(self,x):
  shape=list(x.shape); original_shape=shape.copy()
  if requested=='NPU':
   target=[*shape[:3],math.ceil(shape[3]/128)*128]
   if not self.rec: target=[shape[0],shape[1],math.ceil(shape[2]/128)*128,math.ceil(shape[3]/128)*128]
   if target!=shape:
    x=np.pad(x,[(0,b-a)for a,b in zip(shape,target)]);shape=target
  key=tuple(shape) if requested=='NPU' else ('dynamic',shape[0],shape[1],shape[2] if self.rec else 0)
  compiled=self.cache.pop(key,None)
  if compiled is None:
   model=self.model.clone()
   if requested=='NPU':model.reshape({model.input(0).any_name:shape})
   elif self.rec:model.reshape({model.input(0).any_name:ov.PartialShape([shape[0],3,shape[2],ov.Dimension(1,4096)])})
   else:model.reshape({model.input(0).any_name:ov.PartialShape([shape[0],3,ov.Dimension(32,4096),ov.Dimension(32,4096)])})
   t=time.perf_counter();props={'PERFORMANCE_HINT':'LATENCY', 'CACHE_DIR':str(compiled_cache)}
   if requested=='CPU':props.update(INFERENCE_NUM_THREADS=8,NUM_STREAMS=1)
   compiled=self.core.compile_model(model,requested,props);self.compile_s+=time.perf_counter()-t;self.compiles+=1
  self.cache[key]=compiled
  while len(self.cache)>16:self.cache.popitem(last=False)
  y=compiled([x])[compiled.output(0)].copy()
  # Detection output is spatial; drop padding added for static accelerator buckets.
  if not self.rec:y=y[...,:original_shape[-2],:original_shape[-1]]
  return y


def create_pipeline(model_dir, device, cache_dir):
 global requested, compiled_cache
 requested = device; compiled_cache = pathlib.Path(cache_dir) / device
 compiled_cache.mkdir(parents=True, exist_ok=True)
 root=pathlib.Path(model_dir).resolve()
 dictionary=pathlib.Path(cache_dir)/'ppocrv5-rapid-dict.txt'
 lines=(root/'ppocrv5_dict.txt').read_text(encoding='utf-8').splitlines()
 # Node dictionary includes CTC blank; RapidOCR inserts its own blank token.
 if lines and lines[0]=='': lines=lines[1:]
 dictionary.write_text('\n'.join(lines)+'\n',encoding='utf-8')
 params={'Global.log_level':'warning','Global.use_cls':False,'Rec.rec_keys_path':str(dictionary),'Rec.rec_batch_num':1,'Det.limit_side_len':1536,'Det.limit_type':'max','Det.mean':[.485,.456,.406],'Det.std':[.229,.224,.225]}
 for role,filename in [('Det','ppocrv5_det.onnx'),('Rec','ppocrv5_rec.onnx')]:
  params.update({role+'.engine_type':EngineType.OPENVINO,role+'.ocr_version':OCRVersion.PPOCRV5,role+'.model_path':str(root/filename)})
 backend.OpenVINOInferSession=Session
 pipeline=RapidOCR(params=params);pipeline._load_det_model();pipeline._load_rec_model()
 return pipeline

def model_identity(folder):
 import hashlib
 root=pathlib.Path(folder);digest=hashlib.sha256()
 for name in ['ppocrv5_det.onnx','ppocrv5_rec.onnx','ppocrv5_dict.txt']:
  with (root/name).open('rb') as source:
   while chunk:=source.read(1024*1024):digest.update(chunk)
 return digest.hexdigest()

def probe():
 core=ov.Core(); result=[]
 for device in core.available_devices:
  name=core.get_property(device,'FULL_DEVICE_NAME')
  allowed=device=='CPU' or device.startswith('NPU') or device.startswith('GPU') and 'intel' in name.lower()
  result.append({'device':device,'name':name,'allowed':allowed})
 return result

def calibrate(args):
 from PIL import Image, ImageDraw, ImageFont, ImageFilter
 import statistics,re,tempfile
 image=Image.new('RGB',(1400,600),'white'); draw=ImageDraw.Draw(image)
 try: font=ImageFont.truetype('DejaVuSans.ttf',38)
 except OSError: font=ImageFont.load_default(size=38)
 lines=['Project MERIDIAN-QA-4827','Approved route: COBALT','Quantity: 17 crates','Coordinator: Elara Stone','Deadline: 8 December 2026']
 for i,text in enumerate(lines):draw.text((40,35+i*90),text,font=font,fill='black')
 variants=[np.asarray(image)[:,:,::-1].copy(),np.asarray(image.rotate(1.1,expand=True,fillcolor='white').filter(ImageFilter.GaussianBlur(.3)))[:,:,::-1].copy()]
 reports=[]
 for device in probe():
  if not device['allowed']:continue
  try:
   pipeline=create_pipeline(args.models,device['device'],args.cache);times=[]
   for index in range(4):
    start=time.perf_counter();result=pipeline(variants[index%2],use_cls=False)
    text=re.sub('[^a-z0-9]','', '\n'.join(result.txts or []).lower())
    if not all(field in text for field in ['meridianqa4827','cobalt','17','elarastone','8december2026']):raise RuntimeError('OCR fidelity self-test failed')
    if index>=2:times.append((time.perf_counter()-start)*1000)
   reports.append({**device,'qualified':True,'medianMs':statistics.median(times)})
  except Exception as error: reports.append({**device,'qualified':False,'error':str(error)[:500]})
 receipt={'schema':1,'modelHash':model_identity(args.models),'openvino':ov.__version__,'devices':reports}
 if not any(d['qualified'] and d['device']=='CPU' for d in reports):raise RuntimeError('CPU OCR self-test failed')
 pathlib.Path(args.output).write_text(json.dumps(receipt,indent=2),encoding='utf-8')
 print('DSH_OCR_ACCELERATORS_READY',flush=True)

if __name__=='__main__':
 import argparse,base64,cv2,contextlib
 parser=argparse.ArgumentParser();parser.add_argument('--models',required=True);parser.add_argument('--cache',required=True);parser.add_argument('--device',default='CPU');parser.add_argument('--worker',action='store_true');parser.add_argument('--calibrate',action='store_true');parser.add_argument('--output')
 args=parser.parse_args()
 if args.calibrate:calibrate(args)
 elif args.worker:
  pipeline=None
  for line in sys.stdin:
   request=None
   try:
    request=json.loads(line)
    if not isinstance(request.get('png'),str) or len(request['png'])>96*1024*1024:raise ValueError('Invalid OCR image request')
    started=time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
     if pipeline is None:pipeline=create_pipeline(args.models,args.device,args.cache)
     image=cv2.imdecode(np.frombuffer(base64.b64decode(request['png'],validate=True),dtype=np.uint8),cv2.IMREAD_COLOR)
     if image is None or image.size>96*1024*1024:raise ValueError('Invalid or oversized OCR image')
     result=pipeline(image,use_cls=False)
     text='\n'.join(result.txts or [])
    response={'id':request['id'],'ok':True,'text':text,'elapsedMs':(time.perf_counter()-started)*1000}
   except Exception as error:response={'id':request.get('id') if isinstance(request,dict) else None,'ok':False,'error':str(error)[:1000]}
   print('DSH_OCR_RESULT '+json.dumps(response),flush=True)
 else:parser.error('Choose worker or calibration')
