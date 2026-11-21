// The one HTTP client. Every backend call goes through authFetch / apiJson, so web
// and native share the same behaviour:
//   - web:    cookie session (credentials: include) + CSRF header, no token in JS
//   - native: Authorization: Bearer <token from secure storage>
//   - timeouts, one retry for network failures, friendly errors, central 401 handling

import { API_BASE, CONFIG_ERROR, IS_WEB } from "./config";

export type ApiErrorKind = "http" | "network" | "timeout" | "config" | "parse";

export class ApiError extends Error {
  status: number;
  code?: string;
  kind: ApiErrorKind;
  constructor(message: string, kind: ApiErrorKind, status = 0, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 30000; // free hosting can take ~30s to wake up
const NETWORK_RETRY_DELAY_MS = 1500;

type Hooks = {
  getToken: () => string | null;
  onUnauthorized: () => void;
};
let hooks: Hooks = { getToken: () => null, onUnauthorized: () => {} };

/** Called once by the store so this module needs no import of it. */
export function configureApi(next: Hooks) {
  hooks = next;
}

// Failed credentials here are not "your session expired"
const NO_SESSION_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/signup",
  "/api/auth/logout",
  "/api/auth/demo",
  "/api/auth/google",
];
const isAnonymousPath = (path: string) => NO_SESSION_PATHS.some((p) => path.startsWith(p));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new ApiError("The server took too long to respond. It may be waking up, so please try again.", "timeout");
    }
    throw new ApiError("Can't reach the server. Check your connection and try again.", "network");
  } finally {
    clearTimeout(timer);
  }
}

export interface RequestOptions extends RequestInit {
  /** Retry once when the request never reached the server. Only for requests safe to repeat. */
  retry?: boolean;
}

/** Drop-in replacement for fetch(): takes "/api/..." paths and returns a Response. */
export async function authFetch(path: string, init: RequestOptions = {}): Promise<Response> {
  if (CONFIG_ERROR) throw new ApiError(CONFIG_ERROR, "config");

  const { retry, ...rest } = init;
  const method = (rest.method || "GET").toUpperCase();
  const headers = new Headers(rest.headers as HeadersInit | undefined);
  // The store may still pass a stale Authorization header; the client owns this header.
  headers.delete("Authorization");

  if (IS_WEB) {
    headers.set("X-Client-Platform", "web");
    headers.set("X-Requested-With", "dateza"); // CSRF: needs a CORS preflight, so other sites can't send it
  } else {
    const token = hooks.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const request: RequestInit = {
    ...rest,
    method,
    headers,
    credentials: IS_WEB ? "include" : "omit",
  };
  const url = `${API_BASE}${path}`;

  let res: Response;
  try {
    res = await fetchOnce(url, request);
  } catch (e) {
    const canRetry = (retry ?? method === "GET") && e instanceof ApiError && e.kind !== "config";
    if (!canRetry) throw e;
    await sleep(NETWORK_RETRY_DELAY_MS);
    res = await fetchOnce(url, request);
  }

  if (res.status === 401 && !isAnonymousPath(path)) hooks.onUnauthorized();
  return res;
}

/** Calls the API and returns parsed JSON, throwing ApiError with the server's message otherwise. */
export async function apiJson<T = any>(path: string, init: RequestOptions = {}): Promise<T> {
  const res = await authFetch(path, init);
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.ok
          ? "The server sent an unexpected response. Is the backend URL / web proxy configured correctly?"
          : `Server error (${res.status}). Please try again.`,
        "parse",
        res.status
      );
    }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || data?.message || `Request failed (${res.status})`, "http", res.status, data?.code);
  }
  return data as T;
}

/** Fetches a short-lived, single-use ticket for opening a socket on web. */
export async function fetchSocketTicket(): Promise<string> {
  const { ticket } = await apiJson<{ ticket: string }>("/api/auth/socket-ticket", { method: "POST" });
  return ticket;
}
