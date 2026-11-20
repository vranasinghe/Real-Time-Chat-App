const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const db = require("./db");

const auth = require("./auth");
const profiles = require("./profiles");
const swipes = require("./swipes");
const matches = require("./matches");
const demo = require("./demo");
const images = require("./images");

require("dotenv").config();

const app = express();
const server = http.createServer(app);

// Behind a hosting proxy (Render sets RENDER=true), trust its X-Forwarded-* headers
// so rate limits apply per visitor instead of to everyone sharing the proxy's IP.
if (process.env.RENDER || process.env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// Comma-separated list of allowed origins, e.g. "https://dateza.app,https://www.dateza.app"
// Falls back to "*" only when unset, which should never happen in production.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : "*";

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

// Configure CORS, security headers, and JSON parsing
app.use(helmet());
app.use(cors({ origin: corsOrigin }));

// Images: mounted before the global JSON parser because uploads need a larger
// body limit (the default is 100 KB). Has its own upload rate limit.
app.use("/api/images", images.router);

app.use(express.json());

// Static images (e.g. demo profile photos). The app runs on a different origin,
// so allow cross-origin loading, which helmet blocks by default.
app.use(
  "/public",
  express.static(path.join(__dirname, "public"), {
    maxAge: "7d",
    setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
  })
);

// Rate limit auth endpoints to slow down credential stuffing / brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100, // Increased for development testing
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300, // Increased for development testing
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// Set socketio reference on app
app.set("socketio", io);

// Mount API endpoints
app.use("/api/auth/demo", demo.router); // One-tap live demo login (DEMO_LOGIN_ENABLED=true)
app.use("/api/auth", auth.router);
app.use("/api/profiles", profiles);
app.use("/api/swipes", swipes);
app.use("/api/matches", matches);

// Root test endpoint
app.get("/", (req, res) => {
  res.json({ message: "Dateza Node.js Express Backend is running." });
});


// Authenticate every socket connection with the same JWT used for REST calls
io.use((socket, next) => {
  const headerToken = socket.handshake.headers.authorization?.split(" ")[1];
  const token = socket.handshake.auth?.token || headerToken;

  if (!token) {
    return next(new Error("Authentication token is missing"));
  }

  jwt.verify(token, auth.JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error("Authentication token is invalid or expired"));
    }
    socket.data.userId = decoded.id;
    next();
  });
});

// WebSocket Server Events
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id, "user:", socket.data.userId);

  // Every socket joins its owner's personal room. Chat events are delivered to
  // `user:<id>` rooms, so a client receives messages for all of its matches
  // (including brand-new ones) without having to join per-match rooms.
  socket.join(`user:${socket.data.userId}`);

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
      console.log(`Socket ${socket.id} joined room: ${matchId}`);
    } catch (err) {
      console.error("join_room authorization check failed:", err);
    }
  });

  // Leave a match chat room
  socket.on("leave_room", (matchId) => {
    if (matchId) {
      socket.leave(matchId);
      console.log(`Socket ${socket.id} left room: ${matchId}`);
    }
  });

  // Heartbeat/Online status synchronization — always the authenticated user, never client-supplied
  socket.on("user_online", async () => {
    const userId = socket.data.userId;
    await db.query("UPDATE profiles SET is_online = true WHERE id = $1", [userId]);
    io.emit("status_change", { userId, is_online: true });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

// Initialize Database and launch server
const startServer = async () => {
  await db.initDb();
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
