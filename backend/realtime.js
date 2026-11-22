// Helpers for delivering realtime events to the people in a match.
//
// Every authenticated socket joins `user:<id>` on connect (see index.js), so
// events are addressed to users, not to per-match rooms. Socket.io de-duplicates
// across chained rooms, so a socket that is in several of them gets one copy.

const userRoom = (userId) => `user:${userId}`;

function emitToUsers(io, userIds, event, payload) {
  if (!io || !userIds || userIds.length === 0) return;
  let target = io;
  for (const id of userIds) {
    if (id) target = target.to(userRoom(id));
  }
  target.emit(event, payload);
}

// Sends to both participants, plus the legacy per-match room for older clients.
function emitToMatch(io, match, event, payload) {
  if (!io || !match) return;
  io.to(userRoom(match.user_a)).to(userRoom(match.user_b)).to(match.id).emit(event, payload);
}

// Closes every live socket of a member (all devices). Used when an account is suspended, banned or
// deleted, so a connection opened earlier cannot keep receiving or sending anything.
function disconnectUser(io, userId) {
  if (!io || !userId) return;
  io.in(userRoom(userId)).disconnectSockets(true);
}

module.exports = { userRoom, emitToUsers, emitToMatch, disconnectUser };
