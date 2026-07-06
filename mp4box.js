// ── mp4box.js — everything that touches the MP4 from upload to download ─────
// No upload persistence by design — every page starts empty after a reload,
// the user uploads fresh each time. This file owns sample-accurate timeline
// analysis of the source video/trim range, frame-accurate seeking, and the
// two-phase export pipeline:
//   Phase 1 prepares every effect-rendered frame from the real MP4 sample
//   timeline (MP4Box.js), Phase 2 actually plays the video back in real time
//   (video.play()) while a screen-recording-style MediaRecorder capture runs,
//   drawing whichever prepared frame matches the video's current real
//   playback position at each animation frame.

// Waits for the video to land exactly on `time` before resolving — used to
// step through Phase 1 sample-by-sample instead of relying on real-time
// playback.
//
// Two safety nets, both needed because setting `currentTime` to a value it
// already holds is a no-op in browsers — no internal seek happens, so
// 'seeked' never fires and an unguarded await would hang forever:
//   1. Skip waiting entirely if already at (approximately) that time.
//   2. A timeout as a last-resort escape for any other case where 'seeked'
//      doesn't fire, so the export can never freeze indefinitely.
function seekTo(video, time) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - time) < 0.001) { resolve(); return; }
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      console.warn('seekTo: "seeked" event did not fire within 2s for time', time);
      resolve();
    }, 2000);
    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

let _mp4BoxLib = null;
async function loadMp4Box() {
  if (_mp4BoxLib) return _mp4BoxLib;
  const mod = await import('https://cdn.jsdelivr.net/npm/mp4box@0.5.2/+esm');
  _mp4BoxLib = mod.default ?? mod.MP4Box ?? mod;
  return _mp4BoxLib;
}

// Reads the REAL sample timeline straight out of the MP4 container's sample
// table (the `stbl` box inside `moov` — `stts`/`ctts`/`stsz` etc., which is
// what MP4Box.js's per-sample extraction surfaces) instead of deriving an
// average fps from `nb_samples / duration`. Every entry in the returned
// `samples` array corresponds to one real, distinct video sample with its own
// decode time, composition/presentation time, and duration — this is the
// timeline the export is built from, never a reconstructed average rate.
//
// Throws (does not silently fall back) if the file can't be parsed as MP4 or
// has no video track — see exportWithEffect's error handling.
async function readMp4SampleTimeline(video) {
  const MP4Box = await loadMp4Box();
  const buf = await fetch(video.currentSrc || video.src).then(r => r.arrayBuffer());

  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    const rawSamples = [];
    let trackInfo = null;

    mp4boxFile.onReady = (info) => {
      const track = info.videoTracks && info.videoTracks[0];
      if (!track || !track.nb_samples) {
        reject(new Error('no video track or zero samples'));
        return;
      }
      trackInfo = track;
      // Ask MP4Box to hand us every sample of this track in one batch via
      // onSamples below — this is what gives us real per-sample dts/cts/
      // duration instead of just the track-level summary fields.
      mp4boxFile.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      mp4boxFile.start();
    };

    mp4boxFile.onSamples = (track_id, user, sampleList) => {
      for (const s of sampleList) {
        rawSamples.push({
          number: s.number,
          dts: s.dts,
          cts: s.cts,
          duration: s.duration,
          timescale: s.timescale,
          isSync: !!s.is_sync,
        });
      }
      if (rawSamples.length >= trackInfo.nb_samples) {
        mp4boxFile.stop();

        // Presentation order (cts), not decode order (dts) — matters when
        // B-frames make the two differ.
        rawSamples.sort((a, b) => a.cts - b.cts);

        const samples = rawSamples.map(s => ({
          number: s.number,
          isSync: s.isSync,
          presentationTime: s.cts / s.timescale,
          durationSec: s.duration / s.timescale,
        }));

        resolve({
          trackDurationSec: trackInfo.duration / trackInfo.timescale,
          totalSamples: trackInfo.nb_samples,
          samples,
        });
      }
    };

    mp4boxFile.onError = (e) => reject(new Error('MP4Box parse error: ' + e));

    buf.fileStart = 0;
    mp4boxFile.appendBuffer(buf);
    mp4boxFile.flush();
  });
}

// Selects the real samples whose presentation time falls inside
// [startTime, endTime]. Full-range (trimStart===0 && trimEnd===1) bypasses
// the time comparison entirely and returns every real sample unfiltered, so
// "export everything" can never lose a sample to a rounding/boundary edge
// case at the start or end of the track.
function selectSamplesForRange(allSamples, startTime, endTime, isFullRange) {
  if (isFullRange) return allSamples;
  return allSamples.filter(s => s.presentationTime >= startTime && s.presentationTime <= endTime);
}

// Finds the prepared frame whose sample presentation time is the closest one
// at-or-before `currentTime` — i.e. "which real frame should be on screen
// right now" during Phase 2's real-time playback. `relativeTimes[i]` holds
// each prepared frame's presentation time relative to the trim start (so
// frame 0 is at relative time 0), matching how far `video.currentTime` has
// advanced past `startTime`.
function findFrameIndexForTime(relativeTimes, elapsed) {
  let lo = 0, hi = relativeTimes.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (relativeTimes[mid] <= elapsed) { ans = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return ans;
}

// ── Export current effect to a downloadable MP4 ──────────────────────────────
// Two-phase pipeline:
//   Phase 1 (prepare): for every real MP4 sample in the trim range, seek the
//     video to that sample's exact presentation time, render the active
//     effect, and store the rendered image as an ImageBitmap in memory. This
//     phase can take as long as it needs — seeking/rendering speed has no
//     effect on the output, because nothing is being recorded yet.
//   Phase 2 (real-time capture): seek back to the trim start, start
//     MediaRecorder, then actually call video.play() — a real, normal-speed
//     playback, like pressing a start button. While it plays, a
//     requestAnimationFrame loop continuously looks up which prepared frame
//     corresponds to the video's current real playback position and draws it
//     onto the canvas MediaRecorder is capturing — a screen-recording of the
//     effect-applied playback, running at the video's own real-time clock,
//     not an artificial setTimeout pacing. Stops at the trim end / video end.
//
// Motion & Particles and Mesh have no export path (only effects exposed on
// the download button's effect check below are covered).
export async function exportWithEffect({
  video, videoReady, currentFileName,
  isMeshEnabled, isGlitchEnabled,
  pixelParams, cwState, glitchParams,
  trimStart, trimEnd,
  btnDownload,
  renderPixelation, renderGlitch, renderPixelSorting,
  isExportingRef,
  onProgress, // (frameIndex, frameCount) => void — called once per processed sample
}) {
  if (isExportingRef.current || !videoReady) return;
  isExportingRef.current = true;
  btnDownload.disabled = true;
  btnDownload.textContent = 'Loading…';

  try {
    // ── Phase 0: real sample timeline from the MP4 container ────────────────
    let timeline;
    try {
      timeline = await readMp4SampleTimeline(video);
    } catch (e) {
      throw new Error('MP4 sample timeline could not be read; frame-accurate export is not possible for this file.');
    }

    const isFullRange = trimStart === 0 && trimEnd === 1;
    const startTime = trimStart * timeline.trackDurationSec;
    const endTime   = trimEnd   * timeline.trackDurationSec;
    const selected  = selectSamplesForRange(timeline.samples, startTime, endTime, isFullRange);
    if (selected.length === 0) {
      throw new Error('MP4 sample timeline could not be read; frame-accurate export is not possible for this file.');
    }

    const expectedDurationSec =
      (selected[selected.length - 1].presentationTime + selected[selected.length - 1].durationSec)
      - selected[0].presentationTime;

    const mimeType =
      MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1' :
      MediaRecorder.isTypeSupported('video/mp4')             ? 'video/mp4'             :
      'video/webm';
    const ext = mimeType.startsWith('video/mp4') ? '.mp4' : '.webm';

    console.log(
      '[mp4box export] video.duration(browser)=%ss  trackDuration=%ss  totalSamples=%s  ' +
      'exportedSamples=%s  firstSample=%ss  lastSample=%ss  expectedExportDuration=%ss  ' +
      'codec=%s  container=%s',
      video.duration.toFixed(3), timeline.trackDurationSec.toFixed(3), timeline.totalSamples,
      selected.length, selected[0].presentationTime.toFixed(3),
      selected[selected.length - 1].presentationTime.toFixed(3), expectedDurationSec.toFixed(3),
      mimeType, ext
    );

    const ew = video.videoWidth;
    const eh = video.videoHeight;

    // ── Phase 1: prepare every effect-rendered frame, sample-accurate seek ──
    const prepCanvas = document.createElement('canvas');
    prepCanvas.width  = ew;
    prepCanvas.height = eh;
    const prepCtx = prepCanvas.getContext('2d');

    const preparedFrames = []; // ImageBitmap[]
    const relativeTimes  = []; // seconds since startTime, parallel array

    for (let i = 0; i < selected.length; i++) {
      const sample = selected[i];
      await seekTo(video, sample.presentationTime);

      prepCtx.clearRect(0, 0, ew, eh);
      if (isMeshEnabled()) {
        renderPixelation({ targetCtx: prepCtx, video, cwState, pixelParams, x: 0, y: 0, w: ew, h: eh });
      } else if (isGlitchEnabled()) {
        renderGlitch({ targetCtx: prepCtx, video, glitchParams, x: 0, y: 0, w: ew, h: eh });
        if (glitchParams.pixelSortOn) {
          renderPixelSorting({ targetCtx: prepCtx, glitchParams, cwState, x: 0, y: 0, w: ew, h: eh });
        }
      } else {
        prepCtx.drawImage(video, 0, 0, ew, eh);
      }

      const bitmap = await createImageBitmap(prepCanvas);
      preparedFrames.push(bitmap);
      relativeTimes.push(sample.presentationTime - selected[0].presentationTime);
      if (onProgress) onProgress(i + 1, selected.length);
    }

    // ── Phase 2: real video.play() while a screen-recording-style capture runs ─
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width  = ew;
    exportCanvas.height = eh;
    const exportCtx = exportCanvas.getContext('2d');

    await seekTo(video, startTime);

    const stream   = exportCanvas.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks   = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    await new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = currentFileName.replace(/\.[^.]+$/, '') + '_cc' + ext;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve();
      };

      recorder.start();
      video.play();

      let rafId;
      function tick() {
        const elapsed = video.currentTime - startTime;
        if (elapsed >= endTime - startTime || video.ended) {
          cancelAnimationFrame(rafId);
          video.pause();
          recorder.stop();
          return;
        }

        const idx = findFrameIndexForTime(relativeTimes, elapsed);
        exportCtx.clearRect(0, 0, ew, eh);
        exportCtx.drawImage(preparedFrames[idx], 0, 0, ew, eh);

        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    });

    for (const bitmap of preparedFrames) bitmap.close();
  } finally {
    btnDownload.textContent = 'Download MP4';
    btnDownload.disabled = false;
    isExportingRef.current = false;
  }
}
