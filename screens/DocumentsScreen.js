import { useState, useEffect, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Linking, Modal,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabase";

const DOC_TYPES = {
  reservation: { emoji: "🏨", label: "Резервация" },
  ticket: { emoji: "✈️", label: "Билет" },
  insurance: { emoji: "🛡️", label: "Застраховка" },
  photo: { emoji: "🖼️", label: "Снимка" },
  other: { emoji: "📄", label: "Друго" },
};

function guessDocType(name = "") {
  const n = name.toLowerCase();
  if (n.includes("резерв") || n.includes("hotel") || n.includes("booking")) return "reservation";
  if (n.includes("билет") || n.includes("ticket") || n.includes("flight")) return "ticket";
  if (n.includes("застрах") || n.includes("insur")) return "insurance";
  if (n.match(/\.(jpg|jpeg|png|heic|webp)$/)) return "photo";
  return "other";
}

export default function DocumentsScreen({ onBack, tripId, userId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pickModalVisible, setPickModalVisible] = useState(false);

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

  async function uploadFile({ uri, name, mimeType }) {
    setUploading(true);
    try {
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const path = `${tripId}/${Date.now()}_${name}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, uint8, { contentType: mimeType || "application/octet-stream" });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("documents").getPublicUrl(path);

      const { error: dbError } = await supabase.from("documents").insert({
        trip_id: tripId,
        uploaded_by: userId,
        name,
        file_url: publicUrl,
        doc_type: guessDocType(name),
      });
      if (dbError) throw dbError;
      await fetchDocs();
    } catch (e) {
      Alert.alert("Грешка при качване", e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handlePickDocument() {
    setPickModalVisible(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType });
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  async function handlePickImage(source) {
    setPickModalVisible(false);
    try {
      let result;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") return Alert.alert("Грешка", "Няма достъп до камерата");
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") return Alert.alert("Грешка", "Няма достъп до галерията");
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
          allowsMultipleSelection: false,
        });
      }
      if (result.canceled) return;
      const asset = result.assets[0];
      const ext = asset.uri.split(".").pop() || "jpg";
      const name = `photo_${Date.now()}.${ext}`;
      await uploadFile({ uri: asset.uri, name, mimeType: `image/${ext}` });
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  async function handleDelete(doc) {
    Alert.alert("Изтриване", `Сигурен ли си, че искаш да изтриеш "${doc.name}"?`, [
      { text: "Отказ", style: "cancel" },
      {
        text: "Изтрий", style: "destructive",
        onPress: async () => {
          const urlParts = doc.file_url.split("/documents/");
          const storagePath = urlParts[1];
          await supabase.storage.from("documents").remove([storagePath]);
          await supabase.from("documents").delete().eq("id", doc.id);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <Text style={styles.title}>📁 Документи</Text>
      <Text style={styles.subtitle}>Резервации, билети и застраховки</Text>

      {loading ? (
        <ActivityIndicator color="#1D9E75" style={{ marginTop: 40 }} />
      ) : docs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📄</Text>
          <Text style={styles.emptyTitle}>Няма документи все още</Text>
          <Text style={styles.emptyText}>Качи резервация, билет или снимка — всички в групата ще я видят веднага.</Text>
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
                  <TouchableOpacity onPress={() => Linking.openURL(doc.file_url)} style={styles.iconBtn}>
                    <Text style={styles.iconBtnText}>👁</Text>
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

      <TouchableOpacity style={styles.btn} onPress={() => setPickModalVisible(true)} disabled={uploading}>
        {uploading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>+ Качи документ</Text>}
      </TouchableOpacity>

      {/* Modal за избор на тип */}
      <Modal visible={pickModalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Избери файл</Text>
            <TouchableOpacity style={styles.pickOption} onPress={handlePickDocument}>
              <Text style={styles.pickEmoji}>📄</Text>
              <View>
                <Text style={styles.pickLabel}>Файл / PDF</Text>
                <Text style={styles.pickSub}>Резервация, билет, застраховка</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickOption} onPress={() => handlePickImage("gallery")}>
              <Text style={styles.pickEmoji}>🖼️</Text>
              <View>
                <Text style={styles.pickLabel}>От галерията</Text>
                <Text style={styles.pickSub}>Снимка от телефона</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickOption} onPress={() => handlePickImage("camera")}>
              <Text style={styles.pickEmoji}>📷</Text>
              <View>
                <Text style={styles.pickLabel}>Снимай сега</Text>
                <Text style={styles.pickSub}>Направи снимка с камерата</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setPickModalVisible(false)}>
              <Text style={styles.cancelText}>Отказ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  back: { marginBottom: 16 },
  backText: { color: "#1D9E75", fontSize: 16 },
  title: { fontSize: 26, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#888", marginBottom: 24 },
  empty: { alignItems: "center", padding: 40, backgroundColor: "#fff", borderRadius: 16, marginBottom: 20 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  emptyText: { fontSize: 14, color: "#888", textAlign: "center", lineHeight: 20 },
  list: { gap: 10, marginBottom: 20 },
  docRow: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  docEmoji: { fontSize: 28 },
  docInfo: { flex: 1 },
  docName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a" },
  docMeta: { fontSize: 12, color: "#888", marginTop: 2 },
  docUploader: { fontSize: 11, color: "#aaa", marginTop: 1 },
  docActions: { flexDirection: "row", gap: 6 },
  iconBtn: { padding: 6 },
  iconBtnText: { fontSize: 18 },
  btn: { backgroundColor: "#1D9E75", padding: 16, borderRadius: 14, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 4,
  },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#1a1a1a", marginBottom: 16 },
  pickOption: {
    flexDirection: "row", alignItems: "center", gap: 16,
    padding: 16, borderRadius: 14, backgroundColor: "#F5F5F5", marginBottom: 8,
  },
  pickEmoji: { fontSize: 32 },
  pickLabel: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  pickSub: { fontSize: 12, color: "#888", marginTop: 2 },
  cancelBtn: {
    marginTop: 8, padding: 16, borderRadius: 14,
    borderWidth: 1, borderColor: "#ddd", alignItems: "center",
  },
  cancelText: { color: "#888", fontSize: 15 },
});
