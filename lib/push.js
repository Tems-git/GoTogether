import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// expo-notifications е нативен модул. В Expo Go и в по-стар билд той просто
// го няма — тогава всичко тук мълчи, вместо да събори приложението. Затова се
// зарежда лениво и в try/catch, а не с обикновен import най-горе.
let Notifications = null;
try {
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

export function pushAvailable() {
  return !!Notifications;
}

// Как изглежда известие, докато приложението е отворено. Показваме го, но без
// звук: Realtime вече е обновил екрана, звукът само дразни човека, който в
// момента гледа същия чат.
export function configurePushHandler() {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      // Старите имена, за да работи и ако билдът е с по-ранна версия.
      shouldShowAlert: true,
    }),
  });
}

function easProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ||
    Constants?.easConfig?.projectId ||
    null
  );
}

async function currentToken() {
  const projectId = easProjectId();
  if (!projectId) return null;
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result?.data || null;
}

// Връща токена при успех и null при всяка друга развръзка — отказано
// разрешение, емулатор без Google Play, липсващи FCM credentials. Никоя от
// тях не е причина приложението да спре да работи.
export async function registerForPush(userId) {
  if (!Notifications || !userId) return null;
  try {
    if (Platform.OS === "android") {
      // Без канал Android показва известията тихо и без приоритет.
      await Notifications.setNotificationChannelAsync("messages", {
        name: "Съобщения",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#0A6B57",
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return null;

    const token = await currentToken();
    if (!token) return null;

    await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" }
    );

    return token;
  } catch {
    return null;
  }
}

// При изход токенът се маха, за да не продължат известията да стигат до
// телефон, от който човекът вече е излязъл.
export async function unregisterPush(userId) {
  if (!Notifications || !userId) return;
  try {
    const token = await currentToken();
    if (!token) return;
    await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
  } catch {
    // Няма значение — токенът ще бъде почистен при първата неуспешна доставка.
  }
}

// Тапване върху известие, докато приложението върви или е в background.
export function addPushTapListener(handler) {
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    handler(response?.notification?.request?.content?.data || {});
  });
  return () => sub.remove();
}

// Тапване, което е стартирало приложението от нулата. Тогава listener-ът още
// не съществува, затова събитието се чете отделно.
export async function consumeInitialPush() {
  if (!Notifications) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification?.request?.content?.data || null;
  } catch {
    return null;
  }
}
