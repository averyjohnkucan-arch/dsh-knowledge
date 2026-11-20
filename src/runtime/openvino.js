import { join } from 'node:path';
import { normalized } from './inference.js';

// Ask the driver for device class. Enumeration order and vendor names do not
// reliably distinguish integrated and discrete graphics on a hybrid laptop.
export async function intelDevices() {
  const { addon } = await import('openvino-node');
  const core = new addon.Core();
  return core
    .getAvailableDevices()
    .filter((id) => /^(GPU|NPU)(\.|$)/.test(id))
    .map((id) => ({
      id,
      name: String(core.getProperty(id, 'FULL_DEVICE_NAME')),
      kind: id.startsWith('NPU')
        ? 'npu'
        : String(core.getProperty(id, 'DEVICE_TYPE')).toLowerCase() === 'integrated'
          ? 'igpu'
          : 'gpu',
    }));
}

export async function loadOpenVino(root, encode, device) {
  const { addon } = await import('openvino-node');
  const core = new addon.Core();
  const width = device.startsWith('NPU') ? 256 : 512;
  const model = await core.readModel(join(root, 'intel', 'openvino_model.xml'));
  model.reshape(
    new Map([
      ['input_ids', '[1,' + width + ']'],
      ['attention_mask', '[1,' + width + ']'],
    ]),
  );
  const options = device.startsWith('GPU') ? { INFERENCE_PRECISION_HINT: 'f32' } : {};
  const compiled = await core.compileModel(model, device, options);
  const request = compiled.createInferRequest();
  return {
    async embed(text) {
      const ids = encode(text);
      if (ids.length > width) throw new Error('PASSAGE_TOO_LONG');
      const tokens = new BigInt64Array(width).fill(151643n);
      const mask = new BigInt64Array(width);
      ids.forEach((id, i) => {
        tokens[i] = BigInt(id);
        mask[i] = 1n;
      });
      const outputs = await request.inferAsync({
        input_ids: new addon.Tensor('i64', [1, width], tokens),
        attention_mask: new addon.Tensor('i64', [1, width], mask),
      });
      const hidden = Object.values(outputs)[0].data;
      const end = ids.length * 1024;
      return normalized(hidden.slice(end - 1024, end));
    },
  };
}
