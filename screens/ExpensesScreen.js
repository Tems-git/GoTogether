import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from "react-native";

export default function ExpensesScreen({ onBack }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <Text style={styles.title}>💸 Разходи</Text>
      <Text style={styles.subtitle}>Кой колко дължи</Text>
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>0 лв.</Text>
          <Text style={styles.summaryLbl}>Общо</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>0 лв.</Text>
          <Text style={styles.summaryLbl}>Ти дължиш</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>0 лв.</Text>
          <Text style={styles.summaryLbl}>Дължат ти</Text>
        </View>
      </View>
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>💰</Text>
        <Text style={styles.emptyTitle}>Няма разходи все още</Text>
        <Text style={styles.emptyText}>Добави първия разход и системата ще пресметне кой колко дължи.</Text>
      </View>
      <TouchableOpacity style={styles.btn}>
        <Text style={styles.btnText}>+ Добави разход</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  scroll: { padding: 24, paddingTop: 60 },
  back: { marginBottom: 16 },
  backText: { color: "#1D9E75", fontSize: 16 },
  title: { fontSize: 26, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#888", marginBottom: 24 },
  summary: { backgroundColor: "#1D9E75", borderRadius: 16, padding: 20, flexDirection: "row", marginBottom: 24 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryVal: { fontSize: 18, fontWeight: "bold", color: "#fff" },
  summaryLbl: { fontSize: 11, color: "#E1F5EE", marginTop: 4 },
  divider: { width: 0.5, backgroundColor: "rgba(255,255,255,0.3)" },
  empty: { alignItems: "center", padding: 40, backgroundColor: "#fff", borderRadius: 16, marginBottom: 20 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  emptyText: { fontSize: 14, color: "#888", textAlign: "center", lineHeight: 20 },
  btn: { backgroundColor: "#1D9E75", padding: 16, borderRadius: 14, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});
