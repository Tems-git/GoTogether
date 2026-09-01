import { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Linking, Modal,
  Animated, PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { FileText, Plus } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors, space, radius, type } from "../theme/tokens";

const DOC_TYPES = {
  reservation: { emoji: "🏨", label: "Резервация" },
  ticket: { emoji: "✈️", label: "Билет" },
  insurance: { emoji: "🛡️", label: "Застраховка" },
  photo: { emoji: "🖼️", label: "Снимка" },
  other: { emoji: "📄", label: "Друго" },
};

// Качва се всичко, но не всичко може да се покаже вътре в приложението.
// Снимките ги показваме сами; останалото подаваме на системата.
const IMAGE_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
// HEIC е форматът по подразбиране на iPhone. React Native не го рисува на
// Android, затова не го обещаваме — пращаме го навън, където се отваря.
const MAX_UPLOAD_MB = 25;

// Колко дълго важи връзката към файла. Достатъчно, за да се отвори и разгледа,
// но не толкова, че препратена връзка да остане жива с дни.
const SIGNED_URL_SECONDS = 300;

// Максимално увеличение при разглеждане на снимка. Над четири пъти няма какво
// повече да се види — снимките от телефон свършват като разделителна способност.
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 280;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

// Увеличаване с два пръста, местене с един и двойно тапване за бързо
// приближаване. Написано на PanResponder и Animated, тоест само с това, което
// React Native носи — библиотека за жестове би значела нов нативен билд, а
// така поправката пътува като обикновен ъпдейт.
function ZoomableImage({ uri }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // Animated.Value не се чете синхронно, а по време на жест трябва да знаем
  // откъде сме тръгнали — затова държим и числено копие.
  const cur = useRef({ scale: 1, x: 0, y: 0 });
  const pinch = useRef({ active: false, dist: 0, scale: 1 });
  const pan = useRef({ x: 0, y: 0 });
  const box = useRef({ width: 0, height: 0 });
  const lastTap = useRef(0);

  // Границите на местенето: колкото по-увеличена е снимката, толкова повече
  // има какво да се покаже извън екрана.
  function limit(value, size, s) {
    const max = Math.max(0, (size * (s - 1)) / 2);
    return clamp(value, -max, max);
  }

  function animateTo(nextScale, x = 0, y = 0) {
    cur.current = { scale: nextScale, x, y };
    pan.current = { x, y };
    Animated.parallel([
      Animated.timing(scale, { toValue: nextScale, duration: 180, useNativeDriver: true }),
      Animated.timing(tx, { toValue: x, duration: 180, useNativeDriver: true }),
      Animated.timing(ty, { toValue: y, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        g.numberActiveTouches === 2 || Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,

      onPanResponderGrant: (e) => {
        pinch.current = { active: false, dist: 0, scale: cur.current.scale };
        pan.current = { x: cur.current.x, y: cur.current.y };

        if (e.nativeEvent.touches.length === 1) {
          const now = Date.now();
          if (now - lastTap.current < DOUBLE_TAP_MS) {
            lastTap.current = 0;
            if (cur.current.scale > 1.05) animateTo(1);
            else animateTo(DOUBLE_TAP_ZOOM);
          } else {
            lastTap.current = now;
          }
        }
      },

      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        const size = box.current;

        if (touches.length === 2) {
          const d = touchDistance(touches);
          if (!pinch.current.active) {
            pinch.current = { active: true, dist: d, scale: cur.current.scale };
            return;
          }
          const next = clamp((pinch.current.scale * d) / pinch.current.dist, 1, MAX_ZOOM);
          cur.current.scale = next;
          cur.current.x = limit(cur.current.x, size.width, next);
          cur.current.y = limit(cur.current.y, size.height, next);
          scale.setValue(next);
          tx.setValue(cur.current.x);
          ty.setValue(cur.current.y);
          return;
        }

        if (touches.length === 1) {
          // Вдигането на втория пръст не бива да мести снимката рязко —
          // затова наместваме основата спрямо натрупаното dx/dy.
          if (pinch.current.active) {
            pinch.current.active = false;
            pan.current = { x: cur.current.x - g.dx, y: cur.current.y - g.dy };
          }
          if (cur.current.scale <= 1.01) return;
          cur.current.x = limit(pan.current.x + g.dx, size.width, cur.current.scale);
          cur.current.y = limit(pan.current.y + g.dy, size.height, cur.current.scale);
          tx.setValue(cur.current.x);
          ty.setValue(cur.current.y);
        }
      },

      onPanResponderRelease: () => {
        pinch.current.active = false;
        pan.current = { x: cur.current.x, y: cur.current.y };
        if (cur.current.scale <= 1.02) animateTo(1);
      },
      onPanResponderTerminate: () => {
        pinch.current.active = false;
        pan.current = { x: cur.current.x, y: cur.current.y };
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return (
    <View
      style={styles.previewImageWrap}
      onLayout={(e) => { box.current = e.nativeEvent.layout; }}
      {...responder.panHandlers}
    >
      <Animated.Image
        source={{ uri }}
        resizeMode="contain"
        style={[
          styles.previewImage,
          { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
        ]}
      />
    </View>
  );
}

function isImage(name = "") {
  return IMAGE_REGEX.test(name.trim());
}

// Кофата вече е частна и в базата пазим само пътя вътре в нея. По-старите
// записи обаче пазят пълен публичен URL — приемаме и двете форми.
function storagePath(fileUrl = "") {
  const value = String(fileUrl || "");
  const match = value.match(/\/object\/(?:public|sign)\/documents\/(.+?)(?:\?|$)/);
  if (match) return decodeURIComponent(match[1]);
  return value.replace(/^\/?documents\//, "");
}

function guessDocType(name = "") {
  const n = name.toLowerCase();
  if (n.includes("резерв") || n.includes("hotel") || n.includes("booking")) return "reservation";
  if (n.includes("билет") || n.includes("ticket") || n.includes("flight")) return "ticket";
  if (n.includes("застрах") || n.includes("insur")) return "insurance";
  if (n.match(/\.(jpg|jpeg|png|heic|webp)$/)) return "photo";
  return "other";
}

export default function DocumentsScreen({ onBack, tripId, userId }) {
  // Реални safe area отстояния — status bar отгоре, navigation bar отдолу.
  // Без тях Android навигационната лента застъпва бутона "Качи документ".
  const insets = useSafeAreaInsets();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [openingId, setOpeningId] = useState(null);

  // Файловете вече не са публични. Всяко отваряне иска нова подписана връзка,
  // която важи няколко минути и се издава само ако базата признае, че този
  // потребител участва в пътуването.
  async function signedUrlFor(doc) {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath(doc.file_url), SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      throw error || new Error("Връзката към файла не може да бъде създадена.");
    }
    return data.signedUrl;
  }

  // PDF и другите нерисуваеми файлове се отварят в таб ВЪРХУ приложението, а
  // не в системния браузър. Разликата е в излизането: табът има бутон за
  // затваряне и връща тук с едно докосване, докато Linking.openURL праща в
  // Safari или Chrome и приложението остава на заден план.
  //
  // Модулът се иска лениво и нарочно. Той носи нативен код, тоест липсва в
  // билд, направен преди да го добавим. Ако този екран тръгне върху такъв
  // билд — например при OTA обновление — тук се пада тихо към системния
  // браузър, вместо приложението да гръмне при зареждане.
  async function openOutside(url) {
    try {
      const WebBrowser = require("expo-web-browser");
      if (WebBrowser?.openBrowserAsync) {
        await WebBrowser.openBrowserAsync(url, {
          toolbarColor: colors.surface,
          controlsColor: colors.brand600,
          dismissButtonStyle: "close",
          enableBarCollapsing: true,
        });
        return;
      }
    } catch {
      // Няма нативния модул в този билд — минаваме към системния браузър.
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error("no handler");
    await Linking.openURL(url);
  }

  // Снимката се отваря вътре в приложението. Всичко останало — PDF, документ
  // на Word, архив — го подаваме навън, защото нямаме с какво да го нарисуваме.
  // Ако телефонът няма подходящо приложение, казваме го направо, вместо да
  // отваряме каквото се случи.
  async function handleOpen(doc) {
    setOpeningId(doc.id);
    try {
      const url = await signedUrlFor(doc);
      if (isImage(doc.name)) {
        setPreview({ name: doc.name, url });
        return;
      }
      await openOutside(url);
    } catch (e) {
      Alert.alert(
        "Не мога да отворя файла",
        `„${doc.name}“ не се отвори. ${e?.message || ""}\n\nАко проблемът се повтори, провери дали още участваш в пътуването.`.trim()
      );
    } finally {
      setOpeningId(null);
    }
  }

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("documents")
      .select("*, profiles(display_name)")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });
    if (!error) setDocs(data || []);
    setLoading(false);
  }, [tripId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  async function handleUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];

      // Кофата в Supabase няма ограничение за размер. Без тази проверка един
      // видеофайл може да изяде мястото на всички.
      if (file.size && file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        Alert.alert(
          "Файлът е твърде голям",
          `„${file.name}“ е над ${MAX_UPLOAD_MB} MB. Намали го или качи само страницата, която ви трябва.`
        );
        return;
      }

      setUploading(true);

      const response = await fetch(file.uri);
      const arrayBuffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const path = `${tripId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, uint8, { contentType: file.mimeType || "application/octet-stream" });
      if (uploadError) throw uploadError;

      // Пазим пътя, не URL. Публичен адрес вече няма — той се издава
      // временно при всяко отваряне.
      const { error: dbError } = await supabase.from("documents").insert({
        trip_id: tripId,
        uploaded_by: userId,
        name: file.name,
        file_url: path,
        doc_type: guessDocType(file.name),
      });
      if (dbError) throw dbError;
      await fetchDocs();
    } catch (e) {
      Alert.alert("Грешка при качване", e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc) {
    Alert.alert("Изтриване", `Сигурен ли си, че искаш да изтриеш "${doc.name}"?`, [
      { text: "Отказ", style: "cancel" },
      {
        text: "Изтрий", style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.storage
              .from("documents").remove([storagePath(doc.file_url)]);
            if (error) throw error;
            const { error: rowError } = await supabase
              .from("documents").delete().eq("id", doc.id);
            if (rowError) throw rowError;
          } catch (e) {
            Alert.alert("Изтриването не успя", e.message);
          }
          await fetchDocs();
        },
      },
    ]);
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
    >
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <FileText size={24} color={colors.brand600} strokeWidth={1.75} />
        <Text style={styles.title}>Документи</Text>
      </View>
      <Text style={styles.subtitle}>Резервации, билети и застраховки</Text>

      {loading ? (
        <ActivityIndicator color={colors.brand600} style={{ marginTop: 40 }} />
      ) : docs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📄</Text>
          <Text style={styles.emptyTitle}>Няма документи все още</Text>
          <Text style={styles.emptyText}>Качи резервация, билет или застраховка — всички в групата ще я видят веднага.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {docs.map((doc) => {
            const type = DOC_TYPES[doc.doc_type] || DOC_TYPES.other;
            return (
              <View key={doc.id} style={styles.docRow}>
                <Text style={styles.docEmoji}>{type.emoji}</Text>
                <View style={styles.docInfo}>
                  <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                  <Text style={styles.docMeta}>{type.label} · {formatDate(doc.created_at)}</Text>
                  {doc.profiles?.display_name && (
                    <Text style={styles.docUploader}>от {doc.profiles.display_name}</Text>
                  )}
                </View>
                <View style={styles.docActions}>
                  <TouchableOpacity
                    onPress={() => handleOpen(doc)}
                    style={styles.iconBtn}
                    disabled={openingId === doc.id}
                  >
                    {openingId === doc.id
                      ? <ActivityIndicator size="small" color={colors.brand600} />
                      : <Text style={styles.iconBtnText}>👁</Text>}
                  </TouchableOpacity>
                  {doc.uploaded_by === userId && (
                    <TouchableOpacity onPress={() => handleDelete(doc)} style={styles.iconBtn}>
                      <Text style={styles.iconBtnText}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.btn} onPress={handleUpload} disabled={uploading}>
        {uploading
          ? <ActivityIndicator color={colors.onBrand} />
          : (
            <View style={styles.btnRow}>
              <Plus size={20} color={colors.onBrand} strokeWidth={1.75} />
              <Text style={styles.btnText}>Качи документ</Text>
            </View>
          )}
      </TouchableOpacity>

      <Modal
        visible={!!preview}
        animationType="fade"
        transparent
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.previewBackdrop}>
          <View style={styles.previewBar}>
            <Text style={styles.previewName} numberOfLines={1}>{preview?.name}</Text>
            <TouchableOpacity onPress={() => setPreview(null)} style={styles.previewClose}>
              <Text style={styles.previewCloseText}>Затвори</Text>
            </TouchableOpacity>
          </View>
          {preview && (
            <>
              {/* key-ът нулира увеличението при отваряне на друга снимка */}
              <ZoomableImage key={preview.url} uri={preview.url} />
              <Text style={styles.previewHint} pointerEvents="none">
                Щипни с два пръста или тапни два пъти за увеличаване
              </Text>
            </>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.xl },
  back: { marginBottom: space.lg },
  backText: { ...type.body, color: colors.brand600 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  title: { ...type.title, color: colors.text900 },
  subtitle: { ...type.label, color: colors.text600, marginBottom: space.xl },
  empty: { alignItems: "center", padding: space.xxxl, backgroundColor: colors.surface, borderRadius: radius.card, marginBottom: space.xl },
  emptyEmoji: { fontSize: 48, marginBottom: space.md },
  emptyTitle: { ...type.subhead, color: colors.text900, marginBottom: space.sm },
  emptyText: { ...type.label, color: colors.text600, textAlign: "center" },
  list: { gap: space.md, marginBottom: space.xl },
  docRow: {
    backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg,
    flexDirection: "row", alignItems: "center", gap: space.md,
  },
  docEmoji: { fontSize: 28 },
  docInfo: { flex: 1 },
  docName: { ...type.label, fontWeight: "600", color: colors.text900, fontFamily: "GolosText_600SemiBold" },
  docMeta: { fontSize: 12, lineHeight: 16, color: colors.text600, marginTop: space.xs },
  docUploader: { fontSize: 12, lineHeight: 16, color: colors.text400, marginTop: space.xs },
  docActions: { flexDirection: "row", gap: space.sm },
  iconBtn: { padding: space.sm },
  iconBtnText: { fontSize: 18 },
  btn: { backgroundColor: colors.brand600, padding: space.lg, borderRadius: radius.card, alignItems: "center" },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  btnText: { ...type.body, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },

  // Прегледът е на тъмен фон нарочно — снимка на документ се чете по-добре
  // така, а и е ясно, че си "извън" списъка.
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  previewBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: space.xxxl, paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md,
  },
  previewName: { ...type.body, color: "#fff", flex: 1 },
  previewClose: { paddingVertical: space.sm, paddingHorizontal: space.md },
  previewCloseText: { ...type.body, color: "#fff", fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  previewImageWrap: { flex: 1, width: "100%", overflow: "hidden" },
  previewImage: { flex: 1, width: "100%" },
  previewHint: {
    position: "absolute", left: 0, right: 0, bottom: space.xl,
    textAlign: "center", fontSize: 13, lineHeight: 18,
    color: "rgba(255,255,255,0.5)",
  },
});
