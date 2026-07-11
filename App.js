import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View, TouchableOpacity, TextInput, Linking, AppState } from "react-native";
import { useState, useEffect, useRef } from "react";
import * as Updates from "expo-updates";
import { supabase } from "./lib/supabase";
import SignInScreen from "./screens/SignInScreen";
import DashboardScreen from "./screens/DashboardScreen";
import AIPlannerScreen from "./screens/AIPlannerScreen";
import DocumentsScreen from "./screens/DocumentsScreen";
import ExpensesScreen from "./screens/ExpensesScreen";
import ChatScreen from "./screens/ChatScreen";
import TripSetupScreen from "./screens/TripSetupScreen";

// Разпознаваме код от gotogether://join/XXX или exp+gotogether://join/XXX
function parseInviteCode(url) {
  if (!url) return null;
  const match = url.match(/join\/([A-Z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

// Проверява за нов EAS update и го прилага, ако има.
// Тихо гърми без грешки (не искаме production потребители да виждат error-и,
// ако мрежата е бавна или Expo Go не поддържа updates).
async function checkAndApplyUpdate() {
  // В Expo Go, Updates.checkForUpdateAsync() винаги връща isAvailable: false
  // (Expo Go има собствен update механизъм), затова тази функция е полезна
  // главно в production builds. Но включваме и Expo Go path-a, за да сме готови.
  if (!Updates.isEnabled) return;
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch (e) {
    // Тихо игнорираме — мрежов проблем или Expo Go
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("home");
  const [activeTrip, setActiveTrip] = useState(null);
  const [allTrips, setAllTrips] = useState([]);
  const [tripLoading, setTripLoading] = useState(false);
  const [pendingInviteCode, setPendingInviteCode] = useState(null);
  const [inviteInput, setInviteInput] = useState("");
  const [showInviteInput, setShowInviteInput] = useState(false);
  const appState = useRef(AppState.currentState);

  // Auto-update при cold start и при връщане от background.
  // Целта: тестерите не трябва да рестартират ръчно приложението, за да
  // видят нова версия — просто отваряне от app switcher е достатъчно.
  useEffect(() => {
    checkAndApplyUpdate();

    const sub = AppState.addEventListener("change", (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        checkAndApplyUpdate();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // App отворена чрез deep link докато е затворена
    Linking.getInitialURL().then((url) => {
      const code = parseInviteCode(url);
      if (code) setPendingInviteCode(code);
    });

    // App отворена чрез deep link докато върви
    const sub = Linking.addEventListener("url", ({ url }) => {
      const code = parseInviteCode(url);
      if (code) {
        setPendingInviteCode(code);
        setScreen("signin");
      }
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) handleUser(session.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) handleUser(session.user);
      else { setUser(null); setActiveTrip(null); setAllTrips([]); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleUser(u) {
    setUser(u);
    setTripLoading(true);
    const { data } = await supabase
      .from("trip_members")
      .select("trip_id, trips(*)")
      .eq("user_id", u.id)
      .order("joined_at", { ascending: false });

    const trips = (data || []).map((d) => d.trips).filter(Boolean);
    setAllTrips(trips);
    if (trips.length > 0) setActiveTrip(trips[0]);
    setTripLoading(false);
    setScreen("dashboard");
  }

  function handleInviteSubmit() {
    const code = inviteInput.trim().toUpperCase();
    if (!code || code.length < 4) return;
    setPendingInviteCode(code);
    setShowInviteInput(false);
    setInviteInput("");
    setScreen("signin");
  }

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
      />
    );
  }

  if (screen === "expenses") {
    return (
      <ExpensesScreen
        onBack={() => setScreen("dashboard")}
        tripId={activeTrip?.id}
        userId={user?.id}
        devMode={false}
      />
    );
  }

  if (screen === "chat") {
    return (
      <ChatScreen
        onBack={() => setScreen("dashboard")}
        tripId={activeTrip?.id}
        userId={user?.id}
        tripName={activeTrip?.name}
      />
    );
  }

  if (screen === "signin") {
    return (
      <SignInScreen
        onSignIn={(u) => handleUser(u)}
        pendingInviteCode={pendingInviteCode}
      />
    );
  }

  if (screen === "newtrip" && user) {
    return (
      <TripSetupScreen
        user={user}
        pendingInviteCode={null}
        onTripReady={(trip) => {
          setActiveTrip(trip);
          setAllTrips((prev) => [trip, ...prev.filter((t) => t.id !== trip.id)]);
          setScreen("dashboard");
        }}
      />
    );
  }

  if (user) {
    if (!activeTrip) {
      return (
        <TripSetupScreen
          user={user}
          pendingInviteCode={pendingInviteCode}
          onTripReady={(trip) => {
            setActiveTrip(trip);
            setAllTrips((prev) => [trip, ...prev.filter((t) => t.id !== trip.id)]);
            setPendingInviteCode(null);
            setScreen("dashboard");
          }}
        />
      );
    }
    return (
      <DashboardScreen
        user={user}
        trip={activeTrip}
        allTrips={allTrips}
        onSignOut={() => { supabase.auth.signOut(); setUser(null); setActiveTrip(null); setAllTrips([]); setScreen("home"); }}
        onAI={() => setScreen("ai")}
        onDocuments={() => setScreen("documents")}
        onExpenses={() => setScreen("expenses")}
        onChat={() => setScreen("chat")}
        onSwitchTrip={(trip) => setActiveTrip(trip)}
        onNewTrip={() => setScreen("newtrip")}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🧳</Text>
      <Text style={styles.title}>GoTogether</Text>
      <Text style={styles.subtitle}>Семейни пътувания без главоболие</Text>

      {showInviteInput ? (
        <View style={styles.inviteBox}>
          <Text style={styles.inviteLabel}>Въведи кода за покана</Text>
          <TextInput
            style={styles.inviteInput}
            placeholder="XXXXXX"
            placeholderTextColor="#aaa"
            value={inviteInput}
            onChangeText={setInviteInput}
            autoCapitalize="characters"
            maxLength={6}
            autoFocus
          />
          <TouchableOpacity style={styles.btnPrimary} onPress={handleInviteSubmit}>
            <Text style={styles.btnPrimaryText}>Продължи →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.back} onPress={() => { setShowInviteInput(false); setInviteInput(""); }}>
            <Text style={styles.backText}>← Назад</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setScreen("ai")}>
            <Text style={styles.btnPrimaryText}>Планирай пътуване с AI</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setShowInviteInput(true)}>
            <Text style={styles.btnPrimaryText}>🎫 Имам покана</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => setScreen("signin")}>
            <Text style={styles.btnSecondaryText}>Вход / Регистрация</Text>
          </TouchableOpacity>
        </View>
      )}
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
  inviteBox: { width: "100%", gap: 10 },
  inviteLabel: { color: "#E1F5EE", fontSize: 14, fontWeight: "600", textAlign: "center", marginBottom: 4 },
  inviteInput: {
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    fontSize: 28, fontWeight: "bold", letterSpacing: 8,
    textAlign: "center", color: "#1a1a1a",
  },
  back: { alignItems: "center", marginTop: 4 },
  backText: { color: "#E1F5EE", fontSize: 15 },
});
