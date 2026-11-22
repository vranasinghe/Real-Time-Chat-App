import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { ChevronLeft, ChevronRight, Expand, Heart, ImageOff, MessageSquare, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Profile } from "@/lib/types";
import { MAX_APP_WIDTH } from "@/lib/layout";

const palette = {
  background: "#0E0720", surface: "#1B1035", text: "#FFFFFF",
  secondary: "#B9AECE", primary: "#7C5CFF", like: "#FF2E6E", online: "#22C55E",
};

export function profileAge(birthdate: string): number {
  const today = new Date();
  const date = new Date(birthdate);
  const birthdayPending = today.getMonth() < date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() < date.getDate());
  return today.getFullYear() - date.getFullYear() - (birthdayPending ? 1 : 0);
}

interface Props {
  profile: Profile | null;
  onClose: () => void;
  onLike?: (profile: Profile) => void;
  onMessage?: (profile: Profile) => void;
}

export function ProfileDetailsModal({ profile, onClose, onLike, onMessage }: Props) {
  // Unmount the gallery between profiles so photo/error state never leaks to the next person.
  return (
    <Modal visible={!!profile} transparent animationType="slide" onRequestClose={onClose}>
      {profile && <ProfileDetails key={profile.id} profile={profile} onClose={onClose} onLike={onLike} onMessage={onMessage} />}
    </Modal>
  );
}

function ProfileDetails({ profile, onClose, onLike, onMessage }: Props & { profile: Profile }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [photoIndex, setPhotoIndex] = useState(() => {
    const fullBody = profile.photos.findIndex(photo => photo.includes("profile-galleries"));
    return fullBody >= 0 ? fullBody : 0;
  });
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const photos = (profile.photos || []).filter(Boolean);
  const photo = photos[photoIndex];
  const generatedGalleryPhoto = photo?.includes("profile-galleries");
  const sample = profile.id.startsWith("demo-showcase-") || profile.id.startsWith("seed-showcase-");
  const sheetWidth = Math.min(width, MAX_APP_WIDTH);
  const changePhoto = (index: number) => {
    setPhotoIndex(index);
    setFailed(false);
    setLoading(true);
  };
  const close = () => expanded ? setExpanded(false) : onClose();

  const photoContent = (
    <View style={[styles.photo, expanded ? { flex: 1, aspectRatio: undefined } : { height: Math.min(sheetWidth * 1.5, height * 0.5) }]}>
      {photo && !failed ? (
        <Image
          key={`${photo}-${retry}`}
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          accessibilityLabel={`${profile.name}, full photo ${photoIndex + 1} of ${photos.length}`}
          onLoadStart={() => setLoading(true)}
          onLoad={() => setLoading(false)}
          onError={() => { setFailed(true); setLoading(false); }}
        />
      ) : (
        <View style={styles.center}>
          <ImageOff size={32} color={palette.secondary} />
          <Text style={styles.muted}>{photo ? "This photo could not load." : "No photos yet."}</Text>
          {photo && <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setLoading(true); setRetry(retry + 1); }} style={styles.smallButton}><Text style={styles.text}>Retry photo</Text></Pressable>}
        </View>
      )}
      {photo && loading && !failed && <View pointerEvents="none" style={styles.center}><ActivityIndicator color={palette.text} accessibilityLabel="Loading photo" /></View>}
      {photo && !expanded && <Pressable accessibilityRole="button" accessibilityLabel={`Expand ${profile.name}'s photo`} onPress={() => setExpanded(true)} style={[styles.iconButton, styles.expandButton]}><Expand size={20} color={palette.text} /></Pressable>}
      {photos.length > 1 && <View style={styles.photoNavigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={photoIndex === 0} onPress={() => changePhoto(photoIndex - 1)} style={[styles.iconButton, photoIndex === 0 && styles.disabled]}><ChevronLeft color={palette.text} size={24} /></Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.counter}>{photoIndex + 1} / {photos.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={photoIndex === photos.length - 1} onPress={() => changePhoto(photoIndex + 1)} style={[styles.iconButton, photoIndex === photos.length - 1 && styles.disabled]}><ChevronRight color={palette.text} size={24} /></Pressable>
      </View>}
    </View>
  );

  return (
    <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, 16) }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss profile" accessibilityRole="button" />
      <View accessibilityViewIsModal style={[styles.sheet, { width: sheetWidth, maxHeight: height - Math.max(insets.top, 16) }, expanded && styles.expanded]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.headerTitle}>{expanded ? `${profile.name}'s photo` : "Full Profile"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Back to profile details" : "Close profile"} onPress={close} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><X size={22} color={palette.text} /></Pressable>
        </View>
        {expanded ? photoContent : <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {photoContent}
          <View style={styles.body}>
            <View style={styles.identity}>
              <Text accessibilityRole="header" style={styles.name}>{profile.name}, {profileAge(profile.birthdate)}</Text>
              {profile.is_online && <Text style={styles.online}>Online now</Text>}
            </View>
            {(sample || generatedGalleryPhoto) && <Text style={styles.sample}>{sample ? "Fictional demo profile · AI-generated photo" : "AI-generated additional photo"}</Text>}
            <Text accessibilityRole="header" style={styles.heading}>About Me</Text>
            <Text style={styles.bio}>{profile.bio || "This person hasn't added a bio yet."}</Text>
            <Text accessibilityRole="header" style={styles.heading}>Personal Details</Text>
            {[
              ["Age", `${profileAge(profile.birthdate)} years`],
              ["Height", profile.height_cm ? `${profile.height_cm} cm` : "Not shared"],
              ["Gender", profile.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : "Not shared"],
              ["Interested in", profile.looking_for === "male" ? "Men" : profile.looking_for === "female" ? "Women" : profile.looking_for === "everyone" ? "Everyone" : profile.looking_for || "Not shared"],
            ].map(([label, value]) => <View key={label} style={styles.detailRow}><Text style={styles.muted}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>)}
            <Text accessibilityRole="header" style={styles.heading}>Interests</Text>
            <View style={styles.interests}>{profile.interests?.length ? profile.interests.map(interest => <View key={interest} style={styles.interest}><Text style={styles.interestText}>{interest}</Text></View>) : <Text style={styles.muted}>No interests shared yet.</Text>}</View>
          </View>
        </ScrollView>}
        {!expanded && (onLike || onMessage) && <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {onLike && <Pressable accessibilityRole="button" onPress={() => onLike(profile)} style={({ pressed }) => [styles.action, { backgroundColor: palette.like }, pressed && styles.pressed]}><Heart size={20} color={palette.text} /><Text style={styles.actionText}>Like</Text></Pressable>}
          {onMessage && <Pressable accessibilityRole="button" onPress={() => onMessage(profile)} style={({ pressed }) => [styles.action, { backgroundColor: palette.primary }, pressed && styles.pressed]}><MessageSquare size={20} color={palette.text} /><Text style={styles.actionText}>Message</Text></Pressable>}
        </View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end", alignItems: "center" },
  sheet: { height: "94%", backgroundColor: palette.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  expanded: { height: "100%", backgroundColor: "#07030F" },
  header: { paddingLeft: 24, paddingRight: 12, minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headerTitle: { flex: 1, color: palette.text, fontSize: 18, fontFamily: "SpaceGrotesk_600SemiBold" },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "rgba(14,7,32,0.88)" },
  photo: { width: "100%", backgroundColor: "#07030F" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 16 },
  expandButton: { position: "absolute", right: 16, top: 16 },
  photoNavigation: { position: "absolute", bottom: 12, left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  counter: { backgroundColor: "rgba(14,7,32,0.88)", color: palette.text, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, fontFamily: "Inter_600SemiBold" },
  disabled: { opacity: 0.35 }, pressed: { opacity: 0.75 },
  body: { paddingHorizontal: 24, paddingTop: 24 },
  identity: { gap: 8 }, name: { color: palette.text, fontSize: 30, fontFamily: "SpaceGrotesk_700Bold" },
  online: { color: palette.online, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sample: { color: palette.secondary, fontSize: 12, lineHeight: 18, marginTop: 12, fontFamily: "Inter_400Regular" },
  heading: { color: palette.text, fontSize: 19, marginTop: 28, marginBottom: 12, fontFamily: "SpaceGrotesk_600SemiBold" },
  bio: { color: palette.secondary, fontSize: 16, lineHeight: 25, fontFamily: "Inter_400Regular" },
  muted: { color: palette.secondary, fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  text: { color: palette.text, fontFamily: "Inter_600SemiBold" }, smallButton: { padding: 16, borderRadius: 12, backgroundColor: palette.primary },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  detailValue: { flexShrink: 1, textAlign: "right", color: palette.text, fontSize: 15, lineHeight: 23, fontFamily: "Inter_500Medium" },
  interests: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  interest: { backgroundColor: palette.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  interestText: { color: "#D2C6FF", fontSize: 14, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  action: { flex: 1, minWidth: 120, minHeight: 52, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  actionText: { color: palette.text, fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
