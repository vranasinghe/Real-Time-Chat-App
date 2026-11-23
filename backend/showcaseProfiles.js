const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const profiles = require("./data/showcase-profiles.json");

// Additive, development-only samples. Existing users, original seeds, and the two
// live demo personas are untouched. The seed id makes startup idempotent.
async function seedShowcaseProfiles(query, { demo = false } = {}) {
  const password = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  for (const p of profiles) {
    await query(
      `INSERT INTO profiles (id, email, password, name, birthdate, gender, looking_for, bio, height_cm, interests, photos, is_online, is_demo, email_verified_at, profile_completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [`${demo ? "demo" : "seed"}-showcase-${p.key}`, `${p.key}.${demo ? "demo" : "showcase"}@dateza.local`, password, p.name, p.birthdate, p.gender,
        p.looking_for, p.bio, p.height_cm, p.interests, (p.photo_files || [`${p.key}.png`]).map((file) => `/public/profiles/${file}`), false, demo]
    );
  }
}

module.exports = { seedShowcaseProfiles };
