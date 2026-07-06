// ── Motion & Particles Effect ──────────────────────────────────────────────────
// Frame-differencing motion map: large luma change between consecutive frames
// means motion. A box blur spreads that signal outward so the "push apart"
// effect reaches a radius around the moving area, not just the exact pixels.
// A grid of short rotating white strokes is rendered on a black canvas and
// pushed away from wherever motion is currently happening.
//
// createMotionParticlesEffect() returns a fresh instance with its own agents,
// so each project page gets an independent copy.
//
// The motion-map computation (frame diff + box blur) is the heaviest per-frame
// math here, so it's offloaded to `worker` (a shared per-page Worker running
// worker.js) — requestMotionMap() posts a copy of the frame and returns
// immediately; motionMap updates asynchronously a frame or two later when the
// worker responds. drawMotionParticles() always reads whatever motionMap
// currently holds, so it just renders with the most recent available result.

export function createMotionParticlesEffect(SAMPLE_W, SAMPLE_H, worker) {
  const motionMap = new Float32Array(SAMPLE_W * SAMPLE_H);
  let motionRequestPending = false;

  worker.addEventListener('message', (e) => {
    if (e.data.type !== 'motionMap') return;
    motionMap.set(new Float32Array(e.data.buffer));
    motionRequestPending = false;
  });

  function requestMotionMap(frameData) {
    if (!frameData || motionRequestPending) return;
    motionRequestPending = true;
    const copy = new Uint8ClampedArray(frameData.data); // copy — frameData is still needed synchronously elsewhere this frame
    worker.postMessage({ type: 'motionMap', buffer: copy.buffer, w: SAMPLE_W, h: SAMPLE_H }, [copy.buffer]);
  }

  // Maps a canvas coordinate (within videoBounds) to the analysis grid — a local
  // copy of the same mapping projectpage.js uses for other effects, since pulling
  // it in as a callback would couple this file to projectpage.js's internals.
  function mapToAnalyse(canvasX, canvasY, videoBounds) {
    const relX = (canvasX - videoBounds.x) / videoBounds.width;
    const relY = (canvasY - videoBounds.y) / videoBounds.height;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
    return {
      ax: Math.min(Math.floor(relX * SAMPLE_W), SAMPLE_W - 1),
      ay: Math.min(Math.floor(relY * SAMPLE_H), SAMPLE_H - 1),
    };
  }

  function getMotionAt(canvasX, canvasY, videoBounds) {
    const mapped = mapToAnalyse(canvasX, canvasY, videoBounds);
    if (!mapped) return 0;
    return motionMap[mapped.ay * SAMPLE_W + mapped.ax];
  }

  // ── Agent field — short rotating white strokes, pushed apart by motion ───────
  const MOTION_AGENT_COUNT   = 1400;
  const MOTION_SAMPLE_STEP   = 6;   // px — neighbour distance used for the motion gradient
  const MOTION_PUSH_STRENGTH = 140; // px of max displacement at full motion intensity
  const MOTION_SPRING        = 0.28; // how quickly agents ease toward their target displacement

  let motionAgents = [];

  function initMotionAgents(videoBounds) {
    motionAgents = [];
    const ar   = videoBounds.width / Math.max(1, videoBounds.height);
    const cols = Math.max(1, Math.round(Math.sqrt(MOTION_AGENT_COUNT * ar)));
    const rows = Math.max(1, Math.round(MOTION_AGENT_COUNT / cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        motionAgents.push({
          fx: cols > 1 ? c / (cols - 1) : 0.5,
          fy: rows > 1 ? r / (rows - 1) : 0.5,
          angle: Math.random() * Math.PI * 2,
          spinSpeed: 0.015 + Math.random() * 0.03,
          dx: 0, dy: 0,
        });
      }
    }
  }

  function drawMotionParticles({ ctx, videoReady, videoBounds, drawHandlesForObj, videoObj }) {
    if (!videoReady) return;
    if (motionAgents.length === 0) initMotionAgents(videoBounds);

    const { x: vx, y: vy, width: vw, height: vh } = videoBounds;
    ctx.fillStyle = '#000';
    ctx.fillRect(vx, vy, vw, vh);

    const halfLen = 4;
    ctx.beginPath();
    for (const a of motionAgents) {
      const bx = vx + a.fx * vw;
      const by = vy + a.fy * vh;

      const m  = getMotionAt(bx, by, videoBounds);
      const mR = getMotionAt(bx + MOTION_SAMPLE_STEP, by, videoBounds);
      const mL = getMotionAt(bx - MOTION_SAMPLE_STEP, by, videoBounds);
      const mD = getMotionAt(bx, by + MOTION_SAMPLE_STEP, videoBounds);
      const mU = getMotionAt(bx, by - MOTION_SAMPLE_STEP, videoBounds);
      const gx = mR - mL, gy = mD - mU;

      let targetDx = 0, targetDy = 0;
      if (m > 0.02) {
        const glen = Math.hypot(gx, gy);
        if (glen > 0.0001) {
          // Push away from the direction the motion signal increases in.
          targetDx = -(gx / glen) * m * MOTION_PUSH_STRENGTH;
          targetDy = -(gy / glen) * m * MOTION_PUSH_STRENGTH;
        }
      }
      a.dx += (targetDx - a.dx) * MOTION_SPRING;
      a.dy += (targetDy - a.dy) * MOTION_SPRING;

      a.angle += a.spinSpeed;

      const px = bx + a.dx, py = by + a.dy;
      const lx = Math.cos(a.angle) * halfLen, ly = Math.sin(a.angle) * halfLen;
      ctx.moveTo(px - lx, py - ly);
      ctx.lineTo(px + lx, py + ly);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    drawHandlesForObj(videoObj);
  }

  // Called from deactivateAllEffects() so re-activating starts with a clean
  // baseline instead of diffing against a stale frame from a previous session.
  // Also tells the worker to drop its prevMotionLuma baseline.
  function reset() {
    motionAgents = [];
    worker.postMessage({ type: 'resetMotion' });
  }

  return { requestMotionMap, drawMotionParticles, reset };
}
