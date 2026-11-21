// Where the long-lived session token lives.
//
// Native (Android / iOS): the OS secure store (Keystore / Keychain) via expo-secure-store.
// Web: nowhere. The web session is an HttpOnly cookie the browser manages and
// JavaScript cannot read, so there is no token to store.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "dateza.session.token";
const isNative = Platform.OS !== "web";

export async function loadToken(): Promise<string | null> {
  if (!isNative) return null;
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch (e) {
    console.warn("Secure storage read failed", e);
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  if (!isNative) return;
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  if (!isNative) return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch (e) {
    console.warn("Secure storage delete failed", e);
  }
}
