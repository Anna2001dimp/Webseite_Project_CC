import { exportWithEffect } from './mp4box.js';
import { createPixelationEffect } from './effects/pixelation.js';
import { createMotionParticlesEffect } from './effects/motion-particles.js';
import { renderGlitch } from './effects/glitch.js';
import { renderPixelSorting } from './effects/pixelsorting.js';
import { initInteraction } from './interaction.js';

// Globaler Busy-Zähler — main.js prüft das, um den Inaktivitäts-Reload zu
// unterdrücken, während irgendeine Seite gerade hoch- oder runterlädt.
function markBusy() { window._busyCount = (window._busyCount || 0) + 1; }
function markIdle() { window._busyCount = Math.max(0, (window._busyCount || 0) - 1); }

export function initProjectPageInstance(root, startBtn, { goToProjectPage, goBackToStartScreen, saveCollectionList }) {
  const pageId = root.id || root.dataset.pageId || 'page-unknown';
  const canvas = root.querySelector('.pp-canvas');
  const ctx = canvas.getContext('2d');
  const video = root.querySelector('.pp-video');
  const fileInput = root.querySelector('.pp-file-input');
  const btnUpload   = root.querySelector('.pp-btn-upload');
  const btnDownload = root.querySelector('.pp-btn-download');

  btnUpload.addEventListener('click', () => fileInput.click());

  const btnDeletePage = root.querySelector('.pp-btn-delete-page');
  if (btnDeletePage) {
    btnDeletePage.addEventListener('click', () => {
      interactionCtrl.closeCamera();
      goBackToStartScreen(root);
      const carouselItem = root._carouselItem;
      if (carouselItem) carouselItem.remove();
      root.remove();
      saveCollectionList();
    });
  }

  const btnPlaypause = root.querySelector('.pp-btn-playpause');
  const btnMesh = root.querySelector('.pp-btn-mesh');
  const btnMeshFx = root.querySelector('.pp-btn-meshfx');
  const btnMotionFx = root.querySelector('.pp-btn-motionfx');
  const timelineContainer = root.querySelector('.pp-timeline-container');
  const timelineEl = root.querySelector('.pp-timeline');
  const filmstrip = root.querySelector('.pp-filmstrip');
  const filmCtx = filmstrip.getContext('2d');
  const trimLeftEl = root.querySelector('.pp-trim-left');
  const trimRightEl = root.querySelector('.pp-trim-right');
  const trimOverlayLeft = root.querySelector('.pp-trim-overlay-left');
  const trimOverlayRight = root.querySelector('.pp-trim-overlay-right');
  const trimResetBtn = root.querySelector('.pp-trim-reset');
  const playheadEl = root.querySelector('.pp-playhead');
  const loadingOverlay = root.querySelector('.pp-loading-overlay');

    root.querySelector('.pixelation-logo').addEventListener('click', () => {
      interactionCtrl.closeCamera();
      goBackToStartScreen(root);
    });

  const HANDLE_R    = 6;
  const MAX_FRAMES  = 60;
  const SAMPLE_W    = 160;
  const SAMPLE_H    = 90;

  // Offscreen analysis canvas
  const analyseCanvas = document.createElement('canvas');
  const analyseCtx = analyseCanvas.getContext('2d', { willReadFrequently: true });

  // ── Video object ──────────────────────────────────────────────────────────────
  // Single source of truth for where the video lives on the canvas.
  const videoObj = {
    x: 0, y: 0,
    width: 0, height: 0,
    scale: 1,
    aspectRatio: 1,
  };

  let videoReady      = false;
  let meshEnabled     = false;
  let meshFxEnabled   = false;
  let motionFxEnabled = false;
  let glitchEnabled   = false;
  const glitchParams  = { intensity: 40, slices: 12, offset: 30, luma: 140, scan: 20, grayValue: 50, sortH: 0, sortV: 0, pixelSortOn: false };
  let currentBlobUrl  = null;
  let currentFileName = 'video.mp4';
  let trimStart       = 0;
  let trimEnd         = 1;
  let extractingFrames = false;
  let drag            = null;
  let frameData       = null;
  let extraVideos     = [];   // additional uploaded videos [{videoEl, blobUrl, fileName, obj, ready}]
  let activeExtra     = null; // null=nothing selected, -1=primary, ≥0=index into extraVideos
  let hoverCanvasX    = null; // mouse x over primary video (for in-video trim line)
  let trimDrag        = null; // 'start' | 'end' while dragging a trim line
  let trimLinesSet    = 0;    // 0 = none, 1 = only start placed, 2 = both placed
  let dragHasMoved    = false;

  // ── Effects (each owns its own scratch buffers/state) ─────────────────────────
  // Pixelation now runs entirely on the GPU (WebGL2, see effects/pixelation.js)
  // — no worker needed for it any more. Motion & Particles still offloads its
  // Motion-Map math (frame diff + box blur) to a per-page Worker (worker.js)
  // since that effect's particle simulation stays on the CPU.
  const fxWorker   = new Worker(new URL('./worker.js', import.meta.url));
  const pixelation = createPixelationEffect(SAMPLE_W, SAMPLE_H);
  const motionFx   = createMotionParticlesEffect(SAMPLE_W, SAMPLE_H, fxWorker);
  const isExportingRef = { current: false };

  // ── Analysis ──────────────────────────────────────────────────────────────────
  // analyseCanvas is always SAMPLE_W × SAMPLE_H (160×90), independent of how
  // large the video appears on screen. The video frame is scaled into this fixed
  // resolution each frame, so pixel reads are cheap and consistent.
  //
  // Coordinate mapping:
  //   canvas position  →  mapToAnalyse()  →  pixel on analyseCanvas

  function initAnalyseCanvas() {
    analyseCanvas.width  = SAMPLE_W;
    analyseCanvas.height = SAMPLE_H;
  }

  function getVideoFrameData() {
    if (!videoReady || video.readyState < 2) return null;
    return analyseCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  }

  // ── videoBounds — single reference for all effects ────────────────────────────
  // Always reflects the current position and size of the visible video on canvas.
  const videoBounds = { x: 0, y: 0, width: 0, height: 0 };

  function syncVideoBounds() {
    videoBounds.x      = videoObj.x;
    videoBounds.y      = videoObj.y;
    videoBounds.width  = videoObj.width;
    videoBounds.height = videoObj.height;
  }

  // ── Video placement ───────────────────────────────────────────────────────────
  function initVideoRect() {
    videoObj.aspectRatio = video.videoWidth / video.videoHeight;
    videoObj.scale = Math.min(
      (canvas.width  * 0.4) / video.videoWidth,
      (canvas.height * 0.4) / video.videoHeight,
      1
    );
    videoObj.width  = video.videoWidth  * videoObj.scale;
    videoObj.height = video.videoHeight * videoObj.scale;
    videoObj.x = (canvas.width  - videoObj.width)  / 2;
    videoObj.y = (canvas.height - videoObj.height) / 2;
    syncVideoBounds();
  }

  const selectionOverlay = root.querySelector('.pp-video-selection');
  const selPlay          = root.querySelector('.pp-sel-play');
  const selDelete        = root.querySelector('.pp-sel-delete');
  const SEL_BAR_H        = 30;

  function showSelection(obj) {
    if (!selectionOverlay) return;
    selectionOverlay.style.left   = obj.x + 'px';
    selectionOverlay.style.top    = obj.y + 'px';
    selectionOverlay.style.width  = obj.width + 'px';
    selectionOverlay.style.height = (obj.height + SEL_BAR_H) + 'px';
    selectionOverlay.classList.add('visible');
  }

  function hideSelection() {
    if (selectionOverlay) selectionOverlay.classList.remove('visible');
  }

  // ── Export progress overlay ───────────────────────────────────────────────────
  const exportOverlay = root.querySelector('.pp-export-overlay');

  function showExportOverlay() {
    if (!exportOverlay) return;
    exportOverlay.style.left   = videoBounds.x + 'px';
    exportOverlay.style.top    = videoBounds.y + 'px';
    exportOverlay.style.width  = videoBounds.width + 'px';
    exportOverlay.style.height = videoBounds.height + 'px';
    exportOverlay.textContent  = 'Export... Frame 0 / 0 (0%)';
    exportOverlay.classList.add('visible');
  }

  function updateExportOverlay(frameIndex, frameCount) {
    if (!exportOverlay) return;
    const pct = frameCount > 0 ? Math.round((frameIndex / frameCount) * 100) : 0;
    exportOverlay.textContent = `Export... Frame ${frameIndex} / ${frameCount} (${pct}%)`;
  }

  function hideExportOverlay() {
    if (exportOverlay) exportOverlay.classList.remove('visible');
  }

  function updateTimelinePosition() {
    timelineContainer.style.left  = videoObj.x + 'px';
    timelineContainer.style.top   = (videoObj.y + videoObj.height) + 'px';
    timelineContainer.style.width = videoObj.width + 'px';
  }

  // ── Collection title sync ─────────────────────────────────────────────────────
  root.querySelector('.pp-collection-title-input').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    startBtn.textContent = val ;
    if (root._carouselLabel) root._carouselLabel.textContent = val ;
    if (root.dataset.pageId) saveCollectionList();
  });

  // ── Collection content counter ────────────────────────────────────────────────
  const COUNT_WORDS = [
    'zero','one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen',
    'eighteen','nineteen','twenty'
  ];
  let uploadCount = 0;

  function updateContentCount() {
    const el = root.querySelector('.pp-content-count');
    if (!el) return;
    el.textContent = uploadCount < COUNT_WORDS.length ? COUNT_WORDS[uploadCount] : uploadCount;
  }

  // ── Upload ────────────────────────────────────────────────────────────────────
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = '';          // allow re-picking the same file next time
    const blobUrl = URL.createObjectURL(file);
    uploadCount++;
    updateContentCount();

    if (!videoReady) {
      // First video → load as primary. Effect buttons & download stay disabled
      // until 'loadedmetadata' actually fires — enabling them immediately made
      // the UI look "ready" during the (sometimes several-second) container
      // parsing time, which read as the page being frozen/buggy.
      markBusy(); // bis 'loadedmetadata' unten markIdle() aufruft
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentFileName = file.name;
      currentBlobUrl  = blobUrl;
      videoReady = false;
      btnUpload.disabled = true;
      btnUpload.textContent = 'Loading…';
      video.src  = blobUrl;
    } else {
      // Subsequent uploads → add as extra video on canvas
      markBusy();
      createExtraVideo(blobUrl, file.name);
    }
  });

  function createExtraVideo(blobUrl, fileName) {
    const videoEl = document.createElement('video');
    videoEl.muted       = true;
    videoEl.playsInline = true;
    videoEl.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(videoEl);

    const item = {
      videoEl, blobUrl, fileName,
      obj: { x: 0, y: 0, width: 0, height: 0, scale: 1, aspectRatio: 1 },
      ready: false,
    };

    videoEl.addEventListener('loadedmetadata', () => {
      const ar    = videoEl.videoWidth / videoEl.videoHeight;
      const scale = Math.min(
        (canvas.width  * 0.4) / videoEl.videoWidth,
        (canvas.height * 0.4) / videoEl.videoHeight,
        1
      );
      item.obj.aspectRatio = ar;
      item.obj.width  = videoEl.videoWidth  * scale;
      item.obj.height = videoEl.videoHeight * scale;
      const offset    = extraVideos.indexOf(item) * 30;
      item.obj.x = (canvas.width  - item.obj.width)  / 2 + offset;
      item.obj.y = (canvas.height - item.obj.height) / 2 + offset;
      item.ready = true;
      markIdle();
    }, { once: true });

    extraVideos.push(item);
    videoEl.src = blobUrl;
  }

  video.addEventListener('loadedmetadata', async () => {
    markIdle();
    trimStart = 0;
    trimEnd   = 1;
    updateTrimUI();
    if (btnPlaypause) { btnPlaypause.disabled = false; btnPlaypause.style.display = ''; }
    timelineContainer.classList.add('visible');
    videoReady  = true;
    window._videoLoadedCount = (window._videoLoadedCount || 0) + 1;
    activeExtra = -1;   // auto-select primary after it loads
    btnUpload.disabled = false;
    btnUpload.textContent = 'Upload MP4';
    interactionCtrl.setVideoPresence(true);
    root.querySelector('.pp-btn-mesh').disabled      = false;
    root.querySelector('.pp-btn-meshfx').disabled    = false;
    root.querySelector('.pp-btn-motionfx').disabled  = false;
    root.querySelector('.pp-btn-glitch-fx').disabled = false;
    root.querySelector('.pp-effects-toggle').disabled = false;
    btnDownload.disabled = false;
    initAnalyseCanvas();
    initVideoRect();
    const videoSizeEl = root.querySelector('.pp-video-size');
    if (videoSizeEl) {
      const pctW = Math.round(videoBounds.width  / canvas.width  * 100);
      const pctH = Math.round(videoBounds.height / canvas.height * 100);
      videoSizeEl.textContent = `${pctW}% × ${pctH}%`;
    }
    showSelection(videoObj);
    updateTimelinePosition();
    trimStart = 0; trimEnd = 1; trimLinesSet = 0;
    video.currentTime = 0;
    updatePlaypauseBtn();
    // Filmstrip-Extraktion entfernt: Container ist per CSS dauerhaft unsichtbar
    // (In-Video-Trim ersetzt sie) und das Seeken dafür blockierte unnötig
    // die Sichtbarkeit des Videos und störte die Wiedergabe.
  });

  const glitchPanel     = root.querySelector('.pp-glitch-panel');
  const pixelPanel      = root.querySelector('.pp-pixel-panel');
  const cwPanel         = root.querySelector('.pp-cw-panel');
  const pixelParams     = { pixels: 2, brightness: 0, shadow: 0, focus: 0, scanLines: 0 };

  // ── Color Wheel State ─────────────────────────────────────────────────────────
  const cwState = {
    highlights: { h: 0, s: 0, active: false, str: 0 },
    midtones:   { h: 0, s: 0, active: false, str: 0 },
    shadows:    { h: 0, s: 0, active: false, str: 0 },
  };

  function initColorWheels() {
    root.querySelectorAll('.pp-cw-item').forEach(item => {
      const canvas = item.querySelector('.pp-cw-canvas');
      const zone   = canvas.dataset.zone;
      const state  = cwState[zone];
      const slider = item.querySelector('.pp-cw-strength');
      const valEl  = item.querySelector('.pp-glitch-val');

      const dpr = window.devicePixelRatio || 1;
      canvas.width  = 90 * dpr;
      canvas.height = 90 * dpr;
      canvas.style.width  = '90px';
      canvas.style.height = '90px';

      pixelation.drawColorWheel(canvas, state);

      slider.addEventListener('input', () => {
        state.str = +slider.value;
        valEl.textContent = slider.value + '%';
      });

      function pick(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const cx = canvas.width / 2, cy = canvas.height / 2, R = cx - 1;
        const dx = (e.clientX - rect.left) * scaleX - cx;
        const dy = (e.clientY - rect.top)  * scaleY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > R) return;
        state.active = true;
        state.h = ((Math.atan2(dy, dx) / (Math.PI * 2)) * 360 + 360) % 360;
        state.s = Math.min(dist / R, 1);
        pixelation.drawColorWheel(canvas, state);
      }

      canvas.addEventListener('dblclick', e => {
        const rect = canvas.getBoundingClientRect();
        const cx = canvas.width / 2, cy = canvas.height / 2, R = cx - 1;
        const dx = (e.clientX - rect.left) * (canvas.width / rect.width) - cx;
        const dy = (e.clientY - rect.top)  * (canvas.height / rect.height) - cy;
        if (Math.sqrt(dx * dx + dy * dy) > R) return;
        state.active = false;
        state.h = 0; state.s = 0;
        pixelation.drawColorWheel(canvas, state);
      });

      canvas.addEventListener('mousedown', e => {
        if (e.detail >= 2) return; // ignore mousedown part of dblclick
        pick(e);
        const onMove = e2 => pick(e2);
        const onUp   = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });
  }

  initColorWheels();

  const interactionCtrl = initInteraction(root, {
    glitchParams, pixelParams, cwState,
    getMeshEnabled:   () => meshEnabled,
    getGlitchEnabled: () => glitchEnabled,
    renderPixelation: pixelation.renderPixelation,
    renderGlitch,
    renderPixelSorting,
    deactivateAllEffects,
    markBusy,
    markIdle,
  });

  const glitchGroup    = root.querySelector('.pp-glitch-group');
  const glitchSub      = root.querySelector('.pp-glitch-sub');
  const glitchSubBtns  = glitchSub ? [...glitchSub.querySelectorAll('.pp-glitch-sub-btn')] : [];

  function deactivateAllEffects() {
    meshEnabled = false; meshFxEnabled = false; motionFxEnabled = false; glitchEnabled = false;
    motionFx.reset(); // force a clean baseline next time Motion & Particles is turned on
    btnMesh.classList.remove('active');
    if (btnMeshFx) btnMeshFx.classList.remove('active');
    if (btnMotionFx) btnMotionFx.classList.remove('active');
    glitchPanel.classList.remove('visible');
    pixelPanel.classList.remove('visible');
    if (cwPanel)   cwPanel.classList.remove('visible');
    if (glitchSub) glitchSub.classList.remove('open');
    root.querySelector('.pp-btn-glitch-fx').classList.remove('menu-open');
    glitchSubBtns.forEach(b => b.classList.remove('active'));
  }

  // ── Pixelation toggle ─────────────────────────────────────────────────────────
  btnMesh.addEventListener('click', () => {
    const wasOn = meshEnabled;
    deactivateAllEffects();
    meshEnabled = !wasOn;
    btnMesh.classList.toggle('active', meshEnabled);
    pixelPanel.classList.toggle('visible', meshEnabled);
    if (cwPanel) cwPanel.classList.toggle('visible', meshEnabled);
  });

  // ── Mesh toggle (new effect — UI skeleton only, no render logic yet) ──────────
  if (btnMeshFx) {
    btnMeshFx.addEventListener('click', () => {
      const wasOn = meshFxEnabled;
      deactivateAllEffects();
      meshFxEnabled = !wasOn;
      btnMeshFx.classList.toggle('active', meshFxEnabled);
    });
  }

  // ── Motion & Particles toggle ──────────────────────────────────────────────────
  if (btnMotionFx) {
    btnMotionFx.addEventListener('click', () => {
      const wasOn = motionFxEnabled;
      deactivateAllEffects();
      motionFxEnabled = !wasOn;
      btnMotionFx.classList.toggle('active', motionFxEnabled);
    });
  }

  // ── Glitch — opens submenu only, does not itself activate an effect ───────────
  const btnGlitchFx = root.querySelector('.pp-btn-glitch-fx');
  btnGlitchFx.addEventListener('click', () => {
    if (!glitchSub) return;
    const isOpen = glitchSub.classList.toggle('open');
    btnGlitchFx.classList.toggle('menu-open', isOpen);
  });

  // ── Glitch submenu items ───────────────────────────────────────────────────────
  if (glitchSub) {
    glitchSub.addEventListener('click', (e) => {
      const btn = e.target.closest('.pp-glitch-sub-btn');
      if (!btn) return;
      const wasActive = btn.classList.contains('active') && glitchEnabled;

      deactivateAllEffects();

      if (!wasActive) {
        glitchEnabled = true;
        glitchParams.pixelSortOn = true;
        btn.classList.add('active');
        glitchPanel.classList.add('visible');
        if (cwPanel) cwPanel.classList.add('visible');
        glitchSub.classList.add('open');
        btnGlitchFx.classList.add('menu-open');
      }
    });
  }

  // ── Glitch Slider ─────────────────────────────────────────────────────────────
  function bindSlider(cls, key, suffix) {
    const input = root.querySelector(cls);
    const valEl = input.parentElement.querySelector('.pp-glitch-val');
    input.addEventListener('input', () => {
      glitchParams[key] = +input.value;
      valEl.textContent = input.value + suffix;
    });
  }
  bindSlider('.pp-glitch-intensity', 'intensity', '%');
  bindSlider('.pp-glitch-slices',    'slices',    '');
  bindSlider('.pp-glitch-offset',    'offset',    '%');
  bindSlider('.pp-glitch-luma',      'luma',      '');
  bindSlider('.pp-glitch-scan',      'scan',      '%');
  bindSlider('.pp-glitch-grayvalue', 'grayValue', '%');
  bindSlider('.pp-glitch-sort-h',    'sortH',     '%');
  bindSlider('.pp-glitch-sort-v',    'sortV',     '%');

  // ── Pixel Slider ──────────────────────────────────────────────────────────────
  function bindPixelSlider(cls, key, suffix) {
    const input = root.querySelector(cls);
    if (!input) return;
    const valEl = input.parentElement.querySelector('.pp-glitch-val');
    input.addEventListener('input', () => {
      pixelParams[key] = +input.value;
      if (valEl) valEl.textContent = input.value + suffix;
    });
  }
  bindPixelSlider('.pp-pixel-count',      'pixels',     '%');
  bindPixelSlider('.pp-pixel-brightness', 'brightness', '%');
  bindPixelSlider('.pp-pixel-shadow',     'shadow',     '%');
  bindPixelSlider('.pp-pixel-focus',      'focus',      '%');
  bindPixelSlider('.pp-pixel-scan',       'scanLines',  '%');

  // ── Effects-Menü auf-/zuklappen ────────────────────────────────────────────
  const effectsToggle = root.querySelector('.pp-effects-toggle');
  const effectsSub    = root.querySelector('.pp-effects-sub');
  effectsToggle.addEventListener('click', () => {
    if (effectsToggle.disabled) return;
    effectsSub.classList.toggle('open');
  });

  // ── Download ──────────────────────────────────────────────────────────────────
  btnDownload.addEventListener('click', async () => {
    if (!currentBlobUrl) return;
    if (meshEnabled || glitchEnabled) {
      markBusy();
      showExportOverlay();
      try {
        await exportWithEffect({
          video, videoReady, currentFileName,
          isMeshEnabled:   () => meshEnabled,
          isGlitchEnabled: () => glitchEnabled,
          pixelParams, cwState, glitchParams,
          trimStart, trimEnd,
          btnDownload,
          renderPixelation: pixelation.renderPixelation,
          renderGlitch,
          renderPixelSorting,
          isExportingRef,
          onProgress: updateExportOverlay,
        });
      } finally {
        hideExportOverlay();
        markIdle();
      }
    } else {
      const a = document.createElement('a');
      a.href = currentBlobUrl;
      a.download = currentFileName;
      a.click();
    }
  });

  // ── Playback ──────────────────────────────────────────────────────────────────
  if (btnPlaypause) btnPlaypause.addEventListener('click', togglePlay);

  function togglePlay() {
    if (!videoReady) return;
    video.paused ? video.play() : video.pause();
  }

  video.addEventListener('play',  updatePlaypauseBtn);
  video.addEventListener('pause', updatePlaypauseBtn);

  function updatePlaypauseBtn() {
    if (btnPlaypause) btnPlaypause.textContent = video.paused ? '▶' : '⏸';
    if (selPlay) selPlay.textContent = video.paused ? '▶' : '⏸';
  }

  if (trimResetBtn) trimResetBtn.addEventListener('click', () => {
    trimStart = 0; trimEnd = 1; trimLinesSet = 0;
    updateTrimUI();
  });

  if (selPlay)   selPlay.addEventListener('click',   () => togglePlay());
  if (selDelete) selDelete.addEventListener('click', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', bubbles: true }));
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && videoReady) { e.preventDefault(); togglePlay(); }

    if ((e.code === 'Delete' || e.code === 'Backspace') && !(e.target instanceof HTMLInputElement)) {
      if (activeExtra !== null && activeExtra >= 0 && extraVideos[activeExtra]) {
        // Remove an extra video
        const item = extraVideos[activeExtra];
        item.videoEl.pause();
        item.videoEl.src = '';
        URL.revokeObjectURL(item.blobUrl);
        document.body.removeChild(item.videoEl);
        extraVideos.splice(activeExtra, 1);
        activeExtra = extraVideos.length > 0 ? Math.min(activeExtra, extraVideos.length - 1) : -1;
        uploadCount = Math.max(0, uploadCount - 1);
        updateContentCount();
      } else if (activeExtra === -1 && videoReady) {
        // Remove primary video
        video.pause();
        video.src = '';
        if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
        videoReady   = false;
        window._videoLoadedCount = Math.max(0, (window._videoLoadedCount || 0) - 1);
        meshEnabled  = false;
        meshFxEnabled = false;
        motionFxEnabled = false;
        glitchEnabled = false;
        btnMesh.classList.remove('active');
        if (btnMeshFx) btnMeshFx.classList.remove('active');
        if (btnMotionFx) btnMotionFx.classList.remove('active');
        glitchPanel.classList.remove('visible');
        if (cwPanel) cwPanel.classList.remove('visible');
        if (glitchSub) glitchSub.classList.remove('open');
        root.querySelector('.pp-btn-glitch-fx').classList.remove('menu-open');
        glitchSubBtns.forEach(b => b.classList.remove('active'));
        btnDownload.disabled = true;
        interactionCtrl.setVideoPresence(false);
        root.querySelector('.pp-btn-mesh').disabled      = true;
        root.querySelector('.pp-btn-meshfx').disabled    = true;
        root.querySelector('.pp-btn-motionfx').disabled  = true;
        root.querySelector('.pp-btn-glitch-fx').disabled = true;
        root.querySelector('.pp-effects-toggle').disabled = true;
        if (btnPlaypause) { btnPlaypause.disabled = true; btnPlaypause.style.display = 'none'; btnPlaypause.textContent = '▶'; }
            timelineContainer.classList.remove('visible');
        hideSelection();
        uploadCount = Math.max(0, uploadCount - 1);
        updateContentCount();
        activeExtra = null;
      }
    }
  });

  // ── Trim ──────────────────────────────────────────────────────────────────────
  video.addEventListener('timeupdate', () => {
    if (!videoReady || extractingFrames) return;
    if (trimLinesSet >= 2 && video.currentTime >= trimEnd * video.duration)
      video.currentTime = trimStart * video.duration;
    updatePlayhead();
  });

  function updatePlayhead() {
    if (!videoReady || video.duration === 0) return;
    playheadEl.style.left = (video.currentTime / video.duration * 100) + '%';
  }

  timelineEl.addEventListener('click', (e) => {
    if (!videoReady) return;
    const rect = timelineEl.getBoundingClientRect();
    const pct  = Math.max(trimStart, Math.min(trimEnd, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
  });

  function makeDraggable(handle, onDrag) {
    const getX = (e) => (e.touches ? e.touches[0] : e).clientX;
    const startDrag = (e) => {
      e.preventDefault(); e.stopPropagation();
      const onMove = (me) => {
        const rect = timelineEl.getBoundingClientRect();
        onDrag(Math.max(0, Math.min(1, (getX(me) - rect.left) / rect.width)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup',   onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend',  onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup',   onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend',  onUp);
    };
    handle.addEventListener('mousedown',  startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: false });
  }

  makeDraggable(trimLeftEl, (pct) => {
    trimStart = Math.min(pct, trimEnd - 0.02);
    if (videoReady && video.currentTime < trimStart * video.duration)
      video.currentTime = trimStart * video.duration;
    updateTrimUI();
  });

  makeDraggable(trimRightEl, (pct) => {
    trimEnd = Math.max(pct, trimStart + 0.02);
    if (videoReady && video.currentTime > trimEnd * video.duration)
      video.currentTime = trimEnd * video.duration;
    updateTrimUI();
  });

  function updateTrimUI() {
    trimLeftEl.style.left   = (trimStart * 100) + '%';
    trimRightEl.style.left  = `calc(${trimEnd * 100}% - 6px)`;
    trimOverlayLeft.style.width  = (trimStart * 100) + '%';
    trimOverlayRight.style.width = ((1 - trimEnd) * 100) + '%';
    if (trimResetBtn) {
      if (trimLinesSet >= 2) {
        const obj = videoObj;
        trimResetBtn.style.display = '';
        trimResetBtn.style.left = (obj.x + obj.width - 28) + 'px';
        trimResetBtn.style.top  = (obj.y + 8) + 'px';
      } else {
        trimResetBtn.style.display = 'none';
      }
    }
  }

  // ── Trim line hit detection ───────────────────────────────────────────────────
  function getTrimLineHit(mx, my) {
    if (!videoReady || trimLinesSet < 2) return null;
    const { x: vx, y: vy, width: vw, height: vh } = videoObj;
    if (my < vy || my > vy + vh) return null;
    const startX = vx + trimStart * vw;
    const endX   = vx + trimEnd   * vw;
    if (Math.abs(mx - startX) <= 8) return 'start';
    if (Math.abs(mx - endX)   <= 8) return 'end';
    return null;
  }

  // ── Video drag & resize ───────────────────────────────────────────────────────
  const HANDLE_KEYS = ['nw','n','ne','e','se','s','sw','w'];
  const CURSOR_MAP  = {
    nw: 'nw-resize', n: 'n-resize',  ne: 'ne-resize',
    e:  'e-resize',  se: 'se-resize', s:  's-resize',
    sw: 'sw-resize', w:  'w-resize',  move: 'move',
  };

  function handlePositionsForObj(obj) {
    const { x, y, width: w, height: h } = obj;
    return {
      nw: [x,     y      ], n:  [x+w/2, y      ], ne: [x+w, y      ],
      e:  [x+w,   y+h/2  ], se: [x+w,   y+h    ], s:  [x+w/2, y+h  ],
      sw: [x,     y+h    ], w:  [x,     y+h/2  ],
    };
  }

  function handlePositions() {
    return handlePositionsForObj(videoObj);
  }

  function toCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [
      (clientX - r.left) * (canvas.width  / r.width),
      (clientY - r.top)  * (canvas.height / r.height),
    ];
  }

  // Returns { handle, extraIdx } where extraIdx=-1 means primary, ≥0 means extraVideos[i].
  // Returns null when no hit.
  function getHit(mx, my) {
    // Check extras in reverse order so the most recently added (drawn on top) wins
    for (let i = extraVideos.length - 1; i >= 0; i--) {
      const item = extraVideos[i];
      if (!item.ready) continue;
      const pos = handlePositionsForObj(item.obj);
      for (const key of HANDLE_KEYS) {
        const [hx, hy] = pos[key];
        if (Math.abs(mx - hx) <= HANDLE_R + 3 && Math.abs(my - hy) <= HANDLE_R + 3)
          return { handle: key, extraIdx: i };
      }
      const { x, y, width: w, height: h } = item.obj;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h)
        return { handle: 'move', extraIdx: i };
    }
    // Check primary
    if (videoReady) {
      const pos = handlePositions();
      for (const key of HANDLE_KEYS) {
        const [hx, hy] = pos[key];
        if (Math.abs(mx - hx) <= HANDLE_R + 3 && Math.abs(my - hy) <= HANDLE_R + 3)
          return { handle: key, extraIdx: -1 };
      }
      const { x, y, width: w, height: h } = videoObj;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h)
        return { handle: 'move', extraIdx: -1 };
    }
    return null;
  }

  // Resize with locked aspect ratio — works on any targetObj stored in drag
  function applyDrag(mx, my) {
    const dx  = mx - drag.mx;
    const dy  = my - drag.my;
    const h   = drag.handle;
    const ar  = drag.ar;
    const MIN = 80;
    const obj = drag.targetObj;
    const isPrimary = drag.extraIdx === -1;

    if (h === 'move') {
      obj.x = drag.ox + dx;
      obj.y = drag.oy + dy;
      if (isPrimary) { syncVideoBounds(); updateTimelinePosition(); }
      showSelection(obj);
      return;
    }

    let nx = drag.ox, ny = drag.oy, nw, nh;

    if (h === 'n') {
      nh = Math.max(MIN, drag.oh - dy); nw = nh * ar;
      nx = drag.ox; ny = drag.oy + drag.oh - nh;
    } else if (h === 's') {
      nh = Math.max(MIN, drag.oh + dy); nw = nh * ar;
      nx = drag.ox; ny = drag.oy;
    } else if (h === 'e' || h === 'ne' || h === 'se') {
      nw = Math.max(MIN, drag.ow + dx); nh = nw / ar;
      nx = drag.ox; ny = h === 'ne' ? drag.oy + drag.oh - nh : drag.oy;
    } else { // w, nw, sw
      nw = Math.max(MIN, drag.ow - dx); nh = nw / ar;
      nx = drag.ox + drag.ow - nw; ny = h === 'nw' ? drag.oy + drag.oh - nh : drag.oy;
    }

    obj.x = nx; obj.y = ny;
    obj.width = nw; obj.height = nh;
    if (isPrimary) {
      videoObj.scale = nw / video.videoWidth;
      syncVideoBounds();
      updateTimelinePosition();
    }
    showSelection(obj);
  }

  function startCanvasDrag(clientX, clientY, pd) {
    const [mx, my] = toCanvas(clientX, clientY);
    const hit = getHit(mx, my);
    if (!hit) {
      activeExtra = null;
      hideSelection();
      return;
    }
    if (pd) pd();

    const targetObj = hit.extraIdx >= 0 ? extraVideos[hit.extraIdx].obj : videoObj;
    activeExtra = hit.extraIdx;
    showSelection(targetObj);

    drag = {
      handle: hit.handle, mx, my,
      ox: targetObj.x,  oy: targetObj.y,
      ow: targetObj.width, oh: targetObj.height,
      ar: targetObj.aspectRatio,
      targetObj,
      extraIdx: hit.extraIdx,
    };
  }

  let lastHoverScrubTime = 0;

  function moveCanvasDrag(clientX, clientY) {
    const [mx, my] = toCanvas(clientX, clientY);

    // ── Trim line drag ────────────────────────────────────────────────────────
    if (trimDrag) {
      const { x: vx, width: vw } = videoObj;
      const t = Math.max(0, Math.min(1, (mx - vx) / vw));
      if (trimDrag === 'start') trimStart = t;
      else                      trimEnd   = t;
      // Swap roles when lines cross so left is always start, right always end
      if (trimStart > trimEnd) {
        [trimStart, trimEnd] = [trimEnd, trimStart];
        trimDrag = trimDrag === 'start' ? 'end' : 'start';
      }
      // Scrub video to the dragged line's position
      if (video.duration) video.currentTime = t * video.duration;
      canvas.style.cursor = 'ew-resize';
      return;
    }

    if (!drag) {
      // Cursor: trim line hover takes priority
      const trimHit = getTrimLineHit(mx, my);
      if (trimHit) {
        canvas.style.cursor = 'ew-resize';
      } else {
        const hit = getHit(mx, my);
        canvas.style.cursor = hit ? (CURSOR_MAP[hit.handle] || 'default') : 'default';
      }
      // Hover scrub over primary video — throttled to 25fps to avoid constant seeking
      if (videoReady && video.duration && video.paused) {
        const { x: vx, y: vy, width: vw, height: vh } = videoObj;
        const over = mx >= vx && mx <= vx + vw && my >= vy && my <= vy + vh;
        if (over && hoverCanvasX !== null) {
          const now = performance.now();
          if (now - lastHoverScrubTime >= 40) {
            const dx = mx - hoverCanvasX;
            const dt = (dx / vw) * video.duration;
            video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + dt));
            lastHoverScrubTime = now;
          }
        }
        hoverCanvasX = over ? mx : null;
      } else {
        hoverCanvasX = null;
      }
      return;
    }
    if (!dragHasMoved && Math.hypot(mx - drag.mx, my - drag.my) > 4) dragHasMoved = true;
    if (dragHasMoved) applyDrag(mx, my);
  }

  canvas.addEventListener('mousedown', (e) => {
    dragHasMoved = false;
    const [mx, my] = toCanvas(e.clientX, e.clientY);
    // Trim line grab takes priority over video drag
    const trimHit = getTrimLineHit(mx, my);
    if (trimHit) { e.preventDefault(); trimDrag = trimHit; return; }
    startCanvasDrag(e.clientX, e.clientY, () => e.preventDefault());
  });
  window.addEventListener('mousemove', (e) => moveCanvasDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup', (e) => {
    if (trimDrag) { trimDrag = null; return; }
    if (drag && !dragHasMoved) {
      const [mx, my] = toCanvas(e.clientX, e.clientY);
      handleCanvasClick(mx, my);
    }
    drag = null;
    dragHasMoved = false;
  });
  canvas.addEventListener('mouseleave', () => { hoverCanvasX = null; });
  canvas.addEventListener('touchstart', (e) => { dragHasMoved = false; const t = e.touches[0]; startCanvasDrag(t.clientX, t.clientY, () => e.preventDefault()); }, { passive: false });
  window.addEventListener('touchmove',  (e) => { if (!drag) return; const t = e.touches[0]; moveCanvasDrag(t.clientX, t.clientY); }, { passive: false });
  window.addEventListener('touchend',   ()  => { drag = null; dragHasMoved = false; });

  // ── Draw ──────────────────────────────────────────────────────────────────────
  function drawHandlesForObj(obj) {
    // Handles are invisible — hit detection and cursor changes still work via getHit()
  }

  function drawVideo() {
    const { x, y, width: w, height: h } = videoObj;
    ctx.drawImage(video, x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    drawHandlesForObj(videoObj);
  }

  function drawExtraVideo(item) {
    const { x, y, width: w, height: h } = item.obj;
    ctx.drawImage(item.videoEl, x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    drawHandlesForObj(item.obj);
  }

  // ── Resize ────────────────────────────────────────────────────────────────────
  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    if (videoReady) updateTimelinePosition();
  }

  // ── In-video trim UI ─────────────────────────────────────────────────────────

  // Click on video body: sets the first line then the second (after that, only drag)
  function handleCanvasClick(mx, my) {
    if (!videoReady || trimLinesSet >= 2) return;
    const { x: vx, y: vy, width: vw, height: vh } = videoObj;
    if (mx < vx || mx > vx + vw || my < vy || my > vy + vh) return;
    const t = (mx - vx) / vw;
    if (trimLinesSet === 0) {
      trimStart = t;
      trimLinesSet = 1;
    } else {
      // Place second line; left = start, right = end
      if (t < trimStart) {
        trimEnd   = trimStart;
        trimStart = t;
      } else {
        trimEnd = t;
      }
      trimLinesSet = 2;
    }
    updateTrimUI();
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00.000';
    const m  = Math.floor(seconds / 60);
    const s  = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }

  function drawTrimUI() {
    if (!videoReady) return;
    const { x: vx, y: vy, width: vw, height: vh } = videoObj;

    // Both lines placed: dark overlay + both markers
    if (trimLinesSet >= 2) {
      const startX = vx + trimStart * vw;
      const endX   = vx + trimEnd   * vw;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      if (trimStart > 0) ctx.fillRect(vx, vy, startX - vx, vh);
      if (trimEnd   < 1) ctx.fillRect(endX, vy, vx + vw - endX, vh);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(startX, vy); ctx.lineTo(startX, vy + vh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(endX,   vy); ctx.lineTo(endX,   vy + vh); ctx.stroke();
    } else if (trimLinesSet === 1) {
      // Only first line placed
      const startX = vx + trimStart * vw;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(startX, vy); ctx.lineTo(startX, vy + vh); ctx.stroke();
    }

    // Hover scrub line (always visible while hovering)
    if (hoverCanvasX !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hoverCanvasX, vy); ctx.lineTo(hoverCanvasX, vy + vh); ctx.stroke();
      if (video.duration) {
        const t   = ((hoverCanvasX - vx) / vw) * video.duration;
        const lbl = formatTime(Math.max(0, Math.min(video.duration, t)));
        ctx.font      = '10px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const lx = hoverCanvasX + 5 + 56 > vx + vw ? hoverCanvasX - 61 : hoverCanvasX + 5;
        ctx.fillText(lbl, lx, vy + 14);
      }
    }
  }

  // ── Animate ───────────────────────────────────────────────────────────────────
  // No video persistence/restore across reloads by design — every page starts
  // empty and the user uploads fresh each time.

  let lastVideoTime      = -1;

  function animate() {
    requestAnimationFrame(animate);
    if (!root.classList.contains('visible')) return;

    if (videoReady && video.readyState >= 2) {
      // Pixelation no longer needs frameData (it samples the video directly on
      // the GPU) — only Motion & Particles still needs the downsampled CPU-side
      // frame for its worker-based motion-map diffing.
      if (motionFxEnabled && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        analyseCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        frameData = getVideoFrameData();
        motionFx.requestMotionMap(frameData);
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (videoReady && video.readyState >= 2) {
      if (meshEnabled) {
        pixelation.renderPixelation({
          targetCtx: ctx, video, cwState, pixelParams,
          x: videoBounds.x, y: videoBounds.y, w: videoBounds.width, h: videoBounds.height,
        });
        drawHandlesForObj(videoObj);
      } else if (motionFxEnabled) {
        motionFx.drawMotionParticles({ ctx, videoReady, videoBounds, drawHandlesForObj, videoObj });
      } else if (glitchEnabled) {
        renderGlitch({
          targetCtx: ctx, video, glitchParams,
          x: videoBounds.x, y: videoBounds.y, w: videoBounds.width, h: videoBounds.height,
        });
        if (glitchParams.pixelSortOn) {
          renderPixelSorting({
            targetCtx: ctx, glitchParams, cwState,
            x: videoBounds.x, y: videoBounds.y, w: videoBounds.width, h: videoBounds.height,
          });
        }
        drawHandlesForObj(videoObj);
      } else {
        drawVideo();
      }
      drawTrimUI();
    }

    // Draw extra videos on top of primary
    for (let i = 0; i < extraVideos.length; i++) {
      const item = extraVideos[i];
      if (item.ready && item.videoEl.readyState >= 2) {
        drawExtraVideo(item);
      }
    }
  }

  window.addEventListener('resize', resize);
  resize();
  animate();
}
