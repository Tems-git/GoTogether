import { StyleSheet, Text, View, TouchableOpacity, TextInput, Alert } from "react-native";
import { useState } from "react";
import { signInWithEmail } from "../lib/supabase";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    const error = await signInWithEmail(email);
    setLoading(false);
    if (error) {
      Alert.alert("Грешка", error.message);
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>📧</Text>
        <Text style={styles.title}>Провери имейла си</Text>
        <Text style={styles.subtitle}>Пратихме ти линк за вход на {email}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🧳</Text>
      <Text style={styles.title}>Влез в GoTogether</Text>
      <Text style={styles.subtitle}>Въведи имейла си и ще получиш линк за вход</Text>
      <TextInput
        style={styles.input}
        placeholder="твоя@имейл.com"
        placeholderTextColor="#999"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TouchableOpacity style={styles.btn} onPress={handleSignIn}>
        <Text style={styles.btnText}>{loading ? "Изпращане..." : "Изпрати линк за вход"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center", padding: 24 },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 15, color: "#E1F5EE", textAlign: "center", marginBottom: 32 },
  input: { width: "100%", backgroundColor: "#fff", padding: 16, borderRadius: 14, fontSize: 16, marginBottom: 12 },
  btn: { width: "100%", backgroundColor: "#085041", padding: 16, borderRadius: 14, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});
