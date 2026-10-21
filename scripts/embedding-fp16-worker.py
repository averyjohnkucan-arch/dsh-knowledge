"""One pinned FP16 export across CPU, Intel NPU/iGPU and optional NVIDIA CUDA."""
import argparse,json,pathlib,sys,time,numpy as np
from tokenizers import Tokenizer
p=argparse.ArgumentParser();p.add_argument('--models',required=True);p.add_argument('--device',default='CPU');p.add_argument('--threads',type=int,default=8);p.add_argument('--calibrate',action='store_true');p.add_argument('--vendor',default='intel');args=p.parse_args()
root=pathlib.Path(args.models);tokenizer=Tokenizer.from_file(str(root/'tokenizer.json'));tokenizer.no_padding();tokenizer.no_truncation();sessions={};base=None;core=None
MODEL_ID='dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated'
def intel_engine(device,bucket):
 global base,core
 key=(device,bucket)
 if key in sessions:
  cached=sessions.pop(key);sessions[key]=cached;return cached
 import openvino as ov
 from openvino import opset13 as ops
 from openvino.passes import Manager,ConstantFolding
 if core is None:core=ov.Core()
 if device.startswith('GPU') and 'intel' not in core.get_property(device,'FULL_DEVICE_NAME').lower():raise RuntimeError('Intel iGPU vendor validation failed')
 if base is None:
  m=core.read_model(root/'onnx/model_fp16.onnx')
  # Embedding never has a generation cache. Remove empty KV inputs/outputs;
  # Intel GPU rejects zero-sized runtime input buffers, even though the ONNX
  # semantics are valid. This leaves the same empty-cache computation.
  for param in list(m.get_parameters()):
   if param.friendly_name.startswith('past_key_values'):
    param.output(0).replace(ops.constant(np.zeros((1,8,0,128),np.float16)).output(0));m.remove_parameter(param)
  base=ov.Model([m.output('last_hidden_state')],m.get_parameters())
 m=base.clone();m.reshape({i.any_name:[1,bucket] for i in m.inputs});pm=Manager();pm.register_pass(ConstantFolding());pm.run_passes(m)
 for node in list(m.get_ordered_ops()):
  if node.get_type_name()=='Concat':
   live=[i.get_source_output() for i in node.inputs() if not (i.get_partial_shape().is_static and 0 in list(i.get_shape()))]
   if len(live)==1:node.output(0).replace(live[0])
 m.validate_nodes_and_infer_types();pm.run_passes(m)
 config={'CACHE_DIR':str(root/'compiled-v2'/ov.__version__/device)}
 if device=='CPU':config.update(INFERENCE_NUM_THREADS=max(1,min(32,args.threads)),INFERENCE_PRECISION_HINT='f32')
 sessions[key]=core.compile_model(m,device,config)
 # Bound resident compiled shapes; disk blobs remain reusable after eviction.
 shape_keys=[k for k in sessions if isinstance(k,tuple) and k[0]==device]
 for old in shape_keys[:-4]:sessions.pop(old)
 return sessions[key]
def onnx_engine(device):
 if device not in sessions:
  import onnxruntime as ort
  if device=='CUDA':
   ort.preload_dlls(cuda=True,cudnn=True,directory='')
   if 'CUDAExecutionProvider' not in ort.get_available_providers():raise RuntimeError('CUDA runtime is unavailable')
  options=ort.SessionOptions();options.intra_op_num_threads=max(1,min(32 if device=='CPU' else 2,args.threads));options.inter_op_num_threads=1
  providers=['CUDAExecutionProvider','CPUExecutionProvider'] if device=='CUDA' else ['CPUExecutionProvider']
  sessions[device]=ort.InferenceSession(str(root/'onnx/model_fp16.onnx'),sess_options=options,providers=providers)
  if sessions[device].get_providers()[0]!=providers[0]:raise RuntimeError('Requested execution provider could not initialize')
 return sessions[device]
def encode(texts,device):
 ids=[tokenizer.encode(t).ids for t in texts]
 if any(not row or len(row)>32768 for row in ids):raise RuntimeError('Embedding text must contain 1–32768 tokens')
 width=max(map(len,ids))
 if device=='CPU':bucket=width
 elif device=='CUDA':bucket=((width+31)//32)*32
 elif device=='NPU':bucket=256
 else:bucket=next((n for n in (32,64,128,256,512) if width<=n),width)
 if device=='NPU' and width>256:raise RuntimeError('NPU_LONG_INPUT: use CPU for more than 256 tokens')
 if device.startswith('GPU') and width>512:raise RuntimeError('IGPU_LONG_INPUT: use CPU for more than 512 tokens')
 if device!='CUDA' and len(ids)!=1:raise RuntimeError('Intel embedding requests require one text')
 # Right padding avoids all-masked leading queries on Intel devices. Pool
 # the last real token, never the padded tail, on every backend.
 tokens=np.array([row+[151643]*(bucket-len(row)) for row in ids],np.int64)
 mask=np.array([[1]*len(row)+[0]*(bucket-len(row)) for row in ids],np.int64)
 positions=np.array([list(range(len(row)))+[0]*(bucket-len(row)) for row in ids],np.int64)
 if device in ('CPU','CUDA'):
  session=onnx_engine(device);inputs={'input_ids':tokens,'attention_mask':mask,'position_ids':positions}
  for name in session.get_inputs():
   if name.name.startswith('past_key_values'):inputs[name.name]=np.zeros((len(ids),8,0,128),np.float16)
  hidden=session.run(['last_hidden_state'],inputs)[0]
 else:
  engine=intel_engine(device,bucket);hidden=engine({'input_ids':tokens,'attention_mask':mask,'position_ids':positions})[engine.output(0)]
 vectors=hidden[np.arange(len(ids)),np.array([len(row)-1 for row in ids]),:].astype(np.float64);norm=np.linalg.norm(vectors,axis=1,keepdims=True)
 if not np.all(np.isfinite(norm)) or np.any(norm<=0):raise RuntimeError('Invalid embedding vectors')
 return (vectors/norm).tolist()
if args.calibrate:
 texts=['The Apollo program landed astronauts on the Moon.','An invoice is required before expense reimbursement.','Ocean temperatures influence weather and climate.','This document describes a telescope and its detector.','The research document describes telescope sensors and astronomy observations. '*12,'A scientific article compares ocean temperature measurements and climate records. '*35]
 reference=[encode([t],'CPU')[0] for t in texts];devices=[]
 for device in ['CPU','NPU','GPU']:
  try:
   times=[];cos=[]
   for text,ref in zip(texts,reference):
    if device=='NPU' and len(tokenizer.encode(text).ids)>256:continue
    encode([text],device) # exclude lazy shape compilation from warm latency
    t=time.monotonic();v=encode([text],device)[0];times.append((time.monotonic()-t)*1000);cos.append(float(np.dot(ref,v)))
   ranking=True
   for query,expected in [('Which program landed astronauts on the Moon?',0),('What paperwork is needed to reimburse expenses?',1)]:
    q=encode([query],device)[0];ranking=ranking and int(np.argmax([np.dot(q,v) for v in reference]))==expected
   qualified=min(cos)>=.995 and ranking
   devices.append({'device':device,'name':core.get_property(device,'FULL_DEVICE_NAME') if core is not None else 'CPU','qualified':qualified,'minimumCosine':min(cos),'medianMs':float(np.median(times[1:])),'retrievalSanityPassed':ranking,**({'maxTokens':256} if device=='NPU' else {})})
  except Exception as e:devices.append({'device':device,'qualified':False,'error':str(e)[-1500:]})
 receipt={'schema':1,'format':'canonical-fp16-v1','modelId':MODEL_ID,'devices':devices,'validatedAt':int(time.time()*1000)}
 (root.parent/'ready.json').write_text(json.dumps(receipt));print(json.dumps(receipt),flush=True)
else:
 for line in sys.stdin:
  try:
   request=json.loads(line);t=time.monotonic();texts=request.get('texts') or [request['text']];vectors=encode(texts,args.device)
   result={'id':request['id'],'ok':True,'vectors':vectors,'vector':vectors[0],'elapsedMs':(time.monotonic()-t)*1000,'device':args.device}
  except Exception as e:result={'id':locals().get('request',{}).get('id'),'ok':False,'error':str(e)[-2000:]}
  print('DSH_EMBED_RESULT '+json.dumps(result),flush=True)
