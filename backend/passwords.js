// Password hashing. New hashes use bcrypt cost 12. Existing hashes (any cost) keep
// verifying, and are upgraded to the current cost the next time that user logs in.

const bcrypt = require("bcryptjs");

const COST = 12;
const MIN_LENGTH = 8;
const MAX_LENGTH = 72; // bcrypt ignores anything after 72 bytes

const hashPassword = (password) => bcrypt.hash(password, COST);

const needsRehash = (hash) => {
  try {
    return bcrypt.getRounds(hash) < COST;
  } catch {
    return false;
  }
};

const STRENGTH_MESSAGE = "Use an upper and a lower case letter, a number and a symbol";

/**
 * Returns an error message, or null when the password is acceptable.
 * Same rule as the checklist in the app (mobile/lib/validation.ts): 8 to 72 characters, an upper and a
 * lower case letter, a number and a symbol. The server enforces it; the app only previews it.
 */
function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters long`;
  }
  if (password.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters long`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return STRENGTH_MESSAGE;
  }
  return null;
}

module.exports = { COST, MIN_LENGTH, MAX_LENGTH, hashPassword, needsRehash, passwordProblem };
