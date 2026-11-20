import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { Platform } from "react-native";
import { DEMO_USER, DEMO_PROFILES, DEMO_LIKES_YOU } from "./demoData";

let BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "http://localhost:3000";
if (Platform.OS === "android" && BACKEND_URL.includes("localhost")) {
  BACKEND_URL = BACKEND_URL.replace("localhost", "10.0.2.2");
}

// Photos stored in the database come back as "/api/images/<id>"; images need a full URL
export const resolveMediaUrl = (uri: string): string =>
  typeof uri === "string" && uri.startsWith("/") ? `${BACKEND_URL}${uri}` : uri;

// Applies resolveMediaUrl to a profile's photos (null/undefined pass through)
function withMedia<T extends { photos?: string[] } | null | undefined>(profile: T): T {
  if (!profile || !Array.isArray(profile.photos)) return profile;
  return { ...profile, photos: profile.photos.map(resolveMediaUrl) };
}

// Global WebSocket reference
let socketConnection: Socket | null = null;

export interface Profile {
  id: string;
  email?: string;
  name: string;
  birthdate: string;
  gender: string;
  looking_for: string;
  bio: string;
  height_cm: number;
  interests: string[];
  photos: string[];
  lat?: number;
  lng?: number;
  is_online: boolean;
  match_percent?: number;
  swipe_message?: string;
}

export interface Swipe {
  id: string;
  swiper_id: string;
  swipee_id: string;
  direction: "like" | "pass" | "super";
  created_at: string;
}

export interface Match {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
  expires_at: string;
  other_user?: Profile; // Populated dynamically
  // From GET /api/matches/conversations
  last_message?: Message | null;
  unread_count?: number;
  other_last_read_message_id?: number;
}

export type MessageStatus = "sending" | "sent" | "failed";

export interface Message {
  // Server messages have a numeric id; messages not yet confirmed use "local-<client_id>"
  id: string | number;
  client_id?: string | null;
  match_id: string;
  sender_id: string;
  body: string;
  kind: "text" | "image" | "location";
  created_at: string;
  status?: MessageStatus; // Only set on the sender's device
}

export interface LiveDemoPersona {
  key: string;
  name: string;
  photo: string;
  bio: string;
}

export interface LiveDemoStatus {
  enabled: boolean;
  personas: LiveDemoPersona[];
}

export interface ThreadState {
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
}

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

export interface Story {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  media_url: string;
  media_type: "image" | "video";
  created_at: string;
}

interface AppState {
  // Auth & Session
  user: Profile | null;
  session: boolean;
  token: string | null;
  profileSetupComplete: boolean;
  isUsingSupabase: boolean; // Acts as "live database enabled" flag for backward compatibility
  isDemo: boolean; // Offline demo session: no backend, no sign-in, nothing leaves the device

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
  checkSupabaseConnection: () => boolean;
  signIn: (email: string, pass: string) => Promise<boolean>;
  signUp: (email: string, pass: string, name: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  enterDemoMode: () => Promise<void>;
  getLiveDemoStatus: () => Promise<LiveDemoStatus>;
  signInLiveDemo: (persona: string) => Promise<void>;
  uploadPhoto: (asset: { uri: string; base64?: string | null }) => Promise<string>;
  completeSetup: (profileData: Partial<Profile>) => Promise<void>;
  signOut: () => Promise<void>;
  createQuickMatch: (profile: Profile) => Promise<{ success: boolean; error?: string }>;

  // Swipe Actions
  recordSwipe: (swipeeId: string, direction: "like" | "pass" | "super", message?: string) => Promise<void>;
  clearActiveMatch: () => void;
  resetSwipes: () => void;

  // Chat Actions
  sendMessage: (matchId: string, body: string, kind?: "text" | "image" | "location") => Promise<void>;
  retryMessage: (clientId: string) => Promise<void>;
  receiveMessage: (message: Message) => void;
  loadMessagesForMatch: (matchId: string) => Message[];
  loadThread: (matchId: string) => Promise<void>;
  loadOlderMessages: (matchId: string) => Promise<void>;
  markThreadRead: (matchId: string) => Promise<void>;
  setActiveThread: (matchId: string | null) => void;
  getSocketConnection: () => Socket | null;

  // Story Actions
  addStory: (mediaUrl: string, mediaType: "image" | "video") => Promise<void>;
  deleteStory: (storyId: string) => Promise<void>;
}



export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      session: false,
      token: null,
      profileSetupComplete: false,
      isUsingSupabase: false,
      isDemo: false,
      profiles: [],
      likesYou: [],
      swipes: [],
      matches: [],
      messages: [],
      stories: [
        {
          id: "story-mock-liana-1",
          user_id: "seed-liana",
          user_name: "Liana Ray",
          user_avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
          media_url: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=600&auto=format&fit=crop&q=80",
          media_type: "image",
          created_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: "story-mock-elena-1",
          user_id: "seed-elena",
          user_name: "Elena",
          user_avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
          media_url: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&auto=format&fit=crop&q=80",
          media_type: "image",
          created_at: new Date(Date.now() - 7200000).toISOString(),
        }
      ],
      activeMatch: null,
      threads: {},
      activeThreadId: null,

      initializeStore: async () => {
        WebBrowser.maybeCompleteAuthSession();

        // A send that was in flight when the app closed never got confirmed
        set((state) => ({
          messages: state.messages.map((m) =>
            m.status === "sending" ? { ...m, status: "failed" as MessageStatus } : m
          ),
        }));
        // A demo session never talks to the backend, even if one is configured.
        const connected = get().checkSupabaseConnection() && !get().isDemo;
        set({ isUsingSupabase: connected });

        if (connected && get().token) {
          // Initialize WebSockets client
          get().getSocketConnection();

          // Verify token session validity
          try {
            const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${get().token}` },
            });
            if (res.ok) {
              const profile = await res.json();
              set({
                user: withMedia(profile),
                session: true,
                profileSetupComplete: !!profile.name && !!profile.birthdate,
              });
              await get().fetchMatches();
              await get().fetchLikesYou();
            } else {
              // Stale token, clear credentials
              await get().signOut();
            }
          } catch (e) {
            console.error("Session verification failed:", e);
          }
        }

        await get().fetchDiscoveryProfiles();
        await get().fetchLikesYou();
      },

      fetchDiscoveryProfiles: async () => {
        const { token, isUsingSupabase, isDemo } = get();
        if (isDemo) {
          set({ profiles: DEMO_PROFILES });
          return;
        }
        if (!token || !isUsingSupabase) {
          set({ profiles: [], swipes: [] });
          return;
        }

        try {
          const res = await fetch(`${BACKEND_URL}/api/profiles/discovery`, {
            headers: { Authorization: `Bearer ${token}` },
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
        const { token, isUsingSupabase, isDemo } = get();
        if (isDemo) {
          set({ likesYou: DEMO_LIKES_YOU });
          return;
        }
        if (!token || !isUsingSupabase) {
          set({ likesYou: [] });
          return;
        }

        try {
          const res = await fetch(`${BACKEND_URL}/api/profiles/likes-you`, {
            headers: { Authorization: `Bearer ${token}` },
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
        const { token, isUsingSupabase } = get();
        if (!token || !isUsingSupabase) return;

        // One request: matches + other user + last message + unread count.
        // Thread messages are loaded page by page when a chat is opened (loadThread).
        try {
          const res = await fetch(`${BACKEND_URL}/api/matches/conversations`, {
            headers: { Authorization: `Bearer ${token}` },
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

      checkSupabaseConnection: () => {
        // Returns true if backend URL environment is specified
        const url = process.env.EXPO_PUBLIC_BACKEND_URL;
        return !!url;
      },

      signIn: async (email, password) => {
        const isConnected = get().isUsingSupabase;
        if (isConnected) {
          const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });

          let data: any = {};
          try {
            const text = await res.text();
            data = text ? JSON.parse(text) : {};
          } catch (jsonErr) {
            data = { error: `Server error (${res.status}). Please try again.` };
          }
          if (!res.ok) throw new Error(data.error || data.message || "Login failed");

          set({
            token: data.token,
            user: withMedia(data.user),
            session: true,
            profileSetupComplete: !!data.user.name && !!data.user.birthdate,
          });

          // Connect WebSockets and load chat matches
          get().getSocketConnection();
          await get().fetchMatches();
          return true;
        }

        // Mock Sign-In Fallback
        const mockUser: Profile = {
          id: "current-user-mock-id",
          name: "Test User",
          birthdate: "1999-01-01",
          gender: "male",
          looking_for: "female",
          bio: "Just a default tester account.",
          height_cm: 180,
          interests: ["Tech", "Coffee", "Music"],
          photos: [],
          is_online: true,
        };

        set({
          user: mockUser,
          session: true,
          profileSetupComplete: true,
        });
        return true;
      },

      signUp: async (email, password, name) => {
        const isConnected = get().isUsingSupabase;
        if (isConnected) {
          const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name }),
          });

          let data: any = {};
          try {
            const text = await res.text();
            data = text ? JSON.parse(text) : {};
          } catch (jsonErr) {
            data = { error: `Server error (${res.status}). Please try again.` };
          }
          if (!res.ok) throw new Error(data.error || data.message || "Signup failed");

          set({
            token: data.token,
            user: withMedia(data.user),
            session: true,
            profileSetupComplete: false,
          });

          // Connect WebSockets
          get().getSocketConnection();
          return true;
        }

        // Mock Signup Fallback
        const newMockUser: Profile = {
          id: "current-user-mock-id",
          name: name,
          birthdate: "",
          gender: "",
          looking_for: "",
          bio: "",
          height_cm: 0,
          interests: [],
          photos: [],
          is_online: true,
        };

        set({
          user: newMockUser,
          session: true,
          profileSetupComplete: false,
        });
        return true;
      },

      signInWithGoogle: async () => {
        const isConnected = get().isUsingSupabase;
        if (!isConnected) {
          // Mock Sign-In Fallback for Google (Local development without backend)
          const mockGoogleUser: Profile = {
            id: "google-user-mock-id",
            email: "google-dev@example.com",
            name: "Google Developer",
            birthdate: "",
            gender: "",
            looking_for: "",
            bio: "",
            height_cm: 0,
            interests: [],
            photos: [],
            is_online: true,
          };
          set({
            user: mockGoogleUser,
            session: true,
            profileSetupComplete: false,
          });
          return true;
        }

        try {
          const redirectUrl = Linking.createURL("auth-callback");
          // Fetch Google OAuth Redirect URL from backend
          const res = await fetch(`${BACKEND_URL}/api/auth/google/url?redirect_uri=${encodeURIComponent(redirectUrl)}`);
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to generate Google URL");
          }

          const { url } = await res.json();
          
          // Open web auth session
          const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);
          
          if (result.type === "success" && result.url) {
            const parsed = Linking.parse(result.url);
            const token = parsed.queryParams?.token;
            const userStr = parsed.queryParams?.user;

            if (token && userStr) {
              const userObj = JSON.parse(decodeURIComponent(userStr as string));
              set({
                token: token as string,
                user: withMedia(userObj),
                session: true,
                profileSetupComplete: !!userObj.name && !!userObj.birthdate,
              });
              get().getSocketConnection();
              await get().fetchMatches();
              return true;
            }
          }
          return false;
        } catch (err) {
          console.error("Google login failed:", err);
          throw err;
        }
      },

      enterDemoMode: async () => {
        // Drop any live connection and start from a clean, local-only session.
        if (socketConnection) {
          socketConnection.disconnect();
          socketConnection = null;
        }
        set({
          isDemo: true,
          isUsingSupabase: false,
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
        if (!get().checkSupabaseConnection()) return { enabled: false, personas: [] };
        const res = await fetch(`${BACKEND_URL}/api/auth/demo/status`);
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return (await res.json()) as LiveDemoStatus;
      },

      signInLiveDemo: async (persona) => {
        const res = await fetch(`${BACKEND_URL}/api/auth/demo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Demo sign-in failed (${res.status})`);

        // Start from a clean session (drops any offline-demo or previous account state)
        if (socketConnection) {
          socketConnection.disconnect();
          socketConnection = null;
        }
        Object.keys(lastReadSent).forEach((k) => delete lastReadSent[k]);
        set({
          isDemo: false,
          isUsingSupabase: true,
          token: data.token,
          user: withMedia(data.user),
          session: true,
          profileSetupComplete: true,
          activeMatch: null,
          threads: {},
          activeThreadId: null,
          swipes: [],
          matches: [],
          messages: [],
          profiles: [],
          likesYou: [],
        });

        get().getSocketConnection();
        await get().fetchMatches();
        get().fetchDiscoveryProfiles();
        get().fetchLikesYou();
      },

      // Uploads a picked photo to the backend, which stores it in the database.
      // Returns a full URL to show and to save on the profile. Without a backend
      // (offline demo) the photo stays on this device.
      uploadPhoto: async (asset) => {
        const { token, isUsingSupabase } = get();
        if (!isUsingSupabase || !token) return asset.uri;

        const data = asset.base64 || (asset.uri.startsWith("data:") ? asset.uri : null);
        if (!data) throw new Error("Could not read the selected photo.");

        const res = await fetch(`${BACKEND_URL}/api/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ data }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
        return resolveMediaUrl(body.url);
      },

      completeSetup: async (profileData) => {
        const { user, token, isUsingSupabase } = get();
        if (!user) return;

        const updatedUser = { ...user, ...profileData };

        if (isUsingSupabase && token) {
          try {
            const res = await fetch(`${BACKEND_URL}/api/auth/complete-setup`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(profileData),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Profile setup update failed");
            
            set({
              user: withMedia(data.user),
              profileSetupComplete: true,
            });
          } catch (e) {
            console.error("Failed to sync setup wizard to backend:", e);
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
        if (socketConnection) {
          socketConnection.disconnect();
          socketConnection = null;
        }
        set({
          user: null,
          session: false,
          token: null,
          isDemo: false,
          profileSetupComplete: false,
          activeMatch: null,
          threads: {},
          activeThreadId: null,
          messages: [],
          matches: [],
          swipes: [],
        });
      },

      createQuickMatch: async (profile) => {
        const { user, token, isUsingSupabase } = get();
        if (!user) return { success: false, error: "Not signed in" };

        if (isUsingSupabase && token) {
          try {
            const res = await fetch(`${BACKEND_URL}/api/matches/quick`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
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
        const { user, token, isUsingSupabase, profiles } = get();
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

        if (isUsingSupabase && token) {
          try {
            const res = await fetch(`${BACKEND_URL}/api/swipes`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
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
        const { token, isUsingSupabase } = get();
        if (isUsingSupabase && token) {
          try {
            await fetch(`${BACKEND_URL}/api/swipes/reset`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` }
            });
          } catch (e) {
            console.error("Backend reset swipes failure", e);
          }
        }
        set({ swipes: [], activeMatch: null });
        await get().fetchDiscoveryProfiles();
      },

      sendMessage: async (matchId, body, kind = "text") => {
        const { user, token, isUsingSupabase } = get();
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
          created_at: new Date().toISOString(),
          status: isUsingSupabase && token ? "sending" : "sent",
        };

        // Show it immediately; the server copy replaces it when it arrives
        get().receiveMessage(optimistic);

        if (isUsingSupabase && token) {
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
        const { token, isUsingSupabase, threads } = get();
        if (!isUsingSupabase || !token) {
          set({ threads: { ...threads, [matchId]: { loaded: true, loading: false, hasMore: false } } });
          return;
        }
        if (threads[matchId]?.loading) return;
        set((s) => ({
          threads: { ...s.threads, [matchId]: { ...(s.threads[matchId] ?? { loaded: false, hasMore: true }), loading: true } },
        }));

        try {
          const res = await fetch(
            `${BACKEND_URL}/api/matches/${matchId}/messages?limit=${THREAD_PAGE_SIZE}`,
            { headers: { Authorization: `Bearer ${token}` } }
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
        const { token, isUsingSupabase, threads, messages } = get();
        const thread = threads[matchId];
        if (!isUsingSupabase || !token || !thread?.hasMore || thread.loading) return;

        const oldest = messages
          .filter((m) => m.match_id === matchId && isServerId(m.id))
          .reduce<number | null>((min, m) => (min === null || (m.id as number) < min ? (m.id as number) : min), null);
        if (oldest === null) return;

        set((s) => ({ threads: { ...s.threads, [matchId]: { ...thread, loading: true } } }));
        try {
          const res = await fetch(
            `${BACKEND_URL}/api/matches/${matchId}/messages?limit=${THREAD_PAGE_SIZE}&before=${oldest}`,
            { headers: { Authorization: `Bearer ${token}` } }
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
        const { user, token, isUsingSupabase, messages } = get();
        if (!user) return;

        set((s) => ({
          matches: s.matches.map((m) => (m.id === matchId && m.unread_count ? { ...m, unread_count: 0 } : m)),
        }));
        if (!isUsingSupabase || !token) return;

        const newest = messages
          .filter((m) => m.match_id === matchId && isServerId(m.id) && m.sender_id !== user.id)
          .reduce((max, m) => Math.max(max, m.id as number), 0);
        if (!newest || newest <= (lastReadSent[matchId] ?? 0)) return;

        lastReadSent[matchId] = newest;
        try {
          await fetch(`${BACKEND_URL}/api/matches/${matchId}/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ last_read_message_id: newest }),
          });
        } catch (e) {
          lastReadSent[matchId] = 0; // Try again next time
          console.error("Failed to mark thread read:", e);
        }
      },

      setActiveThread: (matchId) => set({ activeThreadId: matchId }),

      getSocketConnection: () => {
        const { token, isUsingSupabase } = get();
        if (!token || !isUsingSupabase) {
          if (socketConnection) {
            socketConnection.disconnect();
            socketConnection = null;
          }
          return null;
        }

        let conn = socketConnection;
        if (!conn) {
          conn = io(BACKEND_URL, {
            auth: { token },
            extraHeaders: {
              Authorization: `Bearer ${token}`,
            },
          });
          socketConnection = conn;

          // The server puts every socket in its user's personal room, so there are
          // no per-match rooms to join. On (re)connect, catch up on anything missed.
          conn.on("connect", () => {
            get().fetchMatches();
            const open = get().activeThreadId;
            if (open) get().loadThread(open);
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

          // A match was created (possibly by the other person): refresh the list
          conn.on("match_created", () => {
            get().fetchMatches();
          });
        }

        return socketConnection;
      },

      addStory: async (mediaUrl: string, mediaType: "image" | "video") => {
        const { user } = get();
        if (!user) return;

        const newStory: Story = {
          id: `story-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          user_id: user.id,
          user_name: user.name || "My Story",
          user_avatar: (user.photos && user.photos.length > 0) ? user.photos[0] : "https://i.pravatar.cc/150?img=47",
          media_url: mediaUrl,
          media_type: mediaType,
          created_at: new Date().toISOString(),
        };

        set((state) => ({
          stories: [newStory, ...state.stories],
        }));
      },

      deleteStory: async (storyId: string) => {
        set((state) => ({
          stories: state.stories.filter((s) => s.id !== storyId),
        }));
      },
    }),
    {
      name: "dateza-app-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Prevent trying to serialize the live socket connection reference
      partialize: (state) => ({
        user: state.user,
        session: state.session,
        token: state.token,
        profileSetupComplete: state.profileSetupComplete,
        isUsingSupabase: state.isUsingSupabase,
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

// Sends (or re-sends) a message to the backend. The client_id makes retries safe:
// the server returns the stored copy instead of creating a duplicate.
async function postMessage(msg: Message): Promise<void> {
  const { token } = useAppStore.getState();
  const markFailed = () =>
    useAppStore.setState((state) => ({
      messages: state.messages.map((m) =>
        m.client_id === msg.client_id && !isServerId(m.id) ? { ...m, status: "failed" as MessageStatus } : m
      ),
    }));

  if (!token) {
    markFailed();
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/matches/${msg.match_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
