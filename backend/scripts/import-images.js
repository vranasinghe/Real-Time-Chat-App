// Copies every profile photo into the database (`images` table) and points the
// profiles at "/api/images/<id>", so no photo depends on an outside website.
//
//   npm run images:import            uses DATABASE_URL from backend/.env
//
// Safe to run more than once: each source is stored only once, and photos that
// already live in the database are left alone.

const fs = require("fs");
const path = require("path");
const db = require("../db");
const { storeImage } = require("../images");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// Returns image bytes for a photo reference, or null if it can't be recovered
async function loadPhoto(ref) {
  // Files this backend serves from public/ (e.g. the demo photos), with or without host
  const publicMatch = ref.match(/^(?:https?:\/\/[^/]+)?\/public\/(.+)$/i);
  if (publicMatch) {
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(publicMatch[1])));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) return null;
    return { bytes: fs.readFileSync(file), source: `file:public/${publicMatch[1]}` };
  }
  if (/^https?:\/\//i.test(ref)) {
    return { bytes: await fetchBytes(ref), source: ref };
  }
  if (ref.startsWith("data:")) {
    return { bytes: Buffer.from(ref.slice(ref.indexOf(",") + 1), "base64"), source: null };
  }
  return null; // blob:, file:, content: ... only ever existed on one device
}

(async () => {
  await db.initDb(); // makes sure the images table exists

  const { rows: profiles } = await db.query("SELECT id, name, photos FROM profiles WHERE photos IS NOT NULL");
  let imported = 0;
  let alreadyStored = 0;
  let dropped = 0;
  const failures = [];

  for (const profile of profiles) {
    const next = [];
    let changed = false;

    for (const ref of profile.photos) {
      if (typeof ref === "string" && ref.startsWith("/api/images/")) {
        next.push(ref);
        alreadyStored += 1;
        continue;
      }
      try {
        const photo = await loadPhoto(ref);
        if (!photo) {
          dropped += 1;
          changed = true;
          console.log(`  dropped (not recoverable): ${profile.name}: ${String(ref).slice(0, 60)}`);
          continue;
        }
        const { url } = await storeImage(photo.bytes, { ownerId: profile.id, source: photo.source });
        next.push(url);
        imported += 1;
        changed = true;
      } catch (err) {
        // Keep the original reference so nothing is lost; re-run later to retry
        next.push(ref);
        failures.push(`${profile.name}: ${String(ref).slice(0, 60)} (${err.message})`);
      }
    }

    if (changed) {
      await db.query("UPDATE profiles SET photos = $1 WHERE id = $2", [next, profile.id]);
    }
  }

  const { rows } = await db.query("SELECT COUNT(*)::int AS images, COALESCE(SUM(bytes), 0)::bigint AS bytes FROM images");
  console.log(`\nProfiles checked: ${profiles.length}`);
  console.log(`Photos imported: ${imported}, already in database: ${alreadyStored}, dropped: ${dropped}, failed: ${failures.length}`);
  failures.forEach((f) => console.log(`  failed: ${f}`));
  console.log(`Images table: ${rows[0].images} images, ${(Number(rows[0].bytes) / 1024 / 1024).toFixed(2)} MB`);

  await db.pool.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (err) => {
  console.error("Import failed:", err);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
