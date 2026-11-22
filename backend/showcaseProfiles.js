const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const profiles = require("./data/showcase-profiles.json");

// Additive, development-only samples. Existing users, original seeds, and the two
// live demo personas are untouched. The seed id makes startup idempotent.
async function seedShowcaseProfiles(query) {
  const password = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  for (const p of profiles) {
    await query(
      `INSERT INTO profiles (id, email, password, name, birthdate, gender, looking_for, bio, height_cm, interests, photos, is_online)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [`seed-showcase-${p.key}`, `${p.key}.showcase@dateza.local`, password, p.name, p.birthdate, p.gender,
        p.looking_for, p.bio, p.height_cm, p.interests, (p.photo_files || [`${p.key}.png`]).map((file) => `/public/profiles/${file}`), p.is_online]
    );
  }
}

module.exports = { seedShowcaseProfiles };
