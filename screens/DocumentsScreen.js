import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from "react-native";

export default function DocumentsScreen({ onBack }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <Text style={styles.title}>📁 Документи</Text>
      <Text style={styles.subtitle}>Резервации, билети и застраховки</Text>

      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>📄</Text>
        <Text style={styles.emptyTitle}>Няма документи все още</Text>
        <Text style={styles.emptyText}>Качи резервация, билет или застраховка — всички в групата ще я видят веднага.</Text>
      </View>

      <TouchableOpacity style={styles.btn}>
        <Text style={styles.btnText}>+ Качи документ</Text>
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
  subtitle: { fontSize: 14, color: "#888", marginBottom: 32 },
  empty: { alignItems: "center", padding: 40, backgroundColor: "#fff", borderRadius: 16, marginBottom: 20 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  emptyText: { fontSize: 14, color: "#888", textAlign: "center", lineHeight: 20 },
  btn: { backgroundColor: "#1D9E75", padding: 16, borderRadius: 14, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});
