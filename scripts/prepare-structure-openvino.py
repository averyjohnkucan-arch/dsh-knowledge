"""Prepare the PP-DocLayout_plus-L export for explicit OpenVINO devices.

Preserves weights and TopK semantics. Fixed single-page inputs allow the Intel
NPU compiler to resolve rank after Paddle2ONNX shape arithmetic is folded.
Run in the private export runtime; this does not alter the live Paddle models.
"""
import argparse
import numpy as np
import openvino as ov
from openvino import opset13 as ops
from openvino.passes import ConstantFolding, Manager


def prepare(model):
    expected = {'image', 'im_shape', 'scale_factor'}
    if {port.get_any_name() for port in model.inputs} != expected:
        raise ValueError('Expected PP-DocLayout_plus-L image/im_shape/scale_factor inputs')
    model.reshape({'image': [1, 3, 800, 800], 'im_shape': [1, 2], 'scale_factor': [1, 2]})
    folding = Manager()
    folding.register_pass(ConstantFolding())
    # Shape constants can become available only after the preceding pass.
    # Maximum(float constants) in the exporter padding logic is not folded by
    # this OpenVINO version; evaluate only literal constants, never image data.
    for _ in range(8):
        for node in model.get_ordered_ops():
            if node.get_type_name() == 'Identity':
                node.output(0).replace(node.input_value(0))
            elif node.get_type_name() == 'Maximum':
                inputs = [port.get_source_output().get_node() for port in node.inputs()]
                if len(inputs) == 2 and all(item.get_type_name() == 'Constant' for item in inputs):
                    value = np.maximum(inputs[0].get_data(), inputs[1].get_data())
                    node.output(0).replace(ops.constant(value).output(0))
        folding.run_passes(model)
        model.validate_nodes_and_infer_types()
    topks = [node for node in model.get_ordered_ops() if node.get_type_name() == 'TopK']
    if not topks or any(node.input_value(0).partial_shape.rank.is_dynamic for node in topks):
        raise ValueError('TopK input rank remains unresolved; do not deploy this export')
    return model


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--compile-device', choices=['CPU', 'GPU', 'NPU'])
    args = parser.parse_args()
    core = ov.Core()
    model = prepare(core.read_model(args.input))
    if args.compile_device:
        # An explicit device must succeed: no AUTO or CPU fallback.
        core.compile_model(model, args.compile_device)
    ov.save_model(model, args.output, compress_to_fp16=False)
