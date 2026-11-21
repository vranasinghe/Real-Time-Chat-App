// Single source of truth for where the backend lives. Nothing else in the app reads
// EXPO_PUBLIC_* variables or builds backend URLs.
//
// EXPO_PUBLIC_* values are inlined at BUILD time, so changing one needs a rebuild
// (new `expo export` for web, new EAS build for native).
//
//   EXPO_PUBLIC_BACKEND_URL    Backend origin, used by native apps, sockets and images.
//                              Required in production builds. No default there.
//   EXPO_PUBLIC_WEB_API_BASE   Web only. Where the browser sends REST calls.
//                              Unset in production => same origin ("/api/..."), which the
//                              Vercel rewrite forwards to the backend, so the session
//                              cookie is first-party. Set to "" or a URL to override.

import { Platform } from "react-native";

export const IS_WEB = Platform.OS === "web";

const rawBackend = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").trim().replace(/\/+$/, "");

function devFallback(): string {
  // Only ever used in development (Metro / `expo start`), never in a production build.
  return Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
}

let backendUrl = rawBackend;
let configError: string | null = null;

if (!backendUrl) {
  if (__DEV__) {
    backendUrl = devFallback();
  } else {
    configError =
      "This build has no backend configured (EXPO_PUBLIC_BACKEND_URL is missing). Rebuild the app with it set.";
  }
} else if (!/^https?:\/\//i.test(backendUrl)) {
  configError = `EXPO_PUBLIC_BACKEND_URL must start with http:// or https:// (got "${backendUrl}").`;
  backendUrl = "";
} else if (!__DEV__) {
  if (/^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/|$)/i.test(backendUrl)) {
    configError = "Production build points at a local backend address. Set EXPO_PUBLIC_BACKEND_URL to your deployed backend.";
    backendUrl = "";
  } else if (!backendUrl.startsWith("https://")) {
    configError = "Production builds must use an https:// backend URL.";
    backendUrl = "";
  }
} else if (Platform.OS === "android" && backendUrl.includes("localhost")) {
  // The Android emulator reaches the host machine at 10.0.2.2
  backendUrl = backendUrl.replace("localhost", "10.0.2.2");
}

/** Backend origin: sockets, images and native REST calls. Empty string when misconfigured. */
export const BACKEND_URL = backendUrl;

/** Non-null when the app cannot talk to a backend. Surface this to the user. */
export const CONFIG_ERROR = configError;

const webApiOverride = process.env.EXPO_PUBLIC_WEB_API_BASE;

/**
 * Base for REST calls. Web production => "" (same origin, via the Vercel proxy).
 * Web development => the backend directly (localhost, same-site, so cookies work).
 * Native => the backend directly.
 */
export const API_BASE: string = IS_WEB
  ? typeof webApiOverride === "string"
    ? webApiOverride.trim().replace(/\/+$/, "")
    : __DEV__
      ? BACKEND_URL
      : ""
  : BACKEND_URL;

/** Photos stored in the database come back as "/api/images/<id>" */
export const resolveMediaUrl = (uri: string): string =>
  typeof uri === "string" && uri.startsWith("/") ? `${BACKEND_URL}${uri}` : uri;
