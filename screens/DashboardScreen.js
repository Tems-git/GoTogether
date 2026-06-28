import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, Alert, Share, Clipboard, Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function DashboardScreen({ user, trip, allTrips, onSignOut, onAI, onDocuments, onExpenses, onSwitchTrip, onNewTrip }) {
  const [copied, setCopied] = useState(false);
  const [tripPickerVisible, setTripPickerVisible] = useState(false);
  const [members, setMembers] = useState([]);
  const [displayName, setDisplayName] = useState("");
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!trip?.id) return;
    supabase
      .from("trip_members")
      .select("user_id, display_name, role")
      .eq("trip_id", trip.id)
      .then(({ data }) => setMembers(data || []));
  }, [trip?.id]);

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

  const cards = [
    { emoji: "🤖", title: "Планирай с AI", sub: "Ново пътуване", onPress: onAI, color: "#E1F5EE" },
    { emoji: "📁", title: "Документи", sub: "Резервации и билети", onPress: onDocuments, color: "#E6F1FB" },
    { emoji: "💸", title: "Разходи", sub: "Кой колко дължи", onPress: onExpenses, color: "#FAEEDA" },
    { emoji: "🔗", title: "Покани", sub: trip?.invite_code || "...", onPress: handleShare, color: "#FCEBEB" },
  ];

  async function handleShare() {
    if (!trip?.invite_code) return;
    try {
      await Share.share({
        message: `Присъедини се към "${trip.name}" в GoTogether!\nКод за покана: ${trip.invite_code}`,
      });
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  function handleCopyCode() {
    if (!trip?.invite_code) return;
    Clipboard.setString(trip.invite_code);
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

  const startDate = formatDate(trip?.start_date);
  const endDate = formatDate(trip?.end_date);
  const dateRange = startDate && endDate ? `${startDate} – ${endDate}` : startDate || null;

  return (
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

          {otherMembers.length > 0 && (
            <View style={styles.membersRow}>
              {otherMembers.map((m, i) => (
                <View key={m.user_id} style={styles.memberChip}>
                  <View style={[styles.avatar, { backgroundColor: COLORS[(i + 1) % COLORS.length] }]}>
                    <Text style={styles.avatarText}>{getInitials(m.display_name)}</Text>
                  </View>
                  <Text style={styles.memberName}>{m.display_name}</Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.switchBtn} onPress={() => setTripPickerVisible(true)}>
            <Text style={styles.switchBtnText}>🔄 Смени / добави пътуване</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.cards}>
        {cards.map((card, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.card, { backgroundColor: card.color }]}
            onPress={card.onPress}
            disabled={!card.onPress}
          >
            <Text style={styles.cardEmoji}>{card.emoji}</Text>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardSub}>{card.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.signOut} onPress={onSignOut}>
        <Text style={styles.signOutText}>Изход</Text>
      </TouchableOpacity>

      {/* Edit name modal */}
      <Modal visible={editNameVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modal}>
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

      {/* Trip picker modal */}
      <Modal visible={tripPickerVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Пътувания</Text>
            {(allTrips || []).map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.tripOption, t.id === trip?.id && styles.tripOptionActive]}
                onPress={() => {
                  setTripPickerVisible(false);
                  if (t.id !== trip?.id) onSwitchTrip(t);
                }}
              >
                <View style={styles.tripOptionInfo}>
                  <Text style={[styles.tripOptionName, t.id === trip?.id && styles.tripOptionNameActive]}>
                    {t.name}
                  </Text>
                  {t.destination && <Text style={styles.tripOptionDest}>📍 {t.destination}</Text>}
                </View>
                {t.id === trip?.id && <Text style={styles.tripOptionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.newTripBtn}
              onPress={() => { setTripPickerVisible(false); onNewTrip(); }}
            >
              <Text style={styles.newTripBtnText}>+ Ново пътуване</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalClose} onPress={() => setTripPickerVisible(false)}>
              <Text style={styles.modalCloseText}>Затвори</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  header: { alignItems: "center", marginBottom: 20 },
  headerEmoji: { fontSize: 44, marginBottom: 6 },
  appName: { fontSize: 22, fontWeight: "bold", color: "#1D9E75" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  displayName: { fontSize: 14, color: "#555", fontWeight: "500" },
  editIcon: { fontSize: 12 },
  tripCard: {
    backgroundColor: "#1D9E75", borderRadius: 20, padding: 20,
    marginBottom: 24, shadowColor: "#1D9E75", shadowOpacity: 0.3,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  tripTop: { flexDirection: "row", alignItems: "flex-start" },
  tripInfo: { flex: 1 },
  tripName: { fontSize: 20, fontWeight: "bold", color: "#fff", marginBottom: 6 },
  tripDest: { fontSize: 13, color: "#E1F5EE", marginBottom: 3 },
  tripDates: { fontSize: 13, color: "#E1F5EE" },
  inviteBox: { alignItems: "center", marginLeft: 12 },
  inviteLabel: { fontSize: 10, color: "#E1F5EE", marginBottom: 4, letterSpacing: 1 },
  inviteCode: {
    fontSize: 22, fontWeight: "bold", color: "#fff",
    letterSpacing: 4, textAlign: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  inviteCopy: { fontSize: 10, color: "#E1F5EE", textAlign: "center", marginTop: 4 },
  membersRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  memberChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.4)",
  },
  avatarText: { fontSize: 11, fontWeight: "bold", color: "#fff" },
  memberName: { fontSize: 13, color: "#E1F5EE", fontWeight: "500" },
  switchBtn: {
    marginTop: 14, backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10, padding: 10, alignItems: "center",
  },
  switchBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  card: { width: "47%", borderRadius: 16, padding: 20, alignItems: "center" },
  cardEmoji: { fontSize: 32, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "bold", color: "#1a1a1a" },
  cardSub: { fontSize: 12, color: "#666", marginTop: 4, textAlign: "center", fontWeight: "600" },
  signOut: {
    marginTop: 24, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: "#ddd", alignItems: "center",
  },
  signOutText: { color: "#aaa", fontSize: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#1a1a1a", marginBottom: 16 },
  nameInput: {
    backgroundColor: "#F5F5F5", borderRadius: 12, padding: 14,
    fontSize: 16, color: "#1a1a1a", marginBottom: 16,
  },
  modalBtns: { flexDirection: "row", gap: 10 },
  btnCancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  btnCancelText: { color: "#888", fontSize: 15 },
  btnSave: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#1D9E75", alignItems: "center" },
  btnSaveText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  tripOption: {
    flexDirection: "row", alignItems: "center",
    padding: 14, borderRadius: 12, marginBottom: 8, backgroundColor: "#F5F5F5",
  },
  tripOptionActive: { backgroundColor: "#E1F5EE", borderWidth: 1.5, borderColor: "#1D9E75" },
  tripOptionInfo: { flex: 1 },
  tripOptionName: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  tripOptionNameActive: { color: "#1D9E75" },
  tripOptionDest: { fontSize: 12, color: "#888", marginTop: 2 },
  tripOptionCheck: { fontSize: 18, color: "#1D9E75", fontWeight: "bold" },
  newTripBtn: {
    backgroundColor: "#1D9E75", padding: 14, borderRadius: 12,
    alignItems: "center", marginTop: 4, marginBottom: 8,
  },
  newTripBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  modalClose: {
    padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: "#ddd", alignItems: "center",
  },
  modalCloseText: { color: "#888", fontSize: 15 },
});
