const config = require("./config");
config.validate(); // fail fast with a clear message if the deployment is misconfigured

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const logger = require("./logger");
const session = require("./session");
const { emitToUsers } = require("./realtime");

const auth = require("./auth");
const accountSecurity = require("./accountSecurity");
const profiles = require("./profiles");
const swipes = require("./swipes");
const matches = require("./matches");
const demo = require("./demo");
const images = require("./images");

const app = express();
const server = http.createServer(app);

// Behind a hosting proxy (Render), trust its X-Forwarded-* headers so rate limits
// apply per visitor instead of to everyone sharing the proxy's IP.
if (config.trustProxy) {
  app.set("trust proxy", config.trustProxy);
}

// Browsers from these origins may call the API and open sockets. Native apps send no
// Origin header and are not affected. Web sessions normally go through the Vercel
// same-origin proxy, so cookies never need cross-origin CORS.
// With no CORS_ORIGIN: development reflects any origin (so Expo web on localhost can use
// cookies); production allows any origin but never with credentials.
const devOpen = config.corsOpen && !config.isProduction;
const corsOptions = devOpen
  ? { origin: true, credentials: true }
  : config.corsOpen
  ? { origin: "*" }
  : {
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin.replace(/\/$/, ""))),
      credentials: true,
    };

const io = new Server(server, {
  cors: devOpen
    ? { origin: true, credentials: true }
    : config.corsOpen
    ? { origin: "*" }
    : { origin: config.corsOrigins, credentials: true },
});

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));

// Request log (method, path without query string, status, duration). Never bodies or headers.
app.use((req, res, next) => {
  if (req.path === "/healthz" || req.path === "/readyz") return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    logger.info("request", {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - start) / 1000000n),
    });
  });
  next();
});

// Health: liveness (is the process up) and readiness (can it reach the database).
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/readyz", async (req, res) => {
  try {
    await db.ping();
    res.status(200).json({ status: "ready" });
  } catch (err) {
    logger.error("readiness check failed", err);
    res.status(503).json({ status: "unavailable" });
  }
});

// Images: mounted before the global JSON parser because uploads need a larger
// body limit (the default is 100 KB). Has its own upload rate limit.
app.use("/api/images", images.router);

app.use(express.json({ limit: "100kb" }));

// Static images (e.g. demo profile photos). The app runs on a different origin,
// so allow cross-origin loading, which helmet blocks by default.
app.use(
  "/public",
  express.static(path.join(__dirname, "public"), {
    maxAge: "7d",
    setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
  })
);

// General limit for the auth endpoints. Failed logins are limited much harder in auth.js.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.AUTH_RATE_LIMIT, 10) || 100,
  message: { error: "Too many requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.API_RATE_LIMIT, 10) || 300,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// Set socketio reference on app
app.set("socketio", io);

// Mount API endpoints
app.use("/api/auth/demo", demo.router); // One-tap live demo login (DEMO_LOGIN_ENABLED=true)
app.use("/api/auth", accountSecurity.router);
app.use("/api/auth", auth.router);
app.use("/api/profiles", profiles);
app.use("/api/swipes", swipes);
app.use("/api/matches", matches);

// Root test endpoint
app.get("/", (req, res) => {
  res.json({ message: "Dateza Node.js Express Backend is running." });
});

// Unknown API routes: JSON 404 (not an HTML page)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler: never leaks internals to the client
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  logger.error("unhandled request error", err, { method: req.method, path: req.path });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

// Authenticate every socket connection. Web sends a one-time ticket, native sends its
// access token; the server accepts either (also via the Authorization header).
io.use(async (socket, next) => {
  const headerToken = socket.handshake.headers.authorization?.split(" ")[1];
  const credential = {
    ticket: socket.handshake.auth?.ticket,
    token: socket.handshake.auth?.token || headerToken,
  };

  if (!credential.ticket && !credential.token) {
    return next(new Error("Authentication token is missing"));
  }

  try {
    socket.data.userId = await session.authenticateSocketCredential(credential);
    next();
  } catch (err) {
    next(new Error("Authentication token is invalid or expired"));
  }
});

// WebSocket Server Events
io.on("connection", (socket) => {
  logger.debug("socket connected", { socket: socket.id, user: socket.data.userId });

  // Every socket joins its owner's personal room. Chat events are delivered to
  // `user:<id>` rooms, so a client receives messages for all of its matches
  // (including brand-new ones) without having to join per-match rooms. A user can
  // have several sockets (web + phone) and all of them receive every event.
  socket.join(`user:${socket.data.userId}`);

  const userId = socket.data.userId;
  const open = (socketCounts.get(userId) || 0) + 1;
  socketCounts.set(userId, open);
  if (open === 1) void setPresence(userId, true);

  // Legacy: per-match rooms. Kept so older clients keep working; new clients don't need them.
  socket.on("join_room", async (matchId) => {
    if (!matchId) return;
    try {
      const result = await db.query(
        "SELECT 1 FROM matches WHERE id = $1 AND (user_a = $2 OR user_b = $2)",
        [matchId, socket.data.userId]
      );
      if (result.rows.length === 0) {
        return;
      }
      socket.join(matchId);
    } catch (err) {
      logger.error("join_room authorization check failed", err);
    }
  });

  // Leave a match chat room
  socket.on("leave_room", (matchId) => {
    if (matchId) socket.leave(matchId);
  });

  socket.on("disconnect", () => {
    logger.debug("socket disconnected", { socket: socket.id });
    const remaining = (socketCounts.get(userId) || 1) - 1;
    if (remaining > 0) {
      socketCounts.set(userId, remaining);
    } else {
      socketCounts.delete(userId);
      void setPresence(userId, false);
    }
  });
});

// ---- Presence ---------------------------------------------------------------
// A user is online while at least one of their sockets is connected (phone + web both
// count). Changes are sent only to that user's matches, never broadcast to everyone.
// Counts live in memory: correct for a single backend instance (see README).
const socketCounts = new Map(); // userId -> open sockets

async function setPresence(userId, online) {
  try {
    await db.query("UPDATE profiles SET is_online = $2 WHERE id = $1", [userId, online]);
    const partners = await db.query(
      "SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS id FROM matches WHERE user_a = $1 OR user_b = $1",
      [userId]
    );
    emitToUsers(io, partners.rows.map((r) => r.id), "status_change", { userId, is_online: online });
  } catch (err) {
    logger.error("presence update failed", err);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Creates tables with a few retries (the database may be waking up), then listens.
// If it still fails the process exits so the host restarts it, rather than serving a
// half-working API.
const startServer = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.initDb();
      break;
    } catch (err) {
      logger.error(`database initialization failed (attempt ${attempt}/4)`, err);
      if (attempt >= 4) process.exit(1);
      await sleep(2000 * attempt);
    }
  }
  try {
    await db.query("UPDATE profiles SET is_online = false WHERE is_online AND NOT is_demo");
  } catch (err) {
    logger.error("could not reset presence flags", err);
  }
  server.listen(config.port, () => {
    logger.info("server listening", { port: config.port, production: config.isProduction });
  });
};

// Graceful shutdown: stop taking connections, let sockets close, release the DB pool.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try {
    await new Promise((resolve) => io.close(resolve)); // also closes the HTTP server
    await db.close();
    process.exit(0);
  } catch (err) {
    logger.error("error during shutdown", err);
    process.exit(1);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error("unhandled promise rejection", err));

if (require.main === module) {
  startServer();
}

module.exports = { app, server, io, startServer };
