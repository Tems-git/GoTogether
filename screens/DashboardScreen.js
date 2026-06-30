import { useState, useEffect, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, Alert, Share, Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabase";

const MAX_VISIBLE = 4;

export default function DashboardScreen({ user, trip, allTrips, onSignOut, onAI, onDocuments, onExpenses, onChat, onSwitchTrip, onNewTrip }) {
  const [copied, setCopied] = useState(false);
  const [tripPickerVisible, setTripPickerVisible] = useState(false);
  const [membersModalVisible, setMembersModalVisible] = useState(false);
  const [members, setMembers] = useState([]);
  const [removedMembers, setRemovedMembers] = useState([]);
  const [displayName, setDisplayName] = useState("");
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchMembers = useCallback(async () => {
    if (!trip?.id) return;
    const { data } = await supabase
      .from("trip_members")
      .select("user_id, display_name, role, weight")
      .eq("trip_id", trip.id);
    setMembers(data || []);
  }, [trip?.id]);

  const fetchRemovedMembers = useCallback(async () => {
    if (!trip?.id) return;
    const { data } = await supabase
      .from("removed_members")
      .select("id, user_id")
      .eq("trip_id", trip.id);
    if (data && data.length > 0) {
      const ids = data.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles").select("id, display_name").in("id", ids);
      const profileMap = {};
      (profiles || []).forEach((p) => { profileMap[p.id] = p.display_name; });
      setRemovedMembers(data.map((r) => ({ ...r, display_name: profileMap[r.user_id] || "Непознат" })));
    } else {
      setRemovedMembers([]);
    }
  }, [trip?.id]);

  useEffect(() => {
    fetchMembers();
    fetchRemovedMembers();
    if (!trip?.id) return;

    // Channel за trip_members
    const membersChannel = supabase
      .channel(`members-${trip.id}-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${trip.id}` },
        () => { fetchMembers(); fetchRemovedMembers(); }
      )
      .subscribe();

    // Отделен channel за removed_members — БЕЗ filter, защото DELETE events
    // не се филтрират надеждно по колони без специален индекс
    const removedChannel = supabase
      .channel(`removed-${trip.id}-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "removed_members" },
        (payload) => {
          // Проверяваме дали е за нашето пътуване
          const tripId = payload.new?.trip_id || payload.old?.trip_id;
          if (tripId === trip.id) {
            fetchMembers();
            fetchRemovedMembers();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(membersChannel);
      supabase.removeChannel(removedChannel);
    };
  }, [trip?.id, fetchMembers, fetchRemovedMembers, user.id]);

  useEffect(() => {
    if (membersModalVisible) {
      fetchMembers();
      fetchRemovedMembers();
    }
  }, [membersModalVisible, fetchMembers, fetchRemovedMembers]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name);
        else setDisplayName(user.email.split("@")[0]);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!trip?.id || !user?.id) return;

    async function fetchUnread() {
      const { data: member } = await supabase
        .from("trip_members")
        .select("chat_last_read")
        .eq("trip_id", trip.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const lastRead = member?.chat_last_read || "1970-01-01";

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("trip_id", trip.id)
        .neq("user_id", user.id)
        .gt("created_at", lastRead);

      setUnreadCount(count || 0);
    }

    fetchUnread();

    const channel = supabase
      .channel(`dashboard-chat-${trip.id}-${user.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${trip.id}` },
        (payload) => {
          if (payload.new.user_id !== user.id) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [trip?.id, user?.id]);

  async function handleSaveName() {
    const name = newName.trim();
    if (!name) return Alert.alert("Грешка", "Въведи ново име");
    setSavingName(true);
    try {
      await supabase.from("profiles").upsert({ id: user.id, display_name: name });
      if (trip?.id) {
        await supabase.from("trip_members")
          .update({ display_name: name })
          .eq("trip_id", trip.id)
          .eq("user_id", user.id);
      }
      setDisplayName(name);
      setEditNameVisible(false);
      setNewName("");
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setSavingName(false);
    }
  }

  async function handleSetWeight(memberId, newWeight) {
    if (newWeight < 1 || newWeight > 20) return;
    try {
      await supabase.from("trip_members")
        .update({ weight: newWeight })
        .eq("trip_id", trip.id)
        .eq("user_id", memberId);
      setMembers((prev) => prev.map((m) => m.user_id === memberId ? { ...m, weight: newWeight } : m));
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  async function handleRemoveMember(member) {
    Alert.alert(
      "Премахване",
      `Сигурен ли си, че искаш да премахнеш ${member.display_name}?\n\nМинали разходи си остават. Те няма да могат да се върнат без твоето разрешение.`,
      [
        { text: "Отказ", style: "cancel" },
        {
          text: "Премахни", style: "destructive",
          onPress: async () => {
            try {
              await supabase.from("removed_members").upsert({
                trip_id: trip.id,
                user_id: member.user_id,
              });
              await supabase.from("trip_members")
                .delete()
                .eq("trip_id", trip.id)
                .eq("user_id", member.user_id);
            } catch (e) {
              Alert.alert("Грешка", e.message);
            }
          }
        }
      ]
    );
  }

  async function handleUnblock(removed) {
    Alert.alert(
      "Деблокиране",
      `Разреши на ${removed.display_name} да се присъедини отново?`,
      [
        { text: "Отказ", style: "cancel" },
        {
          text: "Да, разреши", onPress: async () => {
            try {
              await supabase.from("removed_members")
                .delete()
                .eq("id", removed.id);
            } catch (e) {
              Alert.alert("Грешка", e.message);
            }
          }
        }
      ]
    );
  }

  const isOwner = members.find((m) => m.user_id === user.id)?.role === "owner";

  const cards = [
    { emoji: "🤖", title: "Планирай с AI", sub: "Ново пътуване", onPress: onAI, color: "#E1F5EE", badge: 0 },
    { emoji: "💬", title: "Чат", sub: "Групов чат", onPress: () => { setUnreadCount(0); onChat(); }, color: "#E8F4FD", badge: unreadCount },
    { emoji: "📁", title: "Документи", sub: "Резервации и билети", onPress: onDocuments, color: "#E6F1FB", badge: 0 },
    { emoji: "💸", title: "Разходи", sub: "Кой колко дължи", onPress: onExpenses, color: "#FAEEDA", badge: 0 },
  ];

  async function handleShare() {
    if (!trip?.invite_code) return;
    try {
      await Share.share({
        message: `Присъедини се към "${trip.name}" в GoTogether!\n\n1. Инсталирай Expo Go\n2. Отвори GoTogether\n3. Въведи код: ${trip.invite_code}`,
      });
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  async function handleCopyCode() {
    if (!trip?.invite_code) return;
    await Clipboard.setStringAsync(trip.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
  }

  function getInitials(name = "") {
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  }

  const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8"];
  const otherMembers = members.filter((m) => m.user_id !== user.id);
  const visibleMembers = otherMembers.slice(0, MAX_VISIBLE);
  const extraCount = otherMembers.length - MAX_VISIBLE;
  const hasWeights = members.some((m) => (m.weight || 1) > 1);

  const startDate = formatDate(trip?.start_date);
  const endDate = formatDate(trip?.end_date);
  const dateRange = startDate && endDate ? `${startDate} – ${endDate}` : startDate || null;

  const showMembersRow = otherMembers.length > 0 || isOwner;

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🧳</Text>
          <Text style={styles.appName}>GoTogether</Text>
          <TouchableOpacity style={styles.nameRow} onPress={() => { setNewName(displayName); setEditNameVisible(true); }}>
            <Text style={styles.displayName}>👤 {displayName}</Text>
            <Text style={styles.editIcon}>✏️</Text>
          </TouchableOpacity>
        </View>

        {trip && (
          <View style={styles.tripCard}>
            <View style={styles.tripTop}>
              <View style={styles.tripInfo}>
                <Text style={styles.tripName}>{trip.name}</Text>
                {trip.destination && <Text style={styles.tripDest}>📍 {trip.destination}</Text>}
                {dateRange && <Text style={styles.tripDates}>📅 {dateRange}</Text>}
              </View>
              <View style={styles.inviteBox}>
                <Text style={styles.inviteLabel}>Код</Text>
                <TouchableOpacity onPress={handleCopyCode}>
                  <Text style={styles.inviteCode}>{trip.invite_code}</Text>
                  <Text style={styles.inviteCopy}>{copied ? "✓ Копирано" : "докосни"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {showMembersRow && (
              <TouchableOpacity style={styles.membersRow} onPress={() => setMembersModalVisible(true)}>
                {visibleMembers.map((m, i) => (
                  <View key={m.user_id} style={[styles.avatar, { backgroundColor: COLORS[(i + 1) % COLORS.length], marginLeft: i > 0 ? -8 : 0 }]}>
                    <Text style={styles.avatarText}>{getInitials(m.display_name)}</Text>
                  </View>
                ))}
                {extraCount > 0 && (
                  <View style={[styles.avatar, styles.avatarExtra, { marginLeft: -8 }]}>
                    <Text style={styles.avatarExtraText}>+{extraCount}</Text>
                  </View>
                )}
                <Text style={styles.membersLabel}>
                  {otherMembers.length > 0
                    ? `${members.length} ${members.length === 1 ? "участник" : "участника"}${hasWeights ? " · с тегла" : ""}`
                    : "👥 Управление на участници"}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.switchBtn} onPress={() => setTripPickerVisible(true)}>
              <Text style={styles.switchBtnText}>🔄 Смени / добави пътуване</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.cards}>
          {cards.map((card, i) => (
            <TouchableOpacity key={i} style={[styles.card, { backgroundColor: card.color }]} onPress={card.onPress}>
              <View style={styles.cardEmojiWrap}>
                <Text style={styles.cardEmoji}>{card.emoji}</Text>
                {card.badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{card.badge > 99 ? "99+" : card.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardSub}>{card.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
          <Text style={styles.shareBtnText}>🔗 Покани участник</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOut} onPress={onSignOut}>
          <Text style={styles.signOutText}>Изход</Text>
        </TouchableOpacity>

      </ScrollView>

      <Modal visible={membersModalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>👥 Участници</Text>
            <Text style={styles.modalSubtitle}>Брой хора определя дела от разходите</Text>

            {members.map((m, i) => {
              const weight = m.weight || 1;
              const isMe = m.user_id === user.id;
              const canRemove = isOwner && !isMe;
              return (
                <View key={m.user_id} style={styles.memberRow}>
                  <View style={[styles.avatarLg, { backgroundColor: isMe ? "#1D9E75" : COLORS[i % COLORS.length] }]}>
                    <Text style={styles.avatarLgText}>{getInitials(m.display_name)}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberRowName}>{m.display_name}</Text>
                    <View style={styles.memberBadges}>
                      {isMe && <Text style={styles.memberYou}>ти</Text>}
                      {m.role === "owner" && <Text style={styles.memberOwner}>организатор</Text>}
                    </View>
                  </View>
                  <View style={styles.memberRight}>
                    <View style={styles.weightControl}>
                      <TouchableOpacity style={styles.weightBtn} onPress={() => handleSetWeight(m.user_id, weight - 1)} disabled={weight <= 1}>
                        <Text style={[styles.weightBtnText, weight <= 1 && { color: "#ccc" }]}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.weightVal}>{weight}</Text>
                      <TouchableOpacity style={styles.weightBtn} onPress={() => handleSetWeight(m.user_id, weight + 1)}>
                        <Text style={styles.weightBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    {canRemove && (
                      <TouchableOpacity onPress={() => handleRemoveMember(m)} style={styles.removeBtn}>
                        <Text style={styles.removeBtnText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {isOwner && (
              <View style={styles.blockedSection}>
                <Text style={styles.blockedTitle}>🚫 Блокирани</Text>
                {removedMembers.length === 0 ? (
                  <Text style={styles.blockedEmpty}>Няма блокирани участници</Text>
                ) : (
                  removedMembers.map((r) => (
                    <View key={r.id} style={styles.blockedRow}>
                      <Text style={styles.blockedName}>{r.display_name}</Text>
                      <TouchableOpacity onPress={() => handleUnblock(r)} style={styles.unblockBtn}>
                        <Text style={styles.unblockBtnText}>Деблокирай</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            )}

            <Text style={styles.weightHint}>💡 Смени броя хора за пропорционално делене на разходите</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setMembersModalVisible(false)}>
              <Text style={styles.modalCloseText}>Готово</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={editNameVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>Смени никнейм</Text>
            <TextInput
              style={styles.nameInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="Новото ти име"
              placeholderTextColor="#bbb"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveName}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => { setEditNameVisible(false); setNewName(""); }}>
                <Text style={styles.btnCancelText}>Отказ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSave} onPress={handleSaveName} disabled={savingName}>
                <Text style={styles.btnSaveText}>Запази</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={tripPickerVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>Пътувания</Text>
            {(allTrips || []).map((t) => (
              <TouchableOpacity key={t.id} style={[styles.tripOption, t.id === trip?.id && styles.tripOptionActive]}
                onPress={() => { setTripPickerVisible(false); if (t.id !== trip?.id) onSwitchTrip(t); }}>
                <View style={styles.tripOptionInfo}>
                  <Text style={[styles.tripOptionName, t.id === trip?.id && styles.tripOptionNameActive]}>{t.name}</Text>
                  {t.destination && <Text style={styles.tripOptionDest}>📍 {t.destination}</Text>}
                </View>
                {t.id === trip?.id && <Text style={styles.tripOptionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.newTripBtn} onPress={() => { setTripPickerVisible(false); onNewTrip(); }}>
              <Text style={styles.newTripBtnText}>+ Ново пътуване</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalClose} onPress={() => setTripPickerVisible(false)}>
              <Text style={styles.modalCloseText}>Затвори</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  header: { alignItems: "center", marginBottom: 20 },
  headerEmoji: { fontSize: 44, marginBottom: 6 },
  appName: { fontSize: 22, fontWeight: "bold", color: "#1D9E75" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  displayName: { fontSize: 14, color: "#555", fontWeight: "500" },
  editIcon: { fontSize: 12 },
  tripCard: {
    backgroundColor: "#1D9E75", borderRadius: 20, padding: 20, marginBottom: 24,
    shadowColor: "#1D9E75", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  tripTop: { flexDirection: "row", alignItems: "flex-start" },
  tripInfo: { flex: 1 },
  tripName: { fontSize: 20, fontWeight: "bold", color: "#fff", marginBottom: 6 },
  tripDest: { fontSize: 13, color: "#E1F5EE", marginBottom: 3 },
  tripDates: { fontSize: 13, color: "#E1F5EE" },
  inviteBox: { alignItems: "center", marginLeft: 12 },
  inviteLabel: { fontSize: 10, color: "#E1F5EE", marginBottom: 4, letterSpacing: 1 },
  inviteCode: {
    fontSize: 22, fontWeight: "bold", color: "#fff", letterSpacing: 4, textAlign: "center",
    backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  inviteCopy: { fontSize: 10, color: "#E1F5EE", textAlign: "center", marginTop: 4 },
  membersRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#1D9E75" },
  avatarText: { fontSize: 11, fontWeight: "bold", color: "#fff" },
  avatarExtra: { backgroundColor: "rgba(255,255,255,0.3)" },
  avatarExtraText: { fontSize: 10, fontWeight: "bold", color: "#fff" },
  membersLabel: { fontSize: 12, color: "#E1F5EE", marginLeft: 10 },
  switchBtn: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, padding: 10, alignItems: "center" },
  switchBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  card: { width: "47%", borderRadius: 16, padding: 20, alignItems: "center" },
  cardEmojiWrap: { position: "relative", marginBottom: 8 },
  cardEmoji: { fontSize: 32 },
  badge: {
    position: "absolute", top: -4, right: -8,
    backgroundColor: "#FF3B30", borderRadius: 10,
    minWidth: 18, height: 18, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  cardTitle: { fontSize: 15, fontWeight: "bold", color: "#1a1a1a" },
  cardSub: { fontSize: 12, color: "#666", marginTop: 4, textAlign: "center", fontWeight: "600" },
  shareBtn: { backgroundColor: "#fff", padding: 14, borderRadius: 12, alignItems: "center", marginBottom: 10, borderWidth: 1, borderColor: "#e0e0e0" },
  shareBtnText: { color: "#1D9E75", fontSize: 14, fontWeight: "600" },
  signOut: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  signOutText: { color: "#aaa", fontSize: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" },
  modalContent: { padding: 24, paddingBottom: 40 },
  modalInner: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#1a1a1a", marginBottom: 4 },
  modalSubtitle: { fontSize: 12, color: "#888", marginBottom: 16 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  avatarLg: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarLgText: { fontSize: 14, fontWeight: "bold", color: "#fff" },
  memberInfo: { flex: 1 },
  memberRowName: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  memberBadges: { flexDirection: "row", gap: 6, marginTop: 2 },
  memberYou: { fontSize: 11, color: "#1D9E75", backgroundColor: "#E1F5EE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  memberOwner: { fontSize: 11, color: "#888", backgroundColor: "#F5F5F5", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  memberRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  weightControl: { flexDirection: "row", alignItems: "center", gap: 6 },
  weightBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#F0F0F0", alignItems: "center", justifyContent: "center" },
  weightBtnText: { fontSize: 18, fontWeight: "bold", color: "#1D9E75", lineHeight: 22 },
  weightVal: { fontSize: 16, fontWeight: "bold", color: "#1a1a1a", minWidth: 20, textAlign: "center" },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFE8E8", alignItems: "center", justifyContent: "center" },
  removeBtnText: { fontSize: 13, color: "#FF3B30", fontWeight: "bold" },
  blockedSection: { marginTop: 20, borderTopWidth: 0.5, borderTopColor: "#f0f0f0", paddingTop: 16 },
  blockedTitle: { fontSize: 13, fontWeight: "700", color: "#888", marginBottom: 10 },
  blockedEmpty: { fontSize: 13, color: "#ccc", fontStyle: "italic" },
  blockedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  blockedName: { fontSize: 14, color: "#aaa", flex: 1 },
  unblockBtn: { backgroundColor: "#E1F5EE", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  unblockBtnText: { color: "#1D9E75", fontSize: 12, fontWeight: "600" },
  weightHint: { fontSize: 12, color: "#888", marginTop: 16, marginBottom: 8, textAlign: "center" },
  nameInput: { backgroundColor: "#F5F5F5", borderRadius: 12, padding: 14, fontSize: 16, color: "#1a1a1a", marginBottom: 16 },
  modalBtns: { flexDirection: "row", gap: 10 },
  btnCancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  btnCancelText: { color: "#888", fontSize: 15 },
  btnSave: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#1D9E75", alignItems: "center" },
  btnSaveText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  tripOption: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, marginBottom: 8, backgroundColor: "#F5F5F5" },
  tripOptionActive: { backgroundColor: "#E1F5EE", borderWidth: 1.5, borderColor: "#1D9E75" },
  tripOptionInfo: { flex: 1 },
  tripOptionName: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  tripOptionNameActive: { color: "#1D9E75" },
  tripOptionDest: { fontSize: 12, color: "#888", marginTop: 2 },
  tripOptionCheck: { fontSize: 18, color: "#1D9E75", fontWeight: "bold" },
  newTripBtn: { backgroundColor: "#1D9E75", padding: 14, borderRadius: 12, alignItems: "center", marginTop: 4, marginBottom: 8 },
  newTripBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  modalClose: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center", marginTop: 8 },
  modalCloseText: { color: "#888", fontSize: 15 },
});
