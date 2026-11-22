// Features that are not implemented yet. A flag stays false until the feature really works
// end to end (backend + UI + tests). Screens must not show a control for a disabled feature,
// and routes for it must not be reachable by URL.
//
//   calls            audio / video calling (needs WebRTC signalling, TURN and development builds)
//   voiceMessages    recording and sending voice notes
//
// See docs/implementation/IMPLEMENTATION_PLAN.md, Phase 10.
export const FEATURES = {
  calls: false,
  voiceMessages: false,
} as const;
