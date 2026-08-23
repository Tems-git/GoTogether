import { StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sparkles } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors } from "../theme/tokens";

export default function AIPlannerScreen({ onBack, trip }) {
  // Реални safe area отстояния — без тях Android навигационната лента
  // застъпва бутона "Генерирай план", а status bar-ът закрива "← Назад".
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState({
    destination: "",
    dates: (trip?.start_date && trip?.end_date) ? `${trip.start_date} - ${trip.end_date}` : "",
    families: "2",
    children: "3",
    budget: "",
    transport: "коли",
  });

  const scrollPadding = { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 };

  async function generatePlan() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-trip-planner", {
        body: {
          destination: form.destination,
          dates: form.dates,
          families: form.families,
          children: form.children,
          budget: form.budget,
          transport: form.transport,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setPlan(data.plan);
    } catch (e) {
      alert("Грешка: " + e.message);
    }
    setLoading(false);
  }

  if (plan) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, scrollPadding]}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.planTitle}>🗺 Твоят план</Text>
        <View style={styles.planBox}>
          <Text style={styles.planText}>{plan}</Text>
        </View>
        <TouchableOpacity style={styles.btn} onPress={() => setPlan(null)}>
          <Text style={styles.btnText}>Нов план</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, scrollPadding]}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Sparkles size={24} color={colors.brand600} strokeWidth={1.75} />
        <Text style={styles.title}>AI Планиране</Text>
      </View>
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
        {loading ? <ActivityIndicator color={colors.onBrand} /> : (
          <View style={styles.btnRow}>
            <Sparkles size={20} color={colors.onBrand} strokeWidth={1.75} />
            <Text style={styles.btnText}>Генерирай план с AI</Text>
          </View>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 24 },
  back: { marginBottom: 16 },
  backText: { color: colors.brand600, fontSize: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: "bold", color: colors.text900 },
  subtitle: { fontSize: 14, color: colors.text600, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: "500", color: colors.text600, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, fontSize: 15, borderWidth: 0.5, borderColor: colors.border },
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1 },
  transportRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  transportBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.surface },
  transportActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  transportText: { fontSize: 13, color: colors.text600 },
  transportTextActive: { color: colors.onBrand, fontWeight: "500" },
  btn: { backgroundColor: colors.brand600, padding: 16, borderRadius: 14, alignItems: "center", marginTop: 24 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  btnText: { color: colors.onBrand, fontSize: 16, fontWeight: "bold" },
  planTitle: { fontSize: 22, fontWeight: "bold", color: colors.text900, marginBottom: 16 },
  planBox: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, marginBottom: 20 },
  planText: { fontSize: 14, color: colors.text900, lineHeight: 22 },
});
