import { StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Linking } from "react-native";
import { useState, useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sparkles } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors, space, radius, type } from "../theme/tokens";

const TRANSPORT_OPTIONS = ["коли", "самолет", "автобус", "влак", "смесен"];
const ACCOMMODATION_TYPES = ["хотел", "хостел", "къща", "къмпинг", "Airbnb", "апартамент", "семеен хотел"];
const COMFORT_OPTIONS = ["без значение", "3+ звезди", "4+ звезди", "5 звезди"];

// Разпознава URL адреси в отговора на AI-то, за да ги покажем като истински
// натискаеми линкове вместо суров текст.
const URL_SPLIT_REGEX = /(https?:\/\/[^\s)]+)/g;
const URL_TEST_REGEX = /^https?:\/\//;

function renderPlanText(text, linkStyle) {
  return text.split(URL_SPLIT_REGEX).map((segment, i) =>
    URL_TEST_REGEX.test(segment) ? (
      <Text key={i} style={linkStyle} onPress={() => Linking.openURL(segment)}>
        {segment}
      </Text>
    ) : (
      <Text key={i}>{segment}</Text>
    )
  );
}

export default function AIPlannerScreen({ onBack, trip, userId }) {
  // Реални safe area отстояния — без тях Android навигационната лента
  // застъпва бутона "Генерирай план", а status bar-ът закрива "← Назад".
  const insets = useSafeAreaInsets();
  // Бюджетът следва валутата на пътуването (зададена в TripSetup), за да е
  // консистентно с Разходи, вместо да е хардкоднат на лева/евро.
  const tripCurrency = trip?.local_currency || "EUR";
  // Планерът е достъпен и от началния екран без вписан потребител/пътуване
  // (маркетингова разходка) — запазване/споделяне/корекция изискват и двете.
  const canPersist = !!(trip?.id && userId);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(canPersist);
  const [displayName, setDisplayName] = useState("");
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const [sharing, setSharing] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);

  const [form, setForm] = useState({
    startPoint: "София",
    destination: "",
    waypoints: [],
    dates: (trip?.start_date && trip?.end_date) ? `${trip.start_date} - ${trip.end_date}` : "",
    families: "2",
    children: "3",
    budget: "",
    transport: "коли",
    accommodationType: null,
    comfort: "без значение",
  });

  // Ако пътуването вече си има запазен план, го показваме директно вместо
  // празна форма — така групата вижда последния съгласуван план при отваряне.
  useEffect(() => {
    if (!canPersist) return;
    supabase
      .from("trip_plans")
      .select("content")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.content) {
          setPlan(data.content);
          setSaveStatus("saved");
        }
      })
      .finally(() => setLoadingSavedPlan(false));
  }, [canPersist, trip?.id]);

  useEffect(() => {
    if (!canPersist) return;
    supabase
      .from("trip_members")
      .select("display_name")
      .eq("trip_id", trip.id)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || ""));
  }, [canPersist, trip?.id, userId]);

  const scrollPadding = { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 };

  function addWaypoint() {
    setForm(f => ({
      ...f,
      waypoints: [...f.waypoints, { id: `${Date.now()}-${f.waypoints.length}`, name: "", overnight: false }],
    }));
  }

  function updateWaypoint(id, patch) {
    setForm(f => ({ ...f, waypoints: f.waypoints.map(w => (w.id === id ? { ...w, ...patch } : w)) }));
  }

  function removeWaypoint(id) {
    setForm(f => ({ ...f, waypoints: f.waypoints.filter(w => w.id !== id) }));
  }

  async function generatePlan() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-trip-planner", {
        body: {
          startPoint: form.startPoint,
          destination: form.destination,
          waypoints: form.waypoints
            .filter(w => w.name.trim())
            .map(w => ({ name: w.name.trim(), overnight: w.overnight })),
          dates: form.dates,
          families: form.families,
          children: form.children,
          budget: form.budget,
          currency: tripCurrency,
          transport: form.transport,
          accommodationType: form.accommodationType || "без значение",
          comfort: form.comfort,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setPlan(data.plan);
      setSaveStatus(null);
    } catch (e) {
      alert("Грешка: " + e.message);
    }
    setLoading(false);
  }

  async function handleSaveToTrip() {
    if (!canPersist || !plan) return;
    setSaveStatus("saving");
    try {
      const { error } = await supabase.from("trip_plans").insert({
        trip_id: trip.id,
        created_by: userId,
        content: plan,
        params: form,
      });
      if (error) throw error;
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus(null);
      alert("Грешка при запазване: " + e.message);
    }
  }

  async function handleShareToChat() {
    if (!canPersist || !plan) return;
    setSharing(true);
    try {
      const { error } = await supabase.from("messages").insert({
        trip_id: trip.id,
        user_id: userId,
        display_name: displayName || "AI Планер",
        text: `📋 AI план за пътуването:\n\n${plan}`,
      });
      if (error) throw error;
      alert("Планът е споделен в чата.");
    } catch (e) {
      alert("Грешка: " + e.message);
    } finally {
      setSharing(false);
    }
  }

  async function handleRefine() {
    if (!feedback.trim() || !plan) return;
    setRefining(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-trip-planner", {
        body: { previousPlan: plan, feedback: feedback.trim(), currency: tripCurrency },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPlan(data.plan);
      setSaveStatus(null);
      setFeedback("");
      setShowRefine(false);
    } catch (e) {
      alert("Грешка: " + e.message);
    } finally {
      setRefining(false);
    }
  }

  function startNewPlan() {
    setPlan(null);
    setSaveStatus(null);
    setShowRefine(false);
    setFeedback("");
  }

  if (loadingSavedPlan) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.brand600} />
      </View>
    );
  }

  if (plan) {
    // Фиксирани хедър (← Назад) и футър (Запази/Сподели/Коригирай) извън
    // ScrollView-а — иначе при дълъг AI отговор трябва да скролираш чак
    // догоре за бутона за връщане и чак додолу за действията върху плана.
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.planHeader}>
          <TouchableOpacity onPress={onBack} style={styles.headerBackBtn}>
            <Text style={styles.backText}>← Назад</Text>
          </TouchableOpacity>
          <Text style={styles.planHeaderTitle}>🗺 Твоят план</Text>
        </View>

        <ScrollView style={styles.planScroll} contentContainerStyle={styles.planScrollContent}>
          <View style={styles.planBox}>
            <Text style={styles.planText}>{renderPlanText(plan, styles.planLink)}</Text>
          </View>
        </ScrollView>

        <View style={[styles.planFooter, { paddingBottom: insets.bottom + space.md }]}>
          {canPersist && !showRefine && (
            <View style={styles.planActionsRow}>
              <TouchableOpacity style={styles.planActionBtn} onPress={handleSaveToTrip} disabled={saveStatus === "saving"}>
                {saveStatus === "saving" ? <ActivityIndicator color={colors.brand600} /> : (
                  <Text style={styles.planActionText}>{saveStatus === "saved" ? "✓ Запазено" : "💾 Запази"}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.planActionBtn} onPress={handleShareToChat} disabled={sharing}>
                {sharing ? <ActivityIndicator color={colors.brand600} /> : <Text style={styles.planActionText}>📤 Сподели</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.planActionBtn} onPress={() => setShowRefine(true)}>
                <Text style={styles.planActionText}>✏️ Коригирай</Text>
              </TouchableOpacity>
            </View>
          )}

          {canPersist && showRefine && (
            <View style={styles.refineBox}>
              <Text style={styles.label}>Каква промяна искаш?</Text>
              <TextInput
                style={[styles.input, styles.refineInput]}
                placeholder="напр. искаме хотел по-близо до плажа"
                value={feedback}
                onChangeText={setFeedback}
                multiline
              />
              <View style={styles.refineBtnRow}>
                <TouchableOpacity style={styles.btnSecondarySmall} onPress={() => { setShowRefine(false); setFeedback(""); }}>
                  <Text style={styles.btnSecondarySmallText}>Отказ</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSmall} onPress={handleRefine} disabled={refining || !feedback.trim()}>
                  {refining ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnSmallText}>Обнови плана</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!showRefine && (
            <TouchableOpacity style={styles.newPlanLink} onPress={startNewPlan}>
              <Text style={styles.newPlanLinkText}>Нов план</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
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

      <Text style={styles.label}>Начална точка</Text>
      <TextInput style={styles.input} placeholder="напр. София" value={form.startPoint} onChangeText={v => setForm({...form, startPoint: v})} />

      <Text style={styles.label}>Крайна точка / дестинация (или остави празно за предложение)</Text>
      <TextInput style={styles.input} placeholder="напр. Тасос, Гърция" value={form.destination} onChangeText={v => setForm({...form, destination: v})} />

      <Text style={styles.label}>Междинни точки (по желание)</Text>
      {form.waypoints.map((w, idx) => (
        <View key={w.id} style={styles.waypointRow}>
          <TextInput
            style={[styles.input, styles.waypointInput]}
            placeholder={`Спирка ${idx + 1}`}
            value={w.name}
            onChangeText={v => updateWaypoint(w.id, { name: v })}
          />
          <TouchableOpacity
            style={[styles.overnightChip, w.overnight && styles.overnightChipActive]}
            onPress={() => updateWaypoint(w.id, { overnight: !w.overnight })}
          >
            <Text style={[styles.overnightChipText, w.overnight && styles.overnightChipTextActive]}>🌙 преспиване</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeWaypoint(w.id)} style={styles.removeWaypointBtn}>
            <Text style={styles.removeWaypointText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={addWaypoint} style={styles.addWaypointBtn}>
        <Text style={styles.addWaypointText}>+ Добави спирка</Text>
      </TouchableOpacity>

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

      <Text style={styles.label}>Бюджет ({tripCurrency})</Text>
      <TextInput style={styles.input} placeholder="напр. 2500" keyboardType="number-pad" value={form.budget} onChangeText={v => setForm({...form, budget: v})} />

      <Text style={styles.label}>Транспорт</Text>
      <View style={styles.transportRow}>
        {TRANSPORT_OPTIONS.map(t => (
          <TouchableOpacity key={t} style={[styles.transportBtn, form.transport === t && styles.transportActive]} onPress={() => setForm({...form, transport: t})}>
            <Text style={[styles.transportText, form.transport === t && styles.transportTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Тип настаняване</Text>
      <View style={styles.chipsWrap}>
        {ACCOMMODATION_TYPES.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.typeChip, form.accommodationType === t && styles.typeChipActive]}
            onPress={() => setForm({...form, accommodationType: form.accommodationType === t ? null : t})}
          >
            <Text style={[styles.typeChipText, form.accommodationType === t && styles.typeChipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Комфорт на настаняване</Text>
      <View style={styles.chipsWrap}>
        {COMFORT_OPTIONS.map(c => (
          <TouchableOpacity key={c} style={[styles.typeChip, form.comfort === c && styles.typeChipActive]} onPress={() => setForm({...form, comfort: c})}>
            <Text style={[styles.typeChipText, form.comfort === c && styles.typeChipTextActive]}>{c}</Text>
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
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.xl },
  back: { marginBottom: space.lg },
  backText: { ...type.body, color: colors.brand600 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  title: { ...type.title, color: colors.text900 },
  subtitle: { ...type.label, color: colors.text600, marginBottom: space.xl },
  label: { ...type.label, color: colors.text600, marginBottom: space.sm, marginTop: space.md },
  input: { ...type.body, backgroundColor: colors.surface, padding: space.lg, borderRadius: radius.control, borderWidth: 0.5, borderColor: colors.border },
  row: { flexDirection: "row", gap: space.md },
  half: { flex: 1 },
  waypointRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  waypointInput: { flex: 1, marginBottom: 0 },
  overnightChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  overnightChipActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  overnightChipText: { ...type.label, color: colors.text600, fontSize: 12 },
  overnightChipTextActive: { color: colors.onBrand },
  removeWaypointBtn: { padding: space.sm },
  removeWaypointText: { ...type.body, color: colors.text400 },
  addWaypointBtn: { alignSelf: "flex-start", marginBottom: space.md },
  addWaypointText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  transportRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  transportBtn: { minWidth: "30%", flexGrow: 1, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.surface },
  transportActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  transportText: { ...type.label, color: colors.text600 },
  transportTextActive: { color: colors.onBrand },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  typeChip: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  typeChipText: { ...type.label, color: colors.text600 },
  typeChipTextActive: { color: colors.onBrand, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  btn: { backgroundColor: colors.brand600, padding: space.lg, borderRadius: radius.card, alignItems: "center", marginTop: space.xl },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  btnText: { ...type.body, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  planHeader: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, backgroundColor: colors.bg, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  headerBackBtn: { paddingVertical: space.xs },
  planHeaderTitle: { ...type.title, color: colors.text900 },
  planScroll: { flex: 1 },
  planScrollContent: { padding: space.xl },
  planFooter: { paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: colors.bg, borderTopWidth: 0.5, borderTopColor: colors.border },
  planTitle: { ...type.title, color: colors.text900, marginBottom: space.lg },
  planBox: { backgroundColor: colors.surface, borderRadius: radius.card, padding: space.xl },
  planText: { ...type.body, color: colors.text900 },
  planLink: { ...type.body, color: colors.brand600, textDecorationLine: "underline" },
  planActionsRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  planActionBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand600, borderRadius: radius.control, padding: space.md, alignItems: "center" },
  planActionText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  newPlanLink: { alignItems: "center", padding: space.sm },
  newPlanLinkText: { ...type.label, color: colors.text600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  refineToggleBtn: { alignItems: "center", padding: space.md, marginBottom: space.md },
  refineToggleText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  refineBox: { backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, marginBottom: space.sm },
  refineInput: { minHeight: 80, textAlignVertical: "top", marginTop: space.sm },
  refineBtnRow: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  btnSecondarySmall: { flex: 1, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  btnSecondarySmallText: { ...type.label, color: colors.text600 },
  btnSmall: { flex: 1, backgroundColor: colors.brand600, padding: space.md, borderRadius: radius.control, alignItems: "center" },
  btnSmallText: { ...type.label, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
});
