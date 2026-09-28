// Runs Whisper off the main thread so rendering stays smooth while it transcribes.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

env.allowLocalModels = false;

let asr = null;

async function load(model, webgpu) {
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total > 1e6) postMessage({ type: 'progress', progress: p.progress });
  };
  if (webgpu) {
    try {
      asr = await pipeline('automatic-speech-recognition', model, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
      return 'webgpu';
    } catch {
      // fall through to WebAssembly
    }
  }
  asr = await pipeline('automatic-speech-recognition', model, { progress_callback });
  return 'wasm';
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const device = await load(data.model, data.webgpu);
      postMessage({ type: 'ready', device });
    } else if (data.type === 'transcribe') {
      const out = await asr(data.audio);
      postMessage({ type: 'result', id: data.id, text: out.text || '' });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
