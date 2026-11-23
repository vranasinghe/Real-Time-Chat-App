import React from "react";
import { Image, ImageProps } from "expo-image";
import { useAppStore } from "@/lib/store";
import { usePrivateMediaSource } from "@/lib/media";

/** An expo-image for a private /api/media file (chat photos, statuses). Handles every platform's auth. */
export function PrivateImage({ uri, ...props }: Omit<ImageProps, "source"> & { uri: string }) {
  const token = useAppStore(state => state.token);
  const source = usePrivateMediaSource(uri, token);
  return <Image {...props} source={source} cachePolicy="none" />;
}
