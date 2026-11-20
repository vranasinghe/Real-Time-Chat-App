import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  StyleSheet,
  StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Phone,
  Video,
  Plus,
  Mic,
  Send,
  Image as ImageIcon,
  MapPin,
  User,
  FileText,
  X,
} from "lucide-react-native";
import { useAppStore, Message } from "@/lib/store";
import Animated, { FadeInUp } from "react-native-reanimated";

const MAX_MESSAGE_LENGTH = 2000;

// Confirmed messages in server order, then not-yet-confirmed ones in send order
function orderThread(list: Message[]): Message[] {
  const confirmed = list
    .filter((m) => typeof m.id === "number")
    .sort((a, b) => (a.id as number) - (b.id as number));
  const local = list
    .filter((m) => typeof m.id !== "number")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return [...confirmed, ...local];
}

export default function ChatThreadScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const matches = useAppStore((s) => s.matches);
  const allMessages = useAppStore((s) => s.messages);
  const user = useAppStore((s) => s.user);
  const thread = useAppStore((s) => (matchId ? s.threads[matchId] : undefined));
  const { sendMessage, retryMessage, loadThread, loadOlderMessages, markThreadRead, setActiveThread } =
    useAppStore.getState();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  // Inverted list: offset 0 is the newest message
  const scrollToNewest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });

  const match = matches.find((m) => m.id === matchId);
  const otherUser = match?.other_user;
  const otherLastRead = match?.other_last_read_message_id ?? 0;

  const messagesList = useMemo(
    () => orderThread(allMessages.filter((m) => m.match_id === matchId)),
    [allMessages, matchId]
  );
  // Inverted list: newest message renders at the bottom, older pages load at the top
  const invertedData = useMemo(() => [...messagesList].reverse(), [messagesList]);

  // My newest confirmed message: the one that shows "Sent" / "Seen"
  const myLatestConfirmedId = useMemo(() => {
    for (let i = messagesList.length - 1; i >= 0; i--) {
      const m = messagesList[i];
      if (m.sender_id === user?.id && typeof m.id === "number") return m.id;
    }
    return null;
  }, [messagesList, user?.id]);

  // While this screen is focused it is the "active thread": incoming messages
  // here don't count as unread, and we tell the other person we've seen them.
  useFocusEffect(
    useCallback(() => {
      if (!matchId) return;
      setActiveThread(matchId);
      loadThread(matchId);
      return () => setActiveThread(null);
    }, [matchId, loadThread, setActiveThread])
  );

  const newestFromOther = messagesList.length ? messagesList[messagesList.length - 1].id : null;
  useEffect(() => {
    if (matchId) markThreadRead(matchId);
  }, [matchId, newestFromOther, markThreadRead]);

  const handleGoBack = () => {
    try {
      router.back();
    } catch {
      router.replace("/(tabs)/chat");
    }
  };

  const handleSend = async () => {
    if (!text.trim() || !matchId) return;
    const bodyText = text.trim();
    setText("");
    const sending = sendMessage(matchId, bodyText, "text");
    scrollToNewest();
    await sending;
  };

  const handleAttachmentOption = (type: string) => {
    setShowAttachmentSheet(false);
    Alert.alert("Attachment Triggered", `Sharing ${type} in chat...`, [
      {
        text: "Send Mock",
        onPress: async () => {
          if (!matchId) return;
          await sendMessage(
            matchId,
            type === "Location"
              ? "📍 Current Location shared"
              : `📎 Mock ${type} attachment`,
            type === "Location" ? "location" : "text"
          );
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const statusLabel = (msg: Message): string | null => {
    if (msg.sender_id !== user?.id) return null;
    if (msg.status === "sending") return "Sending…";
    if (msg.status === "failed") return "Not sent · Tap to retry";
    if (msg.id !== myLatestConfirmedId) return null;
    return typeof msg.id === "number" && msg.id <= otherLastRead ? "Seen" : "Sent";
  };

  const renderBubble = ({ item: msg }: { item: Message }) => {
    const isMe = msg.sender_id === user?.id;
    const failed = msg.status === "failed";
    const status = statusLabel(msg);
    const time = new Date(msg.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <Animated.View
        entering={FadeInUp.duration(180)}
        style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowThem]}
      >
        <Pressable
          disabled={!failed || !msg.client_id}
          onPress={() => msg.client_id && retryMessage(msg.client_id)}
          accessibilityRole={failed ? "button" : undefined}
          accessibilityLabel={failed ? "Message not sent. Tap to retry." : undefined}
          style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleThem,
            msg.status === "sending" && styles.bubbleSending,
            failed && styles.bubbleFailed,
          ]}
        >
          <Text style={styles.bubbleText}>{msg.body}</Text>
          <Text style={[styles.bubbleTime, failed && styles.bubbleTimeFailed]}>
            {status ? `${time} · ${status}` : time}
          </Text>
        </Pressable>
      </Animated.View>
    );
  };

  const isEmpty = messagesList.length === 0;
  const loadingFirstPage = !thread?.loaded && thread?.loading;

  const attachmentOptions = [
    {
      label: "Document",
      icon: FileText,
      bg: "rgba(59, 130, 246, 0.1)",
      border: "rgba(59, 130, 246, 0.2)",
      color: "#3B82F6",
    },
    {
      label: "Camera",
      icon: Video,
      bg: "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.2)",
      color: "#EF4444",
    },
    {
      label: "Gallery",
      icon: ImageIcon,
      bg: "rgba(16, 185, 129, 0.1)",
      border: "rgba(16, 185, 129, 0.2)",
      color: "#10B981",
    },
    {
      label: "Audio",
      icon: Mic,
      bg: "rgba(245, 158, 11, 0.1)",
      border: "rgba(245, 158, 11, 0.2)",
      color: "#F59E0B",
    },
    {
      label: "Contact",
      icon: User,
      bg: "rgba(236, 72, 153, 0.1)",
      border: "rgba(236, 72, 153, 0.2)",
      color: "#EC4899",
    },
  ];

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top || StatusBar.currentHeight || 0 }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex1}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={handleGoBack}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              style={({ pressed }) => [
                styles.backBtn,
                pressed && { opacity: 0.5, transform: [{ scale: 0.92 }] },
              ]}
            >
              <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>

            <View style={styles.avatarRow}>
              <View style={styles.avatarWrap}>
                {otherUser?.photos[0] ? (
                  <Image
                    source={{ uri: otherUser.photos[0] }}
                    style={styles.avatar}
                  />
                ) : (
                  <Text style={styles.avatarPlaceholderText}>U</Text>
                )}
                {otherUser?.is_online && <View style={styles.onlineDot} />}
              </View>
              <View>
                <Text style={styles.headerName}>
                  {otherUser?.name || "Match"}
                </Text>
                <Text style={styles.headerStatus}>
                  {otherUser?.is_online ? "Active Now" : "Offline"}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push("/call/audio")}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { backgroundColor: "rgba(255,255,255,0.1)" },
              ]}
            >
              <Phone size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => router.push("/call/video")}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { backgroundColor: "rgba(255,255,255,0.1)" },
              ]}
            >
              <Video size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* Messages: inverted so the newest sits at the bottom and older pages load on scroll up */}
        {isEmpty ? (
          <View style={styles.emptyWrap}>
            {loadingFirstPage ? (
              <ActivityIndicator color="#7C5CFF" />
            ) : (
              <Text style={styles.emptyText}>
                You matched with {otherUser?.name}! Send the first message to
                kick off the connection.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={invertedData}
            keyExtractor={(m) => String(m.client_id ?? m.id)}
            renderItem={renderBubble}
            style={styles.messageScroll}
            contentContainerStyle={styles.messageScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onEndReached={() => matchId && loadOlderMessages(matchId)}
            onEndReachedThreshold={0.3}
            initialNumToRender={20}
            windowSize={11}
            ListFooterComponent={
              thread?.loading && thread?.loaded ? (
                <ActivityIndicator color="#7C5CFF" style={{ marginVertical: 12 }} />
              ) : thread?.hasMore === false || !thread ? (
                <View style={styles.dateLabelWrap}>
                  <View style={styles.dateLabelInner}>
                    <Text style={styles.dateLabelText}>Start of your conversation</Text>
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <Pressable
            onPress={() => setShowAttachmentSheet(true)}
            style={({ pressed }) => [
              styles.plusBtn,
              pressed && { backgroundColor: "rgba(255,255,255,0.1)" },
            ]}
          >
            <Plus size={20} color="#7C5CFF" />
          </Pressable>

          <View style={styles.inputWrap}>
            <TextInput
              placeholder="Type your message..."
              placeholderTextColor="#9A8FB8"
              value={text}
              onChangeText={setText}
              style={styles.input}
              maxLength={MAX_MESSAGE_LENGTH}
              multiline
            />
            <Pressable
              onPress={() =>
                Alert.alert("Voice Recording", "Voice messages coming soon!")
              }
            >
              <Mic size={18} color="#9A8FB8" />
            </Pressable>
          </View>

          <Pressable
            onPress={handleSend}
            disabled={!text.trim()}
            style={[
              styles.sendBtn,
              text.trim() ? styles.sendBtnActive : styles.sendBtnInactive,
            ]}
          >
            <Send
              size={16}
              color="#FFFFFF"
              fill={text.trim() ? "#FFFFFF" : "none"}
            />
          </Pressable>
        </View>

        {/* Attachment Modal */}
        <Modal
          visible={showAttachmentSheet}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setShowAttachmentSheet(false)}
        >
          <Pressable
            onPress={() => setShowAttachmentSheet(false)}
            style={styles.modalOverlay}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={styles.modalSheet}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Share Attachment</Text>
                <Pressable
                  onPress={() => setShowAttachmentSheet(false)}
                  style={styles.modalCloseBtn}
                >
                  <X size={16} color="#FFFFFF" />
                </Pressable>
              </View>

              <View style={styles.attachmentGrid}>
                {attachmentOptions.map((item) => (
                  <Pressable
                    key={item.label}
                    onPress={() => handleAttachmentOption(item.label)}
                    style={({ pressed }) => [
                      styles.attachmentItem,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View
                      style={[
                        styles.attachmentIcon,
                        {
                          backgroundColor: item.bg,
                          borderColor: item.border,
                          borderWidth: 1,
                        },
                      ]}
                    >
                      <item.icon size={22} color={item.color} />
                    </View>
                    <Text style={styles.attachmentLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0E0720",
  },
  flex1: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(26, 15, 61, 0.4)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarRow: { flexDirection: "row", alignItems: "center" },
  avatarWrap: {
    position: "relative",
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: "#1B1035",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholderText: { color: "#FFFFFF", fontFamily: "Inter_400Regular" },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#22C55E",
    borderWidth: 2,
    borderColor: "#0E0720",
  },
  headerName: {
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    fontWeight: "bold",
  },
  headerStatus: {
    color: "#9A8FB8",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#1B1035",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },

  // Messages
  messageScroll: { flex: 1, paddingHorizontal: 16 },
  messageScrollContent: { paddingVertical: 16 },
  dateLabelWrap: { alignItems: "center", marginVertical: 16 },
  dateLabelInner: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(27, 16, 53, 0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  dateLabelText: {
    color: "#9A8FB8",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 80 },
  emptyText: {
    color: "#9A8FB8",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 40,
    lineHeight: 24,
  },

  // Bubble
  bubbleRow: { flexDirection: "row", marginBottom: 14 },
  bubbleRowMe: { justifyContent: "flex-end" },
  bubbleRowThem: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "75%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
  },
  bubbleMe: {
    backgroundColor: "#7C5CFF",
    borderTopRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: "#1B1035",
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  bubbleText: {
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 20,
  },
  bubbleSending: { opacity: 0.7 },
  bubbleFailed: {
    backgroundColor: "rgba(255, 46, 110, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 46, 110, 0.6)",
  },
  bubbleTime: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    textAlign: "right",
    color: "rgba(255, 255, 255, 0.65)",
  },
  bubbleTimeFailed: { color: "#FF8FB1", fontFamily: "Inter_600SemiBold" },

  // Input
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(26, 15, 61, 0.2)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  plusBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1B1035",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1B1035",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    marginRight: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  input: {
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    flex: 1,
    padding: 0,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnActive: { backgroundColor: "#7C5CFF" },
  sendBtnInactive: {
    backgroundColor: "#1B1035",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    opacity: 0.5,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  modalSheet: {
    backgroundColor: "#0E0720",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1B1035",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  attachmentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  attachmentItem: { width: "30%", alignItems: "center", marginBottom: 24 },
  attachmentIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  attachmentLabel: {
    color: "#9A8FB8",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textAlign: "center",
  },
});
