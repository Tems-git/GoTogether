import { useState, useEffect, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Linking,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { supabase } from "../lib/supabase";

const DOC_TYPES = {
  reservation: { emoji: "🏨", label: "Резервация" },
  ticket: { emoji: "✈️", label: "Билет" },
  insurance: { emoji: "🛡️", label: "Застраховка" },
  other: { emoji: "📄", label: "Друго" },
};

function docTypeFromMime(mime = "") {
  if (mime.includes("pdf")) return "other";
  return "other";
}

function guessDocType(name = "") {
  const n = name.toLowerCase();
  if (n.includes("резерв") || n.includes("hotel") || n.includes("booking")) return "reservation";
  if (n.includes("билет") || n.includes("ticket") || n.includes("flight")) return "ticket";
  if (n.includes("застрах") || n.includes("insur")) return "insurance";
  return "other";
}

export default function DocumentsScreen({ onBack, tripId, userId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

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
      setUploading(true);

      // Четем файла като ArrayBuffer
      const response = await fetch(file.uri);
      const arrayBuffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const ext = file.name.split(".").pop();
      const path = `${tripId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, uint8, { contentType: file.mimeType || "application/octet-stream" });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("documents")
        .getPublicUrl(path);

      const { error: dbError } = await supabase.from("documents").insert({
        trip_id: tripId,
        uploaded_by: userId,
        name: file.name,
        file_url: publicUrl,
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
          // Извличаме path от URL-а
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

      <TouchableOpacity style={styles.btn} onPress={handleUpload} disabled={uploading}>
        {uploading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>+ Качи документ</Text>}
      </TouchableOpacity>
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
});
