// Server-driven onboarding (backend: GET/PATCH /api/onboarding, POST /api/onboarding/complete).
// The server owns the truth: which steps are confirmed, what is missing, and when a profile is complete.
// The app only shows the steps and sends the answers; it never marks itself complete.

import { apiJson } from "./api";

export type StepId =
  | "consent"
  | "basics"
  | "verify_email"
  | "birthday"
  | "gender"
  | "interested_in"
  | "intention"
  | "photos"
  | "interests"
  | "about"
  | "preferences";

export interface OnboardingStep {
  id: StepId;
  required: boolean;
  done: boolean;
}

export interface OnboardingState {
  complete: boolean;
  /** The step the member should see next, or "review" when every step is confirmed. */
  next_step: StepId | "review";
  steps: OnboardingStep[];
  profile: {
    name: string;
    birthdate: string | null;
    gender: string | null;
    looking_for: string | null;
    relationship_intention: string | null;
    /** Relative image paths ("/api/images/<id>") the member uploaded. */
    photos: string[];
    interests: string[];
    bio: string;
    height_cm: number | null;
    min_age: number | null;
    max_age: number | null;
  };
  email: { address: string; verified: boolean; required: boolean; delivery_available: boolean };
  consent: { current_versions: { terms: string; privacy: string }; accepted: { terms: boolean; privacy: boolean } };
  photos: { minimum: number; recommended: number; maximum: number };
  birthdate_locked: boolean;
  underage: boolean;
  missing: string[];
  can_complete: boolean;
  eligibility: { eligible: boolean; reasons: string[] };
  options: { genders: string[]; interested_in: string[]; intentions: string[] };
}

export const getOnboarding = () => apiJson<OnboardingState>("/api/onboarding", { retry: true });

export const saveOnboardingStep = (step: StepId, body: Record<string, unknown>) =>
  apiJson<OnboardingState>(`/api/onboarding/${step}`, { method: "PATCH", body: JSON.stringify(body) });

export const completeOnboarding = () => apiJson<OnboardingState>("/api/onboarding/complete", { method: "POST" });

/** Where each step lives in the app. */
export function routeFor(step: StepId | "review"): string {
  switch (step) {
    case "consent": return "/profile-setup/consent";
    case "basics": return "/profile-setup/basics";
    case "verify_email": return "/auth/verify-code";
    case "birthday": return "/profile-setup/birthday";
    case "gender": return "/profile-setup/gender";
    case "interested_in": return "/profile-setup/interested-in";
    case "intention": return "/profile-setup/intention";
    case "photos": return "/profile-setup/photos";
    case "interests": return "/profile-setup/interests";
    case "about": return "/profile-setup/about";
    case "preferences": return "/profile-setup/preferences";
    default: return "/profile-setup/review";
  }
}

/** "/api/images/<id>" from a full image URL (the server only accepts the relative form). */
export function relativeImagePath(url: string): string | null {
  const m = /\/api\/images\/[0-9a-f-]{36}/i.exec(url);
  return m ? m[0].toLowerCase() : null;
}

export const GENDER_LABELS: Record<string, string> = { male: "Man", female: "Woman", non_binary: "Non-binary", other: "Another gender" };
export const INTERESTED_IN_LABELS: Record<string, string> = { male: "Men", female: "Women", everyone: "Everyone" };
export const INTENTION_LABELS: Record<string, string> = {
  long_term: "A long-term relationship",
  short_term: "Something casual",
  friendship: "New friends",
  figuring_out: "Still figuring it out",
};
