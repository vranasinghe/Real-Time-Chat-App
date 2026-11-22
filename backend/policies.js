// Versions of the policies a member must accept. These are LABELS, not legal text.
//
// The Terms of Service, Privacy Policy and Community Guidelines are drafts that still need legal review
// (see docs/implementation/KNOWN_LIMITATIONS.md). "draft-1" says exactly that. When reviewed text is
// published, bump the version: members are then asked to accept it again (the re-acceptance flow is Phase 6).

const POLICY_VERSIONS = Object.freeze({
  terms: "draft-1",
  privacy: "draft-1",
});

module.exports = { POLICY_VERSIONS };
