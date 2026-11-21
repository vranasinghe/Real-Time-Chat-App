// Minimal structured (JSON-lines) logger. Never pass passwords, tokens or
// request bodies to it.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function write(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

// Errors are logged by name/message/stack only (pg errors can carry query text).
const errFields = (err) =>
  err ? { err: { name: err.name, message: err.message, code: err.code, stack: err.stack } } : {};

module.exports = {
  debug: (msg, f) => write("debug", msg, f),
  info: (msg, f) => write("info", msg, f),
  warn: (msg, f) => write("warn", msg, f),
  error: (msg, err, f) => write("error", msg, { ...errFields(err), ...f }),
};
