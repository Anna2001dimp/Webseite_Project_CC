// ── Entry point ───────────────────────────────────────────────────────────────
// The app is split by component:
//   landingpage.js        — landing page + hand-tracking grid
//   startscreen.js        — carousel, collection persistence, navigation
//   projectpage.js        — per-page canvas/video/trim/drag shell + effect dispatch
//   mp4box.js             — everything MP4: exact frame-count analysis,
//                           frame-accurate export/download (no upload persistence)
//   effects/pixelation.js — Pixelation (focus map, color wheels)
//   effects/mesh.js        — Mesh (placeholder)
//   effects/motion-particles.js — Motion & Particles
//   effects/glitch.js      — Glitch
import './landingpage.js';
import './startscreen.js';

