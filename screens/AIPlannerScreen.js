import { StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { useState } from "react";
import Markdown from "react-native-markdown-display";

const ANTHROPIC_KEY = "ANTHROPIC_KEY_HERE";

export default function AIPlannerScreen({ onBack }) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState({
    destination: "",
    dates: "",
    families: "2",
    children: "3",
    budget: "",
    transport: "коли",
  });

  async function generatePlan() {
    setLoading(true);
    try {
      const prompt = `Ти си експерт travel planner за семейни пътувания. Създай подробен план за следното пътуване:
- Дестинация: ${form.destination || "предложи ти"}
- Период: ${form.dates || "предложи ти"}
- Семейства: ${form.families}
- Деца: ${form.children}
- Бюджет: ${form.budget ? form.budget + " лв." : "предложи ти"}
- Транспорт: ${form.transport}
- Тръгваме от София, България

Отговори на български с:
1. МАРШРУТ — реално време за път от София, спирки, часове
2. НАСТАНЯВАНЕ — 2-3 варианта подходящи за деца с приблизителни цени
3. ПРОГРАМА — дневна програма с активности за деца
4. БЮДЖЕТ — разбивка по категории в лева
5. СЪВЕТИ — специфични за пътуване с деца`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await response.json();
      setPlan(data.content[0].text);
    } catch (e) {
      alert("Грешка: " + e.message);
    }
    setLoading(false);
  }

  if (plan) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.planTitle}>🗺 Твоят план</Text>
        <View style={styles.planBox}>
          <Markdown style={markdownStyles}>{plan}</Markdown>
        </View>
        <TouchableOpacity style={styles.btn} onPress={() => setPlan(null)}>
          <Text style={styles.btnText}>Нов план</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <Text style={styles.title}>🤖 AI Планиране</Text>
      <Text style={styles.subtitle}>Разкажи ни за пътуването и ще получиш готов план</Text>

      <Text style={styles.label}>Дестинация (или остави празно за предложение)</Text>
      <TextInput style={styles.input} placeholder="напр. Гърция, Халкидики" value={form.destination} onChangeText={v => setForm({...form, destination: v})} />

      <Text style={styles.label}>Период</Text>
      <TextInput style={styles.input} placeholder="напр. 15-22 юли 2025" value={form.dates} onChangeText={v => setForm({...form, dates: v})} />

      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={styles.label}>Семейства</Text>
          <TextInput style={styles.input} keyboardType="number-pad" value={form.families} onChangeText={v => setForm({...form, families: v})} />
        </View>
        <View style={styles.half}>
          <Text style={styles.label}>Деца</Text>
          <TextInput style={styles.input} keyboardType="number-pad" value={form.children} onChangeText={v => setForm({...form, children: v})} />
        </View>
      </View>

      <Text style={styles.label}>Бюджет (лв.)</Text>
      <TextInput style={styles.input} placeholder="напр. 5000" keyboardType="number-pad" value={form.budget} onChangeText={v => setForm({...form, budget: v})} />

      <Text style={styles.label}>Транспорт</Text>
      <View style={styles.transportRow}>
        {["коли", "самолет", "смесен"].map(t => (
          <TouchableOpacity key={t} style={[styles.transportBtn, form.transport === t && styles.transportActive]} onPress={() => setForm({...form, transport: t})}>
            <Text style={[styles.transportText, form.transport === t && styles.transportTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.btn} onPress={generatePlan} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Генерирай план с AI ✨</Text>}
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
  label: { fontSize: 13, fontWeight: "500", color: "#555", marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: "#fff", padding: 14, borderRadius: 12, fontSize: 15, borderWidth: 0.5, borderColor: "#ddd" },
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1 },
  transportRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  transportBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#ddd", alignItems: "center", backgroundColor: "#fff" },
  transportActive: { backgroundColor: "#1D9E75", borderColor: "#1D9E75" },
  transportText: { fontSize: 13, color: "#555" },
  transportTextActive: { color: "#fff", fontWeight: "500" },
  btn: { backgroundColor: "#1D9E75", padding: 16, borderRadius: 14, alignItems: "center", marginTop: 24 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  planTitle: { fontSize: 22, fontWeight: "bold", color: "#1a1a1a", marginBottom: 16 },
  planBox: { backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 20 },
});

const markdownStyles = {
  heading1: { fontSize: 20, fontWeight: "bold", color: "#1D9E75", marginBottom: 8, marginTop: 16 },
  heading2: { fontSize: 17, fontWeight: "bold", color: "#085041", marginBottom: 6, marginTop: 14 },
  heading3: { fontSize: 15, fontWeight: "600", color: "#333", marginBottom: 4, marginTop: 10 },
  body: { fontSize: 14, color: "#333", lineHeight: 22 },
  strong: { fontWeight: "bold", color: "#1a1a1a" },
  hr: { backgroundColor: "#eee", height: 1, marginVertical: 12 },
};
