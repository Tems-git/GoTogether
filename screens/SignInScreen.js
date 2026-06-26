import {
  StyleSheet, Text, View, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from "react-native";
import { useState } from "react";
import { supabase } from "../lib/supabase";

const OTP_LENGTH = 8; // Supabase праща 8-цифрен код по подразбиране

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("email"); // "email" | "otp"
  const [loading, setLoading] = useState(false);

  async function handleSendOtp() {
    if (!email.trim()) return Alert.alert("Грешка", "Въведи имейл адрес");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) {
      Alert.alert("Грешка", error.message);
    } else {
      setStep("otp");
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== OTP_LENGTH) return Alert.alert("Грешка", `Въведи ${OTP_LENGTH}-цифрения код`);
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) {
      Alert.alert("Грешка", "Невалиден или изтекъл код. Опитай отново.");
    }
  }

  if (step === "otp") {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>📬</Text>
        <Text style={styles.title}>Въведи кода</Text>
        <Text style={styles.subtitle}>
          Пратихме {OTP_LENGTH}-цифрен код на{"\n"}{email}
        </Text>
        <TextInput
          style={[styles.input, styles.otpInput]}
          placeholder={"0".repeat(OTP_LENGTH)}
          placeholderTextColor="#aaa"
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus
        />
        <TouchableOpacity style={styles.btn} onPress={handleVerifyOtp} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Потвърди</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.back} onPress={() => { setStep("email"); setOtp(""); }}>
          <Text style={styles.backText}>← Смени имейл</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resend} onPress={handleSendOtp} disabled={loading}>
          <Text style={styles.resendText}>Изпрати нов код</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🧳</Text>
      <Text style={styles.title}>Влез в GoTogether</Text>
      <Text style={styles.subtitle}>Въведи имейла си и ще получиш код за вход</Text>
      <TextInput
        style={styles.input}
        placeholder="твоя@имейл.com"
        placeholderTextColor="#aaa"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity style={styles.btn} onPress={handleSendOtp} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Изпрати код</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: "#1D9E75",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 15, color: "#E1F5EE", textAlign: "center", marginBottom: 32, lineHeight: 22 },
  input: {
    width: "100%", backgroundColor: "#fff", padding: 16,
    borderRadius: 14, fontSize: 16, marginBottom: 12, color: "#1a1a1a",
  },
  otpInput: {
    fontSize: 28, fontWeight: "bold", letterSpacing: 8,
    textAlign: "center", paddingVertical: 20,
  },
  btn: {
    width: "100%", backgroundColor: "#085041",
    padding: 16, borderRadius: 14, alignItems: "center", marginBottom: 12,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  back: { marginTop: 8 },
  backText: { color: "#E1F5EE", fontSize: 15 },
  resend: { marginTop: 16 },
  resendText: { color: "#E1F5EE", fontSize: 14, textDecorationLine: "underline" },
});
