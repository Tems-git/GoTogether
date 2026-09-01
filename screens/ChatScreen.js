import { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, TouchableWithoutFeedback,
  FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Linking, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageSquare } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors, space, radius, type } from "../theme/tokens";

// Цветът на аватара се избира по user_id, а не по мястото в списъка. Така
// един и същи човек е с един и същи цвят при всяко отваряне, на всяко
// устройство и при всички участници — иначе цветовете щяха да скачат при
// зареждане на по-стари съобщения.
const AVATAR_COLORS = [
  "#0A6B57", "#B4531F", "#3D5A98", "#7A3E9D",
  "#177A6B", "#9B2C46", "#4C6B1A", "#2B5F7A",
];

function avatarColor(id) {
  const key = String(id || "");
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// Разпознаване на адреси в текста на съобщение. Умишлено просто: пълен адрес
// с http/https, или започващ с www. Каквото не отговаря на това, си остава
// обикновен текст — по-добре един линк да не се хване, отколкото половин
// изречение да посинее и да води наникъде.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

// Крайната пунктуация почти винаги принадлежи на изречението, не на адреса.
// „…виж https://maps.app.goo.gl/abc." трябва да отвори адреса без точката.
const TRAILING_PUNCT = /[.,;:!?)\]}»„“"'…]+$/;

// Картовите адреси се подават на системата, за да ги поеме приложението за
// карти. Вътрешният браузър би показал уеб версията и би загубил навигацията,
// запазените места и профила на човека.
const MAP_URL = /(maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]{2,8}\/maps|maps\.google\.|maps\.apple\.com|waze\.com)/i;

// Връща текста, нарязан на парчета: обикновените имат само `text`, адресите
// имат и `url`. Един елемент без `url` означава съобщение без линкове.
function splitByLinks(value) {
  const source = String(value || "");
  const parts = [];
  let cursor = 0;

  source.replace(URL_REGEX, (match, _captured, offset) => {
    const clean = match.replace(TRAILING_PUNCT, "");
    if (!clean) return match;
    if (offset > cursor) parts.push({ text: source.slice(cursor, offset) });
    parts.push({
      text: clean,
      url: clean.toLowerCase().startsWith("www.") ? `https://${clean}` : clean,
    });
    cursor = offset + clean.length;
    return match;
  });

  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts.length ? parts : [{ text: source }];
}

export default function ChatScreen({ onBack, tripId, userId, tripName, onOpenPlan }) {
  // insets дава реалните височини на status bar (top) и navigation bar (bottom)
  // за конкретното устройство. Без тях Android навигационната лента застъпва
  // полето за писане — тапването задейства системните бутони вместо input-а.
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [memberReads, setMemberReads] = useState([]);
  // Съобщението, за което в момента гледаме кой го е прочел.
  const [readInfo, setReadInfo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [editText, setEditText] = useState("");
  const [showJump, setShowJump] = useState(false);
  const flatRef = useRef(null);
  const editInputRef = useRef(null);
  // Дали в момента сме в дъното на списъка. Държим го в ref, а не в state,
  // защото се чете вътре в onContentSizeChange, където state би бил стар.
  const atBottom = useRef(true);

  const markAsRead = useCallback(async () => {
    await supabase.from("trip_members")
      .update({ chat_last_read: new Date().toISOString() })
      .eq("trip_id", tripId)
      .eq("user_id", userId);
  }, [tripId, userId]);

  const fetchMemberReads = useCallback(async () => {
    const { data } = await supabase
      .from("trip_members")
      .select("user_id, display_name, chat_last_read")
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

    const msgChannel = supabase
      .channel(`messages-${tripId}-${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        async (payload) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
          await markAsRead();
        }
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new : m));
        }
      )
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      )
      .subscribe();

    const membersChannel = supabase
      .channel(`members-reads-${tripId}-${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` },
        () => fetchMemberReads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(membersChannel);
    };
  }, [tripId, userId, fetchMessages, fetchMemberReads, markAsRead]);

  useEffect(() => {
    // Същото условие като при onContentSizeChange: смъкваме списъка само ако
    // човекът вече е долу. Този ефект беше пропуснат при предишната поправка и
    // продължаваше да дърпа екрана надолу при всяко ново съобщение.
    if (messages.length > 0 && atBottom.current) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  useEffect(() => {
    if (editingMsg) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editingMsg]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setText("");
    try {
      const { data: inserted } = await supabase
        .from("messages")
        .insert({
          trip_id: tripId,
          user_id: userId,
          display_name: displayName,
          text: trimmed,
        })
        .select("id")
        .single();

      // Известието тръгва след като съобщението е записано и нарочно без
      // await — ако функцията се забави или се провали, съобщението вече е в
      // чата. Известието е удобство, не част от изпращането.
      if (inserted?.id) {
        supabase.functions
          .invoke("send-chat-push", { body: { messageId: inserted.id } })
          .catch(() => {});
      }
    } catch (e) {
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }

  function handleLongPress(msg) {
    if (msg.user_id !== userId) return;
    Alert.alert("Съобщение", undefined, [
      {
        text: "👁 Кой е прочел",
        onPress: () => setReadInfo(msg),
      },
      {
        text: "✏️ Редактирай",
        onPress: () => { setEditingMsg(msg); setEditText(msg.text); }
      },
      {
        text: "🗑 Изтрий",
        style: "destructive",
        onPress: () => handleDelete(msg),
      },
      { text: "Отказ", style: "cancel" },
    ]);
  }

  async function handleDelete(msg) {
    Alert.alert("Изтриване", "Сигурен ли си?", [
      { text: "Отказ", style: "cancel" },
      {
        text: "Изтрий", style: "destructive",
        onPress: async () => {
          try {
            await supabase.from("messages").delete().eq("id", msg.id).eq("user_id", userId);
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          } catch (e) {
            Alert.alert("Грешка", e.message);
          }
        }
      }
    ]);
  }

  function cancelEdit() {
    setEditingMsg(null);
    setEditText("");
  }

  async function handleSaveEdit() {
    const trimmed = editText.trim();
    if (!trimmed) return;
    try {
      await supabase.from("messages")
        .update({ text: trimmed, updated_at: new Date().toISOString() })
        .eq("id", editingMsg.id)
        .eq("user_id", userId);
      setMessages((prev) => prev.map((m) =>
        m.id === editingMsg.id ? { ...m, text: trimmed, updated_at: new Date().toISOString() } : m
      ));
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setEditingMsg(null);
      setEditText("");
    }
  }

  const myMessages = messages.filter((m) => m.user_id === userId);
  const lastMyMsgId = myMessages.length > 0 ? myMessages[myMessages.length - 1].id : null;

  function getReadStatus(msgId, createdAt) {
    if (msgId !== lastMyMsgId) return null;
    if (memberReads.length === 0) return "delivered";
    const allRead = memberReads.every(
      (m) => m.chat_last_read && new Date(m.chat_last_read) >= new Date(createdAt)
    );
    return allRead ? "read" : "delivered";
  }

  // Прочитането се пази като момент, не като списък: chat_last_read на
  // участника. Съобщение е прочетено от него, ако е било написано преди този
  // момент. Затова „прочел" не значи, че го е погледнал — значи, че е бил в
  // чата след него.
  function readersFor(msg) {
    const at = new Date(msg.created_at).getTime();
    const read = [];
    const pending = [];
    memberReads.forEach((m) => {
      const name = m.display_name || "Участник";
      if (m.chat_last_read && new Date(m.chat_last_read).getTime() >= at) read.push(name);
      else pending.push(name);
    });
    return { read, pending };
  }

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

  // Две различни разстояния нарочно: списъкът се влачи надолу сам само ако
  // сме почти долу, а бутонът се появява доста по-късно — иначе би мигал при
  // всяко леко превъртане.
  function handleScroll(e) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    atBottom.current = fromBottom < 120;
    setShowJump(fromBottom > 400);
  }

  function jumpToLatest() {
    atBottom.current = true;
    setShowJump(false);
    flatRef.current?.scrollToEnd({ animated: true });
  }

  async function openLink(url) {
    try {
      if (MAP_URL.test(url)) {
        await Linking.openURL(url);
        return;
      }
      try {
        const WebBrowser = require("expo-web-browser");
        if (WebBrowser?.openBrowserAsync) {
          await WebBrowser.openBrowserAsync(url, {
            toolbarColor: colors.surface,
            controlsColor: colors.brand600,
            dismissButtonStyle: "close",
            enableBarCollapsing: true,
          });
          return;
        }
      } catch {
        // Билдът няма нативния модул — минаваме към системния браузър.
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Не мога да отворя линка", url);
    }
  }

  // Дългото натискане върху линк трябва да отваря същото меню като върху
  // останалата част от балона — иначе редакцията и изтриването изчезват за
  // съобщения, които са само линк.
  function renderMessageText(item, isMe) {
    const parts = splitByLinks(item.text);
    const textStyle = [styles.msgText, isMe && styles.msgTextMe];

    if (parts.length === 1 && !parts[0].url) {
      return <Text style={textStyle}>{item.text}</Text>;
    }

    return (
      <Text style={textStyle}>
        {parts.map((part, i) =>
          part.url ? (
            <Text
              key={`l${i}`}
              style={[styles.link, isMe && styles.linkMe]}
              onPress={() => openLink(part.url)}
              onLongPress={() => handleLongPress(item)}
            >
              {part.text}
            </Text>
          ) : (
            part.text
          )
        )}
      </Text>
    );
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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <View style={styles.headerTitleRow}>
            <MessageSquare size={24} color={colors.brand600} strokeWidth={1.75} />
            <Text style={styles.headerTitle}>Чат</Text>
          </View>
          <Text style={styles.headerSub}>{tripName}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand600} />
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={grouped}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          onScroll={handleScroll}
          scrollEventThrottle={64}
          // Ново съобщение сваля списъка надолу само ако човекът вече е долу.
          // Иначе четенето на стар разговор се прекъсваше от всяко пристигащо
          // съобщение — екранът просто отскачаше.
          onContentSizeChange={() => {
            if (atBottom.current) flatRef.current?.scrollToEnd({ animated: false });
          }}
          renderItem={({ item }) => {
            if (item.type === "date") {
              return (
                <View style={styles.dateSep}>
                  <Text style={styles.dateText}>{formatDate(item.date)}</Text>
                </View>
              );
            }
            const isMe = item.user_id === userId;
            const readStatus = isMe ? getReadStatus(item.id, item.created_at) : null;

            return (
              <View style={[styles.msgWrapper, isMe && styles.msgWrapperMe]}>
                <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
                  {!isMe && (
                    <View style={[styles.avatar, { backgroundColor: avatarColor(item.user_id) }]}>
                      <Text style={styles.avatarText}>
                        {(item.display_name || "?")[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <TouchableWithoutFeedback onLongPress={() => handleLongPress(item)}>
                    <View style={[styles.bubble, isMe && styles.bubbleMe]}>
                      {!isMe && <Text style={styles.senderName}>{item.display_name}</Text>}
                      {item.plan_id ? (
                        // Споделен AI план — карта с бутон към Планера, не целия
                        // текст на плана (иначе чатът се задръства при дълъг план).
                        <View style={styles.planCard}>
                          {renderMessageText(item, isMe)}
                          <TouchableOpacity
                            style={[styles.planCardBtn, isMe && styles.planCardBtnMe]}
                            onPress={() => onOpenPlan && onOpenPlan(item.plan_id)}
                          >
                            <Text style={[styles.planCardBtnText, isMe && styles.planCardBtnTextMe]}>🗺 Отвори плана →</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        renderMessageText(item, isMe)
                      )}
                      <View style={styles.timeLine}>
                        <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>
                          {formatTime(item.created_at)}
                          {item.updated_at ? " · редактирано" : ""}
                        </Text>
                      </View>
                    </View>
                  </TouchableWithoutFeedback>
                </View>
                {readStatus && (
                  <TouchableOpacity
                    style={styles.tickRow}
                    onPress={() => setReadInfo(item)}
                    activeOpacity={0.6}
                  >
                    <Text style={readStatus === "read" ? styles.tickRead : styles.tickDelivered}>
                      {readStatus === "read" ? "✓✓ Прочетено" : "✓✓ Доставено"}
                    </Text>
                  </TouchableOpacity>
                )}
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

      {showJump && !editingMsg && (
        <TouchableOpacity
          style={[styles.jumpBtn, { bottom: insets.bottom + 76 }]}
          onPress={jumpToLatest}
          activeOpacity={0.85}
          accessibilityLabel="Към последното съобщение"
        >
          <Text style={styles.jumpBtnIcon}>↓</Text>
        </TouchableOpacity>
      )}

      {editingMsg ? (
        <View style={[styles.editBar, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.editBarTop}>
            <Text style={styles.editBarLabel}>✏️ Редактиране</Text>
            <TouchableOpacity onPress={cancelEdit}>
              <Text style={styles.editBarCancel}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.editBarRow}>
            <TextInput
              ref={editInputRef}
              style={styles.editBarInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              maxLength={500}
              placeholderTextColor={colors.text400}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !editText.trim() && styles.sendBtnDisabled]}
              onPress={handleSaveEdit}
              disabled={!editText.trim()}
            >
              <Text style={styles.sendIcon}>✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={styles.input}
            placeholder="Напиши съобщение..."
            placeholderTextColor={colors.text400}
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
      )}
      <Modal visible={!!readInfo} animationType="fade" transparent onRequestClose={() => setReadInfo(null)}>
        <TouchableWithoutFeedback onPress={() => setReadInfo(null)}>
          <View style={styles.readOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.readSheet}>
                <Text style={styles.readTitle}>Кой е прочел</Text>
                {readInfo && (
                  <>
                    <Text style={styles.readQuote} numberOfLines={2}>„{readInfo.text}"</Text>
                    {(() => {
                      const { read, pending } = readersFor(readInfo);
                      return (
                        <>
                          <Text style={styles.readGroupLabel}>
                            ✓✓ Прочели ({read.length})
                          </Text>
                          {read.length === 0
                            ? <Text style={styles.readEmpty}>Още никой</Text>
                            : read.map((n) => <Text key={`r-${n}`} style={styles.readName}>{n}</Text>)}

                          <Text style={styles.readGroupLabel}>
                            Още не ({pending.length})
                          </Text>
                          {pending.length === 0
                            ? <Text style={styles.readEmpty}>Никой не остана</Text>
                            : pending.map((n) => <Text key={`p-${n}`} style={styles.readNamePending}>{n}</Text>)}
                        </>
                      );
                    })()}
                    <Text style={styles.readNote}>
                      „Прочел" значи, че човекът е отварял чата след това съобщение.
                    </Text>
                  </>
                )}
                <TouchableOpacity style={styles.readClose} onPress={() => setReadInfo(null)}>
                  <Text style={styles.readCloseText}>Затвори</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface, paddingBottom: space.md,
    paddingHorizontal: space.lg, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { marginRight: space.md },
  backText: { ...type.body, color: colors.brand600 },
  headerInfo: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerTitle: { ...type.subhead, fontWeight: "bold", color: colors.text900, fontFamily: "GolosText_700Bold" },
  headerSub: { fontSize: 12, lineHeight: 16, color: colors.text600, marginTop: space.xs },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: space.lg, paddingBottom: space.sm },
  dateSep: { alignItems: "center", marginVertical: space.md },
  dateText: {
    fontSize: 12, lineHeight: 16, color: colors.text600, backgroundColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.control,
  },
  msgWrapper: { marginBottom: space.sm },
  msgWrapperMe: { alignItems: "flex-end" },
  msgRow: { flexDirection: "row", alignItems: "flex-end" },
  msgRowMe: { flexDirection: "row-reverse" },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: AVATAR_COLORS[0], alignItems: "center", justifyContent: "center",
    marginRight: space.sm,
  },
  avatarText: { ...type.label, fontWeight: "bold", color: colors.onBrand, fontFamily: "GolosText_700Bold" },
  bubble: {
    maxWidth: "75%", backgroundColor: colors.surface,
    borderRadius: radius.card, borderBottomLeftRadius: 4,
    padding: space.md, paddingBottom: space.sm,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  bubbleMe: {
    backgroundColor: colors.brand600,
    borderBottomLeftRadius: radius.card, borderBottomRightRadius: 4,
    marginLeft: space.sm,
  },
  senderName: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.brand600, marginBottom: space.xs },
  planCard: { gap: space.xs },
  planCardBtn: {
    marginTop: space.xs, alignSelf: "flex-start",
    backgroundColor: colors.bg, borderRadius: radius.control,
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  planCardBtnMe: { backgroundColor: "rgba(255,255,255,0.2)" },
  planCardBtnText: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.brand600 },
  planCardBtnTextMe: { color: colors.onBrand },
  msgText: { ...type.body, color: colors.text900 },
  msgTextMe: { color: colors.onBrand },
  jumpBtn: {
    position: "absolute", right: space.lg,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brand600,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  jumpBtnIcon: { color: colors.onBrand, fontSize: 22, lineHeight: 26, fontWeight: "700" },
  link: { color: colors.brand600, textDecorationLine: "underline" },
  linkMe: { color: colors.onBrand, textDecorationLine: "underline", fontWeight: "600" },
  timeLine: { flexDirection: "row", justifyContent: "flex-end", marginTop: space.xs },
  msgTime: { fontSize: 12, lineHeight: 16, color: colors.text400 },
  msgTimeMe: { color: colors.onBrandMuted },
  tickRow: { marginTop: space.xs, marginRight: space.xs },
  readOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", padding: space.lg,
  },
  readSheet: {
    width: "100%", maxWidth: 380, backgroundColor: colors.surface,
    borderRadius: radius.card, padding: space.lg,
  },
  readTitle: { ...type.subhead, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.text900 },
  readQuote: { ...type.body, color: colors.text600, fontStyle: "italic", marginTop: space.xs },
  readGroupLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.text600,
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: space.md,
  },
  readName: { ...type.body, color: colors.text900, marginTop: space.xs },
  readNamePending: { ...type.body, color: colors.text400, marginTop: space.xs },
  readEmpty: { ...type.body, color: colors.text400, fontStyle: "italic", marginTop: space.xs },
  readNote: { fontSize: 12, lineHeight: 16, color: colors.text400, marginTop: space.md },
  readClose: {
    marginTop: space.lg, backgroundColor: colors.brand600,
    borderRadius: radius.control, padding: space.md, alignItems: "center",
  },
  readCloseText: { ...type.label, fontWeight: "700", fontFamily: "GolosText_700Bold", color: colors.onBrand },
  tickRead: { fontSize: 12, lineHeight: 16, color: colors.brand600, fontWeight: "600" },
  tickDelivered: { fontSize: 12, lineHeight: 16, color: colors.text400, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: space.xxxl },
  emptyEmoji: { fontSize: 48, marginBottom: space.md },
  emptyText: { ...type.label, color: colors.text400, textAlign: "center" },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end",
    backgroundColor: colors.surface, paddingTop: space.md, paddingHorizontal: space.lg,
    borderTopWidth: 0.5, borderTopColor: colors.border,
  },
  input: {
    ...type.body,
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    color: colors.text900, maxHeight: 100, marginRight: space.md,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.brand600, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#ccc" },
  sendIcon: { color: colors.onBrand, fontSize: 16, marginLeft: space.xs },
  editBar: {
    backgroundColor: colors.surface, borderTopWidth: 0.5, borderTopColor: colors.border,
    paddingHorizontal: space.lg, paddingTop: space.sm,
  },
  editBarTop: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: space.sm,
  },
  editBarLabel: { fontSize: 12, lineHeight: 16, color: colors.brand600, fontWeight: "600" },
  editBarCancel: { fontSize: 18, color: colors.text400, padding: space.xs },
  editBarRow: { flexDirection: "row", alignItems: "flex-end" },
  editBarInput: {
    ...type.body,
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    color: colors.text900, maxHeight: 100, marginRight: space.md,
    borderWidth: 1.5, borderColor: colors.brand600,
  },
});
