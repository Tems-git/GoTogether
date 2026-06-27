import {
  StyleSheet, Text, View, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, TouchableWithoutFeedback, Keyboard,
} from "react-native";
import { useState } from "react";
import { supabase } from "../lib/supabase";

const OTP_LENGTH = 6;

export default function SignInScreen({ onSignIn, pendingInviteCode }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step, setStep] = useState("email");
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
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) {
      Alert.alert("Грешка", "Невалиден или изтекъл код. Опитай отново.");
      return;
    }

    if (data?.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", data.user.id)
        .maybeSingle();

      const defaultName = data.user.email.split("@")[0];
      const hasRealName = profile?.display_name && profile.display_name !== defaultName;

      if (!hasRealName) {
        setStep("name");
      } else {
        onSignIn(data.user);
      }
    }
  }

  async function handleSetName() {
    const name = displayName.trim();
    if (!name) return Alert.alert("Грешка", "Въведи твоето име");
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Няма активна сесия");
      await supabase.from("profiles").upsert({ id: user.id, display_name: name });
      onSignIn(user);
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setLoading(false);
    }
  }

  const renderContent = () => {
    if (step === "name") {
      return (
        <>
          <Text style={styles.emoji}>👋</Text>
          <Text style={styles.title}>Как се казваш?</Text>
          <Text style={styles.subtitle}>Членовете на пътуването ще те виждат с това име</Text>
          <TextInput
            style={styles.input}
            placeholder="Напр. Темелко"
            placeholderTextColor="#aaa"
            value={displayName}
            onChangeText={setDisplayName}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSetName}
          />
          <TouchableOpacity style={styles.btn} onPress={handleSetName} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Продължи →</Text>}
          </TouchableOpacity>
        </>
      );
    }

    if (step === "otp") {
      return (
        <>
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
            returnKeyType="done"
            onSubmitEditing={handleVerifyOtp}
          />
          <TouchableOpacity style={styles.btn} onPress={handleVerifyOtp} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Потвърди</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.back} onPress={() => { setStep("email"); setOtp(""); }}>
            <Text style={styles.backText}>← Смени имейл</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resend} onPress={handleSendOtp} disabled={loading}>
            <Text style={styles.resendText}>Изпрати нов код</Text>
          </TouchableOpacity>
        </>
      );
    }

    return (
      <>
        <Text style={styles.emoji}>🧳</Text>
        <Text style={styles.title}>Влез в GoTogether</Text>
        <Text style={styles.subtitle}>
          {pendingInviteCode
            ? "Имаш покана! Влез за да се присъединиш."
            : "Въведи имейла си и ще получиш код за вход"}
        </Text>
        {pendingInviteCode && (
          <View style={styles.inviteBadge}>
            <Text style={styles.inviteBadgeText}>🎫 Код: {pendingInviteCode}</Text>
          </View>
        )}
        <TextInput
          style={styles.input}
          placeholder="твоя@имейл.com"
          placeholderTextColor="#aaa"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSendOtp}
        />
        <TouchableOpacity style={styles.btn} onPress={handleSendOtp} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Изпрати код</Text>}
        </TouchableOpacity>
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {renderContent()}
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#1D9E75" },
  container: {
    flexGrow: 1, backgroundColor: "#1D9E75",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 15, color: "#E1F5EE", textAlign: "center", marginBottom: 32, lineHeight: 22 },
  inviteBadge: {
    backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 8, marginBottom: 16,
  },
  inviteBadgeText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
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
