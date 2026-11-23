// Where the long-lived session token lives.
//
// Native (Android / iOS): the OS secure store (Keystore / Keychain) via expo-secure-store.
// Web: normally nowhere. The web session is an HttpOnly cookie the browser manages and
// JavaScript cannot read. The one exception is the shared live demo (Alex / Elena):
// a cookie is shared by every tab, so two personas in two tabs would overwrite each
// other. Demo sessions on web therefore use a token kept in this tab's sessionStorage.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "dateza.session.token";
const isNative = Platform.OS !== "web";

function tabStorage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null; // storage blocked (privacy mode)
  }
}

/** Web only, synchronous: this tab's demo token, readable before the store has initialized. */
export function peekTabToken(): string | null {
  if (isNative) return null;
  try {
    return tabStorage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export async function loadToken(): Promise<string | null> {
  if (!isNative) {
    try {
      return tabStorage()?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch (e) {
    console.warn("Secure storage read failed", e);
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  if (!isNative) {
    try {
      tabStorage()?.setItem(KEY, token);
    } catch (e) {
      console.warn("Tab storage write failed", e); // still works in memory for this page load
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  if (!isNative) {
    try {
      tabStorage()?.removeItem(KEY);
    } catch {
      /* nothing stored */
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch (e) {
    console.warn("Secure storage delete failed", e);
  }
}
