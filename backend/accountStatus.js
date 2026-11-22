// The ONE place an account's status changes (used by moderation tooling in Phase 2 and by tests).
//
//   suspended | banned | deleted | pending_deletion  -> every session ends (token_version is bumped), every live
//                                                       socket is closed, and the member can neither sign in
//                                                       (suspended / banned / deleted) nor be reached.
//   active                                            -> lifts the restriction (existing sessions stay ended;
//                                                       the member signs in again).
// Nothing is deleted here; content removal and account deletion are separate, reviewed processes.

const db = require("./db");
const { disconnectUser } = require("./realtime");

const STATUSES = ["active", "suspended", "banned", "pending_deletion", "deleted"];

/**
 * @param {import("socket.io").Server | null} io  used to close live sockets (may be null in scripts)
 * @param {string} userId
 * @param {string} status one of STATUSES
 * @param {{ suspendedUntil?: Date | string | null }} [options]
 */
async function setAccountStatus(io, userId, status, { suspendedUntil = null } = {}) {
  if (!STATUSES.includes(status)) throw new Error("unknown account status: " + status);
  const until = status === "suspended" ? suspendedUntil : null;
  const result = await db.query(
    `UPDATE profiles
     SET status = $2, suspended_until = $3, status_changed_at = NOW(), token_version = token_version + 1
     WHERE id = $1 RETURNING id, status, suspended_until`,
    [userId, status, until]
  );
  if (!result.rows[0]) throw new Error("no such account");
  if (status !== "active") disconnectUser(io, userId);
  return result.rows[0];
}

module.exports = { setAccountStatus, STATUSES };
