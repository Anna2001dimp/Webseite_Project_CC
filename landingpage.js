// ── Landing Page Drag-to-Reveal ───────────────────────────────────────────────
(function initLanding() {
  const page  = document.getElementById('landingPage');
  const cta   = document.getElementById('landing-cta');
  const title = document.getElementById('landing-title');

  // ── Seiten-Drag (vertikal) ──────────────────────────────────────────────────
  let startY = null, baseY = 0, currentDY = 0;

  function getCurrentY() {
    const m = (page.style.transform || '').match(/translateY\((-?[\d.]+)px\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  // ── Buchstaben-Stauchung bei Mausnähe (kleiner Radius, pro Buchstabe) ──────
  if (cta) {
    const ctaLetters = Array.from(cta.querySelectorAll('span'));
    const CTA_RADIUS = 20; // px
    window.addEventListener('mousemove', (e) => {
      for (const el of ctaLetters) {
        const r  = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d  = Math.hypot(e.clientX - cx, e.clientY - cy);
        const s  = d < CTA_RADIUS ? 1 - 0.7 * (1 - d / CTA_RADIUS) : 1;
        el.style.transform = `scale(${s})`;
      }
    });
  }

  const landingDesc = document.getElementById('landing-desc');
  const landingPage = document.getElementById('landingPage');
  if (landingDesc && landingPage) {
    landingPage.addEventListener('mousemove', (e) => {
      const W = window.innerWidth, H = window.innerHeight;
      const hitW = W * 0.28, hitH = H * 0.38;
      const inCC = Math.abs(e.clientX - W / 2) < hitW && Math.abs(e.clientY - H / 2) < hitH;
      landingDesc.style.opacity = inCC ? '1' : '0';
    });
    landingPage.addEventListener('mouseleave', () => { landingDesc.style.opacity = '0'; });
  }

  function addLetterShrink(el, radius = 20) {
    if (!el) return;
    const letters = Array.from(el.querySelectorAll('span'));
    window.addEventListener('mousemove', (e) => {
      for (const letter of letters) {
        const r  = letter.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d  = Math.hypot(e.clientX - cx, e.clientY - cy);
        const s  = d < radius ? 1 - 0.7 * (1 - d / radius) : 1;
        letter.style.transform = `scale(${s})`;
      }
    });
  }

  addLetterShrink(document.getElementById('logo'));
  addLetterShrink(document.getElementById('btn-create'));

  function onDown(clientY) {
    startY = clientY;
    baseY  = getCurrentY();
    currentDY = baseY;
    page.style.transition = 'none';
    page.classList.add('dragging');
  }

  function onMove(clientY) {
    if (startY === null) return;
    const dy = Math.max(-window.innerHeight, Math.min(0, baseY + (clientY - startY)));
    currentDY = dy;
    page.style.transform = `translateY(${dy}px)`;
  }

  function revealStartScreen() {
    page.style.transition = 'opacity 0.8s ease';
    page.style.opacity    = '0';
    page.addEventListener('transitionend', () => {
      page.style.display = 'none';
    }, { once: true });

    const startScreen = document.getElementById('startScreen');
    if (startScreen) startScreen.style.transform = 'scale(1)';
  }

  function showLandingPage() {
    const startScreen = document.getElementById('startScreen');
    if (startScreen) startScreen.style.transform = 'scale(1.04)';

    page.style.display    = 'block';
    page.style.transform  = 'translateY(0)';
    page.style.transition = 'none';
    page.style.opacity    = '0';
    requestAnimationFrame(() => {
      page.style.transition = 'opacity 0.8s ease';
      page.style.opacity    = '1';
    });
  }

  const logo = document.getElementById('logo');
  if (logo) {
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', showLandingPage);
  }

  function finishDrag() {
    if (currentDY < -window.innerHeight * 0.5) {
      revealStartScreen();
      currentDY = 0;
    } else {
      page.style.transition = 'transform 0.4s cubic-bezier(0.16,1,0.3,1)';
      page.style.transform  = 'translateY(0)';
      currentDY = 0;
    }
  }

  function onUp() {
    if (startY === null) return;
    page.classList.remove('dragging');
    startY = null;
    finishDrag();
  }

  if (cta) {
    cta.addEventListener('mousedown', (e) => e.stopPropagation());
    cta.addEventListener('click',     (e) => { e.stopPropagation(); revealStartScreen(); });
  }

  page.addEventListener('mousedown',    (e) => onDown(e.clientY));
  window.addEventListener('mousemove',  (e) => onMove(e.clientY));
  window.addEventListener('mouseup',    ()  => onUp());
  page.addEventListener('touchstart',   (e) => onDown(e.touches[0].clientY),    { passive: true });
  window.addEventListener('touchmove',  (e) => onMove(e.touches[0].clientY),    { passive: true });
  window.addEventListener('touchend',   ()  => onUp());

  let wheelSnapTimer = null;
  page.addEventListener('wheel', (e) => {
    // Nach oben wischen: deltaY negativ
    currentDY = Math.max(-window.innerHeight, Math.min(0, currentDY - e.deltaY));
    page.style.transition = 'none';
    page.style.transform  = `translateY(${currentDY}px)`;

    clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => {
      if (currentDY < -window.innerHeight * 0.3) {
        // Weit genug → Start Screen einblenden
        revealStartScreen();
        currentDY = 0;
      } else {
        // Zurücksnappen
        page.style.transition = 'transform 0.4s cubic-bezier(0.16,1,0.3,1)';
        page.style.transform  = 'translateY(0)';
        currentDY = 0;
      }
    }, 120);
  }, { passive: true });

  // ── Buchstaben — nur wenn #landing-title im DOM vorhanden ─────────────────
  if (title) {
    const TEXT = title.textContent.trim();
    title.innerHTML = '';

    // 1. Gesamtbreite bei Referenzgröße messen → font-size berechnen
    const REF = 200;
    const tmp = document.createElement('span');
    tmp.style.cssText = `position:absolute;visibility:hidden;top:-9999px;font-size:${REF}px;font-weight:900;font-family:sans-serif;text-transform:uppercase;white-space:nowrap;letter-spacing:0`;
    tmp.textContent = TEXT.toUpperCase();
    document.body.appendChild(tmp);
    const totalW = tmp.getBoundingClientRect().width;
    document.body.removeChild(tmp);
    const fs = REF * (window.innerWidth / totalW);

    // 2. Echte visuelle Höhe der Buchstaben via Canvas messen
    const offCtx = document.createElement('canvas').getContext('2d');
    offCtx.font = `900 ${fs}px sans-serif`;
    const m = offCtx.measureText(TEXT.toUpperCase());
    const visualH   = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const negMargin = -(fs - visualH);

    // 3. Vorerst nur eine Zeile
    const rowCount = 1;

    for (let r = 0; r < rowCount; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'title-row';
      rowEl.style.lineHeight = fs + 'px';
      if (r > 0) rowEl.style.marginTop = negMargin + 'px';

      Array.from(TEXT).forEach((ch) => {
        const span = document.createElement('span');
        span.className = 'letter';
        span.textContent = ch;
        span.style.fontSize = fs + 'px';
        rowEl.appendChild(span);
      });
      title.appendChild(rowEl);
    }
  }

  // ── Hand-Gesture Drag ─────────────────────────────────────────────────────
  // _handPalmY wird von initGrid() pro Kamera-Frame gesetzt (normalisiert 0..1)
  let prevHandY = null;
  let wasHandClosed = false;

  (function handLoop() {
    requestAnimationFrame(handLoop);
    if (startY !== null) { prevHandY = null; wasHandClosed = false; return; } // Maus/Touch hat Vorrang
    if (window._handPalmY === null || window._handPalmY === undefined) {
      if (wasHandClosed) finishDrag();
      prevHandY = null;
      wasHandClosed = false;
      return;
    }

    // Offene Hand: Position mitverfolgen aber keine Bewegung auslösen
    // → kein Sprung wenn Faust gemacht wird
    if (!window._handClosed) {
      if (wasHandClosed) finishDrag();
      wasHandClosed = false;
      prevHandY = window._handPalmY;
      return;
    }
    wasHandClosed = true;

    if (prevHandY === null) { prevHandY = window._handPalmY; return; } // erstes Frame nach Faust: kein Sprung

    const delta = (window._handPalmY - prevHandY) * window.innerHeight * 1.8;
    prevHandY = window._handPalmY;

    if (Math.abs(delta) < 0.4) return; // Jitter-Filter

    currentDY = Math.max(-window.innerHeight, Math.min(0, currentDY + delta));
    page.style.transition = 'none';
    page.style.transform  = `translateY(${currentDY}px)`;
  })();

})();

// ── Canvas Fabric-Textur + Face/Hand Tracking ─────────────────────────────────
(function initGrid() {
  const canvas = document.getElementById('landing-grid');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0;
  let hFibers = [], vFibers = [];
  let titleMap = null, titleMapW = 0, titleMapH = 0;
  let cCenters = [];
  const startTime = performance.now();

  const SPACING   = 3;
  const BASE_AMP  = 2.2;
  const BASE_FREQ = 0.032;

  // ── Influence Map ─────────────────────────────────────────────────────────
  // 1 Zelle = INF_SCALE × INF_SCALE px. Landmarks schreiben Gauß-Blobs rein.
  // Fasern lesen per Array-Lookup (O(1)) statt pro Landmark zu iterieren.
  const INF_SCALE = 6;
  let infW = 0, infH = 0, infMap = null;
  let repelVX = null, repelVY = null; // persistente Verschiebungs-Geschwindigkeit pro Zelle

  let mouseX = -9999, mouseY = -9999;
  let ccGlowAlpha = 0;
  let fingerTips = []; // alle Fingerkuppen-Positionen, je {x, y} in Canvas-Pixeln
  const REPEL_RADIUS   = 50;
  const REPEL_STRENGTH = 40;
  const REPEL_DECAY    = 0.94; // wie schnell die Verschiebung abklingt
  const REPEL_MAX      = 50;   // Kappung, damit Fasern nicht ins Unendliche wandern

  // Zufällig weg vom Finger gedrückt (statt exakt radial) → kein Ring am Radius-Rand,
  // und die Geschwindigkeit klingt langsam ab → Fasern bewegen sich nach dem Kick weiter.
  function updateRepelField() {
    for (let i = 0; i < repelVX.length; i++) {
      repelVX[i] *= REPEL_DECAY;
      repelVY[i] *= REPEL_DECAY;
    }
    const R = REPEL_RADIUS / INF_SCALE;
    for (const tip of fingerTips) {
      const cx = tip.x / INF_SCALE, cy = tip.y / INF_SCALE;
      const x0 = Math.max(0, cx - R | 0), x1 = Math.min(infW - 1, Math.ceil(cx + R));
      const y0 = Math.max(0, cy - R | 0), y1 = Math.min(infH - 1, Math.ceil(cy + R));
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const dist = Math.hypot(ix - cx, iy - cy);
          if (dist >= R) continue;
          const i = iy * infW + ix;
          const angle = Math.atan2(iy - cy, ix - cx) + (Math.random() - 0.5) * 1.4;
          const mag   = (1 - dist / R) * REPEL_STRENGTH * 0.15;
          repelVX[i] = Math.max(-REPEL_MAX, Math.min(REPEL_MAX, repelVX[i] + Math.cos(angle) * mag));
          repelVY[i] = Math.max(-REPEL_MAX, Math.min(REPEL_MAX, repelVY[i] + Math.sin(angle) * mag));
        }
      }
    }
  }

  function sampleRepel(x, y) {
    const ix = Math.max(0, Math.min(infW - 1, x / INF_SCALE | 0));
    const iy = Math.max(0, Math.min(infH - 1, y / INF_SCALE | 0));
    const i  = iy * infW + ix;
    return [repelVX[i], repelVY[i]];
  }

  const landingPage = document.getElementById('landingPage');
  (landingPage || window).addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
  });
  (landingPage || window).addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function buildInfluenceMap(pts) {
    infMap.fill(0);
    const R = 48 / INF_SCALE;   // ~8 Inf-Zellen = 48px Canvas-Radius pro Landmark
    for (const pt of pts) {
      const cx = pt.x * infW, cy = pt.y * infH;
      const x0 = Math.max(0, cx - R | 0),  x1 = Math.min(infW - 1, Math.ceil(cx + R));
      const y0 = Math.max(0, cy - R | 0),  y1 = Math.min(infH - 1, Math.ceil(cy + R));
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const d = Math.hypot(ix - cx, iy - cy) / R;
          if (d < 1) {
            const i = iy * infW + ix;
            infMap[i] = Math.min(1, infMap[i] + (1 - d) * (1 - d) * 0.6);
          }
        }
      }
    }
  }

  function sampleInf(x, y) {
    const ix = Math.max(0, Math.min(infW - 1, x / INF_SCALE | 0));
    const iy = Math.max(0, Math.min(infH - 1, y / INF_SCALE | 0));
    return infMap[iy * infW + ix];
  }

  function sampleTitle(x, y) {
    if (!titleMap) return 0;
    const ix = Math.max(0, Math.min(titleMapW - 1, x / INF_SCALE | 0));
    const iy = Math.max(0, Math.min(titleMapH - 1, y / INF_SCALE | 0));
    return titleMap[iy * titleMapW + ix];
  }

  // Großflächige Helligkeitsvariation
  function brightness(x, y) {
    const nx = x / W, ny = y / H;
    const verticalFalloff = 1 - ny * 0.65; // oben hell, unten dunkler → Licht/Schatten-Verlauf
    return Math.min(0.92,
      (0.28
      + 0.42 * Math.pow(Math.max(0, Math.sin(nx * Math.PI * 2.1 + 0.6) * Math.sin(ny * Math.PI * 1.8 + 0.4)), 1.2)
      + 0.22 * (0.5 + 0.5 * Math.sin(nx * Math.PI * 4.5 + ny * Math.PI * 3.2 + 1.3))
      ) * verticalFalloff
    );
  }

  // Faser-Parameter einmalig berechnen (pro Resize)
  function rebuild() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    infW  = Math.ceil(W / INF_SCALE);
    infH  = Math.ceil(H / INF_SCALE);
    infMap  = new Float32Array(infW * infH);
    repelVX = new Float32Array(infW * infH);
    repelVY = new Float32Array(infW * infH);

    hFibers = [];
    for (let baseY = 0; baseY < H; baseY += SPACING) {
      hFibers.push({
        base:  baseY,
        phase: Math.random() * Math.PI * 2,
        amp:   BASE_AMP  * (0.4 + Math.random() * 1.4),
        freq:  BASE_FREQ * (0.6 + Math.random() * 0.9),
        op:    brightness(W / 2, baseY)
      });
    }
    vFibers = [];
    for (let baseX = 0; baseX < W; baseX += SPACING) {
      vFibers.push({
        base:  baseX,
        phase: Math.random() * Math.PI * 2,
        amp:   BASE_AMP  * (0.4 + Math.random() * 1.4),
        freq:  BASE_FREQ * (0.6 + Math.random() * 0.9),
        op:    brightness(baseX, H / 2)
      });
    }

    // "Project CC" auf Offscreen-Canvas samplen → titleMap (binäre Lookup-Tabelle)
    const FS_T = Math.round(W / 4);
    const offC = document.createElement('canvas');
    offC.width = W; offC.height = H;
    const offG = offC.getContext('2d');
    offG.fillStyle = '#000';
    offG.fillRect(0, 0, W, H);
    offG.fillStyle    = '#fff';
    offG.font         = `900 ${FS_T}px 'Ribes', sans-serif`;
    offG.textAlign    = 'center';
    offG.textBaseline = 'middle';
    offG.letterSpacing = '18px';
    offG.fillText('CC', W / 2, H / 2);

    // Mittelpunkte der beiden C-Buchstaben berechnen
    const cW = offG.measureText('C').width;
    const gap = 18;
    cCenters = [
      { x: W / 2 - cW / 2 - gap / 2, y: H / 2 },
      { x: W / 2 + cW / 2 + gap / 2, y: H / 2 }
    ];

    const imgData = offG.getImageData(0, 0, W, H).data;

    titleMapW = Math.ceil(W / INF_SCALE);
    titleMapH = Math.ceil(H / INF_SCALE);
    const rawMap = new Uint8Array(titleMapW * titleMapH);
    for (let py = 0; py < H; py += INF_SCALE) {
      for (let px = 0; px < W; px += INF_SCALE) {
        if (imgData[(py * W + px) * 4] > 80) {
          rawMap[(py / INF_SCALE | 0) * titleMapW + (px / INF_SCALE | 0)] = 1;
        }
      }
    }
    // Dilation + Falloff → weiche Buchstabengrenzen (~30px Übergangszone)
    const BLUR_R = 5;
    titleMap = new Float32Array(titleMapW * titleMapH);
    for (let iy = 0; iy < titleMapH; iy++) {
      for (let ix = 0; ix < titleMapW; ix++) {
        if (rawMap[iy * titleMapW + ix]) { titleMap[iy * titleMapW + ix] = 1; continue; }
        let maxVal = 0;
        for (let dy = -BLUR_R; dy <= BLUR_R; dy++) {
          for (let dx = -BLUR_R; dx <= BLUR_R; dx++) {
            const nx = ix + dx, ny = iy + dy;
            if (nx < 0 || nx >= titleMapW || ny < 0 || ny >= titleMapH) continue;
            if (rawMap[ny * titleMapW + nx]) {
              const d = Math.hypot(dx, dy) / BLUR_R;
              if (d < 1) maxVal = Math.max(maxVal, 1 - d);
            }
          }
        }
        titleMap[iy * titleMapW + ix] = maxVal;
      }
    }
  }

  // Animations-Loop — Zwei-Pass: Basis-Fasern + 3D-Bas-Relief (Highlight + Schatten)
  function draw() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    updateRepelField();

    // ── Pass 1: Fasern — statisch außerhalb, Sinuswelle innerhalb von „Project CC" ──
    const tTime = (performance.now() - startTime) * 0.0011;
    const tAmp  = 11 * (1 + 0.28 * Math.sin(tTime * 0.22));
    const ECHO_STEPS = 3;
    const ECHO_DT    = 0.06;
    ctx.lineWidth = 0.35;

    for (const f of hFibers) {
      const pulse = 0.75 + 0.25 * Math.sin(f.base * 0.018 + tTime * 1.4);
      for (let e = ECHO_STEPS - 1; e >= 0; e--) {
        const t  = tTime - e * ECHO_DT;
        const baseOp = Math.min(1, f.op * 1.04 * pulse) * (1 - e / ECHO_STEPS);
        let open = false, prevX = 0, prevY = 0;
        for (let x = 0; x <= W; x += 2) {
          const inT = sampleTitle(x, f.base);
          if (inT <= 0) { open = false; continue; }
          const y = f.base + f.amp * Math.sin(x * f.freq + f.phase)
                  + (Math.cos(x * 0.006 + f.base * 0.013 + t * 0.82) * tAmp
                   + Math.cos(f.base * 0.005 + t * 1.2) * tAmp * 0.35) * inT;
          const [pdx, pdy] = sampleRepel(x, y);
          const rx = x + pdx, ry = y + pdy;
          if (open) {
            ctx.strokeStyle = `rgba(255,255,255,${(baseOp * inT).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(rx, ry);
            ctx.stroke();
          }
          prevX = rx; prevY = ry; open = true;
        }
      }
    }

    for (const f of vFibers) {
      const pulse = 0.75 + 0.25 * Math.sin(f.base * 0.018 + tTime * 1.4);
      for (let e = ECHO_STEPS - 1; e >= 0; e--) {
        const t  = tTime - e * ECHO_DT;
        const baseOp = Math.min(1, f.op * 2.86 * pulse) * (1 - e / ECHO_STEPS);
        let open = false, prevX = 0, prevY = 0;
        for (let y = 0; y <= H; y += 2) {
          const inT = sampleTitle(f.base, y);
          if (inT <= 0) { open = false; continue; }
          const x = f.base + f.amp * Math.sin(y * f.freq + f.phase)
                  + (Math.cos(y * 0.006 + f.base * 0.013 + t * 0.82) * tAmp
                   + Math.cos(f.base * 0.005 + t * 1.2) * tAmp * 0.35) * inT;
          const [pdx, pdy] = sampleRepel(x, y);
          const rx = x + pdx, ry = y + pdy;
          if (open) {
            ctx.strokeStyle = `rgba(255,255,255,${(baseOp * inT).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(rx, ry);
            ctx.stroke();
          }
          prevX = rx; prevY = ry; open = true;
        }
      }
    }

    // ── Pass 2: 3D-Wölbung — Highlight oben + Schatten unten (nur Influence > 0) ──
    if (infMap) {
      ctx.lineWidth = 0.5;

      // Horizontale Fasern: Y verschieben
      for (const f of hFibers) {
        // Schnell-Check: hat diese Faser überhaupt Influence?
        let anyInf = false;
        for (let sx = 0; sx <= W; sx += W / 9) {
          if (sampleInf(sx, f.base) > 0.05) { anyInf = true; break; }
        }
        if (!anyInf) continue;

        // Highlight oben (helle Linie, nach oben verschoben)
        let open = false, lastInf = 0;
        ctx.lineWidth = 1.2;
        for (let x = 0; x <= W; x += 2) {
          const inf = sampleInf(x, f.base);
          if (inf <= 0.05) {
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          const y    = f.base + f.amp * Math.sin(x * f.freq + f.phase);
          const lift = inf * 5;
          if (!open || Math.abs(inf - lastInf) > 0.06) {
            if (open) ctx.stroke();
            ctx.strokeStyle = `rgba(215,215,215,${Math.min(1, inf * 1.4).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x, y - lift);
            open = true; lastInf = inf;
          } else {
            ctx.lineTo(x, y - lift);
          }
        }
        if (open) ctx.stroke();

        // Schatten unten (dunklere Linie, nach unten verschoben) — auf weiße Fasern
        open = false; lastInf = 0;
        ctx.lineWidth = 1.5;
        for (let x = 0; x <= W; x += 2) {
          const inf = sampleInf(x, f.base);
          if (inf <= 0.05) {
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          const y    = f.base + f.amp * Math.sin(x * f.freq + f.phase);
          const drop = inf * 3;
          if (!open || Math.abs(inf - lastInf) > 0.06) {
            if (open) ctx.stroke();
            // Dunkelgrau statt schwarz → sichtbar über weißen Fasern
            ctx.strokeStyle = `rgba(80,80,80,${Math.min(1, inf * 1.2).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x, y + drop);
            open = true; lastInf = inf;
          } else {
            ctx.lineTo(x, y + drop);
          }
        }
        if (open) ctx.stroke();

        // Verstärkter Kern — beeinflusste Basis-Linie heller + dicker
        open = false; lastInf = 0;
        for (let x = 0; x <= W; x += 2) {
          const inf = sampleInf(x, f.base);
          if (inf <= 0.05) {
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          const y = f.base + f.amp * Math.sin(x * f.freq + f.phase);
          if (!open || Math.abs(inf - lastInf) > 0.06) {
            if (open) ctx.stroke();
            ctx.lineWidth   = 0.65 + inf * 2.5;
            ctx.strokeStyle = `rgba(215,215,215,${Math.min(1, f.op + inf * 0.6).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x, y);
            open = true; lastInf = inf;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (open) ctx.stroke();
      }

      // Vertikale Fasern: X verschieben
      for (const f of vFibers) {
        let anyInf = false;
        for (let sy = 0; sy <= H; sy += H / 9) {
          if (sampleInf(f.base, sy) > 0.05) { anyInf = true; break; }
        }
        if (!anyInf) continue;

        // Highlight links
        let open = false, lastInf = 0;
        ctx.lineWidth = 1.2;
        for (let y = 0; y <= H; y += 2) {
          const inf = sampleInf(f.base, y);
          if (inf <= 0.05) {
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          const x    = f.base + f.amp * Math.sin(y * f.freq + f.phase);
          const lift = inf * 5;
          if (!open || Math.abs(inf - lastInf) > 0.06) {
            if (open) ctx.stroke();
            ctx.strokeStyle = `rgba(215,215,215,${Math.min(1, inf * 1.4).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x - lift, y);
            open = true; lastInf = inf;
          } else {
            ctx.lineTo(x - lift, y);
          }
        }
        if (open) ctx.stroke();

        // Schatten rechts
        open = false; lastInf = 0;
        ctx.lineWidth = 1.5;
        for (let y = 0; y <= H; y += 2) {
          const inf = sampleInf(f.base, y);
          if (inf <= 0.05) {
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          const x    = f.base + f.amp * Math.sin(y * f.freq + f.phase);
          const drop = inf * 3;
          if (!open || Math.abs(inf - lastInf) > 0.06) {
            if (open) ctx.stroke();
            ctx.strokeStyle = `rgba(80,80,80,${Math.min(1, inf * 1.2).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x + drop, y);
            open = true; lastInf = inf;
          } else {
            ctx.lineTo(x + drop, y);
          }
        }
        if (open) ctx.stroke();

        // Verstärkter Kern
        open = false; lastInf = 0;
        for (let y = 0; y <= H; y += 2) {
          const inf = sampleInf(f.base, y);
          if (inf <= 0.05) {
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          const x = f.base + f.amp * Math.sin(y * f.freq + f.phase);
          if (!open || Math.abs(inf - lastInf) > 0.06) {
            if (open) ctx.stroke();
            ctx.lineWidth   = 0.65 + inf * 2.5;
            ctx.strokeStyle = `rgba(215,215,215,${Math.min(1, f.op + inf * 0.6).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x, y);
            open = true; lastInf = inf;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (open) ctx.stroke();
      }
    }

    // ── C-Labels + Glow bei Cursor/Finger-Nähe ──────────────────────────────────
    if (cCenters.length === 2) {
      const ccR = W * 0.16;
      const pts = [...fingerTips];
      if (mouseX > -9999) pts.push({ x: mouseX, y: mouseY });
      let targetGlow = 0;
      for (const p of pts)
        for (const c of cCenters) {
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < ccR) targetGlow = Math.max(targetGlow, 1 - d / ccR);
        }
      ccGlowAlpha += (targetGlow - ccGlowAlpha) * 0.1;

      if (ccGlowAlpha > 0.01) {
        const glowR = 22;
        for (const c of cCenters) {
          const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowR);
          grad.addColorStop(0,   `rgba(255,255,255,${(0.95 * ccGlowAlpha).toFixed(3)})`);
          grad.addColorStop(0.5, `rgba(255,255,255,${(0.6  * ccGlowAlpha).toFixed(3)})`);
          grad.addColorStop(0.8, `rgba(255,255,255,${(0.2  * ccGlowAlpha).toFixed(3)})`);
          grad.addColorStop(1,   'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(c.x, c.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowColor = 'white';
        ctx.shadowBlur  = ccGlowAlpha * 25;
      }

      ctx.font         = `900 22px 'Ribes', sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'rgba(255,255,255,0.8)';
      ctx.fillText('C', cCenters[0].x, cCenters[0].y);
      ctx.fillText('C', cCenters[1].x, cCenters[1].y);
      ctx.shadowBlur = 0;
    }

    requestAnimationFrame(draw);
  }

  rebuild();
  window.addEventListener('resize', rebuild);
  draw();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(rebuild);
  }

  // ── MediaPipe: beide Hände (21 Joints je) ──────────────────────────────────
  async function startTracking() {
    const { HandLandmarker, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs'
    );

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );

    const handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    const vid = document.createElement('video');
    vid.autoplay = true; vid.playsInline = true; vid.muted = true;
    vid.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:0;left:0;';
    document.body.appendChild(vid);

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    vid.srcObject = stream;
    await new Promise(r => vid.addEventListener('loadeddata', r, { once: true }));

    let lastVidTime = -1;
    let lastPinchLeftAt = 0, lastPinchRightAt = 0;
    const PINCH_HOLD_MS = 80; // überbrückt nur sehr kurze Tracking-Lücken (Selbstverdeckung), schluckt aber keine schnell wiederholten Pinches mehr
    const PINCH_ENGAGE_PX  = 65; // muss näher zusammenkommen, um als "gepincht" zu zählen
    const PINCH_RELEASE_PX = 90; // muss weiter als das auseinander, um wieder "los" zu sein
    let pinchStateByHand = [];

    // Glättung (exponentieller gleitender Mittelwert) gegen das Zittern der
    // Rohdaten — wirkt direkt an der Quelle, statt es nur optisch zu verdecken.
    const SMOOTH_ALPHA = 0.35; // kleiner = glatter, aber träger
    const ema = (prev, raw) => prev == null ? raw : prev + SMOOTH_ALPHA * (raw - prev);
    let smIndexX = null, smIndexY = null, smThumbX = null, smThumbY = null;
    let smHandTips = [];

    (function tick() {
      requestAnimationFrame(tick);
      if (vid.currentTime === lastVidTime || vid.readyState < 2) return;
      lastVidTime = vid.currentTime;

      const now = performance.now();
      const pts = [];

      // Hände: alle 21 Joints je Hand (Knöchel, Glieder, Fingerkuppen)
      try {
        const hr = handLandmarker.detectForVideo(vid, now);

        if (hr.landmarks.length > 0) {
          const hand = hr.landmarks[0];
          window._handPalmY = hand[9].y; // MCP Mittelfinger = stabile Handflächen-Mitte

          // Faust-Erkennung: Fingerkuppe Y > MCP Y → Finger eingekrollt
          // Paare: [Kuppe, MCP] für Zeige-, Mittel-, Ring-, Kleinfinger
          const fistPairs = [[8,5],[12,9],[16,13],[20,17]];
          const curled = fistPairs.filter(([tip, mcp]) => hand[tip].y > hand[mcp].y).length;
          window._handClosed = curled >= 3; // mind. 3 von 4 Fingern eingekrollt = Faust

          fingerTips = [];
          const tipIdx = [4, 8, 12, 16, 20]; // Daumen, Zeige-, Mittel-, Ring-, Kleinfinger
          for (const h of hr.landmarks) {
            for (const ti of tipIdx) {
              fingerTips.push({ x: (1 - h[ti].x) * W, y: h[ti].y * H });
            }
          }

          // Zeigefinger- und Daumen-Kuppe der ersten Hand als primärer Zeiger —
          // für Hand-Interaktion (Logo/Create/Karussell-Scroll) auf anderen
          // Seiten nutzbar, in Viewport-Pixeln. Geglättet gegen Zittern.
          smIndexX = ema(smIndexX, (1 - hand[8].x) * W);
          smIndexY = ema(smIndexY, hand[8].y * H);
          smThumbX = ema(smThumbX, (1 - hand[4].x) * W);
          smThumbY = ema(smThumbY, hand[4].y * H);
          window._indexTipX = smIndexX;
          window._indexTipY = smIndexY;
          window._thumbTipX = smThumbX;
          window._thumbTipY = smThumbY;

          // Zeige- + Daumen-Kuppe JEDER erkannten Hand (bis zu 2) — für die
          // gleichzeitige Anzeige beider Hände auf dem Start Screen. Jede Hand
          // bekommt ihren eigenen Glättungs-Zustand (Index im Array).
          window._handTips = hr.landmarks.map((h, hi) => {
            const rawIX = (1 - h[8].x) * W, rawIY = h[8].y * H;
            const rawTX = (1 - h[4].x) * W, rawTY = h[4].y * H;
            const prev = smHandTips[hi];
            const next = {
              indexX: ema(prev?.indexX, rawIX), indexY: ema(prev?.indexY, rawIY),
              thumbX: ema(prev?.thumbX, rawTX), thumbY: ema(prev?.thumbY, rawTY),
            };
            smHandTips[hi] = next;
            return next;
          });
          smHandTips.length = hr.landmarks.length; // verwaiste Glättungs-Zustände verworfener Hände entfernen
        } else {
          window._handPalmY  = null;
          window._handClosed = false;
          fingerTips = [];
          window._indexTipX = null;
          window._indexTipY = null;
          window._thumbTipX = null;
          window._thumbTipY = null;
          window._handTips  = [];
          smIndexX = smIndexY = smThumbX = smThumbY = null;
          smHandTips = [];
        }

        // Pinch-Erkennung (Daumen + Zeigefinger berühren sich) pro Hand. Links/
        // rechts wird über die Bildschirmposition der Hand bestimmt (gespiegelte
        // x-Koordinate relativ zur Bildschirmmitte) statt über MediaPipes
        // Handedness-Label — robuster, da unabhängig von Spiegelung/Benennung.
        for (let hi = 0; hi < hr.landmarks.length; hi++) {
          const hand = hr.landmarks[hi];
          const dx = (hand[4].x - hand[8].x) * W;
          const dy = (hand[4].y - hand[8].y) * H;
          const dist = Math.hypot(dx, dy);
          // Hysterese: enger Schwellenwert zum Auslösen, weiterer zum Lösen —
          // verhindert sowohl zu leichtes Auslösen als auch Flackern an der Grenze.
          const wasPinching = pinchStateByHand[hi] || false;
          const pinching = wasPinching ? dist < PINCH_RELEASE_PX : dist < PINCH_ENGAGE_PX;
          pinchStateByHand[hi] = pinching;
          const mirroredX = (1 - hand[0].x) * W; // Handgelenk, gespiegelte Bildschirm-X
          if (pinching) {
            if (mirroredX > W / 2) lastPinchRightAt = now;
            else                   lastPinchLeftAt  = now;
          }
        }
        pinchStateByHand.length = hr.landmarks.length;
        // Pinch bleibt für PINCH_HOLD_MS "aktiv", auch wenn die Hand exakt im
        // Berührungsmoment (Selbstverdeckung der Finger) kurz nicht erkannt wird.
        window._pinchRight = (now - lastPinchRightAt) < PINCH_HOLD_MS;
        window._pinchLeft  = (now - lastPinchLeftAt)  < PINCH_HOLD_MS;

        for (const hand of hr.landmarks) {
          for (const lm of hand) {
            pts.push({ x: 1 - lm.x, y: lm.y });
          }
        }
      } catch (_) {
        window._handPalmY  = null;
        window._handClosed = false;
        window._pinchLeft  = false;
        window._pinchRight = false;
        window._handTips   = [];
      }

      if (pts.length) buildInfluenceMap(pts);
      else if (infMap) infMap.fill(0);  // nichts erkannt → alles zurücksetzen
    })();
  }

  startTracking().catch(err => console.warn('Tracking nicht verfügbar:', err));
})();
