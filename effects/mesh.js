// ── Mesh Effect ─────────────────────────────────────────────────────────────────
// Reserved for a future Mesh effect. Currently a UI-only toggle (button, active
// state, mutex with the other effects) — the toggle wiring lives in
// projectpage.js alongside the other effect buttons since there's no
// effect-specific render logic yet to isolate here.
//
// Once a render algorithm is designed, add it here following the same shape as
// effects/glitch.js or effects/motion-particles.js (a render function that
// receives ctx/videoBounds/etc. as explicit parameters).

export {};
