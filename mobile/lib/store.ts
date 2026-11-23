import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";

import { DEMO_USER, DEMO_PROFILES, DEMO_LIKES_YOU } from "./demoData";
import { BACKEND_URL, CONFIG_ERROR, IS_WEB, resolveMediaUrl } from "./config";
import { ApiError, apiJson, authFetch, configureApi, fetchSocketTicket } from "./api";
import { clearToken, loadToken, peekTabToken, saveToken } from "./tokenStore";
import { isMediaActive, MEDIA_LIFETIME_MS, uploadEphemeralMedia } from "./media";

export { resolveMediaUrl };

import type {
  Profile, Swipe, Match, Message, MessageStatus, LiveDemoPersona, LiveDemoStatus, ThreadState, Story,
} from "./types";
export type {
  Profile, Swipe, Match, Message, MessageStatus, LiveDemoPersona, LiveDemoStatus, ThreadState, Story,
};

// Applies resolveMediaUrl to a profile's photos (null/undefined pass through)
// The API can send photos/interests as null (e.g. profiles that never finished setup).
// Normalize to arrays so screens can safely read photos[0] / interests.map.
function withMedia<T extends { photos?: string[] | null; interests?: string[] | null } | null | undefined>(profile: T): T {
  if (!profile) return profile;
  return {
    ...profile,
    photos: Array.isArray(profile.photos) ? profile.photos.filter(Boolean).map(resolveMediaUrl) : [],
    interests: Array.isArray(profile.interests) ? profile.interests : [],
  };
}

// Global WebSocket reference
let socketConnection: Socket | null = null;









const THREAD_PAGE_SIZE = 30;

// RFC 4122 v4 id used to make sends idempotent
const generateClientId = (): string => {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const sameMessage = (a: Message, b: Message) =>
  String(a.id) === String(b.id) || (!!a.client_id && a.client_id === b.client_id);

const isServerId = (id: Message["id"]) => typeof id === "number";

const newerOf = (a: Message | null | undefined, b: Message | null | undefined) => {
  if (!a) return b ?? null;
  if (!b) return a;
  if (isServerId(a.id) && isServerId(b.id)) return (b.id as number) > (a.id as number) ? b : a;
  return new Date(b.created_at).getTime() >= new Date(a.created_at).getTime() ? b : a;
};

// Highest read pointer we've already sent per match, so we don't spam the server
const lastReadSent: Record<string, number> = {};


interface AppState {
  // Auth & Session
  user: Profile | null;
  session: boolean;
  token: string | null; // Native: persisted in secure storage. Web: null, except a per-tab live demo session (sessionStorage).
  profileSetupComplete: boolean;
  isDemo: boolean; // Offline demo session: no backend, no sign-in, nothing leaves the device (explicitly chosen)
  isInitialized: boolean; // Persisted state loaded and the stored session located (not persisted)
  socketConnected: boolean; // Live socket status (not persisted)

  // App Data
  profiles: Profile[];
  likesYou: Profile[];
  swipes: Swipe[];
  matches: Match[];
  messages: Message[];
  stories: Story[];

  // Interactive Flow States
  activeMatch: { match: Match; profile: Profile } | null;

  // Chat
  threads: Record<string, ThreadState>; // Paging state per match (not persisted)
  activeThreadId: string | null; // Thread currently on screen: its messages don't count as unread

  // Actions
  initializeStore: () => Promise<void>;
  fetchDiscoveryProfiles: () => Promise<void>;
  fetchMatches: () => Promise<void>;
  fetchLikesYou: () => Promise<void>;
  signIn: (email: string, pass: string) => Promise<boolean>;
  signUp: (email: string, pass: string, name: string, birthdate: string, policies: { terms: string; privacy: string }) => Promise<boolean>;
  /** Re-reads the member from the server (verification status, eligibility) and opens real-time if now eligible. */
  refreshProfile: () => Promise<void>;
  signInWithGoogle: () => Promise<boolean>;
  enterDemoMode: () => Promise<void>;
  getLiveDemoStatus: () => Promise<LiveDemoStatus>;
  signInLiveDemo: (persona: string) => Promise<void>;
  uploadPhoto: (asset: { uri: string; base64?: string | null }) => Promise<string>;
  completeSetup: (profileData: Partial<Profile>) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  createQuickMatch: (profile: Profile) => Promise<{ success: boolean; error?: string }>;

  // Swipe Actions
  recordSwipe: (swipeeId: string, direction: "like" | "pass" | "super", message?: string) => Promise<void>;
  clearActiveMatch: () => void;
  resetSwipes: () => void;

  // Chat Actions
  sendMessage: (matchId: string, body: string, kind?: "text" | "image" | "location", expiresAt?: string) => Promise<void>;
  retryMessage: (clientId: string) => Promise<void>;
  receiveMessage: (message: Message) => void;
  loadMessagesForMatch: (matchId: string) => Message[];
  loadThread: (matchId: string) => Promise<void>;
  loadOlderMessages: (matchId: string) => Promise<void>;
  markThreadRead: (matchId: string) => Promise<void>;
  setActiveThread: (matchId: string | null) => void;
  getSocketConnection: () => Socket | null;
  resumeConnection: () => Promise<void>;

  // Story Actions
  addStory: (mediaUrl: string, mediaType: "image" | "video") => Promise<void>;
  deleteStory: (storyId: string) => Promise<void>;
  fetchStories: () => Promise<void>;
  expireMedia: () => void;
}



// Dating features are open only when the SERVER says so (eligibility from /api/auth/me, login, ...).
const isEligible = (u?: Profile | null) => !!u?.eligibility?.eligible;

// PKCE helpers for the Google sign-in (the verifier never leaves the device except in the final exchange).
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
async function makePkce() {
  const verifier = toHex(await Crypto.getRandomBytesAsync(48)); // 96 characters, all unreserved
  const base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  const challenge = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  account_suspended: "This account is suspended.",
  account_banned: "This account has been closed for breaking the community rules.",
  account_closed: "This account is closed.",
  sign_in_failed: "Google sign-in failed. Make sure your Google address is verified and try again.",
};

// A real (backend-backed) session: signed in and not the offline demo
const isLiveSession = (s: { session: boolean; isDemo: boolean }) => s.session && !s.isDemo;

const waitForHydration = () =>
  new Promise<void>((resolve) => {
    if (useAppStore.persist.hasHydrated()) return resolve();
    const unsub = useAppStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });

function disconnectSocket() {
  if (socketConnection) {
    socketConnection.removeAllListeners();
    socketConnection.disconnect();
    socketConnection = null;
  }
}

function resetRealtime() {
  disconnectSocket();
  Object.keys(lastReadSent).forEach((k) => delete lastReadSent[k]);
}

// Wipes everything tied to the signed-in user, in memory and on disk. Used for logout,
// expired sessions and switching accounts. Never touches the network.
async function clearSessionLocal() {
  resetRealtime();
  await clearToken();
  useAppStore.setState({
    user: null,
    session: false,
    token: null,
    isDemo: false,
    socketConnected: false,
    profileSetupComplete: false,
    activeMatch: null,
    threads: {},
    activeThreadId: null,
    messages: [],
    matches: [],
    swipes: [],
    profiles: [],
    likesYou: [],
    stories: [],
  });
}

// Starts a fresh session from a login / sign-up response, discarding any previous
// account or offline-demo state first.
async function establishSession(data: { token?: string; user: Profile }, profileSetupComplete: boolean) {
  let token: string | null = null;
  if (!IS_WEB) {
    if (!data.token) throw new ApiError("The server did not return a session. Please try again.", "parse");
    token = data.token;
    await saveToken(token);
  } else if (data.token) {
    // Web live demo: a per-tab session (see tokenStore.ts)
    token = data.token;
    await saveToken(token);
  } else {
    // Web cookie session: drop any demo token this tab had, or it would win over the cookie
    await clearToken();
  }
  resetRealtime();
  useAppStore.setState({
    isDemo: false,
    token,
    user: withMedia(data.user),
    session: true,
    profileSetupComplete,
    activeMatch: null,
    threads: {},
    activeThreadId: null,
    swipes: [],
    matches: [],
    messages: [],
    profiles: [],
    likesYou: [],
    stories: [],
  });
  useAppStore.getState().getSocketConnection();
}

// Only one sign-in / sign-up at a time: a double tap gets the first request's result.
let authInFlight: Promise<any> | null = null;
function runExclusiveAuth<T>(task: () => Promise<T>): Promise<T> {
  if (authInFlight) return authInFlight;
  const run = task().finally(() => {
    authInFlight = null;
  });
  authInFlight = run;
  return run;
}

// Confirms the stored session with the backend. A rejected session is cleared; a
// server that is unreachable keeps the saved session so the app still opens offline.
async function verifySession() {
  try {
    const profile = await apiJson<Profile>("/api/auth/me", { retry: true });
    useAppStore.setState({
      user: withMedia(profile),
      profileSetupComplete: isEligible(profile),
    });
    const store = useAppStore.getState();
    store.getSocketConnection();
    if (isEligible(profile)) {
      await Promise.all([store.fetchMatches(), store.fetchDiscoveryProfiles(), store.fetchLikesYou(), store.fetchStories()]);
    }
  } catch (e) {
    if (e instanceof ApiError && e.kind === "http" && (e.status === 401 || e.status === 404)) {
      await clearSessionLocal();
    } else {
      console.warn("Could not verify the saved session; continuing with saved data", e);
      useAppStore.getState().getSocketConnection();
    }
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      session: false,
      token: null,
      profileSetupComplete: false,
      isDemo: false,
      isInitialized: false,
      socketConnected: false,
      profiles: [],
      likesYou: [],
      swipes: [],
      matches: [],
      messages: [],
      stories: [],
      activeMatch: null,
      threads: {},
      activeThreadId: null,

      initializeStore: async () => {
        WebBrowser.maybeCompleteAuthSession();
        await waitForHydration();
        get().expireMedia();

        // A send that was in flight when the app closed never got confirmed
        set((state) => ({
          messages: state.messages.map((m) =>
            m.status === "sending" ? { ...m, status: "failed" as MessageStatus } : m
          ),
        }));

        // The offline demo was explicitly chosen and never talks to the backend.
        if (get().isDemo) {
          set({ profiles: DEMO_PROFILES, likesYou: DEMO_LIKES_YOU, isInitialized: true });
          return;
        }

        // Native: the session token lives in secure storage. Older builds kept it in
        // AsyncStorage; move it over once.
        if (!IS_WEB) {
          let token = await loadToken();
          const legacy = get().token;
          if (!token && legacy) {
            token = legacy;
            await saveToken(legacy).catch(() => {});
          }
          set({ token });
        } else {
          // Web: a live demo session belongs to this tab only (null for cookie sessions)
          set({ token: await loadToken() });
        }

        const { session, token } = get();
        if (!session && IS_WEB && token) {
          // The saved state is shared by every tab, so another tab may have signed out.
          // This tab still has its own demo session: restore it before showing anything.
          set({ session: true, isDemo: false });
          await verifySession();
          set({ isInitialized: true });
          return;
        }
        if (session && !IS_WEB && !token) {
          // Signed in according to saved state, but the credential is gone
          await clearSessionLocal();
        } else if (!session) {
          await clearToken();
          set({ profiles: [], likesYou: [] });
        }
        set({ isInitialized: true });

        // Check the stored session with the server in the background so the UI isn't
        // blocked while a sleeping free-tier backend wakes up.
        if (get().session) void verifySession();
      },

      fetchDiscoveryProfiles: async () => {
        const { isDemo } = get();
        const isLive = isLiveSession(get());
        if (isDemo) {
          set({ profiles: DEMO_PROFILES });
          return;
        }
        if (!isLive) {
          set({ profiles: [], swipes: [] });
          return;
        }

        try {
          const res = await authFetch(`/api/profiles/discovery`, {
          });
          const data = await res.json();
          if (res.ok) {
            set({ profiles: (data as Profile[]).map(withMedia) });
          }
        } catch (e) {
          console.error("Failed to fetch discovery profiles from Express:", e);
          set({ profiles: [] });
        }
      },

      fetchLikesYou: async () => {
        const { isDemo } = get();
        const isLive = isLiveSession(get());
        if (isDemo) {
          set({ likesYou: DEMO_LIKES_YOU });
          return;
        }
        if (!isLive) {
          set({ likesYou: [] });
          return;
        }

        try {
          const res = await authFetch(`/api/profiles/likes-you`, {
          });
          const data = await res.json();
          if (res.ok) {
            set({ likesYou: (data as Profile[]).map(withMedia) });
          }
        } catch (e) {
          console.error("Failed to fetch likes-you profiles from Express:", e);
        }
      },

      fetchMatches: async () => {
        const isLive = isLiveSession(get());
        if (!isLive) return;

        // One request: matches + other user + last message + unread count.
        // Thread messages are loaded page by page when a chat is opened (loadThread).
        try {
          const res = await authFetch(`/api/matches/conversations`, {
          });
          if (res.ok) {
            const matchesData: Match[] = await res.json();
            const { activeThreadId } = get();
            set({
              matches: matchesData.map((m) =>
                // The open thread is being read right now
                ({
                  ...m,
                  other_user: withMedia(m.other_user),
                  ...(m.id === activeThreadId ? { unread_count: 0 } : {}),
                })
              ),
            });
          }
        } catch (e) {
          console.error("Failed to fetch conversations:", e);
        }
      },

      signIn: async (email, password) => {
        return runExclusiveAuth(async () => {
          const data = await apiJson<{ token?: string; user: Profile }>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: email.trim(), password }),
            retry: true,
          });
          await establishSession(data, isEligible(data.user));
          if (isEligible(data.user)) await get().fetchMatches();
          return true;
        });
      },

      signUp: async (email, password, name, birthdate, policies) => {
        return runExclusiveAuth(async () => {
          const data = await apiJson<{ token?: string; user: Profile }>("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ email: email.trim(), password, name: name.trim(), birthdate, accepted_policies: policies }),
          });
          await establishSession(data, isEligible(data.user));
          return true;
        });
      },

      refreshProfile: async () => {
        if (!isLiveSession(get())) return;
        const profile = await apiJson<Profile>("/api/auth/me");
        set({ user: withMedia(profile), profileSetupComplete: isEligible(profile) });
        if (isEligible(profile)) {
          get().getSocketConnection();
          await Promise.all([get().fetchMatches(), get().fetchDiscoveryProfiles(), get().fetchLikesYou(), get().fetchStories()]);
        }
      },

      signInWithGoogle: async () => {
        if (CONFIG_ERROR) throw new ApiError(CONFIG_ERROR, "config");
        if (IS_WEB) {
          throw new Error("Google sign-in is not available on the web version yet. Please use email and password.");
        }
        return runExclusiveAuth(async () => {
          // 1. PKCE: only the challenge goes to the server now; the verifier stays here until the exchange.
          const { verifier, challenge } = await makePkce();
          const redirectUrl = Linking.createURL("auth-callback");
          const { url } = await apiJson<{ url: string }>(
            `/api/auth/google/url?redirect_uri=${encodeURIComponent(redirectUrl)}&code_challenge=${challenge}&code_challenge_method=S256`
          );

          const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);
          if (result.type !== "success" || !result.url) return false;

          // 2. The redirect carries ONLY a short-lived one-time code (or an error), never a token or a profile.
          const parsed = Linking.parse(result.url);
          const error = parsed.queryParams?.error;
          if (typeof error === "string") throw new Error(GOOGLE_ERRORS[error] || "Google sign-in failed.");
          const code = parsed.queryParams?.code;
          if (typeof code !== "string") return false;

          // 3. Trade the code (plus the PKCE verifier) for the real session.
          const data = await apiJson<{ token?: string; user: Profile }>("/api/auth/oauth/exchange", {
            method: "POST",
            body: JSON.stringify({ code, code_verifier: verifier }),
          });
          await establishSession(data, isEligible(data.user));
          if (isEligible(data.user)) await get().fetchMatches();
          return true;
        });
      },

      // Offline demo: explicitly chosen, local only, never mixes with a real account.
      enterDemoMode: async () => {
        resetRealtime();
        await clearToken();
        set({
          isDemo: true,
          token: null,
          user: DEMO_USER,
          session: true,
          profileSetupComplete: true,
          activeMatch: null,
          threads: {},
          activeThreadId: null,
          swipes: [],
          matches: [],
          messages: [],
          profiles: DEMO_PROFILES,
          likesYou: DEMO_LIKES_YOU,
        });
      },

      // Live demo: shared, pre-matched accounts on the real backend, so two devices
      // can chat in real time without signing up.
      getLiveDemoStatus: async () => {
        if (CONFIG_ERROR) return { enabled: false, personas: [] };
        return apiJson<LiveDemoStatus>("/api/auth/demo/status", { retry: true });
      },

      signInLiveDemo: async (persona) => {
        await runExclusiveAuth(async () => {
          const data = await apiJson<{ token?: string; user: Profile }>("/api/auth/demo", {
            method: "POST",
            body: JSON.stringify({ persona }),
          });
          await establishSession(data, isEligible(data.user));
          if (isEligible(data.user)) {
            await get().fetchMatches();
            get().fetchDiscoveryProfiles();
            get().fetchLikesYou();
          }
          return true;
        });
      },

      // Uploads a picked photo to the backend, which stores it in the database.
      // Returns a full URL to show and to save on the profile. Without a backend
      // (offline demo) the photo stays on this device.
      uploadPhoto: async (asset) => {
        const isLive = isLiveSession(get());
        if (!isLive) return asset.uri;

        const data = asset.base64 || (asset.uri.startsWith("data:") ? asset.uri : null);
        if (!data) throw new Error("Could not read the selected photo.");

        const res = await authFetch(`/api/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
        return resolveMediaUrl(body.url);
      },

      completeSetup: async (profileData) => {
        const { user } = get();
        const isLive = isLiveSession(get());
        if (!user) return;

        const updatedUser = { ...user, ...profileData };

        if (isLive) {
          try {
            const res = await authFetch(`/api/auth/complete-setup`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(profileData),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Profile update failed");
            
            // Completion is decided by the server (eligibility), never by this call succeeding.
            set({
              user: withMedia(data.user),
              profileSetupComplete: isEligible(data.user),
            });
          } catch (e) {
            console.error("Failed to save the profile:", e);
            throw e;
          }
        } else {
          set({
            user: updatedUser,
            profileSetupComplete: true,
          });
        }

        // Refetch discovery profiles matching new preference settings
        await get().fetchDiscoveryProfiles();
      },

      signOut: async () => {
        const wasLive = isLiveSession(get());
        // Ask the server to clear the web cookie (native just discards its token).
        // Never let a network failure keep the user signed in locally.
        if (wasLive) {
          try {
            await authFetch("/api/auth/logout", { method: "POST" });
          } catch (e) {
            console.warn("Logout request failed; signing out locally", e);
          }
        }
        await clearSessionLocal();
      },

      // Changes the password on the server. Every OTHER device is signed out; this one gets
      // a fresh session (web: new cookie; native: new token saved to secure storage).
      changePassword: async (current, next) => {
        if (!isLiveSession(get())) throw new Error("Sign in with a real account to change its password.");
        const data = await apiJson<{ token?: string }>("/api/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ current_password: current, new_password: next }),
        });
        if (!IS_WEB) {
          if (!data.token) throw new ApiError("The server did not return a new session. Please sign in again.", "parse");
          await saveToken(data.token);
          set({ token: data.token });
        }
        // The old socket used the old session: reconnect with the new one
        disconnectSocket();
        get().getSocketConnection();
      },

      createQuickMatch: async (profile) => {
        const { user } = get();
        const isLive = isLiveSession(get());
        if (!user) return { success: false, error: "Not signed in" };

        if (isLive) {
          try {
            const res = await authFetch(`/api/matches/quick`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ profile_id: profile.id }),
            });
            const data = await res.json();
            if (res.ok) {
              set((state) => {
                const matchExists = state.matches.some((m) => m.id === data.id);
                if (matchExists) return {};
                return { matches: [{ ...data, other_user: withMedia(data.other_user) }, ...state.matches] };
              });
              // Connect socket to match room
              const socket = get().getSocketConnection();
              if (socket) {
                socket.emit("join_room", data.id);
              }
              return { success: true };
            }
            return { success: false, error: data.error || "Could not start a chat with this profile" };
          } catch (e) {
            console.error("Backend quick match creation failed", e);
            return { success: false, error: "Could not start a chat with this profile" };
          }
        } else {
          // Fallback to local memory mock match
          const newMatch: Match = {
            id: `match-quick-${Date.now()}`,
            user_a: user.id,
            user_b: profile.id,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            other_user: profile,
          };
          set((state) => {
            const matchExists = state.matches.some((m) => m.user_b === profile.id);
            if (matchExists) return {};
            return { matches: [newMatch, ...state.matches] };
          });
          return { success: true };
        }
      },

      recordSwipe: async (swipeeId, direction, message) => {
        const { user, profiles } = get();
        const isLive = isLiveSession(get());
        if (!user) return;

        const newSwipe: Swipe = {
          id: Math.random().toString(),
          swiper_id: user.id,
          swipee_id: swipeeId,
          direction,
          created_at: new Date().toISOString(),
        };

        set((state) => ({
          swipes: [...state.swipes, newSwipe],
        }));

        if (isLive) {
          try {
            const res = await authFetch(`/api/swipes`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ swipee_id: swipeeId, direction, message }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Recording swipe failed");

            if (data.activeMatch) {
              set((state) => ({
                matches: [data.activeMatch.match, ...state.matches],
                activeMatch: { ...data.activeMatch, profile: withMedia(data.activeMatch.profile) },
              }));
              // Connect socket to the match room
              const socket = get().getSocketConnection();
              if (socket) {
                socket.emit("join_room", data.activeMatch.match.id);
              }
            }
            await get().fetchDiscoveryProfiles();
            await get().fetchLikesYou();
          } catch (e) {
            console.error("Express swipe insert failure", e);
          }
        } else {
          // Mock Match Logic: 60% chance of a match if they "like" or "super" a mock profile
          if (direction === "like" || direction === "super") {
            const matches = get().matches;
            const alreadyMatched = matches.some((m) => m.user_b === swipeeId || m.user_a === swipeeId);
            if (alreadyMatched) return;

            const shouldMatch = Math.random() < 0.6;
            if (shouldMatch) {
              const matchedProfile = profiles.find((p) => p.id === swipeeId);
              if (matchedProfile) {
                const newMatch: Match = {
                  id: `match-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  user_a: user.id,
                  user_b: swipeeId,
                  created_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                  other_user: matchedProfile,
                };
                
                set((state) => ({
                  matches: [newMatch, ...state.matches],
                  activeMatch: { match: newMatch, profile: matchedProfile },
                }));
              }
            }
          }
        }
      },


      clearActiveMatch: () => set({ activeMatch: null }),

      resetSwipes: async () => {
        const isLive = isLiveSession(get());
        if (isLive) {
          try {
            await authFetch(`/api/swipes/reset`, {
              method: "POST",
            });
          } catch (e) {
            console.error("Backend reset swipes failure", e);
          }
        }
        set({ swipes: [], activeMatch: null });
        await get().fetchDiscoveryProfiles();
      },

      sendMessage: async (matchId, body, kind = "text", expiresAt) => {
        const { user } = get();
        const isLive = isLiveSession(get());
        const text = body.trim();
        if (!user || !text) return;

        const clientId = generateClientId();
        const optimistic: Message = {
          id: `local-${clientId}`,
          client_id: clientId,
          match_id: matchId,
          sender_id: user.id,
          body: text,
          kind,
          ...(kind === "image" ? { expires_at: expiresAt || new Date(Date.now() + MEDIA_LIFETIME_MS).toISOString() } : {}),
          created_at: new Date().toISOString(),
          status: isLive ? "sending" : "sent",
        };

        // Show it immediately; the server copy replaces it when it arrives
        get().receiveMessage(optimistic);

        if (isLive) {
          await postMessage(optimistic);
          return;
        }

        // Offline / demo mode: simulate the match replying
        setTimeout(() => {
          const match = get().matches.find((m) => m.id === matchId);
          const partnerName = match?.other_user?.name || "Match";
          get().receiveMessage({
            id: `msg-reply-${Date.now()}`,
            match_id: matchId,
            sender_id: match?.user_b === user.id ? match.user_a : match?.user_b || "partner-id",
            body: `Hey! That sounds awesome. This is a simulated real-time response from ${partnerName}! ⚡`,
            kind: "text",
            created_at: new Date().toISOString(),
          });
        }, 2500);
      },

      retryMessage: async (clientId) => {
        const msg = get().messages.find((m) => m.client_id === clientId);
        if (!msg || msg.status !== "failed") return;
        set((state) => ({
          messages: state.messages.map((m) =>
            m.client_id === clientId ? { ...m, status: "sending" as MessageStatus } : m
          ),
        }));
        await postMessage(msg);
      },

      // Single entry point for every message: optimistic, HTTP response, socket push, mock reply.
      // De-duplicates by server id or client_id, keeps the chat list's last message and
      // unread count in sync.
      receiveMessage: (message) => {
        set((state) => {
          const me = state.user?.id;
          const idx = state.messages.findIndex((m) => sameMessage(m, message));
          let messages: Message[];
          let isNew = false;

          if (idx === -1) {
            messages = [...state.messages, message];
            isNew = true;
          } else {
            const existing = state.messages[idx];
            // A confirmed server copy always wins over the local optimistic one
            if (isServerId(existing.id) && !isServerId(message.id)) return {};
            messages = [...state.messages];
            messages[idx] = {
              ...existing,
              ...message,
              status: message.sender_id === me ? message.status ?? "sent" : undefined,
            };
          }

          const fromOther = message.sender_id !== me;
          const matches = state.matches.map((m) => {
            if (m.id !== message.match_id) return m;
            const countsAsUnread = isNew && fromOther && state.activeThreadId !== m.id;
            return {
              ...m,
              last_message: newerOf(m.last_message, message),
              unread_count: countsAsUnread ? (m.unread_count ?? 0) + 1 : m.unread_count,
            };
          });

          return { messages, matches };
        });
      },

      loadMessagesForMatch: (matchId) => {
        return get().messages.filter((m) => m.match_id === matchId);
      },

      // Loads the newest page of a thread and merges it with what we have locally
      loadThread: async (matchId) => {
        const { threads } = get();
        const isLive = isLiveSession(get());
        if (!isLive) {
          set({ threads: { ...threads, [matchId]: { loaded: true, loading: false, hasMore: false } } });
          return;
        }
        if (threads[matchId]?.loading) return;
        set((s) => ({
          threads: { ...s.threads, [matchId]: { ...(s.threads[matchId] ?? { loaded: false, hasMore: true }), loading: true } },
        }));

        try {
          const res = await authFetch(
            `/api/matches/${matchId}/messages?limit=${THREAD_PAGE_SIZE}`
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const page: Message[] = await res.json();

          set((s) => {
            // Keep unconfirmed local messages; replace server messages for this thread
            const keep = s.messages.filter((m) => m.match_id !== matchId || !isServerId(m.id));
            const pending = keep.filter((m) => !page.some((p) => sameMessage(p, m)));
            const threadState = s.threads[matchId];
            return {
              messages: [...pending, ...page],
              threads: {
                ...s.threads,
                [matchId]: {
                  loaded: true,
                  loading: false,
                  // Keep "has older" knowledge if we'd already paged further back
                  hasMore: threadState?.loaded ? threadState.hasMore || page.length === THREAD_PAGE_SIZE : page.length === THREAD_PAGE_SIZE,
                },
              },
            };
          });
        } catch (e) {
          console.error("Failed to load thread:", e);
          set((s) => ({ threads: { ...s.threads, [matchId]: { loaded: true, loading: false, hasMore: s.threads[matchId]?.hasMore ?? false } } }));
        }
      },

      loadOlderMessages: async (matchId) => {
        const { threads, messages } = get();
        const isLive = isLiveSession(get());
        const thread = threads[matchId];
        if (!isLive || !thread?.hasMore || thread.loading) return;

        const oldest = messages
          .filter((m) => m.match_id === matchId && isServerId(m.id))
          .reduce<number | null>((min, m) => (min === null || (m.id as number) < min ? (m.id as number) : min), null);
        if (oldest === null) return;

        set((s) => ({ threads: { ...s.threads, [matchId]: { ...thread, loading: true } } }));
        try {
          const res = await authFetch(
            `/api/matches/${matchId}/messages?limit=${THREAD_PAGE_SIZE}&before=${oldest}`
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const page: Message[] = await res.json();
          set((s) => ({
            messages: [...page.filter((p) => !s.messages.some((m) => sameMessage(m, p))), ...s.messages],
            threads: { ...s.threads, [matchId]: { loaded: true, loading: false, hasMore: page.length === THREAD_PAGE_SIZE } },
          }));
        } catch (e) {
          console.error("Failed to load older messages:", e);
          set((s) => ({ threads: { ...s.threads, [matchId]: { ...thread, loading: false } } }));
        }
      },

      // Marks everything the other person sent in this thread as read
      markThreadRead: async (matchId) => {
        const { user, messages } = get();
        const isLive = isLiveSession(get());
        if (!user) return;

        set((s) => ({
          matches: s.matches.map((m) => (m.id === matchId && m.unread_count ? { ...m, unread_count: 0 } : m)),
        }));
        if (!isLive) return;

        const newest = messages
          .filter((m) => m.match_id === matchId && isServerId(m.id) && m.sender_id !== user.id)
          .reduce((max, m) => Math.max(max, m.id as number), 0);
        if (!newest || newest <= (lastReadSent[matchId] ?? 0)) return;

        lastReadSent[matchId] = newest;
        try {
          await authFetch(`/api/matches/${matchId}/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ last_read_message_id: newest }),
          });
        } catch (e) {
          lastReadSent[matchId] = 0; // Try again next time
          console.error("Failed to mark thread read:", e);
        }
      },

      setActiveThread: (matchId) => set({ activeThreadId: matchId }),

      getSocketConnection: () => {
        // Real-time messaging only opens for members the server says are eligible.
        if (!isLiveSession(get()) || CONFIG_ERROR || !get().profileSetupComplete) {
          disconnectSocket();
          return null;
        }

        let conn = socketConnection;
        if (!conn) {
          conn = io(BACKEND_URL, {
            reconnection: true,
            reconnectionDelayMax: 10000,
            // Called on every (re)connect attempt. Web gets a fresh single-use ticket
            // (its session lives in an HttpOnly cookie); native sends its access token.
            auth: (cb) => {
              if (IS_WEB) {
                fetchSocketTicket()
                  .then((ticket) => cb({ ticket }))
                  .catch(() => cb({}));
              } else {
                cb({ token: get().token });
              }
            },
          });
          socketConnection = conn;

          // The server puts every socket in its user's personal room, so there are
          // no per-match rooms to join. On (re)connect, catch up on anything missed.
          conn.on("connect", () => {
            set({ socketConnected: true });
            get().fetchMatches();
            void get().fetchStories();
            const open = get().activeThreadId;
            if (open) get().loadThread(open);
          });

          conn.on("disconnect", () => set({ socketConnected: false }));
          conn.on("stories_changed", () => { void get().fetchStories(); });
          conn.on("media_expired", (event: { match_id: string }) => {
            get().expireMedia();
            void get().fetchMatches();
            if (get().activeThreadId === event.match_id) void get().loadThread(event.match_id);
          });

          conn.on("new_message", (message: Message) => {
            get().receiveMessage(message);
            // Reading the thread right now: tell the sender it's been seen
            if (get().activeThreadId === message.match_id) {
              get().markThreadRead(message.match_id);
            }
          });

          conn.on("messages_read", (evt: { match_id: string; user_id: string; last_read_message_id: number }) => {
            set((state) => ({
              matches: state.matches.map((m) => {
                if (m.id !== evt.match_id) return m;
                if (evt.user_id === state.user?.id) return { ...m, unread_count: 0 }; // Read on another device
                return {
                  ...m,
                  other_last_read_message_id: Math.max(m.other_last_read_message_id ?? 0, evt.last_read_message_id),
                };
              }),
            }));
          });

          // A match came online / went offline (sent only to their matches)
          conn.on("status_change", (evt: { userId: string; is_online: boolean }) => {
            set((state) => ({
              matches: state.matches.map((m) =>
                m.other_user?.id === evt.userId ? { ...m, other_user: { ...m.other_user, is_online: evt.is_online } } : m
              ),
            }));
          });

          // A match was created (possibly by the other person): refresh the list
          conn.on("match_created", () => {
            get().fetchMatches();
          });
        }

        return socketConnection;
      },

      // The app came back to the foreground (or the network returned): reconnect the
      // socket if the OS dropped it, and catch up on anything missed meanwhile.
      resumeConnection: async () => {
        get().expireMedia();
        if (!isLiveSession(get())) return;
        const conn = get().getSocketConnection();
        if (conn && !conn.connected) conn.connect();
        await get().fetchMatches();
        await get().fetchStories();
        const open = get().activeThreadId;
        if (open) await get().loadThread(open);
      },

      fetchStories: async () => {
        get().expireMedia();
        if (!isLiveSession(get())) return;
        const accountId = get().user?.id;
        try {
          const stories = await apiJson<Story[]>("/api/stories");
          if (get().user?.id === accountId && isLiveSession(get())) set({ stories: stories.filter(story => isMediaActive(story)).map(story => ({ ...story, user_avatar: resolveMediaUrl(story.user_avatar) })) });
        } catch (error) { console.warn("Could not refresh statuses", error); }
      },

      expireMedia: () => set(state => {
        const messages = state.messages.filter(message => message.kind !== "image" || isMediaActive(message));
        return {
          stories: state.stories.filter(story => isMediaActive(story)),
          messages,
          matches: state.matches.map(match => match.last_message?.kind === "image" && !isMediaActive(match.last_message)
            ? { ...match, last_message: messages.filter(message => message.match_id === match.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null } : match),
        };
      }),

      addStory: async (mediaUrl: string, mediaType: "image" | "video") => {
        const { user } = get();
        if (!user) throw new Error("Sign in to add a status.");
        let newStory: Story;
        if (isLiveSession(get())) {
          const media = await uploadEphemeralMedia(mediaUrl, mediaType, "story");
          newStory = await apiJson<Story>("/api/stories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_id: media.id }) });
          newStory.user_avatar = resolveMediaUrl(newStory.user_avatar);
        } else {
          newStory = {
            id: `story-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            user_id: user.id, user_name: user.name || "My Story", user_avatar: user.photos?.[0] || "",
            media_url: mediaUrl, media_type: mediaType, created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + MEDIA_LIFETIME_MS).toISOString(),
          };
        }
        if (get().user?.id === user.id) set(state => ({ stories: [newStory, ...state.stories.filter(story => story.id !== newStory.id && isMediaActive(story))] }));
      },

      deleteStory: async (storyId: string) => {
        if (isLiveSession(get())) await apiJson(`/api/stories/${storyId}`, { method: "DELETE" });
        set(state => ({ stories: state.stories.filter(story => story.id !== storyId) }));
      },
    }),
    {
      name: "dateza-app-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Prevent trying to serialize the live socket connection reference
      partialize: (state) => ({
        user: state.user,
        session: state.session,
        profileSetupComplete: state.profileSetupComplete,
        isDemo: state.isDemo,
        // threads / activeThreadId are session-only
        swipes: state.swipes,
        matches: state.matches,
        messages: state.messages,
        stories: state.stories,
      }),
    }
  )
);

configureApi({
  // Web: read the tab token directly too, so requests made before initializeStore finishes
  // (e.g. a chat screen opened by reloading the page) still carry this tab's demo session.
  getToken: () => useAppStore.getState().token ?? peekTabToken(),
  // The server rejected our session (expired / revoked): drop it and show the sign-in flow
  onUnauthorized: () => {
    if (isLiveSession(useAppStore.getState())) void clearSessionLocal();
  },
});

// Sends (or re-sends) a message to the backend. The client_id makes retries safe:
// the server returns the stored copy instead of creating a duplicate.
async function postMessage(msg: Message): Promise<void> {
  const markFailed = () =>
    useAppStore.setState((state) => ({
      messages: state.messages.map((m) =>
        m.client_id === msg.client_id && !isServerId(m.id) ? { ...m, status: "failed" as MessageStatus } : m
      ),
    }));

  if (!isLiveSession(useAppStore.getState())) {
    markFailed();
    return;
  }

  try {
    const res = await authFetch(`/api/matches/${msg.match_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: msg.body, kind: msg.kind, client_id: msg.client_id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
    useAppStore.getState().receiveMessage({ ...data, status: "sent" });
  } catch (e) {
    console.error("Send message failed:", e);
    markFailed();
  }
}
