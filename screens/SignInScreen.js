import {
  StyleSheet, Text, View, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, TouchableWithoutFeedback, Keyboard,
} from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { colors, space, radius, type } from "../theme/tokens";

const OTP_LENGTH = 6;

export default function SignInScreen({ onSignIn, pendingInviteCode }) {
  // Съдържанието е центрирано, но при отворена клавиатура на Android може да
  // опре в status/navigation bar — insets гарантират минимално отстояние.
  const insets = useSafeAreaInsets();
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
            placeholderTextColor={colors.text400}
            value={displayName}
            onChangeText={setDisplayName}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSetName}
          />
          <TouchableOpacity style={styles.btn} onPress={handleSetName} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnText}>Продължи →</Text>}
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
            placeholderTextColor={colors.text400}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            returnKeyType="done"
            onSubmitEditing={handleVerifyOtp}
          />
          <TouchableOpacity style={styles.btn} onPress={handleVerifyOtp} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnText}>Потвърди</Text>}
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
          placeholderTextColor={colors.text400}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSendOtp}
        />
        <TouchableOpacity style={styles.btn} onPress={handleSendOtp} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnText}>Изпрати код</Text>}
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
          contentContainerStyle={[
            styles.container,
            { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {renderContent()}
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.brand600 },
  container: {
    flexGrow: 1, backgroundColor: colors.brand600,
    alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl,
  },
  emoji: { fontSize: 64, marginBottom: space.lg },
  title: { ...type.title, color: colors.onBrand, marginBottom: space.sm, textAlign: "center" },
  subtitle: { ...type.label, color: colors.onBrandMuted, textAlign: "center", marginBottom: space.xxxl },
  inviteBadge: {
    backgroundColor: "rgba(255,255,255,0.2)", borderRadius: radius.control,
    paddingHorizontal: space.lg, paddingVertical: space.sm, marginBottom: space.lg,
  },
  inviteBadgeText: { ...type.label, fontWeight: "bold", color: colors.onBrand },
  input: {
    width: "100%", backgroundColor: colors.surface, padding: space.lg,
    borderRadius: radius.control, ...type.body, marginBottom: space.sm, color: colors.text900,
  },
  otpInput: {
    fontSize: 28, fontWeight: "bold", letterSpacing: 8,
    textAlign: "center", paddingVertical: space.xl,
  },
  btn: {
    width: "100%", backgroundColor: colors.brand700,
    padding: space.lg, borderRadius: radius.card, alignItems: "center", marginBottom: space.sm,
  },
  btnText: { ...type.body, color: colors.onBrand, fontWeight: "bold" },
  back: { marginTop: space.sm },
  backText: { ...type.body, color: colors.onBrandMuted },
  resend: { marginTop: space.lg },
  resendText: { ...type.label, color: colors.onBrandMuted, textDecorationLine: "underline" },
});
