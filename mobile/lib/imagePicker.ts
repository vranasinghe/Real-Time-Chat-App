// Platform adapter for choosing a profile photo.
//
// Native (Android/iOS) and web return different things from the picker:
//   - native: a file:// or content:// uri plus (when asked) base64 bytes
//   - web:    a data: URL (or blob:) plus base64 bytes, from a browser File
// Both are normalised to { uri, base64, mimeType } here, validated the same way, and the
// bytes are what gets uploaded, so the upload code never cares which platform it is on.
// The server re-checks everything (file signature, size, auth); these checks only give
// fast, friendly errors.

import * as ImagePicker from "expo-image-picker";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // keep in sync with backend/images.js

export interface PickedImage {
  /** For previewing (data: URL on web, file URI on native) */
  uri: string;
  /** Raw image bytes, base64 encoded, ready to upload */
  base64: string;
  mimeType: string;
}

export class ImagePickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePickError";
  }
}

const approxBytes = (base64: string) => Math.floor((base64.length * 3) / 4);

/** Opens the photo library. Resolves null if the user cancels; throws ImagePickError if the photo is unusable. */
export async function pickProfileImage(camera = false): Promise<PickedImage | null> {
  let result: ImagePicker.ImagePickerResult;
  try {
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new ImagePickError("Allow camera access to take a photo.");
    const pick = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    result = await pick({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.7, // re-encodes to JPEG, which also converts iPhone HEIC photos
      base64: true,
    });
  } catch {
    throw new ImagePickError("Could not open your photo library. Check the app's photo permission and try again.");
  }
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const dataUrl = asset.uri.startsWith("data:") ? asset.uri : null;
  const base64 = asset.base64 || (dataUrl ? dataUrl.slice(dataUrl.indexOf(",") + 1) : "");
  if (!base64) throw new ImagePickError("Could not read the selected photo.");

  const mimeType = (asset.mimeType || dataUrl?.slice(5, dataUrl.indexOf(";")) || "image/jpeg").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    throw new ImagePickError("Please choose a JPEG, PNG, WebP or GIF photo.");
  }
  if (approxBytes(base64) > MAX_IMAGE_BYTES) {
    throw new ImagePickError("That photo is larger than 5 MB. Please choose a smaller one.");
  }
  return { uri: asset.uri, base64, mimeType };
}
