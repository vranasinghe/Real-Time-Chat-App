// Keep the offline bundle self-contained and the backend deployable on its own.
// Run from any directory after changing backend/data/showcase-profiles.json or its photos.
const fs = require("node:fs");
const path = require("node:path");
const profiles = require("../data/showcase-profiles.json");
const destination = path.join(__dirname, "../../mobile/assets/profiles");
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(path.join(__dirname, "../data/showcase-profiles.json"), path.join(destination, "catalog.json"));
for (const profile of profiles) {
  for (const file of profile.photo_files || [`${profile.key}.png`]) {
    fs.copyFileSync(path.join(__dirname, "../public/profiles", file), path.join(destination, file));
  }
}
console.log(`Synced ${profiles.length} showcase profiles and photos to the offline app.`);
