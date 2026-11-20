"""Explicit-device embedding worker. One export and tokenizer across every device."""
import argparse,sys,json,time,pathlib,numpy as np,openvino as ov,concurrent.futures
from tokenizers import Tokenizer
parser=argparse.ArgumentParser();parser.add_argument('--models',required=True);parser.add_argument('--vendor',default='intel');parser.add_argument('--device',default='CPU');parser.add_argument('--calibrate',action='store_true');parser.add_argument('--threads',type=int,default=8);args=parser.parse_args()
root=pathlib.Path(args.models);tokenizer=Tokenizer.from_file(str(root/'tokenizer.json'));tokenizer.no_padding();tokenizer.no_truncation();core=ov.Core()
base=core.read_model(root/'openvino_model.xml');compiled={}
def engine(device,bucket):
 key=(device,bucket)
 if key not in compiled:
  if device.startswith('GPU'):
   name=core.get_property(device,'FULL_DEVICE_NAME')
   if args.vendor not in name.lower():raise RuntimeError('Selected GPU does not match the requested vendor')
  model=base.clone();model.reshape({'input_ids':[1,bucket],'attention_mask':[1,bucket]})
  config={'CACHE_DIR':str(root/'compiled'/device)}
  if device=='CPU':config.update(INFERENCE_NUM_THREADS=max(1,min(32,args.threads)),INFERENCE_PRECISION_HINT='f32')
  compiled[key]=core.compile_model(model,device,config)
 return compiled[key]
def embed(text,device):
 ids=tokenizer.encode(text).ids
 if not ids or len(ids)>32768:raise RuntimeError('Embedding text must contain 1–32768 tokens')
 bucket=256 if len(ids)<=256 else 512 if len(ids)<=512 else len(ids)
 if device.startswith('NPU') and bucket>512:raise RuntimeError('NPU_LONG_INPUT: use CPU for more than 512 tokens')
 pad=bucket-len(ids);inputs={'input_ids':np.array([[151643]*pad+ids],np.int64),'attention_mask':np.array([[0]*pad+[1]*len(ids)],np.int64)}
 model=engine(device,bucket);tensor=model(inputs)[model.output(0)];vector=tensor[0,-1,:].astype(np.float64);norm=np.linalg.norm(vector)
 if not np.isfinite(norm) or norm<=0:raise RuntimeError('Embedding returned invalid values')
 return (vector/norm).tolist()
if args.calibrate:
 texts=['The Apollo program landed astronauts on the Moon.','An invoice is required before expense reimbursement.','Ocean temperatures influence weather and climate.','This document describes a telescope and its detector.']
 reference=[embed(text,'CPU') for text in texts];devices=[]
 for device in ['CPU','NPU']:
  try:
   times=[];cosines=[]
   for text,ref in zip(texts,reference):
    start=time.monotonic();vector=embed(text,device);times.append((time.monotonic()-start)*1000);cosines.append(float(np.dot(ref,vector)))
   queries=[('Which program landed astronauts on the Moon?',0),('What paperwork is needed to reimburse expenses?',1)]
   ranking_passed=True
   for query,expected in queries:
    query_vector=embed(query,device)
    ranking_passed=ranking_passed and int(np.argmax([np.dot(query_vector,vector) for vector in reference]))==expected
   device_name=core.get_property(device,'FULL_DEVICE_NAME');qualified=min(cosines)>=.995 and ranking_passed
   devices.append({'device':device,'name':device_name,'qualified':qualified,'medianMs':float(np.median(times[1:])),'minimumCosine':min(cosines),'retrievalSanityPassed':ranking_passed})
  except Exception as error:devices.append({'device':device,'qualified':False,'error':str(error)[-1500:]})
 result={'schema':1,'modelId':'OpenVINO/Qwen3-Embedding-0.6B-int8-ov','devices':devices,'validatedAt':int(time.time()*1000)}
 (root.parent.parent/'ready.json').write_text(json.dumps(result));print(json.dumps(result),flush=True)
else:
 for line in sys.stdin:
  try:
   request=json.loads(line);start=time.monotonic();vector=embed(request['text'],args.device);result={'id':request['id'],'ok':True,'vector':vector,'elapsedMs':(time.monotonic()-start)*1000}
  except Exception as error:result={'id':locals().get('request',{}).get('id'),'ok':False,'error':str(error)[-1500:]}
  print('DSH_EMBED_RESULT '+json.dumps(result),flush=True)
