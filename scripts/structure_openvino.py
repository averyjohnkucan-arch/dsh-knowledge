"""Explicit-device layout runner; Paddle retains its preprocessing/postprocessing."""
import numpy as np
import openvino as ov


class LayoutRunner:
    def __init__(self, model_path, device, cache_dir=None):
        if device not in ('CPU', 'GPU', 'NPU'):
            raise ValueError('Unsupported layout device')
        self.core = ov.Core()
        name = self.core.get_property(device, 'FULL_DEVICE_NAME')
        if device == 'GPU' and 'intel' not in name.lower():
            raise ValueError('Layout GPU must be the Intel iGPU')
        properties = {'CACHE_DIR': cache_dir} if cache_dir else {}
        if device == 'CPU':
            properties.update(INFERENCE_NUM_THREADS=4, INFERENCE_PRECISION_HINT='f32')
        elif device == 'GPU':
            properties['INFERENCE_PRECISION_HINT'] = 'f32'
        self.model = self.core.compile_model(model_path, device, properties)
        self.names = sorted(port.get_any_name() for port in self.model.inputs)
        self.device = device
        self.device_name = name

    def __call__(self, values, **kwargs):
        # PaddleX RunnerPredictor supplies inputs in lexicographic name order.
        if len(values) != len(self.names):
            raise ValueError('Layout input count mismatch')
        feeds = {name: np.ascontiguousarray(value) for name, value in zip(self.names, values)}
        shape = feeds['image'].shape
        if len(shape) != 4 or tuple(shape[1:]) != (3, 800, 800) or shape[0] < 1:
            raise ValueError(f'Verified layout graph requires 800x800 pages; received {shape}')
        if any(value.shape[0] != shape[0] for value in feeds.values()):
            raise ValueError('Layout metadata batch mismatch')
        # PP-Structure may batch several PDF pages. The NPU graph has a fixed
        # page shape; concatenate boxes and per-page counts in original order.
        outputs = [[] for _ in self.model.outputs]
        for page in range(shape[0]):
            result = self.model({name: value[page:page+1] for name, value in feeds.items()})
            for values, port in zip(outputs, self.model.outputs):
                values.append(result[port].copy())
        return [np.concatenate(values, axis=0) for values in outputs]


def install_layout_runner(engine, model_path, device, cache_dir=None):
    predictor = engine.paddlex_pipeline.layout_det_model
    if not hasattr(predictor, 'runner'):
        raise RuntimeError('Unsupported PaddleX layout predictor; keep the CPU pipeline')
    if not hasattr(predictor, '_dsh_reference_runner'):
        predictor._dsh_reference_runner = predictor.runner
    predictor.runner = LayoutRunner(model_path, device, cache_dir)
