"""Compact CTC output: preserve argmax/max while avoiding full vocabulary transfer."""
import hashlib,pathlib,os
class CtcScores:
 def __init__(self,indices,scores):self.indices=indices;self.scores=scores
 def argmax(self,axis):
  if axis!=2:raise ValueError('Unsupported CTC axis')
  return self.indices
 def max(self,axis):
  if axis!=2:raise ValueError('Unsupported CTC axis')
  return self.scores

def compact_model(source,cache):
 import onnx
 from onnx import helper,TensorProto
 source=pathlib.Path(source);key=hashlib.sha256(source.read_bytes()).hexdigest()
 target=pathlib.Path(cache)/('ctc-'+key+'-v2.onnx')
 if target.exists():return target
 model=onnx.load(str(source));output=model.graph.output[0];name=output.name
 # PP-OCRv5 emits float32 [batch,time,vocabulary] probabilities.
 if output.type.tensor_type.elem_type!=TensorProto.FLOAT or len(output.type.tensor_type.shape.dim)!=3:raise ValueError('Unsupported recognition output')
 indices='dsh_ctc_indices';scores='dsh_ctc_scores'
 model.graph.node.append(helper.make_node('ArgMax',[name],[indices],axis=2,keepdims=0))
 version=next(entry.version for entry in model.opset_import if entry.domain=='')
 if version>=18:
  axes='dsh_ctc_axes';model.graph.initializer.append(helper.make_tensor(axes,TensorProto.INT64,[1],[2]))
  model.graph.node.append(helper.make_node('ReduceMax',[name,axes],[scores],keepdims=0))
 else:model.graph.node.append(helper.make_node('ReduceMax',[name],[scores],axes=[2],keepdims=0))
 del model.graph.output[:]
 model.graph.output.extend([helper.make_tensor_value_info(indices,TensorProto.INT64,['batch','time']),helper.make_tensor_value_info(scores,TensorProto.FLOAT,['batch','time'])])
 onnx.checker.check_model(model)
 temp=target.with_suffix('.'+str(os.getpid())+'.tmp');onnx.save(model,str(temp));os.replace(temp,target)
 return target
