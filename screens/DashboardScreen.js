import { useState } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, Alert, Share, Clipboard,
} from "react-native";

export default function DashboardScreen({ user, trip, onSignOut, onAI, onDocuments, onExpenses }) {
  const [copied, setCopied] = useState(false);

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

  const startDate = formatDate(trip?.start_date);
  const endDate = formatDate(trip?.end_date);
  const dateRange = startDate && endDate
    ? `${startDate} – ${endDate}`
    : startDate || null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>🧳</Text>
        <Text style={styles.appName}>GoTogether</Text>
        <Text style={styles.email}>{user.email}</Text>
      </View>

      {/* Trip card */}
      {trip && (
        <View style={styles.tripCard}>
          <View style={styles.tripTop}>
            <View style={styles.tripInfo}>
              <Text style={styles.tripName}>{trip.name}</Text>
              {trip.destination && (
                <Text style={styles.tripDest}>📍 {trip.destination}</Text>
              )}
              {dateRange && (
                <Text style={styles.tripDates}>📅 {dateRange}</Text>
              )}
            </View>
            <View style={styles.inviteBox}>
              <Text style={styles.inviteLabel}>Код</Text>
              <TouchableOpacity onPress={handleCopyCode}>
                <Text style={styles.inviteCode}>{trip.invite_code}</Text>
                <Text style={styles.inviteCopy}>{copied ? "✓ Копирано" : "докосни"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Cards */}
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

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 40 },

  header: { alignItems: "center", marginBottom: 20 },
  headerEmoji: { fontSize: 44, marginBottom: 6 },
  appName: { fontSize: 22, fontWeight: "bold", color: "#1D9E75" },
  email: { fontSize: 13, color: "#aaa", marginTop: 2 },

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
});
