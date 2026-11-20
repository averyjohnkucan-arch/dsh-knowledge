import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-node';

async function tokenizer(root, kind) {
  const read = async (file) => JSON.parse(await readFile(join(root, kind, file), 'utf8'));
  return new Tokenizer(
    ...(await Promise.all([read('tokenizer.json'), read('tokenizer_config.json')])),
  );
}

function integers(values) {
  return new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length]);
}

function numberAt(tensor, index) {
  if (
    tensor.type !== 'float16' ||
    tensor.data instanceof Float32Array ||
    tensor.data.constructor.name === 'Float16Array'
  )
    return Number(tensor.data[index]);
  // Runtimes without a native Float16Array expose raw IEEE half-precision words.
  const word = tensor.data[index],
    exponent = (word >>> 10) & 31,
    fraction = word & 1023;
  const sign = word & 32768 ? -1 : 1;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return (
    sign *
    (exponent ? 1 + fraction / 1024 : fraction / 1024) *
    2 ** (exponent ? exponent - 15 : -14)
  );
}

export function normalized(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0 || values.length !== 1024)
    throw new Error('Invalid Qwen embedding');
  return Array.from(values, (value) => value / norm);
}

function feeds(session, ids, cacheType) {
  const inputs = {};
  for (const name of session.inputNames) {
    if (name === 'input_ids') inputs[name] = integers(ids);
    else if (name === 'attention_mask') inputs[name] = integers(ids.map(() => 1));
    else if (name === 'position_ids') inputs[name] = integers(ids.map((_, index) => index));
    else if (name.startsWith('past_key_values.')) {
      const empty = cacheType === 'float16' ? new Uint16Array(0) : new Float32Array(0);
      inputs[name] = new ort.Tensor(cacheType, empty, [1, 8, 0, 128]);
    } else throw new Error('Unexpected model input ' + name);
  }
  return inputs;
}

const instruction =
  'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".';
const prefix =
  '<|im_start|>system\n' +
  instruction +
  '<|im_end|>\n<|im_start|>user\n<Instruct>: Given a web search query, retrieve relevant passages that answer the query\n<Query>: ';
const suffix = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';

export async function loadInference(root, kind, device, threads, profile) {
  const tok = await tokenizer(root, kind);
  const encode = (text) => tok.encode(text, { add_special_tokens: false }).ids;
  if (device.startsWith('ov:')) {
    const { loadOpenVino } = await import('./openvino.js');
    return loadOpenVino(root, encode, device.slice(3));
  }
  const provider = device;
  const filename = kind === 'embedding' ? 'model_fp16.onnx' : 'model_q4.onnx';
  const session = await ort.InferenceSession.create(join(root, kind, 'onnx', filename), {
    ...(profile ? { enableProfiling: true, profileFilePrefix: join(profile, 'device') } : {}),
    executionProviders: [provider],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    logSeverityLevel: 3,
  });
  const release = () => session.release();
  if (kind === 'embedding')
    return {
      release,
      async verifyProvider() {
        session.endProfiling();
        const file = (await readdir(profile)).find((name) => name.endsWith('.json'));
        if (!file) throw new Error('No execution profile was produced');
        const events = JSON.parse(await readFile(join(profile, file), 'utf8'));
        const expected = (provider + 'ExecutionProvider').toLowerCase();
        const onDevice = events.some(
          ({ args }) =>
            args?.provider?.toLowerCase() === expected &&
            /matmul|gemm|attention|fusednode/i.test(args.op_name || ''),
        );
        if (!onDevice) throw new Error('The driver did not execute the model core on this device');
        return true;
      },
      async embed(text) {
        const ids = encode(text);
        if (!ids.length || ids.length > 32768)
          throw new Error('Embedding input exceeds model limits');
        const { last_hidden_state: hidden } = await session.run(feeds(session, ids, 'float16'), [
          'last_hidden_state',
        ]);
        try {
          const width = hidden.dims.at(-1),
            start = (ids.length - 1) * width;
          return normalized(Array.from({ length: width }, (_, i) => numberAt(hidden, start + i)));
        } finally {
          hidden.dispose();
        }
      },
    };
  const yes = encode('yes')[0],
    no = encode('no')[0],
    end = encode(suffix);
  return {
    release,
    async score(query, document) {
      // Keep the assistant suffix even for long passages. The last real token
      // predicts yes/no; treating this model as a single-logit classifier is wrong.
      const head = encode(prefix + query).slice(0, 320);
      const body = encode('\n<Document>: ' + document);
      const ids = [...head, ...body.slice(0, 1024 - head.length - end.length), ...end];
      const cache = session.inputMetadata.find((input) =>
        input.name.startsWith('past_key_values.'),
      );
      const { logits } = await session.run(feeds(session, ids, cache?.type ?? 'float32'), [
        'logits',
      ]);
      try {
        const width = logits.dims.at(-1),
          row = logits.data.length - width;
        const delta = numberAt(logits, row + yes) - numberAt(logits, row + no);
        if (!Number.isFinite(delta)) throw new Error('Invalid Qwen relevance score');
        return 1 / (1 + Math.exp(-delta));
      } finally {
        logits.dispose();
      }
    },
  };
}
