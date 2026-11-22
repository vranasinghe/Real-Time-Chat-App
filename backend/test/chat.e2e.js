// End-to-end test for the chat backend: two real users, real sockets.
//
// Usage (backend must be running):
//   API_URL=http://localhost:5001 npm run test:chat
//
// Creates three throwaway members (chat-e2e-*@example.com) and deletes nothing, so run it against a local
// disposable database, never production. Members go through the real sign-up and onboarding API, so the server
// must run with REQUIRE_EMAIL_VERIFICATION=false (see test/e2eHelpers.js). `npm run test:e2e:local` does all of it.

// Safety: these scripts create accounts and delete nothing, and API_URL may be a server
// connected to ANY database. Only run them against a disposable one, and say so:
//   E2E_CONFIRM_DISPOSABLE_DB=1 API_URL=http://localhost:5001 npm run test:chat
// (Prefer `npm run test:integration`, which starts its own app on a throwaway database.)
if (process.env.E2E_CONFIRM_DISPOSABLE_DB !== "1") {
  console.error("Refusing to run: set E2E_CONFIRM_DISPOSABLE_DB=1 to confirm the server uses a disposable database.");
  process.exit(1);
}

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { io } = require("socket.io-client");
const { createEligibleMember } = require("./e2eHelpers");

const API = process.env.API_URL || "http://localhost:5001";
const PASSWORD = "E2eTest#" + crypto.randomBytes(4).toString("hex");
const RUN = Date.now().toString(36);

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// A finished member: adult, policies accepted, onboarded through the API (eligible for dating features).
async function register(label) {
  return createEligibleMember(api, { email: `chat-e2e-${label}-${RUN}@example.com`, password: PASSWORD, name: `E2E ${label}` });
}

function connect(user) {
  return new Promise((resolve, reject) => {
    const socket = io(API, { auth: { token: user.token }, transports: ["websocket"] });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

// Records every event of a given name so tests can wait for / count them
function recorder(socket, event) {
  const seen = [];
  const waiters = [];
  socket.on(event, (payload) => {
    seen.push(payload);
    waiters.splice(0).forEach((w) => w());
  });
  return {
    seen,
    async next(predicate = () => true, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = seen.find(predicate);
        if (hit) return hit;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timed out waiting for "${event}"`);
        await new Promise((r) => {
          waiters.push(r);
          setTimeout(r, left);
        });
      }
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Chat e2e against ${API}`);
  const alice = await register("alice");
  const bob = await register("bob");
  const eve = await register("eve");

  // Sockets connect BEFORE the match exists: nobody joins any per-match room
  const aSock = await connect(alice);
  const bSock = await connect(bob);
  const aMatch = recorder(aSock, "match_created");
  const bMatch = recorder(bSock, "match_created");
  const aMsgs = recorder(aSock, "new_message");
  const bMsgs = recorder(bSock, "new_message");
  const aReads = recorder(aSock, "messages_read");

  let matchId;
  await check("mutual like creates a match and notifies both users live", async () => {
    await api("POST", "/api/swipes", alice.token, { swipee_id: bob.id, direction: "like" });
    const res = await api("POST", "/api/swipes", bob.token, { swipee_id: alice.id, direction: "like" });
    assert.equal(res.status, 200);
    matchId = res.data.activeMatch.match.id;
    assert.equal((await aMatch.next()).match_id, matchId);
    assert.equal((await bMatch.next()).match_id, matchId);
  });

  let first;
  const clientId = crypto.randomUUID();
  await check("message is delivered to the other user without join_room", async () => {
    const res = await api("POST", `/api/matches/${matchId}/messages`, alice.token, {
      body: "  Hi Bob!  ",
      client_id: clientId,
    });
    assert.equal(res.status, 201);
    first = res.data;
    assert.equal(first.body, "Hi Bob!", "body is trimmed");
    assert.equal(first.client_id, clientId);
    const got = await bMsgs.next((m) => m.id === first.id);
    assert.equal(got.client_id, clientId);
    await aMsgs.next((m) => m.id === first.id); // sender's other devices get it too
  });

  await check("retrying with the same client_id returns the original, no duplicate", async () => {
    const res = await api("POST", `/api/matches/${matchId}/messages`, alice.token, {
      body: "Hi Bob!",
      client_id: clientId,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.id, first.id);
    await sleep(400);
    assert.equal(bMsgs.seen.filter((m) => m.client_id === clientId).length, 1, "no second socket event");
  });

  await check("someone else re-using a client_id is rejected", async () => {
    const res = await api("POST", `/api/matches/${matchId}/messages`, bob.token, {
      body: "hijack",
      client_id: clientId,
    });
    assert.equal(res.status, 409);
  });

  await check("conversation list has last message and unread count", async () => {
    const res = await api("GET", "/api/matches/conversations", bob.token);
    assert.equal(res.status, 200);
    const convo = res.data.find((c) => c.id === matchId);
    assert.ok(convo, "match is listed");
    assert.equal(convo.other_user.id, alice.id);
    assert.equal(convo.last_message.id, first.id);
    assert.equal(convo.unread_count, 1);
  });

  await check("marking read clears unread and tells the sender (Seen)", async () => {
    const res = await api("POST", `/api/matches/${matchId}/read`, bob.token, {
      last_read_message_id: first.id,
    });
    assert.equal(res.status, 200);
    const evt = await aReads.next((e) => e.user_id === bob.id);
    assert.equal(evt.last_read_message_id, first.id);

    const bobView = (await api("GET", "/api/matches/conversations", bob.token)).data.find((c) => c.id === matchId);
    assert.equal(bobView.unread_count, 0);
    const aliceView = (await api("GET", "/api/matches/conversations", alice.token)).data.find((c) => c.id === matchId);
    assert.equal(aliceView.other_last_read_message_id, first.id);
  });

  await check("read pointer never moves backwards or past the newest message", async () => {
    let res = await api("POST", `/api/matches/${matchId}/read`, bob.token, { last_read_message_id: 0 });
    assert.equal(res.data.last_read_message_id, first.id);
    res = await api("POST", `/api/matches/${matchId}/read`, bob.token, { last_read_message_id: first.id + 100000 });
    assert.equal(res.data.last_read_message_id, first.id);
  });

  await check("messages page newest-first with ?limit and ?before", async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await api("POST", `/api/matches/${matchId}/messages`, bob.token, { body: `msg ${i}` });
      assert.equal(r.status, 201);
    }
    const page1 = await api("GET", `/api/matches/${matchId}/messages?limit=3`, alice.token);
    assert.deepEqual(page1.data.map((m) => m.body), ["msg 3", "msg 4", "msg 5"]);
    const page2 = await api("GET", `/api/matches/${matchId}/messages?limit=3&before=${page1.data[0].id}`, alice.token);
    assert.deepEqual(page2.data.map((m) => m.body), ["Hi Bob!", "msg 1", "msg 2"]);
    const unread = (await api("GET", "/api/matches/conversations", alice.token)).data.find((c) => c.id === matchId);
    assert.equal(unread.unread_count, 5);
  });

  await check("input validation", async () => {
    const path = `/api/matches/${matchId}/messages`;
    assert.equal((await api("POST", path, alice.token, { body: "   " })).status, 400);
    assert.equal((await api("POST", path, alice.token, { body: "x".repeat(2001) })).status, 400);
    assert.equal((await api("POST", path, alice.token, { body: "hi", kind: "video" })).status, 400);
    assert.equal((await api("POST", path, alice.token, { body: "hi", client_id: "nope" })).status, 400);
    assert.equal((await api("GET", `/api/matches/${matchId}/messages?before=abc`, alice.token)).status, 400);
  });

  await check("outsiders cannot read, send, mark read, or receive", async () => {
    const eSock = await connect(eve);
    const eMsgs = recorder(eSock, "new_message");
    eSock.emit("join_room", matchId); // legacy room join must be refused too
    await sleep(200);
    assert.equal((await api("GET", `/api/matches/${matchId}/messages`, eve.token)).status, 403);
    assert.equal((await api("POST", `/api/matches/${matchId}/messages`, eve.token, { body: "hi" })).status, 403);
    assert.equal((await api("POST", `/api/matches/${matchId}/read`, eve.token, { last_read_message_id: 1 })).status, 403);
    await api("POST", `/api/matches/${matchId}/messages`, alice.token, { body: "private" });
    await sleep(400);
    assert.equal(eMsgs.seen.length, 0);
    eSock.close();
  });

  aSock.close();
  bSock.close();
  console.log(`\n${passed} checks passed`);
  process.exit(0);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
