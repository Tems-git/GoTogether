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

// Акаунт за ревюърите на Google Play и App Store. Влизането в приложението е с
// код по имейл, а те нямат достъп до чужда поща — без това виждат празен екран
// и отхвърлят приложението. Този адрес няма истинска кутия: кодът за него е
// фиксиран, стои само на сървъра и е изписан в бележките за ревю.
const REVIEW_EMAIL = "review@wegotogether.xyz";
const REVIEW_CODE_LENGTH = 12;

export default function SignInScreen({ onSignIn, pendingInviteCode }) {
  // Съдържанието е центрирано, но при отворена клавиатура на Android може да
  // опре в status/navigation bar — insets гарантират минимално отстояние.
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step, setStep] = useState("email");
  const [loading, setLoading] = useState(false);

  const address = email.trim().toLowerCase();
  const isReview = address === REVIEW_EMAIL;

  async function handleSendOtp() {
    if (!address) return Alert.alert("Грешка", "Въведи имейл адрес");

    // Няма на кого да пратим писмо — адресът за ревю не е истинска кутия.
    if (isReview) {
      setOtp("");
      setStep("otp");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) {
      Alert.alert("Грешка", error.message);
    } else {
      setStep("otp");
    }
  }

  // Разменя кода за ревю за истинска сесия. Функцията на сървъра проверява кода
  // и връща еднократен токен на Supabase; тук той се превръща в сесия по
  // същия път като обикновен код по имейл.
  async function verifyReviewCode(code) {
    const { data: grant, error: grantError } = await supabase.functions.invoke("review-signin", {
      body: { email: address, code },
    });
    if (grantError || grant?.error) {
      return { data: null, error: grantError || new Error(grant.error) };
    }

    // Supabase приема токена в две форми и различните версии на клиента
    // предпочитат различна. Пробваме първо hash-а, после шестцифрения код.
    if (grant?.token_hash) {
      const byHash = await supabase.auth.verifyOtp({
        token_hash: grant.token_hash,
        type: grant.type || "magiclink",
      });
      if (!byHash.error) return byHash;
    }
    if (grant?.email_otp) {
      return supabase.auth.verifyOtp({
        email: address,
        token: grant.email_otp,
        type: "email",
      });
    }
    return { data: null, error: new Error("Липсва токен за вход.") };
  }

  async function handleVerifyOtp() {
    const token = otp.trim();
    if (isReview) {
      if (!token) return Alert.alert("Грешка", "Въведи кода от бележките за ревю");
    } else if (token.length !== OTP_LENGTH) {
      return Alert.alert("Грешка", `Въведи ${OTP_LENGTH}-цифрения код`);
    }

    setLoading(true);
    const { data, error } = isReview
      ? await verifyReviewCode(token)
      : await supabase.auth.verifyOtp({ email: address, token, type: "email" });
    setLoading(false);
    if (error) {
      Alert.alert(
        "Грешка",
        isReview
          ? "Кодът за ревю не е приет. Провери го в бележките за ревю."
          : "Невалиден или изтекъл код. Опитай отново."
      );
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
          <Text style={styles.emoji}>{isReview ? "🔑" : "📬"}</Text>
          <Text style={styles.title}>Въведи кода</Text>
          <Text style={styles.subtitle}>
            {isReview
              ? `Кодът е в бележките за ревю\nEnter the code from the review notes`
              : `Пратихме ${OTP_LENGTH}-цифрен код на\n${email}`}
          </Text>
          <TextInput
            style={[styles.input, isReview ? styles.reviewInput : styles.otpInput]}
            placeholder={isReview ? "код за ревю" : "0".repeat(OTP_LENGTH)}
            placeholderTextColor={colors.text400}
            value={otp}
            onChangeText={(t) =>
              setOtp(isReview ? t.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : t.replace(/[^0-9]/g, ""))
            }
            keyboardType={isReview ? "default" : "number-pad"}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={isReview ? REVIEW_CODE_LENGTH : OTP_LENGTH}
            returnKeyType="done"
            onSubmitEditing={handleVerifyOtp}
          />
          <TouchableOpacity style={styles.btn} onPress={handleVerifyOtp} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnText}>Потвърди</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.back} onPress={() => { setStep("email"); setOtp(""); }}>
            <Text style={styles.backText}>← Смени имейл</Text>
          </TouchableOpacity>
          {!isReview && (
            <TouchableOpacity style={styles.resend} onPress={handleSendOtp} disabled={loading}>
              <Text style={styles.resendText}>Изпрати нов код</Text>
            </TouchableOpacity>
          )}
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
  inviteBadgeText: { ...type.label, fontWeight: "bold", color: colors.onBrand, fontFamily: "GolosText_700Bold" },
  input: {
    width: "100%", backgroundColor: colors.surface, padding: space.lg,
    borderRadius: radius.control, ...type.body, marginBottom: space.sm, color: colors.text900,
  },
  otpInput: {
    fontSize: 28, fontWeight: "bold", letterSpacing: 8,
    textAlign: "center", paddingVertical: space.xl, fontFamily: "GolosText_700Bold",
  },
  // Кодът за ревю е дванайсет знака — по-дребен шрифт, за да се побере на един ред.
  reviewInput: {
    fontSize: 19, fontWeight: "bold", letterSpacing: 2,
    textAlign: "center", paddingVertical: space.xl, fontFamily: "GolosText_700Bold",
  },
  btn: {
    width: "100%", backgroundColor: colors.brand700,
    padding: space.lg, borderRadius: radius.card, alignItems: "center", marginBottom: space.sm,
  },
  btnText: { ...type.body, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  back: { marginTop: space.sm },
  backText: { ...type.body, color: colors.onBrandMuted },
  resend: { marginTop: space.lg },
  resendText: { ...type.label, color: colors.onBrandMuted, textDecorationLine: "underline" },
});
