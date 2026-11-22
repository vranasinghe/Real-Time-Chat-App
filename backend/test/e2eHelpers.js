// Shared sign-up helper for the manual end-to-end scripts (chat.e2e.js, images.e2e.js).
//
// Members must now be adults who accepted the current policies, verified their e-mail and finished the
// server-driven onboarding before any dating feature opens. These scripts talk to a RUNNING server over HTTP,
// so they go through the real API only. They cannot read the e-mail code, therefore the server under test must
// be started with REQUIRE_EMAIL_VERIFICATION=false (a development-only switch that production ignores).
// `npm run test:e2e:local` (backend/scripts/run-e2e.js) starts such a server on a throwaway database for you.

const assert = require("node:assert/strict");

// 1x1 PNG used as the member's (test) photo
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Registers an adult member who accepts the current policies. `api(method, path, token, body)` is the script's own client. */
async function registerMember(api, { email, password, name, birthdate = "1990-06-15" }) {
  const config = await api("GET", "/api/auth/config");
  assert.equal(config.status, 200, "GET /api/auth/config");
  const res = await api("POST", "/api/auth/register", null, {
    email,
    password,
    name,
    birthdate,
    accepted_policies: config.data.policies,
  });
  assert.equal(res.status, 201, `register ${name}: ${JSON.stringify(res.data)}`);
  return { token: res.data.token, id: res.data.user.id };
}

/** Walks the real onboarding API to an eligible member. Returns the uploaded photo's path. */
async function onboardMember(api, member) {
  const state = await api("GET", "/api/onboarding", member.token);
  assert.equal(state.status, 200, "GET /api/onboarding");
  if (state.data.email.required && !state.data.email.verified) {
    throw new Error(
      "The server under test requires e-mail verification, which these scripts cannot complete. " +
        "Start it with REQUIRE_EMAIL_VERIFICATION=false (development only) or use `npm run test:e2e:local`."
    );
  }
  const step = async (name, body) => {
    const r = await api("PATCH", `/api/onboarding/${name}`, member.token, body);
    assert.equal(r.status, 200, `onboarding ${name}: ${JSON.stringify(r.data)}`);
  };
  await step("gender", { gender: "other" });
  await step("interested_in", { looking_for: "everyone" });
  const image = await api("POST", "/api/images", member.token, { data: PNG_BASE64 });
  assert.equal(image.status, 201, `photo upload: ${JSON.stringify(image.data)}`);
  await step("photos", { photos: [image.data.url] });
  const done = await api("POST", "/api/onboarding/complete", member.token);
  assert.equal(done.status, 200, `onboarding complete: ${JSON.stringify(done.data)}`);
  assert.equal(done.data.eligibility.eligible, true);
  return image.data.url;
}

/** register + onboard in one call. */
async function createEligibleMember(api, details) {
  const member = await registerMember(api, details);
  member.photo = await onboardMember(api, member);
  return member;
}

module.exports = { PNG_BASE64, registerMember, onboardMember, createEligibleMember };
