import { loadInference } from './inference.js';

// Native providers can terminate a process when a driver fails. Keep that
// failure outside Harness and tell the parent which request needs a CPU retry.
let model;
let modelKey;
process.on('disconnect', () => process.exit(0));
process.on('message', async ({ id, method, args }) => {
  try {
    let value;
    if (method === 'devices') {
      const { intelDevices } = await import('./openvino.js');
      value = await intelDevices();
    } else {
      const [config, ...input] = args;
      const key = JSON.stringify(config);
      if (key !== modelKey) {
        await model?.release?.();
        modelKey = undefined;
        model = await loadInference(...config);
        modelKey = key;
      }
      value = await model[method](...input);
    }
    process.send?.({ id, value });
  } catch (error) {
    process.send?.({ id, error: error.message });
  }
});
