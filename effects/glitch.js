// ── Glitch Effect ───────────────────────────────────────────────────────────────
// RGB channel split, randomized horizontal slice shifting, and scan lines.
// Stateless — renders directly from the live <video> element each call, so no
// factory/instance is needed here (unlike Pixelation/Motion, which keep
// per-page scratch buffers).

// Renders the glitch effect onto any target context/rect — used both for the
// live preview (targetCtx = main canvas ctx, rect = videoBounds) and for
// full-resolution export (targetCtx = exportCtx, rect = {x:0,y:0,w:ew,h:eh}).
// Unifying these removes what used to be two near-identical copies of this
// same block (one in the live draw call, one inside exportWithEffect).
export function renderGlitch({ targetCtx, video, glitchParams, x, y, w, h }) {
  const { intensity, slices, offset, scan } = glitchParams;

  const maxOffset  = w * (offset / 100) * 0.5;
  const scanAlpha  = scan / 100 * 0.6;
  const sliceCount = Math.max(1, slices);
  const sliceH     = h / sliceCount;

  targetCtx.drawImage(video, x, y, w, h);

  // ── Horizontal Slice Shift ─────────────────────────────────────────────────
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(x, y, w, h);
  targetCtx.clip();
  for (let i = 0; i < sliceCount; i++) {
    if (Math.random() * 100 < intensity) {
      const sy   = y + i * sliceH;
      const xOff = (Math.random() - 0.5) * 2 * maxOffset;
      targetCtx.drawImage(video,
        0, (i / sliceCount) * video.videoHeight, video.videoWidth, video.videoHeight / sliceCount,
        x + xOff, sy, w, sliceH
      );
    }
  }
  targetCtx.restore();

  // ── Scan Lines ────────────────────────────────────────────────────────────
  if (scanAlpha > 0.01) {
    targetCtx.save();
    targetCtx.fillStyle = `rgba(0,0,0,${scanAlpha})`;
    for (let yy = y; yy < y + h; yy += 3) {
      targetCtx.fillRect(x, yy, w, 1);
    }
    targetCtx.restore();
  }
}
