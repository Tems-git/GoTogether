import { StyleSheet, Text, View, TouchableOpacity } from "react-native";

export default function DashboardScreen({ user, onSignOut, onAI, onDocuments, onExpenses }) {
  const cards = [
    { emoji: "🤖", title: "Планирай с AI", sub: "Ново пътуване", onPress: onAI, color: "#E1F5EE" },
    { emoji: "📁", title: "Документи", sub: "Резервации и билети", onPress: onDocuments, color: "#E6F1FB" },
    { emoji: "💸", title: "Разходи", sub: "Кой колко дължи", onPress: onExpenses, color: "#FAEEDA" },
    { emoji: "🔗", title: "Покани", sub: "Добави членове", onPress: null, color: "#FCEBEB" },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.emoji}>🧳</Text>
        <Text style={styles.title}>GoTogether</Text>
        <Text style={styles.email}>{user.email}</Text>
      </View>
      <View style={styles.cards}>
        {cards.map((card, i) => (
          <TouchableOpacity key={i} style={[styles.card, { backgroundColor: card.color }]} onPress={card.onPress} disabled={!card.onPress}>
            <Text style={styles.cardEmoji}>{card.emoji}</Text>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardSub}>{card.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.signOut} onPress={onSignOut}>
        <Text style={styles.signOutText}>Изход</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5", padding: 24, paddingTop: 60 },
  header: { alignItems: "center", marginBottom: 32 },
  emoji: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "bold", color: "#1D9E75" },
  email: { fontSize: 14, color: "#888", marginTop: 4 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: { width: "47%", borderRadius: 16, padding: 20, alignItems: "center" },
  cardEmoji: { fontSize: 32, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "bold", color: "#1a1a1a" },
  cardSub: { fontSize: 12, color: "#666", marginTop: 4, textAlign: "center" },
  signOut: { marginTop: 32, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  signOutText: { color: "#888", fontSize: 14 },
});
