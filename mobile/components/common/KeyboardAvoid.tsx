import React from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

/** Keeps focused inputs visible above the on-screen keyboard (iOS and Android). No-op on web. */
export function KeyboardAvoid({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "web" ? undefined : "padding"}
      enabled={Platform.OS !== "web"}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
