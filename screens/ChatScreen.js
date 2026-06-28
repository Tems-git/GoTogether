import { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, FlatList,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function ChatScreen({ onBack, tripId, userId, tripName }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [memberReads, setMemberReads] = useState([]); // chat_last_read за всички останали
  const flatRef = useRef(null);

  const markAsRead = useCallback(async () => {
    await supabase.from("trip_members")
      .update({ chat_last_read: new Date().toISOString() })
      .eq("trip_id", tripId)
      .eq("user_id", userId);
  }, [tripId, userId]);

  const fetchMemberReads = useCallback(async () => {
    const { data } = await supabase
      .from("trip_members")
      .select("user_id, chat_last_read")
      .eq("trip_id", tripId)
      .neq("user_id", userId);
    setMemberReads(data || []);
  }, [tripId, userId]);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });
    setMessages(data || []);
    setLoading(false);
    await markAsRead();
  }, [tripId, markAsRead]);

  useEffect(() => {
    supabase.from("trip_members")
      .select("display_name")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || "Непознат"));

    fetchMessages();
    fetchMemberReads();

    const channel = supabase
      .channel(`chat-${tripId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        async (payload) => {
          setMessages((prev) => [...prev, payload.new]);
          await markAsRead();
        }
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` },
        () => fetchMemberReads() // при промяна на chat_last_read
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [tripId, userId, fetchMessages, fetchMemberReads, markAsRead]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setText("");
    try {
      await supabase.from("messages").insert({
        trip_id: tripId,
        user_id: userId,
        display_name: displayName,
        text: trimmed,
      });
    } catch (e) {
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }

  // Проверяваме дали всички останали са прочели след created_at на съобщението
  function getReadStatus(msg) {
    if (msg.user_id !== userId) return null; // само моите съобщения
    if (memberReads.length === 0) return "sent";
    const allRead = memberReads.every(
      (m) => m.chat_last_read && new Date(m.chat_last_read) >= new Date(msg.created_at)
    );
    return allRead ? "read" : "delivered";
  }

  // Показваме отметки само на последното ми съобщение
  const myMessages = messages.filter((m) => m.user_id === userId);
  const lastMyMsgId = myMessages.length > 0 ? myMessages[myMessages.length - 1].id : null;

  function formatTime(iso) {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Днес";
    if (d.toDateString() === yesterday.toDateString()) return "Вчера";
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  }

  const grouped = [];
  let lastDate = null;
  messages.forEach((msg) => {
    const d = new Date(msg.created_at).toDateString();
    if (d !== lastDate) {
      grouped.push({ type: "date", date: msg.created_at, key: `date-${msg.created_at}` });
      lastDate = d;
    }
    grouped.push({ type: "msg", ...msg, key: msg.id });
  });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>💬 Чат</Text>
          <Text style={styles.headerSub}>{tripName}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#1D9E75" />
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={grouped}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            if (item.type === "date") {
              return (
                <View style={styles.dateSep}>
                  <Text style={styles.dateText}>{formatDate(item.date)}</Text>
                </View>
              );
            }
            const isMe = item.user_id === userId;
            const isLastMine = item.id === lastMyMsgId;
            const readStatus = isLastMine ? getReadStatus(item) : null;

            return (
              <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
                {!isMe && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(item.display_name || "?")[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={[styles.bubble, isMe && styles.bubbleMe]}>
                  {!isMe && (
                    <Text style={styles.senderName}>{item.display_name}</Text>
                  )}
                  <Text style={[styles.msgText, isMe && styles.msgTextMe]}>{item.text}</Text>
                  <View style={styles.msgMeta}>
                    <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>{formatTime(item.created_at)}</Text>
                    {readStatus === "read" && (
                      <Text style={styles.tickRead}>✓✓</Text>
                    )}
                    {readStatus === "delivered" && (
                      <Text style={styles.tickDelivered}>✓✓</Text>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>Няма съобщения още.{"\n"}Бъди първият!</Text>
            </View>
          }
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Напиши съобщение..."
          placeholderTextColor="#aaa"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={500}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          <Text style={styles.sendIcon}>{sending ? "..." : "➤"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#F5F5F5" },
  header: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", paddingTop: 56, paddingBottom: 12,
    paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: "#e0e0e0",
  },
  backBtn: { marginRight: 12 },
  backText: { color: "#1D9E75", fontSize: 16 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "bold", color: "#1a1a1a" },
  headerSub: { fontSize: 12, color: "#888", marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, paddingBottom: 8 },
  dateSep: { alignItems: "center", marginVertical: 12 },
  dateText: {
    fontSize: 11, color: "#888", backgroundColor: "#e8e8e8",
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
  },
  msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 8 },
  msgRowMe: { flexDirection: "row-reverse" },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "#4ECDC4", alignItems: "center", justifyContent: "center",
    marginRight: 8,
  },
  avatarText: { fontSize: 13, fontWeight: "bold", color: "#fff" },
  bubble: {
    maxWidth: "75%", backgroundColor: "#fff",
    borderRadius: 16, borderBottomLeftRadius: 4,
    padding: 10, paddingBottom: 6,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  bubbleMe: {
    backgroundColor: "#1D9E75",
    borderBottomLeftRadius: 16, borderBottomRightRadius: 4,
    marginLeft: 8,
  },
  senderName: { fontSize: 11, fontWeight: "700", color: "#1D9E75", marginBottom: 3 },
  msgText: { fontSize: 15, color: "#1a1a1a", lineHeight: 20 },
  msgTextMe: { color: "#fff" },
  msgMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 },
  msgTime: { fontSize: 10, color: "#bbb" },
  msgTimeMe: { color: "rgba(255,255,255,0.7)" },
  tickRead: { fontSize: 11, color: "#A8F0D4", fontWeight: "bold" },
  tickDelivered: { fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "bold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 14, color: "#aaa", textAlign: "center", lineHeight: 22 },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end",
    backgroundColor: "#fff", padding: 10, paddingHorizontal: 16,
    borderTopWidth: 0.5, borderTopColor: "#e0e0e0",
  },
  input: {
    flex: 1, backgroundColor: "#F5F5F5", borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, fontSize: 15,
    color: "#1a1a1a", maxHeight: 100, marginRight: 10,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#ccc" },
  sendIcon: { color: "#fff", fontSize: 16, marginLeft: 2 },
});
