import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function TripSetupScreen({ user, onTripReady, pendingInviteCode }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [inviteCode, setInviteCode] = useState(pendingInviteCode || "");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingTrip, setPendingTrip] = useState(null); // trip чака потвърждение на името

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
        .select("user_id, display_name")
        .eq("trip_id", trip.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        onTripReady(trip);
        return;
      }

      // Проверяваме дали има профил с истинско име
      const profile = await getOrCreateProfile();
      const defaultName = user.email.split("@")[0];
      const hasRealName = profile?.display_name && profile.display_name !== defaultName;

      if (!hasRealName) {
        // Питаме за истинско име преди да добавим
        setPendingTrip(trip);
        setLoading(false);
        return;
      }

      // Директно присъединяване
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
      // Запазваме профила
      await supabase.from("profiles").upsert({
        id: user.id,
        display_name: trimmedName,
      });

      // Присъединяваме към пътуването
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

  // Стъпка за въвеждане на име преди присъединяване
  if (pendingTrip) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.emoji}>👋</Text>
            <Text style={styles.title}>Как се казваш?</Text>
            <Text style={styles.subtitle}>
              Членовете на „{pendingTrip.name}" ще те виждат с това име
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Напр. Спас"
              placeholderTextColor="#bbb"
              value={displayName}
              onChangeText={setDisplayName}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleConfirmName}
            />
            <TouchableOpacity style={styles.btnPrimary} onPress={handleConfirmName} disabled={loading}>
              {loading ? <ActivityIndicator color="#1D9E75" /> : <Text style={styles.btnPrimaryText}>Присъедини се →</Text>}
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
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
            placeholderTextColor="#bbb"
          />
          <Text style={styles.label}>Дестинация</Text>
          <TextInput
            style={styles.input}
            placeholder="Напр. Солун"
            value={destination}
            onChangeText={setDestination}
            placeholderTextColor="#bbb"
          />
          <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate} disabled={loading}>
            {loading ? <ActivityIndicator color="#1D9E75" /> : <Text style={styles.btnPrimaryText}>Създай пътуване</Text>}
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
            placeholderTextColor="#bbb"
          />
          <TouchableOpacity style={styles.btnPrimary} onPress={handleJoin} disabled={loading}>
            {loading ? <ActivityIndicator color="#1D9E75" /> : <Text style={styles.btnPrimaryText}>Присъедини се</Text>}
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
  flex: { flex: 1, backgroundColor: "#1D9E75" },
  container: { flex: 1, backgroundColor: "#1D9E75" },
  scroll: { padding: 24, paddingTop: 80, alignItems: "center", minHeight: "100%" },
  emoji: { fontSize: 64, marginBottom: 16, textAlign: "center" },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 15, color: "#E1F5EE", textAlign: "center", marginBottom: 40, lineHeight: 22, paddingHorizontal: 24 },
  buttons: { width: "100%", gap: 12 },
  form: { width: "100%", gap: 8 },
  label: { fontSize: 13, color: "#E1F5EE", fontWeight: "600", marginTop: 8, marginBottom: 4 },
  input: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    fontSize: 16, color: "#1a1a1a", marginBottom: 8, width: "100%",
  },
  codeInput: { fontSize: 24, fontWeight: "bold", letterSpacing: 8, textAlign: "center" },
  btnPrimary: {
    backgroundColor: "#fff", padding: 16, borderRadius: 14,
    alignItems: "center", marginTop: 8, width: "100%",
  },
  btnPrimaryText: { color: "#1D9E75", fontSize: 16, fontWeight: "bold" },
  btnSecondary: {
    backgroundColor: "transparent", padding: 16, borderRadius: 14,
    alignItems: "center", borderWidth: 1.5, borderColor: "#fff",
  },
  btnSecondaryText: { color: "#fff", fontSize: 16, fontWeight: "500" },
  back: { marginTop: 12, alignItems: "center" },
  backText: { color: "#E1F5EE", fontSize: 15 },
});
