import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import SignInScreen from "./screens/SignInScreen";
import DashboardScreen from "./screens/DashboardScreen";
import AIPlannerScreen from "./screens/AIPlannerScreen";
import DocumentsScreen from "./screens/DocumentsScreen";
import ExpensesScreen from "./screens/ExpensesScreen";
import TripSetupScreen from "./screens/TripSetupScreen";

// DEV MODE: прескача логин — само за тестване, изтрий преди production!
const DEV_MODE = true;
const DEV_TRIP = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Тест пътуване",
  destination: "София",
  invite_code: "DEVTST",
  start_date: null,
  end_date: null,
};
const DEV_USER = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "dev@test.com",
};

export default function App() {
  const [user, setUser] = useState(DEV_MODE ? DEV_USER : null);
  const [loading, setLoading] = useState(!DEV_MODE);
  const [screen, setScreen] = useState(DEV_MODE ? "dashboard" : "home");
  const [activeTrip, setActiveTrip] = useState(DEV_MODE ? DEV_TRIP : null);
  const [tripLoading, setTripLoading] = useState(false);

  useEffect(() => {
    if (DEV_MODE) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (DEV_MODE || !user) { if (!DEV_MODE) setActiveTrip(null); return; }
    async function loadTrip() {
      setTripLoading(true);
      const { data } = await supabase
        .from("trip_members")
        .select("trip_id, trips(*)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false })
        .limit(1)
        .single();
      if (data?.trips) setActiveTrip(data.trips);
      setTripLoading(false);
    }
    loadTrip();
  }, [user]);

  if (loading || tripLoading) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingEmoji}>🧳</Text>
        <Text style={styles.loadingText}>GoTogether</Text>
      </View>
    );
  }

  if (screen === "ai") return <AIPlannerScreen onBack={() => setScreen(user ? "dashboard" : "home")} />;

  if (screen === "documents") {
    return (
      <DocumentsScreen
        onBack={() => setScreen("dashboard")}
        tripId={activeTrip?.id}
        userId={user?.id}
        devMode={DEV_MODE}
      />
    );
  }

  if (screen === "expenses") {
    return (
      <ExpensesScreen
        onBack={() => setScreen("dashboard")}
        tripId={activeTrip?.id}
        userId={user?.id}
        devMode={DEV_MODE}
      />
    );
  }

  if (screen === "signin") return <SignInScreen />;

  if (screen === "dashboard" || user) {
    if (!activeTrip) {
      return (
        <TripSetupScreen
          user={user}
          onTripReady={(trip) => setActiveTrip(trip)}
        />
      );
    }
    return (
      <DashboardScreen
        user={user}
        trip={activeTrip}
        onSignOut={() => { supabase.auth.signOut(); setScreen("home"); setActiveTrip(null); }}
        onAI={() => setScreen("ai")}
        onDocuments={() => setScreen("documents")}
        onExpenses={() => setScreen("expenses")}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🧳</Text>
      <Text style={styles.title}>GoTogether</Text>
      <Text style={styles.subtitle}>Семейни пътувания без главоболие</Text>
      <View style={styles.buttons}>
        <TouchableOpacity style={styles.btnPrimary} onPress={() => setScreen("ai")}>
          <Text style={styles.btnPrimaryText}>Планирай пътуване с AI</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={() => setScreen("signin")}>
          <Text style={styles.btnSecondaryText}>Присъедини се с код</Text>
        </TouchableOpacity>
      </View>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  loadingEmoji: { fontSize: 64 },
  loadingText: { fontSize: 24, fontWeight: "bold", color: "#fff", marginTop: 12 },
  container: { flex: 1, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center", padding: 24 },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: { fontSize: 36, fontWeight: "bold", color: "#fff", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#E1F5EE", textAlign: "center", marginBottom: 48 },
  buttons: { width: "100%", gap: 12 },
  btnPrimary: { backgroundColor: "#fff", padding: 16, borderRadius: 14, alignItems: "center" },
  btnPrimaryText: { color: "#1D9E75", fontSize: 16, fontWeight: "bold" },
  btnSecondary: { backgroundColor: "transparent", padding: 16, borderRadius: 14, alignItems: "center", borderWidth: 1.5, borderColor: "#fff" },
  btnSecondaryText: { color: "#fff", fontSize: 16, fontWeight: "500" },
});
