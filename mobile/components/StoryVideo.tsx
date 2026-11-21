import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent, useEventListener } from "expo";
import { useAppStore } from "@/lib/store";
import { privateMediaSource } from "@/lib/media";

export function StoryVideo({ uri, paused, onProgress, onEnd }: { uri: string; paused: boolean; onProgress: (progress: number) => void; onEnd: () => void }) {
  const token = useAppStore(state => state.token);
  const player = useVideoPlayer({ ...privateMediaSource(uri, token), useCaching: false }, video => { video.loop = false; video.timeUpdateEventInterval = 0.25; video.play(); });
  useEventListener(player, "timeUpdate", event => onProgress(Math.min(event.currentTime / (player.duration || 60), 1)));
  useEventListener(player, "playToEnd", onEnd);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
  return <View style={StyleSheet.absoluteFill}>
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls crossOrigin={uri.startsWith("/api/media/") ? "use-credentials" : undefined} />
    {status === "error" && <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}><Text style={{ color: "#FFFFFF" }}>Video is unavailable or has expired.</Text></View>}
  </View>;
}
