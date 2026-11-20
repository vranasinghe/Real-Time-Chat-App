import type { Profile } from "./store";

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
  p("demo-liana", "Liana Ray", "2001-03-14", "female", "male",
    "Looking for someone to join me on a sunrise hike or a late-night diner run. I make a mean sourdough.",
    167, ["Hiking", "Baking", "Sunrises", "Road Trips"],
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80", true, 92),
  p("demo-elena", "Elena", "2001-08-15", "female", "male",
    "Art director & coffee enthusiast. Let's explore local galleries and talk about modern architecture over pour-overs.",
    168, ["Art", "Coffee", "Design", "Museums"],
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80", true, 88),
  p("demo-aria", "Aria", "1999-11-20", "female", "everyone",
    "Avid reader, sci-fi fan, and yoga lover. Looking for genuine conversations that last way past midnight.",
    165, ["Reading", "Yoga", "Cinema", "Sci-Fi", "Music"],
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&auto=format&fit=crop&q=80", true, 85),
  p("demo-chloe", "Chloe", "2000-06-25", "female", "male",
    "Fashion blogger & photography student. Capture life in frames. Tell me your favorite film stock.",
    170, ["Fashion", "Photography", "Cinema", "Writing"],
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&auto=format&fit=crop&q=80", false, 81),
  p("demo-sophia", "Sophia", "1998-01-08", "female", "male",
    "Marine biologist & amateur surfer. The ocean is my second home. Let's find our favourite shoreline together.",
    163, ["Ocean", "Surfing", "Science", "Travel", "Documentaries"],
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&auto=format&fit=crop&q=80", true, 79),
  p("demo-marcus", "Marcus", "1998-04-12", "male", "female",
    "Weekend hiker and amateur chef. Seeking someone to share new recipes with, or escape to the mountains on Friday nights.",
    182, ["Cooking", "Hiking", "Travel", "Nature", "Fitness"],
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&auto=format&fit=crop&q=80", false, 76),
  p("demo-dev", "Dev", "1996-02-05", "male", "female",
    "Software engineer by day, live music seeker by night. Always down for street tacos and experimental electronic sets.",
    175, ["Music", "Tech", "Tacos", "Festivals", "Running"],
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80", true, 74),
  p("demo-nina", "Nina", "2000-12-17", "female", "everyone",
    "Musician and street artist. I paint walls, play bass, and drink way too much iced coffee. Come find me.",
    162, ["Music", "Art", "Bass Guitar", "Coffee", "Street Art"],
    "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&auto=format&fit=crop&q=80", true, 72),
  p("demo-james", "James", "1995-07-11", "male", "female",
    "Architect with a weakness for jazz bars and bookstores. Probably sketching something. Let's design something together.",
    185, ["Architecture", "Jazz", "Books", "Design", "Coffee"],
    "https://images.unsplash.com/photo-1463453091185-61582044d556?w=600&auto=format&fit=crop&q=80", true, 70),
];

/** Profiles that have already liked the demo user ("Likes You" tab). */
export const DEMO_LIKES_YOU: Profile[] = DEMO_PROFILES.slice(0, 3).map((profile) => ({
  ...profile,
  swipe_message: "Hey! Love your profile. Coffee sometime?",
}));
