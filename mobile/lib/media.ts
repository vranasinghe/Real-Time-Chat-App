import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { API_BASE, BACKEND_URL } from "./config";
import { authFetch } from "./api";

export const MEDIA_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const isMediaActive = (item: { created_at: string; expires_at?: string | null }, now = Date.now()) =>
  now < (item.expires_at ? Date.parse(item.expires_at) : Date.parse(item.created_at) + MEDIA_LIFETIME_MS);

export function privateMediaSource(uri: string, token: string | null) {
  const url = uri.startsWith("/api/media/") ? `${Platform.OS === "web" ? API_BASE : BACKEND_URL}${uri}` : uri;
  // Only attach credentials to this app's private endpoint, never to external URLs.
  return { uri: url, ...(Platform.OS !== "web" && token && uri.startsWith("/api/media/") ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
}

// Web live-demo sessions carry a per-tab bearer token instead of the shared cookie, and an <img>/<video>
// element cannot send an Authorization header. So on web with a token, download the private file with the
// header and show it from a temporary blob URL. Everywhere else the normal source is used unchanged.
// Returns null while the file is loading (or if it could not be loaded).
export function usePrivateMediaSource(uri: string, token: string | null) {
  const needsFetch = Platform.OS === "web" && !!token && uri.startsWith("/api/media/");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    setBlobUrl(null);
    if (!needsFetch) return;
    let alive = true;
    let created: string | null = null;
    authFetch(uri)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob(); })
      .then(blob => { if (alive) { created = URL.createObjectURL(blob); setBlobUrl(created); } })
      .catch(() => {});
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [uri, needsFetch]);
  if (needsFetch) return blobUrl ? { uri: blobUrl } : null;
  return privateMediaSource(uri, token);
}

export async function uploadEphemeralMedia(uri: string, type: "image" | "video", purpose: "chat" | "story", matchId?: string) {
  let bytes: Uint8Array;
  if (Platform.OS !== "web" && /^(file|content):/.test(uri)) {
    const { File } = await import("expo-file-system");
    bytes = await new File(uri).bytes();
  } else {
    const response = await fetch(uri);
    if (!response.ok) throw new Error("Could not read the selected file.");
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const limit = (type === "video" ? 25 : 5) * 1024 * 1024;
  if (!bytes.length || bytes.length > limit) throw new Error(type === "video" ? "Videos must be 25 MB or smaller." : "Photos must be 5 MB or smaller.");
  const query = `purpose=${purpose}${matchId ? `&matchId=${encodeURIComponent(matchId)}` : ""}`;
  const response = await authFetch(`/api/media?${query}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not upload media.");
  return data as { id: string; url: string; expires_at: string; media_type: "image" | "video" };
}
