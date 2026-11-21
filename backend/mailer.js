// Sends transactional email through Resend (https://resend.com), if configured.
//
//   RESEND_API_KEY   API key (secret, server only)
//   MAIL_FROM        Verified sender, e.g. "Dateza <no-reply@yourdomain.com>"
//
// Without both, email features are DISABLED in production (the endpoints answer 503 and
// the app skips verification / hides password reset). Outside production the code is
// written to the log instead so local development works without an email account.

const config = require("./config");
const logger = require("./logger");

const providerConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

/** True when codes can actually be delivered (or logged, in development). */
const isEnabled = () => providerConfigured() || !config.isProduction;

async function sendMail({ to, subject, text }) {
  if (!providerConfigured()) {
    if (config.isProduction) throw new Error("email delivery is not configured");
    logger.info("dev mail (not sent)", { to, subject, text }); // development only
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    throw new Error(`mail provider rejected the message (${res.status})`);
  }
}

module.exports = { isEnabled, providerConfigured, sendMail };
