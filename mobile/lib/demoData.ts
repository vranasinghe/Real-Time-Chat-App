import type { Profile } from "./store";
import { SHOWCASE_PROFILES } from "./showcaseProfiles";

/**
 * Offline demo content. Used by "Try Demo" so the app can be explored
 * with no backend, no sign-in and no sign-up.
 */

export const DEMO_USER: Profile = {
  id: "demo-user",
  email: "demo@dateza.app",
  name: "Demo User",
  birthdate: "1998-05-15",
  gender: "male",
  looking_for: "everyone",
  bio: "Exploring Dateza in demo mode. Nothing here is saved to a server.",
  height_cm: 178,
  interests: ["Music", "Travel", "Coffee", "Hiking"],
  photos: [
    "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=600&auto=format&fit=crop&q=80",
  ],
  is_online: true,
};

const p = (
  id: string,
  name: string,
  birthdate: string,
  gender: string,
  looking_for: string,
  bio: string,
  height_cm: number,
  interests: string[],
  photo: string,
  is_online: boolean,
  match_percent: number
): Profile => ({
  id,
  name,
  birthdate,
  gender,
  looking_for,
  bio,
  height_cm,
  interests,
  photos: [photo],
  is_online,
  match_percent,
});

export const DEMO_PROFILES: Profile[] = [
  ...SHOWCASE_PROFILES,
];

/** Profiles that have already liked the demo user ("Likes You" tab). */
export const DEMO_LIKES_YOU: Profile[] = DEMO_PROFILES.filter((profile) => !profile.id.startsWith("demo-showcase-")).slice(0, 3).map((profile) => ({
  ...profile,
  swipe_message: "Hey! Love your profile. Coffee sometime?",
}));
