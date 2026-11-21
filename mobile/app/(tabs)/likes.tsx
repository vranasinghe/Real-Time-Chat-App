import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowUpRight, Heart, ImageOff } from "lucide-react-native";
import { ProfileDetailsModal, profileAge } from "@/components/ProfileDetailsModal";
import { useAppStore, Profile } from "@/lib/store";
import { MAX_APP_WIDTH } from "@/lib/layout";

const colors = {
  background: "#0E0720", surface: "#1B1035", primary: "#7C5CFF",
  text: "#FFFFFF", secondary: "#B9AECE", muted: "#9A8FB8",
  like: "#FF2E6E", online: "#46D995", border: "rgba(185,174,206,0.18)",
};
const FILTERS = ["All", "Online now", "Best match"] as const;
type Filter = typeof FILTERS[number];

function LikeCard({ profile, width, busy, disabled, onOpen, onLike }: {
  profile: Profile; width: number; busy: boolean; disabled: boolean;
  onOpen: (profile: Profile) => void; onLike: (profile: Profile) => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const match = typeof profile.match_percent === "number" ? Math.max(0, Math.min(100, profile.match_percent)) : null;
  return (
    <View style={[styles.card, { width }]}>
      <Pressable
        onPress={() => onOpen(profile)} accessibilityRole="button"
        accessibilityLabel={`View ${profile.name}'s full profile`}
        style={({ pressed, hovered }) => [styles.profileLink, (pressed || hovered) && styles.cardHighlighted]}
      >
        <View style={styles.photoArea}>
          {profile.photos[0] && !photoFailed ? (
            <Image source={{ uri: profile.photos[0] }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" onError={() => setPhotoFailed(true)} />
          ) : <View style={styles.photoPlaceholder}><ImageOff size={28} color={colors.muted} /><Text style={styles.placeholderText}>View profile</Text></View>}
          {match !== null && <View style={styles.matchBadge}><Heart size={11} color="#D7CBFF" /><Text style={styles.matchText}>{match}% match</Text></View>}
        </View>
        <View style={styles.cardInfo}>
          <Text numberOfLines={1} style={styles.name}>{profile.name}, {profileAge(profile.birthdate)}</Text>
          <View style={styles.statusRow}>
            {profile.is_online ? <><View style={styles.onlineDot} /><Text style={styles.onlineText}>Online now</Text></> : <><Text style={styles.statusText}>View profile</Text><ArrowUpRight size={13} color={colors.secondary} /></>}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onLike(profile)} disabled={disabled} accessibilityRole="button"
        accessibilityLabel={`Like ${profile.name} back`} accessibilityState={{ disabled, busy }}
        style={({ pressed, hovered }) => [styles.likeButton, (pressed || hovered) && styles.likeButtonActive, disabled && styles.disabled]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Heart size={16} color={colors.text} fill={colors.text} />}
        <Text style={styles.likeButtonText}>{busy ? "Liking…" : "Like back"}</Text>
      </Pressable>
    </View>
  );
}

export default function LikesScreen() {
  const { likesYou, recordSwipe, fetchLikesYou } = useAppStore();
  const { width } = useWindowDimensions();
  const [activeFilter, setActiveFilter] = useState<Filter>("All");
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [contentWidth, setContentWidth] = useState(Math.min(width, MAX_APP_WIDTH) - 40);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(likesYou.length === 0);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchLikesYou().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [fetchLikesYou]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await fetchLikesYou(); } finally { setRefreshing(false); }
  }, [fetchLikesYou]);

  const filteredProfiles = useMemo(() => {
    if (activeFilter === "Online now") return likesYou.filter(profile => profile.is_online);
    if (activeFilter === "Best match") return [...likesYou].sort((a, b) => (b.match_percent ?? 0) - (a.match_percent ?? 0));
    return likesYou;
  }, [likesYou, activeFilter]);

  const handleLikeBack = async (profile: Profile) => {
    if (pendingId) return;
    setSelectedProfile(null);
    setPendingId(profile.id);
    try { await recordSwipe(profile.id, "like"); }
    catch { Alert.alert("Could not send your like", "Please try again in a moment."); }
    finally { setPendingId(null); }
  };

  const columns = contentWidth < 290 ? 1 : 2;
  const cardWidth = columns === 1 ? contentWidth : (contentWidth - 14) / 2;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>Likes You</Text>
          <View accessible accessibilityLabel={`${likesYou.length} likes`} style={styles.countBadge}><Text style={styles.countText}>{likesYou.length}</Text></View>
        </View>
        <Text style={styles.subtitle}>Discover people who already liked you.</Text>
        <View accessibilityRole="tablist" accessibilityLabel="Filter likes" style={styles.filters}>
          {FILTERS.map(filter => <Pressable
            key={filter} onPress={() => setActiveFilter(filter)} accessibilityRole="tab"
            accessibilityState={{ selected: activeFilter === filter }}
            style={({ pressed, hovered }) => [styles.filter, activeFilter === filter && styles.filterSelected, (pressed || hovered) && styles.filterHighlighted]}
          ><Text style={[styles.filterText, activeFilter === filter && styles.filterTextSelected]}>{filter}</Text></Pressable>)}
        </View>
      </View>

      <View style={styles.listArea} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
        <FlatList
          key={columns} data={filteredProfiles} numColumns={columns} keyExtractor={profile => profile.id}
          columnWrapperStyle={columns === 2 ? styles.column : undefined}
          contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
          renderItem={({ item }) => <LikeCard profile={item} width={cardWidth} busy={pendingId === item.id} disabled={pendingId !== null} onOpen={setSelectedProfile} onLike={handleLikeBack} />}
          ListEmptyComponent={loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading likes" /></View> : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Heart size={30} color="#B9A6FF" /></View>
              <Text style={styles.emptyTitle}>{activeFilter === "Online now" && likesYou.length ? "No one is online right now" : "Your next connection starts here"}</Text>
              <Text style={styles.emptyBody}>{activeFilter === "Online now" && likesYou.length ? "You can still get to know the people who liked you." : "When someone likes your profile, you'll find them here. Explore a few profiles in the meantime."}</Text>
              <Pressable accessibilityRole="button" onPress={() => likesYou.length ? setActiveFilter("All") : router.replace("/(tabs)/explore")} style={({ pressed }) => [styles.emptyAction, pressed && styles.disabled]}><Text style={styles.emptyActionText}>{likesYou.length ? "See all likes" : "Explore profiles"}</Text></Pressable>
            </View>
          )}
        />
      </View>
      <ProfileDetailsModal profile={selectedProfile} onClose={() => setSelectedProfile(null)} onLike={handleLikeBack} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: colors.text, fontSize: 32, lineHeight: 40, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.8 },
  countBadge: { minWidth: 32, height: 32, paddingHorizontal: 10, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#281B4A" },
  countText: { color: "#D2C4FF", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subtitle: { marginTop: 8, color: colors.secondary, fontSize: 14, lineHeight: 22, fontFamily: "Inter_400Regular" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 24 },
  filter: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  filterSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterHighlighted: { opacity: 0.8 },
  filterText: { color: colors.secondary, fontSize: 13, lineHeight: 20, fontFamily: "Inter_500Medium" },
  filterTextSelected: { color: colors.text, fontFamily: "Inter_600SemiBold" },
  listArea: { flex: 1, marginHorizontal: 20 },
  listContent: { paddingBottom: 116, flexGrow: 1 },
  column: { gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden", marginBottom: 16 },
  profileLink: { width: "100%" }, cardHighlighted: { opacity: 0.88 },
  photoArea: { width: "100%", aspectRatio: 0.8, backgroundColor: "#271C40", overflow: "hidden" },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  placeholderText: { color: colors.secondary, fontSize: 12, fontFamily: "Inter_400Regular" },
  matchBadge: { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(14,7,32,0.86)", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  matchText: { color: colors.text, fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
  cardInfo: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14 },
  name: { color: colors.text, fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold", letterSpacing: -0.3 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, minHeight: 18 },
  onlineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.online },
  onlineText: { color: colors.online, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  statusText: { color: colors.secondary, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  likeButton: { marginHorizontal: 12, marginBottom: 12, minHeight: 44, borderRadius: 12, backgroundColor: "#C91B53", flexDirection: "row", gap: 7, paddingHorizontal: 8, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  likeButtonActive: { backgroundColor: "#B8174A" },
  likeButtonText: { color: colors.text, fontSize: 13, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  disabled: { opacity: 0.6 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 48 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#24163E", alignItems: "center", justifyContent: "center", marginBottom: 24 },
  emptyTitle: { textAlign: "center", color: colors.text, fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 22, lineHeight: 29 },
  emptyBody: { textAlign: "center", color: colors.secondary, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 23, marginTop: 12, maxWidth: 300 },
  emptyAction: { marginTop: 24, minHeight: 48, paddingHorizontal: 24, paddingVertical: 13, backgroundColor: colors.primary, borderRadius: 24 },
  emptyActionText: { color: colors.text, fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 22 },
});
