// ── Pixelation Effect (WebGL2) ──────────────────────────────────────────────────
// Entire per-frame pipeline runs on the GPU: the video frame is uploaded directly
// as a texture (gl.texImage2D(video) — a fast driver-side copy, NOT a CPU
// readback), and every step (greyscale, focus glow, brightness/shadow, 3-zone
// color-wheel tint, pixelation downsample) runs as a single GLSL fragment
// shader. There is no getImageData/putImageData anywhere in the hot path —
// the only CPU↔GPU boundary left is the final `ctx.drawImage(glCanvas, ...)`
// composite onto the main 2D canvas, which is a GPU-side blit, not a pixel
// readback.
//
// Focus Map is a simple per-pixel glow: each pixel's own brightness decides
// whether it gets pushed darker or brighter — dark pixels (below mid-grey)
// get pushed further down, bright pixels get pushed further up, the strength
// of that push controlled by the Focus slider. No edge detection, no
// per-frame analysis of neighbouring pixels — kept deliberately simple.
//
// createPixelationEffect() returns a fresh instance with its own WebGL context,
// so each project page gets an independent copy. Falls back to drawing the
// plain video frame if WebGL2 isn't available.

export function createPixelationEffect(SAMPLE_W, SAMPLE_H) {
  const glCanvas = document.createElement('canvas');
  glCanvas.width  = SAMPLE_W;
  glCanvas.height = SAMPLE_H;
  const gl = glCanvas.getContext('webgl2');

  const gpu = gl ? setupGPU(gl) : null;
  if (!gl) console.warn('Pixelation: WebGL2 not available, effect will show the plain video.');

  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  // ── Color wheel picker widget — small, rarely-updated UI canvas, left as
  // plain Canvas 2D since it's not part of the per-frame render path.
  function drawColorWheel(canvas, state) {
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

  // Renders the pixelation effect onto any target context/rect — used both for
  // the live preview (targetCtx = main canvas ctx, rect = videoBounds) and for
  // full-resolution export (targetCtx = exportCtx, rect = {x:0,y:0,w:ew,h:eh}).
  function renderPixelation({ targetCtx, video, cwState, pixelParams, x, y, w, h }) {
    const { pixels, brightness, shadow, focus, scanLines } = pixelParams;

    // Pixel Count at 0% → show the untouched original frame, bypassing
    // greyscale/focus/color-wheel/scan-line processing entirely.
    if (pixels <= 0 || !gpu) {
      targetCtx.drawImage(video, x, y, w, h);
      return;
    }
    if (video.readyState < 2) return;

    // Block size controls output resolution: more pixels = coarser = fewer samples
    const blockSz = Math.max(1, Math.round(pixels * 0.8));
    const pW = Math.max(1, Math.min(SAMPLE_W, Math.round(w / blockSz)));
    const pH = Math.max(1, Math.min(SAMPLE_H, Math.round(h / blockSz)));

    if (glCanvas.width !== pW || glCanvas.height !== pH) {
      glCanvas.width  = pW;
      glCanvas.height = pH;
    }

    const cwH = cwState.highlights, cwM = cwState.midtones, cwS = cwState.shadows;
    const hOn = cwH.active && cwH.str > 0, mOn = cwM.active && cwM.str > 0, sOn = cwS.active && cwS.str > 0;
    const hRgb = hOn ? hslToRgb(cwH.h, cwH.s, 0.5) : [0,0,0];
    const mRgb = mOn ? hslToRgb(cwM.h, cwM.s, 0.5) : [0,0,0];
    const sRgb = sOn ? hslToRgb(cwS.h, cwS.s, 0.5) : [0,0,0];

    gpu.render({
      video, pW, pH,
      focus: focus / 100,
      brightness: brightness / 100,
      shadow: shadow / 100,
      highlightOn: hOn, highlightStr: cwH.str / 100, highlightTint: hRgb,
      midtoneOn: mOn,   midtoneStr:   cwM.str / 100, midtoneTint:   mRgb,
      shadowOn: sOn,     shadowStr:    cwS.str / 100, shadowTint:    sRgb,
    });

    // GPU-side blit (not a pixel readback) — same nearest-neighbor upscale
    // trick as before for the blocky look at higher pixel counts.
    targetCtx.imageSmoothingEnabled = pixels < 10;
    targetCtx.drawImage(glCanvas, x, y, w, h);
    targetCtx.imageSmoothingEnabled = true;

    // Scan lines — fixed 1px-thin horizontal lines, only their darkness scales.
    // Cheap enough (≤ ~30 thin fillRects) that it isn't worth a shader pass.
    const scanAlpha = (scanLines / 100) * 0.85;
    if (scanAlpha > 0.01) {
      targetCtx.save();
      targetCtx.beginPath();
      targetCtx.rect(x, y, w, h);
      targetCtx.clip();
      targetCtx.fillStyle = `rgba(0,0,0,${scanAlpha})`;
      for (let yy = y; yy < y + h; yy += 3) {
        targetCtx.fillRect(x, yy, w, 1);
      }
      targetCtx.restore();
    }
  }

  return { hslToRgb, drawColorWheel, renderPixelation };
}

// ── GPU pipeline setup ───────────────────────────────────────────────────────
// A single pass, sampling a fullscreen triangle-strip (no vertex buffer
// needed — the vertex shader builds positions from gl_VertexID): greyscale +
// focus glow + brightness/shadow + color-wheel tint, all in one shader.
function setupGPU(gl) {
  const VERTEX_SRC = `#version 300 es
    const vec2 verts[4] = vec2[4](vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(1.,1.));
    out vec2 vUv;
    void main() {
      vec2 p = verts[gl_VertexID];
      vUv = p * 0.5 + 0.5;
      gl_Position = vec4(p, 0.0, 1.0);
    }
  `;

  const COMPOSITE_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVideo;
    uniform float uFocus, uBrightness, uShadow;
    uniform vec2 uTexelSize;
    uniform bool uHighlightOn, uMidtoneOn, uShadowOn;
    uniform float uHighlightStr, uMidtoneStr, uShadowStr;
    uniform vec3 uHighlightTint, uMidtoneTint, uShadowTint;
    out vec4 outColor;
    void main() {
      vec3 c = texture(uVideo, vUv).rgb;
      float lumaF = dot(c, vec3(0.299, 0.587, 0.114));

      // Focus Map: sanfte S-Kurve (smoothstep) erhält Graustufen im Mittelbereich.
      float pushed = clamp(mix(lumaF, smoothstep(0.1, 0.9, lumaF), uFocus), 0.0, 1.0);

      // Bloom-Glow: nur wirklich helle Pixel strahlen aus (quadratisch gewichtet).
      float glow = 0.0, gw = 0.0;
      for (int dx = -4; dx <= 4; dx++) {
        for (int dy = -4; dy <= 4; dy++) {
          float w   = exp(-float(dx*dx + dy*dy) * 0.04);
          vec3 s    = texture(uVideo, clamp(vUv + vec2(float(dx), float(dy)) * uTexelSize * 5.0, vec2(0.0), vec2(1.0))).rgb;
          float lum = dot(s, vec3(0.299, 0.587, 0.114));
          float b   = max(0.0, lum - 0.45);
          glow += b * b * w;
          gw   += w;
        }
      }
      glow = clamp((glow / gw) * 6.0 * uFocus, 0.0, 0.75);
      float pushedF = clamp(pushed + glow, 0.0, 1.0);

      float v = pushedF * 255.0;
      v = clamp(v + uBrightness * 128.0 - uShadow * 128.0, 0.0, 255.0);

      float rv = v, gv = v, bv = v;
      float lumaF2 = v / 255.0;
      if (uHighlightOn) {
        float wgt = lumaF2 * lumaF2;
        rv += wgt * uHighlightStr * (uHighlightTint.r - 128.0);
        gv += wgt * uHighlightStr * (uHighlightTint.g - 128.0);
        bv += wgt * uHighlightStr * (uHighlightTint.b - 128.0);
      }
      if (uMidtoneOn) {
        float wgt = 4.0 * lumaF2 * (1.0 - lumaF2);
        rv += wgt * uMidtoneStr * (uMidtoneTint.r - 128.0);
        gv += wgt * uMidtoneStr * (uMidtoneTint.g - 128.0);
        bv += wgt * uMidtoneStr * (uMidtoneTint.b - 128.0);
      }
      if (uShadowOn) {
        float wgt = (1.0 - lumaF2) * (1.0 - lumaF2);
        rv += wgt * uShadowStr * (uShadowTint.r - 128.0);
        gv += wgt * uShadowStr * (uShadowTint.g - 128.0);
        bv += wgt * uShadowStr * (uShadowTint.b - 128.0);
      }
      outColor = vec4(clamp(rv,0.0,255.0)/255.0, clamp(gv,0.0,255.0)/255.0, clamp(bv,0.0,255.0)/255.0, 1.0);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }

  function link(fragSrc) {
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error('Program link error: ' + log);
    }
    return prog;
  }

  function uniforms(prog, names) {
    const u = {};
    for (const n of names) u[n] = gl.getUniformLocation(prog, n);
    return u;
  }

  const compProg = link(COMPOSITE_FRAG);
  const compU    = uniforms(compProg, [
    'uVideo', 'uFocus', 'uBrightness', 'uShadow', 'uTexelSize',
    'uHighlightOn', 'uMidtoneOn', 'uShadowOn',
    'uHighlightStr', 'uMidtoneStr', 'uShadowStr',
    'uHighlightTint', 'uMidtoneTint', 'uShadowTint',
  ]);

  // NEAREST = point sampling, giving the crisp blocky pixelation look when
  // upscaled rather than a blurred/averaged one.
  const videoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const vao = gl.createVertexArray(); // empty VAO — vertex shader uses gl_VertexID only

  function uploadVideoFrame(video) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  function render({
    video, pW, pH, focus, brightness, shadow,
    highlightOn, highlightStr, highlightTint,
    midtoneOn, midtoneStr, midtoneTint,
    shadowOn, shadowStr, shadowTint,
  }) {
    uploadVideoFrame(video);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pW, pH);
    gl.useProgram(compProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(compU.uVideo, 0);
    gl.uniform1f(compU.uFocus, focus);
    gl.uniform2f(compU.uTexelSize, 1.0 / pW, 1.0 / pH);
    gl.uniform1f(compU.uBrightness, brightness);
    gl.uniform1f(compU.uShadow, shadow);
    gl.uniform1i(compU.uHighlightOn, highlightOn ? 1 : 0);
    gl.uniform1i(compU.uMidtoneOn, midtoneOn ? 1 : 0);
    gl.uniform1i(compU.uShadowOn, shadowOn ? 1 : 0);
    gl.uniform1f(compU.uHighlightStr, highlightStr);
    gl.uniform1f(compU.uMidtoneStr, midtoneStr);
    gl.uniform1f(compU.uShadowStr, shadowStr);
    gl.uniform3f(compU.uHighlightTint, ...highlightTint);
    gl.uniform3f(compU.uMidtoneTint, ...midtoneTint);
    gl.uniform3f(compU.uShadowTint, ...shadowTint);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return { render };
}
