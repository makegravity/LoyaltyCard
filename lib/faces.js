'use strict';
// Finds faces in a photo, so a membership card always carries one. Uses the UltraFace
// detector (models/ultraface-rfb-320.onnx, MIT licence, 1.2 MB) run by ONNX Runtime's
// WebAssembly build: no native code, so it runs the same in the Alpine container.
const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-web');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const MODEL = path.join(__dirname, '..', 'models', 'ultraface-rfb-320.onnx');
const W = 320;
const H = 240;
const MIN_SCORE = 0.7;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

let session = null;
function model() {
  // logSeverityLevel 3: errors only (the model file trips a harmless warning per weight).
  session ??= ort.InferenceSession.create(new Uint8Array(fs.readFileSync(MODEL)), { logSeverityLevel: 3 });
  return session;
}

function decode(buf, mime) {
  if (mime === 'image/jpeg') return jpeg.decode(buf, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
  if (mime === 'image/png') return PNG.sync.read(buf);
  return null;
}

// The photo, scaled to fit 320×240 without stretching (grey bars fill the rest), as the
// network's input: RGB planes, each value (v − 127) / 128.
function toInput({ width, height, data }) {
  const scale = Math.min(W / width, H / height);
  const ox = (W - width * scale) / 2;
  const oy = (H - height * scale) / 2;
  const input = new Float32Array(3 * W * H); // 0 = the grey of the bars
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5 - oy) / scale - 0.5;
    if (sy < -0.5 || sy > height - 0.5) continue;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5 - ox) / scale - 0.5;
      if (sx < -0.5 || sx > width - 0.5) continue;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      for (let c = 0; c < 3; c++) {
        const p = (yy, xx) => data[(yy * width + xx) * 4 + c];
        const v = (p(y0, x0) * (1 - fx) + p(y0, x1) * fx) * (1 - fy) + (p(y1, x0) * (1 - fx) + p(y1, x1) * fx) * fy;
        input[c * W * H + y * W + x] = (v - 127) / 128;
      }
    }
  }
  return { input, scale, ox, oy };
}

const iou = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
};

// The faces in a JPEG or PNG, biggest first, in the photo's own pixels:
// [{ x, y, w, h, score }]. Null for another format.
async function findFaces(buf, mime) {
  const img = decode(buf, mime);
  if (!img) return null;
  const { input, scale, ox, oy } = toInput(img);
  const session = await model();
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) });
  const scores = out.scores.data;
  const boxes = out.boxes.data;
  const found = [];
  for (let i = 0; i < scores.length / 2; i++) {
    const score = scores[i * 2 + 1];
    if (score < MIN_SCORE) continue;
    const x1 = (boxes[i * 4] * W - ox) / scale;
    const y1 = (boxes[i * 4 + 1] * H - oy) / scale;
    const x2 = (boxes[i * 4 + 2] * W - ox) / scale;
    const y2 = (boxes[i * 4 + 3] * H - oy) / scale;
    found.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, score });
  }
  // One box per face: keep the best of any that overlap.
  found.sort((a, b) => b.score - a.score);
  const faces = [];
  for (const f of found) if (faces.every((k) => iou(k, f) < 0.3)) faces.push(f);
  return faces.sort((a, b) => b.w * b.h - a.w * a.h).map((f) => ({ ...f, imageWidth: img.width, imageHeight: img.height }));
}

// Why a card photo won't do, or null when it shows one clear face: none found, a face too
// small to recognise at the register, or someone else just as clearly in the photo.
async function photoProblem(buf, mime) {
  const faces = await findFaces(buf, mime);
  if (faces === null) return 'Please use a JPEG or PNG photo.';
  if (!faces.length) return "We couldn't find a face in that photo. Face the camera in good light and take it again.";
  const [main, next] = faces;
  if (main.w < 0.15 * Math.min(main.imageWidth, main.imageHeight)) return 'Your face is too small in that photo. Move closer and take it again.';
  if (next && next.w > 0.6 * main.w) return 'Only one person in the photo, please. Take it again with just you.';
  return null;
}

module.exports = { findFaces, photoProblem, warmUp: () => model() };
