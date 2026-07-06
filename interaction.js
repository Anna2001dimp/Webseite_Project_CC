export function initInteraction(root, {
  glitchParams, pixelParams, cwState,
  getMeshEnabled, getGlitchEnabled,
  renderPixelation, renderGlitch, renderPixelSorting,
  deactivateAllEffects,
  markBusy, markIdle,
}) {
  const btnInteraction  = root.querySelector('.pp-btn-interaction');
  const cameraOverlay   = root.querySelector('.pp-camera-overlay');
  const cameraCanvas    = root.querySelector('.pp-camera-canvas');
  const cameraDelete    = root.querySelector('.pp-camera-delete');
  const btnUpload       = root.querySelector('.pp-btn-upload');
  const btnDownload     = root.querySelector('.pp-btn-download');
  const effectsToggle   = root.querySelector('.pp-effects-toggle');
  const btnMesh         = root.querySelector('.pp-btn-mesh');
  const btnMeshFx       = root.querySelector('.pp-btn-meshfx');
  const btnMotionFx     = root.querySelector('.pp-btn-motionfx');
  const btnGlitchFx     = root.querySelector('.pp-btn-glitch-fx');

  if (!btnInteraction || !cameraOverlay || !cameraCanvas || !cameraDelete) {
    console.error('interaction.js: Pflicht-Elemente nicht gefunden', {
      btnInteraction, cameraOverlay, cameraCanvas, cameraDelete,
    });
    return { setVideoPresence() {}, closeCamera() {} };
  }

  const cameraCtx = cameraCanvas.getContext('2d');

  const CAM_W = 640, CAM_H = 360;
  cameraCanvas.width  = CAM_W;
  cameraCanvas.height = CAM_H;

  const ASPECT  = CAM_H / CAM_W;
  const MIN_W   = 240;
  let   displayW = CAM_W;

  function applyCameraSize(w) {
    displayW = Math.max(MIN_W, Math.min(Math.round(window.innerWidth * 0.92), Math.round(w)));
    cameraCanvas.style.width  = displayW + 'px';
    cameraCanvas.style.height = Math.round(displayW * ASPECT) + 'px';
  }

  function resizeDelta(dir, dx, dy) {
    const dyW = dy / ASPECT;
    switch (dir) {
      case 'e':  return dx;
      case 'w':  return -dx;
      case 's':  return dyW;
      case 'n':  return -dyW;
      case 'se': return (dx + dyW) / 2;
      case 'sw': return (-dx + dyW) / 2;
      case 'ne': return (dx - dyW) / 2;
      case 'nw': return (-dx - dyW) / 2;
    }
  }

  const cameraHandles = root.querySelectorAll('.pp-camera-handle');
  cameraHandles.forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;
      const startW = displayW;
      const onMove = ev => applyCameraSize(startW + resizeDelta(dir, ev.clientX - startX, ev.clientY - startY));
      const onUp   = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });

  const camVideo = document.createElement('video');
  camVideo.autoplay = true;
  camVideo.playsInline = true;
  camVideo.muted = true;

  let camStream    = null;
  let cameraActive = false;
  let camAnimId    = null;

  function setEffectsEnabled(enabled) {
    if (effectsToggle) effectsToggle.disabled = !enabled;
    if (btnMesh)       btnMesh.disabled       = !enabled;
    if (btnMeshFx)     btnMeshFx.disabled     = !enabled;
    if (btnMotionFx)   btnMotionFx.disabled   = !enabled;
    if (btnGlitchFx)   btnGlitchFx.disabled   = !enabled;
  }

  async function openCamera() {
    btnInteraction.textContent = 'Loading...';
    btnInteraction.disabled = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia nicht verfügbar (HTTP/file:// ohne localhost?)');
      }
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 } },
        audio: true,
      });
      camVideo.srcObject = camStream;
      cameraOverlay.style.display = '';
      cameraActive = true;
      cameraHandles.forEach(h => h.style.display = 'block');
      renderCameraLoop();
      await camVideo.play();
      btnInteraction.textContent = 'Interaction';
      btnInteraction.disabled = false;
      btnInteraction.classList.add('active');
      btnUpload.disabled   = true;
      btnDownload.disabled = false;
      setEffectsEnabled(true);
    } catch (e) {
      console.error('Kamera-Fehler:', e);
      btnInteraction.textContent = 'Interaction';
      btnInteraction.disabled = false;
    }
  }

  function closeCamera() {
    if (!cameraActive) return;
    cameraActive = false;
    if (camAnimId) { cancelAnimationFrame(camAnimId); camAnimId = null; }
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    camVideo.srcObject = null;
    cameraOverlay.style.display = 'none';
    btnInteraction.classList.remove('active');
    btnUpload.disabled   = false;
    btnDownload.disabled = true;
    setEffectsEnabled(false);
    cameraHandles.forEach(h => h.style.display = 'none');
    displayW = CAM_W;
    cameraCanvas.style.width = '';
    cameraCanvas.style.height = '';
    deactivateAllEffects();
  }

  function renderCameraLoop() {
    if (!cameraActive) return;
    camAnimId = requestAnimationFrame(renderCameraLoop);
    if (camVideo.readyState < 2) return;

    cameraCtx.clearRect(0, 0, CAM_W, CAM_H);

    if (getMeshEnabled()) {
      renderPixelation({
        targetCtx: cameraCtx, video: camVideo, cwState, pixelParams,
        x: 0, y: 0, w: CAM_W, h: CAM_H,
      });
    } else if (getGlitchEnabled()) {
      renderGlitch({
        targetCtx: cameraCtx, video: camVideo, glitchParams,
        x: 0, y: 0, w: CAM_W, h: CAM_H,
      });
      if (glitchParams.pixelSortOn) {
        renderPixelSorting({
          targetCtx: cameraCtx, glitchParams, cwState,
          x: 0, y: 0, w: CAM_W, h: CAM_H,
        });
      }
    } else {
      cameraCtx.drawImage(camVideo, 0, 0, CAM_W, CAM_H);
    }
  }

  function recordAndExport() {
    markBusy();
    btnDownload.textContent = 'Loading...';
    btnDownload.disabled = true;
    const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
      ? 'video/mp4;codecs=avc1'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
    const ext      = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const stream   = cameraCanvas.captureStream(30);
    camStream.getAudioTracks().forEach(t => stream.addTrack(t));
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `interaction.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      btnDownload.textContent = 'Download MP4';
      btnDownload.disabled = false;
      markIdle();
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 5000);
  }

  btnInteraction.addEventListener('click', () => {
    if (cameraActive) closeCamera(); else openCamera();
  });

  cameraDelete.addEventListener('click', closeCamera);

  btnDownload.addEventListener('click', () => {
    if (cameraActive) recordAndExport();
  });

  return {
    setVideoPresence(hasVideo) {
      btnInteraction.disabled = hasVideo;
    },
    closeCamera,
  };
}
