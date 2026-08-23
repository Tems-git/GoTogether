import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import DatePicker from "../components/DatePicker";
import { colors } from "../theme/tokens";

// Местна валута на пътуването — показва се като втори ред до EUR сумите в
// Разходи → Как да се изравним. EUR по подразбиране.
// Не включваме валути, които вече не съществуват в ECB feed-а (напр. BGN
// след влизането на България в еврозоната) — иначе toEUR() не намира курс
// и третира сумата като EUR, което дава грешни изравнявания.
const LOCAL_CURRENCY_OPTIONS = ["EUR", "USD", "GBP", "CHF"];

export default function TripSetupScreen({ user, onTripReady, pendingInviteCode, onBack }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [localCurrency, setLocalCurrency] = useState("EUR");
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [inviteCode, setInviteCode] = useState(pendingInviteCode || "");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingTrip, setPendingTrip] = useState(null);

  useEffect(() => {
    if (pendingInviteCode) {
      setMode("join");
      setInviteCode(pendingInviteCode);
    }
  }, [pendingInviteCode]);

  async function getOrCreateProfile() {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    return profile;
  }

  async function handleCreate() {
    if (!name.trim()) return Alert.alert("Грешка", "Въведи име на пътуването");

    // Валидацията на формат/валидност вече е гарантирана от DatePicker —
    // тук проверяваме само крос-полева зависимост (край след начало).
    if (startDate && endDate && endDate < startDate) {
      return Alert.alert("Грешка", "Крайната дата трябва да е след началната");
    }

    setLoading(true);
    try {
      const profile = await getOrCreateProfile();
      if (!profile) {
        await supabase.from("profiles").insert({
          id: user.id,
          display_name: user.email.split("@")[0],
        });
      }

      const { data: trip, error } = await supabase
        .from("trips")
        .insert({
          owner_id: user.id,
          name: name.trim(),
          destination: destination.trim() || null,
          local_currency: localCurrency,
          start_date: startDate,
          end_date: endDate,
        })
        .select()
        .single();
      if (error) throw error;

      const memberName = profile?.display_name || user.email.split("@")[0];
      const { error: memberError } = await supabase.from("trip_members").insert({
        trip_id: trip.id,
        user_id: user.id,
        display_name: memberName,
        role: "owner",
      });
      if (memberError) throw memberError;

      onTripReady(trip);
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!inviteCode.trim()) return Alert.alert("Грешка", "Въведи код за покана");
    setLoading(true);
    try {
      const { data: trip, error } = await supabase
        .from("trips")
        .select()
        .eq("invite_code", inviteCode.trim().toUpperCase())
        .maybeSingle();
      if (error || !trip) throw new Error("Невалиден код за покана");

      // Проверяваме дали вече е член
      const { data: existing } = await supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", trip.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        onTripReady(trip);
        return;
      }

      // Проверяваме blacklist
      const { data: blocked } = await supabase
        .from("removed_members")
        .select("id")
        .eq("trip_id", trip.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (blocked) {
        throw new Error("Нямаш достъп до това пътуване. Свържи се с организатора.");
      }

      const profile = await getOrCreateProfile();
      const defaultName = user.email.split("@")[0];
      const hasRealName = profile?.display_name && profile.display_name !== defaultName;

      if (!hasRealName) {
        setPendingTrip(trip);
        setLoading(false);
        return;
      }

      const { error: joinError } = await supabase.from("trip_members").insert({
        trip_id: trip.id,
        user_id: user.id,
        display_name: profile.display_name,
        role: "member",
      });
      if (joinError) throw joinError;
      onTripReady(trip);
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmName() {
    const trimmedName = displayName.trim();
    if (!trimmedName) return Alert.alert("Грешка", "Въведи твоето име");
    setLoading(true);
    try {
      await supabase.from("profiles").upsert({
        id: user.id,
        display_name: trimmedName,
      });

      const { error: joinError } = await supabase.from("trip_members").insert({
        trip_id: pendingTrip.id,
        user_id: user.id,
        display_name: trimmedName,
        role: "member",
      });
      if (joinError) throw joinError;
      onTripReady(pendingTrip);
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setLoading(false);
    }
  }

  if (pendingTrip) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[styles.container, styles.namePad, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.emoji}>👋</Text>
            <Text style={styles.title}>Как се казваш?</Text>
            <Text style={styles.subtitle}>
              Членовете на „{pendingTrip.name}" ще те виждат с това име
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Напр. Спас"
              placeholderTextColor={colors.text400}
              value={displayName}
              onChangeText={setDisplayName}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleConfirmName}
            />
            <TouchableOpacity style={styles.btnPrimary} onPress={handleConfirmName} disabled={loading}>
              {loading ? <ActivityIndicator color={colors.brand600} /> : <Text style={styles.btnPrimaryText}>Присъедини се →</Text>}
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}
    >
      {onBack && (
        <TouchableOpacity style={styles.backTop} onPress={onBack}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.emoji}>🧳</Text>
      <Text style={styles.title}>Добре дошъл!</Text>
      <Text style={styles.subtitle}>Създай ново пътуване или се присъедини към съществуващо</Text>

      {!mode && (
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setMode("create")}>
            <Text style={styles.btnPrimaryText}>+ Ново пътуване</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => setMode("join")}>
            <Text style={styles.btnSecondaryText}>Присъедини се с код</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === "create" && (
        <View style={styles.form}>
          <Text style={styles.label}>Име на пътуването *</Text>
          <TextInput
            style={styles.input}
            placeholder="Напр. Лято 2025 в Гърция"
            value={name}
            onChangeText={setName}
            placeholderTextColor={colors.text400}
          />
          <Text style={styles.label}>Дестинация</Text>
          <TextInput
            style={styles.input}
            placeholder="Напр. Солун"
            value={destination}
            onChangeText={setDestination}
            placeholderTextColor={colors.text400}
          />
          <Text style={styles.label}>Дати на пътуването</Text>
          <Text style={styles.hint}>По желание</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Начална дата"
              />
            </View>
            <Text style={styles.dateSep}>→</Text>
            <View style={styles.dateCol}>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="Крайна дата"
                minDate={startDate}
              />
            </View>
          </View>
          <Text style={styles.label}>Местна валута</Text>
          <Text style={styles.hint}>Показва се до EUR сумите при изравняване на разходите</Text>
          <View style={styles.currencyRow}>
            {LOCAL_CURRENCY_OPTIONS.map((code) => (
              <TouchableOpacity
                key={code}
                style={[styles.currencyChip, localCurrency === code && styles.currencyChipActive]}
                onPress={() => setLocalCurrency(code)}
              >
                <Text style={[styles.currencyChipText, localCurrency === code && styles.currencyChipTextActive]}>
                  {code}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand600} /> : <Text style={styles.btnPrimaryText}>Създай пътуване</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.back} onPress={() => setMode(null)}>
            <Text style={styles.backText}>← Назад</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === "join" && (
        <View style={styles.form}>
          <Text style={styles.label}>Код за покана</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="XXXXXX"
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="characters"
            maxLength={6}
            placeholderTextColor={colors.text400}
          />
          <TouchableOpacity style={styles.btnPrimary} onPress={handleJoin} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand600} /> : <Text style={styles.btnPrimaryText}>Присъедини се</Text>}
          </TouchableOpacity>
          {!pendingInviteCode && (
            <TouchableOpacity style={styles.back} onPress={() => setMode(null)}>
              <Text style={styles.backText}>← Назад</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.brand600 },
  container: { flex: 1, backgroundColor: colors.brand600 },
  namePad: { paddingHorizontal: 24 },
  scroll: { paddingHorizontal: 24, alignItems: "center", minHeight: "100%" },
  emoji: { fontSize: 64, marginBottom: 16, textAlign: "center" },
  title: { fontSize: 28, fontWeight: "bold", color: colors.onBrand, marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 15, color: colors.onBrandMuted, textAlign: "center", marginBottom: 40, lineHeight: 22, paddingHorizontal: 24 },
  buttons: { width: "100%", gap: 12 },
  form: { width: "100%", gap: 8 },
  label: { fontSize: 13, color: colors.onBrandMuted, fontWeight: "600", marginTop: 8, marginBottom: 4 },
  hint: { fontSize: 11, color: "rgba(225,245,238,0.7)", marginBottom: 8 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    fontSize: 16, color: colors.text900, marginBottom: 8, width: "100%",
  },
  codeInput: { fontSize: 24, fontWeight: "bold", letterSpacing: 8, textAlign: "center" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  dateCol: { flex: 1 },
  dateSep: { color: colors.onBrandMuted, fontSize: 16, fontWeight: "600" },
  currencyRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  currencyChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  currencyChipActive: { backgroundColor: colors.surface },
  currencyChipText: { fontSize: 14, fontWeight: "600", color: colors.onBrand },
  currencyChipTextActive: { color: colors.brand600 },
  btnPrimary: {
    backgroundColor: colors.surface, padding: 16, borderRadius: 14,
    alignItems: "center", marginTop: 8, width: "100%",
  },
  btnPrimaryText: { color: colors.brand600, fontSize: 16, fontWeight: "bold" },
  btnSecondary: {
    backgroundColor: "transparent", padding: 16, borderRadius: 14,
    alignItems: "center", borderWidth: 1.5, borderColor: colors.onBrand,
  },
  btnSecondaryText: { color: colors.onBrand, fontSize: 16, fontWeight: "500" },
  back: { marginTop: 12, alignItems: "center" },
  backTop: { alignSelf: "flex-start", marginBottom: 8 },
  backText: { color: colors.onBrandMuted, fontSize: 15 },
});
