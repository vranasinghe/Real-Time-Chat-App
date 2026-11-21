// Shared data shapes (mirror the backend API). Used by the store, screens and components.

export type MessageStatus = "sending" | "sent" | "failed";

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
  expires_at?: string | null;
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

export interface Story {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  media_url: string;
  media_type: "image" | "video";
  created_at: string;
  expires_at?: string;
}
