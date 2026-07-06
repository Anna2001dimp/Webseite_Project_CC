export function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function drawColorWheel(canvas, state) {
  const c2 = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, R = cx - 1;
  const img = c2.createImageData(W, H);
  const d = img.data;
  const holeR = R * 0.28;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > R) continue;
      const i = (y * W + x) * 4;
      if (!state.active && dist < holeR) {
        d[i] = d[i+1] = d[i+2] = 0; d[i+3] = 255; continue;
      }
      const hue = ((Math.atan2(dy, dx) / (Math.PI * 2)) * 360 + 360) % 360;
      const sat = Math.min(dist / R, 1);
      const [r, g, b] = hslToRgb(hue, sat, 0.5);
      d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
  if (state.active) {
    const angle = state.h * Math.PI / 180;
    const dotX = cx + Math.cos(angle) * state.s * R;
    const dotY = cy + Math.sin(angle) * state.s * R;
    c2.beginPath(); c2.arc(dotX, dotY, 4, 0, Math.PI * 2);
    c2.strokeStyle = 'white'; c2.lineWidth = 1.5; c2.stroke();
  }
}

export function renderPixelSorting({ targetCtx, glitchParams, cwState, x, y, w, h }) {
  const { grayValue, sortH, sortV, luma: lumaSlider } = glitchParams;

  const PS_ROW_STEP   = 6;
  const PS_BRIGHTNESS = lumaSlider;
  const ascending     = lumaSlider >= 140;

  const imgData = targetCtx.getImageData(x, y, w, h);
  const d = imgData.data;
  const rowW = Math.round(w);
  const rowH = Math.round(h);

  if (grayValue > 0) {
    const contrastFactor = 1 + (grayValue / 100) * 4;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.min(255, Math.max(0, (gray - 128) * contrastFactor + 128));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }

  const luma = i => d[i];

  for (let row = 0; row < rowH; row += PS_ROW_STEP) {
    const base = row * rowW * 4;
    let col = 0;
    while (col < rowW) {
      if (luma(base + col * 4) > PS_BRIGHTNESS) {
        let endCol = col;
        while (endCol < rowW && luma(base + endCol * 4) > PS_BRIGHTNESS) endCol++;

        const run = [];
        for (let c = col; c < endCol; c++) {
          const j = base + c * 4;
          run.push([d[j], d[j + 1], d[j + 2], d[j + 3]]);
        }
        run.sort((a, b) => {
          const la = 0.299*a[0]+0.587*a[1]+0.114*a[2], lb = 0.299*b[0]+0.587*b[1]+0.114*b[2];
          return ascending ? la - lb : lb - la;
        });

        for (let c = col; c < endCol; c++) {
          const j = base + c * 4;
          const [r, g, b, a] = run[c - col];
          d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a;
        }
        col = endCol;
      } else {
        col++;
      }
    }
  }

  if (sortH > 0 || sortV > 0) {
    const src = new Uint8ClampedArray(d);
    const maxShiftH = (sortH / 100) * 40;
    const maxShiftV = (sortV / 100) * 40;
    for (let yy = 0; yy < rowH; yy++) {
      for (let xx = 0; xx < rowW; xx++) {
        const j = (yy * rowW + xx) * 4;
        const norm = (src[j] - 128) / 128;
        const sx = Math.min(rowW - 1, Math.max(0, Math.round(xx - norm * maxShiftH)));
        const sy = Math.min(rowH - 1, Math.max(0, Math.round(yy + norm * maxShiftV)));
        const sj = (sy * rowW + sx) * 4;
        d[j] = src[sj]; d[j + 1] = src[sj + 1]; d[j + 2] = src[sj + 2]; d[j + 3] = src[sj + 3];
      }
    }
  }

  if (cwState) {
    const cwH = cwState.highlights, cwM = cwState.midtones, cwS = cwState.shadows;
    const hOn = cwH.active && cwH.str > 0, mOn = cwM.active && cwM.str > 0, sOn = cwS.active && cwS.str > 0;
    if (hOn || mOn || sOn) {
      const hRgb = hOn ? hslToRgb(cwH.h, cwH.s, 0.5) : [0,0,0];
      const mRgb = mOn ? hslToRgb(cwM.h, cwM.s, 0.5) : [0,0,0];
      const sRgb = sOn ? hslToRgb(cwS.h, cwS.s, 0.5) : [0,0,0];
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) / 255;
        let r = d[i], g = d[i+1], b = d[i+2];
        if (hOn) { const wgt = l*l*cwH.str/100; r += wgt*(hRgb[0]-128); g += wgt*(hRgb[1]-128); b += wgt*(hRgb[2]-128); }
        if (mOn) { const wgt = 4*l*(1-l)*cwM.str/100; r += wgt*(mRgb[0]-128); g += wgt*(mRgb[1]-128); b += wgt*(mRgb[2]-128); }
        if (sOn) { const wgt = (1-l)*(1-l)*cwS.str/100; r += wgt*(sRgb[0]-128); g += wgt*(sRgb[1]-128); b += wgt*(sRgb[2]-128); }
        d[i] = Math.min(255, Math.max(0, r));
        d[i+1] = Math.min(255, Math.max(0, g));
        d[i+2] = Math.min(255, Math.max(0, b));
      }
    }
  }

  targetCtx.putImageData(imgData, x, y);
}
