// Helpers for profile photo lists (no other backend dependencies, to avoid circular requires).

// Matches our own image URLs, with or without host: /api/images/<uuid>
const IMAGE_PATH_RE = /\/api\/images\/([0-9a-f-]{36})(?:[?#].*)?$/i;

// Normalises a photo list from a client before it's saved on a profile:
// full URLs to our own images become "/api/images/<id>", other web URLs are kept,
// and device-only references (blob:, file:, content:, data:) are dropped.
function normalizePhotoList(photos) {
  if (!Array.isArray(photos)) return photos;
  return photos
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => {
      const own = p.match(IMAGE_PATH_RE);
      if (own) return `/api/images/${own[1].toLowerCase()}`;
      return p.trim();
    })
    .filter((p) => p.startsWith("/api/images/") || /^https?:\/\//i.test(p));
}

module.exports = { IMAGE_PATH_RE, normalizePhotoList };
