// Holds the latest onboarding state from the server for the setup screens. Nothing here is persisted:
// the server is the source of truth, so closing the app and opening it again resumes from the server's
// answer (GET /api/onboarding), on any device.

import { create } from "zustand";
import { ApiError } from "./api";
import { completeOnboarding, getOnboarding, saveOnboardingStep } from "./onboardingApi";
import type { OnboardingState, StepId } from "./onboardingApi";
import { useAppStore } from "./store";

interface OnboardingStore {
  state: OnboardingState | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<OnboardingState | null>;
  save: (step: StepId, body: Record<string, unknown>) => Promise<OnboardingState>;
  complete: () => Promise<OnboardingState>;
  reset: () => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export const useOnboarding = create<OnboardingStore>((set) => ({
  state: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const state = await getOnboarding();
      set({ state, loading: false });
      return state;
    } catch (e) {
      set({ loading: false, error: message(e) });
      return null;
    }
  },

  // Throws the server's error (ApiError) so the screen can show it next to the field; the state is
  // refreshed when the server says something that changes it (for example: under 18).
  save: async (step, body) => {
    try {
      const state = await saveOnboardingStep(step, body);
      set({ state });
      return state;
    } catch (e) {
      if (e instanceof ApiError && e.code === "underage") {
        try {
          set({ state: await getOnboarding() });
        } catch {
          /* the message from the failed save is shown anyway */
        }
      }
      throw e;
    }
  },

  complete: async () => {
    const state = await completeOnboarding();
    set({ state });
    // The server now says eligible: refresh the member (opens real-time, loads matches and discovery).
    await useAppStore.getState().refreshProfile();
    return state;
  },

  reset: () => set({ state: null, loading: false, error: null }),
}));
