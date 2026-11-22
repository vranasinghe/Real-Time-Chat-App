// Account-security calls: email verification and password reset. Thin wrappers over the
// shared API client so screens stay free of URLs and error plumbing.

import { apiJson } from "./api";

export interface AuthConfig {
  emailVerification: boolean;
  emailVerificationRequired?: boolean;
  passwordReset: boolean;
  /** The policy versions a new member must accept (undefined when the server could not be reached). */
  policies?: { terms: string; privacy: string };
}

/** What this server offers. If it can't be reached, assume nothing is available. */
export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    return await apiJson<AuthConfig>("/api/auth/config", { retry: true });
  } catch {
    return { emailVerification: false, passwordReset: false };
  }
}

export const requestEmailCode = () => apiJson("/api/auth/verify-email/request", { method: "POST" });

export const confirmEmailCode = (code: string) =>
  apiJson("/api/auth/verify-email/confirm", { method: "POST", body: JSON.stringify({ code }) });

export const requestPasswordReset = (email: string) =>
  apiJson("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: email.trim() }) });

export const confirmPasswordReset = (email: string, code: string, newPassword: string) =>
  apiJson("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), code, new_password: newPassword }),
  });
