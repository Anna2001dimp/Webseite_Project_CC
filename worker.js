// ── Effect computation worker ───────────────────────────────────────────────────
// Runs the heavy per-frame math (Focus Map for Pixelation, Motion Map for
// Motion & Particles) off the main thread, so it never competes with video
// decode or UI responsiveness. Pure number-crunching only — no DOM/Canvas
// access here (Workers can't touch the DOM), the final pixel/canvas rendering
// stays on the main thread (see effects/pixelation.js and
// effects/motion-particles.js for the request/response wiring).
//
// Trade-off: results arrive asynchronously, so the rendered effect lags the
// live frame by roughly one round-trip (a frame or two) — accepted in exchange
// for not blocking the main thread.

let focusLumaBuffer = null, focusLapBuffer = null, focusDepthMap = null;
let motionLumaBuffer = null, motionDiffBuffer = null, motionMap = null;
let prevMotionLuma = null;

function ensureFocusBuffers(n) {
  if (focusLumaBuffer && focusLumaBuffer.length === n) return;
  focusLumaBuffer = new Float32Array(n);
  focusLapBuffer  = new Float32Array(n);
  focusDepthMap   = new Float32Array(n);
}

function ensureMotionBuffers(n) {
  if (motionLumaBuffer && motionLumaBuffer.length === n) return;
  motionLumaBuffer = new Float32Array(n);
  motionDiffBuffer = new Float32Array(n);
  motionMap        = new Float32Array(n);
}

// ── Focus-Map (depth approximation, pure JS, no ML/CDN) ──────────────────────
// Measures local sharpness via Laplacian filter on each frame.
// Sharp/detailed areas (foreground objects) → bright.
// Smooth/flat areas (background) → dark.
// A box-blur pass spreads the focus signal so whole objects fill, not just edges.
function calculateFocusMap(d, W, H) {
  ensureFocusBuffers(W * H);

  // Step 1 — luminance
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    focusLumaBuffer[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  }

  // Step 2 — Laplacian (4-neighbour): high value = sharp/detailed = foreground
  let maxVal = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const v = Math.abs(
        focusLumaBuffer[y * W + x - 1] + focusLumaBuffer[y * W + x + 1] +
        focusLumaBuffer[(y - 1) * W + x] + focusLumaBuffer[(y + 1) * W + x] -
        4 * focusLumaBuffer[y * W + x]
      );
      focusLapBuffer[y * W + x] = v;
      if (v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) return focusDepthMap;
  for (let i = 0; i < W * H; i++) focusLapBuffer[i] /= maxVal;

  // Step 3 — box blur (radius 2) to spread focus signal while keeping detail
  const R = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, count = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
            sum += focusLapBuffer[ny * W + nx];
            count++;
          }
        }
      }
      focusDepthMap[y * W + x] = sum / count;
    }
  }

  // Step 4 — normalise so the full 0–1 range is always used
  let dmin = Infinity, dmax = -Infinity;
  for (let i = 0; i < W * H; i++) {
    if (focusDepthMap[i] < dmin) dmin = focusDepthMap[i];
    if (focusDepthMap[i] > dmax) dmax = focusDepthMap[i];
  }
  const range = dmax - dmin || 1;
  for (let i = 0; i < W * H; i++) {
    focusDepthMap[i] = (focusDepthMap[i] - dmin) / range;
  }
  return focusDepthMap;
}

// ── Motion-Map — frame-differencing: large luma change between consecutive
// frames means motion. A box blur spreads that signal outward so the
// "push apart" effect reaches a radius around the moving area.
function calculateMotionMap(d, W, H) {
  ensureMotionBuffers(W * H);

  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    motionLumaBuffer[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  }

  if (!prevMotionLuma) {
    prevMotionLuma = new Float32Array(motionLumaBuffer);
    motionMap.fill(0);
    return motionMap;
  }

  let maxVal = 0;
  for (let i = 0; i < W * H; i++) {
    const v = Math.abs(motionLumaBuffer[i] - prevMotionLuma[i]);
    motionDiffBuffer[i] = v;
    if (v > maxVal) maxVal = v;
  }
  prevMotionLuma.set(motionLumaBuffer);

  if (maxVal === 0) { motionMap.fill(0); return motionMap; }
  for (let i = 0; i < W * H; i++) motionDiffBuffer[i] /= maxVal;

  // Box blur (radius 4) — defines how far the push-apart effect reaches
  // around a moving area, not just the exact pixels that changed.
  const R = 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, count = 0;
      for (let dy = -R; dy <= R; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          sum += motionDiffBuffer[ny * W + nx];
          count++;
        }
      }
      motionMap[y * W + x] = sum / count;
    }
  }
  return motionMap;
}

self.onmessage = (e) => {
  const { type, buffer, w, h } = e.data;

  if (type === 'focusMap') {
    const data = new Uint8ClampedArray(buffer);
    const result = calculateFocusMap(data, w, h).slice(); // copy — keep our own buffer intact
    self.postMessage({ type: 'focusMap', buffer: result.buffer }, [result.buffer]);
  } else if (type === 'motionMap') {
    const data = new Uint8ClampedArray(buffer);
    const result = calculateMotionMap(data, w, h).slice();
    self.postMessage({ type: 'motionMap', buffer: result.buffer }, [result.buffer]);
  } else if (type === 'resetMotion') {
    prevMotionLuma = null;
  }
};
