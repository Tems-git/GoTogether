import { useState, useEffect, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView,
  Modal, TextInput, ActivityIndicator, Alert,
} from "react-native";
import { supabase } from "../lib/supabase";

const DEV_MEMBERS = [
  { user_id: "00000000-0000-0000-0000-000000000002", display_name: "Теmelko" },
  { user_id: "00000000-0000-0000-0000-000000000003", display_name: "Спас" },
];

const MEMBER_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#DDA0DD", "#98D8C8", "#FFEAA7"];

function calcSettlements(members, expenses, splits) {
  const unsettled = splits.filter((s) => !s.is_settled);
  const balance = {};
  members.forEach((m) => (balance[m.user_id] = 0));
  expenses.forEach((exp) => {
    const expSplits = unsettled.filter((s) => s.expense_id === exp.id);
    expSplits.forEach((s) => {
      if (s.user_id === exp.paid_by) return;
      balance[exp.paid_by] = (balance[exp.paid_by] || 0) + Number(s.share);
      balance[s.user_id] = (balance[s.user_id] || 0) - Number(s.share);
    });
  });
  const creditors = [], debtors = [];
  Object.entries(balance).forEach(([uid, amt]) => {
    if (amt > 0.01) creditors.push({ uid, amt });
    else if (amt < -0.01) debtors.push({ uid, amt: -amt });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const result = [];
  let i = 0, j = 0;
  while (i < creditors.length && j < debtors.length) {
    const pay = Math.min(creditors[i].amt, debtors[j].amt);
    result.push({ from: debtors[j].uid, to: creditors[i].uid, amount: pay });
    creditors[i].amt -= pay;
    debtors[j].amt -= pay;
    if (creditors[i].amt < 0.01) i++;
    if (debtors[j].amt < 0.01) j++;
  }
  return result;
}

const CATEGORIES = [
  { key: "transport", label: "Транспорт", emoji: "🚗" },
  { key: "food", label: "Храна", emoji: "🍽" },
  { key: "accommodation", label: "Нощувка", emoji: "🏨" },
  { key: "activity", label: "Активност", emoji: "🎡" },
  { key: "other", label: "Друго", emoji: "💰" },
];

export default function ExpensesScreen({ onBack, tripId, userId, devMode }) {
  const [expenses, setExpenses] = useState([]);
  const [splits, setSplits] = useState([]);
  const [members, setMembers] = useState(devMode ? DEV_MEMBERS : []);
  const [loading, setLoading] = useState(!devMode);
  const [modalVisible, setModalVisible] = useState(false);
  const [settleVisible, setSettleVisible] = useState(false);
  const [settling, setSettling] = useState(null);

  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(userId);
  const [category, setCategory] = useState("other");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (devMode) return;
    setLoading(true);
    try {
      const { data: mData } = await supabase
        .from("trip_members").select("user_id, display_name").eq("trip_id", tripId);
      const { data: eData } = await supabase
        .from("expenses").select("*").eq("trip_id", tripId).order("created_at", { ascending: false });
      const expenseIds = (eData || []).map((e) => e.id);
      let sData = [];
      if (expenseIds.length > 0) {
        const { data } = await supabase.from("expense_splits").select("*").in("expense_id", expenseIds);
        sData = data || [];
      }
      setMembers((mData && mData.length > 0) ? mData : DEV_MEMBERS);
      setExpenses(eData || []);
      setSplits(sData);
    } catch (e) {
      setMembers(DEV_MEMBERS);
    } finally {
      setLoading(false);
    }
  }, [tripId, devMode]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const memberColor = (uid) => {
    const idx = members.findIndex((m) => m.user_id === uid);
    return MEMBER_COLORS[idx % MEMBER_COLORS.length];
  };

  async function handleMarkSettled(settlement, index) {
    Alert.alert(
      "Изравняване",
      `${memberName(settlement.from)} е платил ${settlement.amount.toFixed(2)} лв. на ${memberName(settlement.to)}?`,
      [
        { text: "Отказ", style: "cancel" },
        {
          text: "Да, изравнено!", onPress: async () => {
            setSettling(index);
            try {
              const expenseIds = expenses.map((e) => e.id);
              const splitsToSettle = splits.filter(
                (s) => s.user_id === settlement.from &&
                  expenseIds.includes(s.expense_id) &&
                  !s.is_settled
              );
              if (splitsToSettle.length > 0) {
                await supabase
                  .from("expense_splits")
                  .update({ is_settled: true })
                  .in("expense_id", splitsToSettle.map((s) => s.expense_id))
                  .eq("user_id", settlement.from);
              }
              await fetchAll();
            } catch (e) {
              Alert.alert("Грешка", e.message);
            } finally {
              setSettling(null);
            }
          }
        },
      ]
    );
  }

  async function handleSave() {
    if (!desc.trim()) return Alert.alert("Грешка", "Въведи описание");
    const amt = parseFloat(amount.replace(",", "."));
    if (isNaN(amt) || amt <= 0) return Alert.alert("Грешка", "Въведи валидна сума");
    if (members.length === 0) return Alert.alert("Грешка", "Няма участници в пътуването");
    setSaving(true);
    try {
      const share = parseFloat((amt / members.length).toFixed(2));
      const { data: exp, error } = await supabase.from("expenses").insert({
        trip_id: tripId, paid_by: paidBy, amount: amt,
        description: desc.trim(), category, split_type: "equal",
      }).select().single();
      if (error) throw error;
      const { error: splitError } = await supabase.from("expense_splits").insert(
        members.map((m) => ({ expense_id: exp.id, user_id: m.user_id, share, is_settled: false }))
      );
      if (splitError) throw splitError;
      setModalVisible(false);
      setDesc(""); setAmount(""); setPaidBy(userId); setCategory("other");
      await fetchAll();
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(expId) {
    Alert.alert("Изтриване", "Сигурен ли си?", [
      { text: "Отказ", style: "cancel" },
      {
        text: "Изтрий", style: "destructive",
        onPress: async () => {
          await supabase.from("expense_splits").delete().eq("expense_id", expId);
          await supabase.from("expenses").delete().eq("id", expId);
          await fetchAll();
        },
      },
    ]);
  }

  const unsettledSplits = splits.filter((s) => !s.is_settled);
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const myUnsettledShare = unsettledSplits.filter((s) => s.user_id === userId).reduce((s, x) => s + Number(x.share), 0);
  const iPaid = expenses.filter((e) => e.paid_by === userId).reduce((s, e) => s + Number(e.amount), 0);
  const mySettledShare = splits.filter((s) => s.user_id === userId && s.is_settled).reduce((s, x) => s + Number(x.share), 0);
  const iOwe = Math.max(0, myUnsettledShare - (iPaid - mySettledShare));
  const owedToMe = Math.max(0, (iPaid - mySettledShare) - myUnsettledShare);

  // Похарчено по участник
  const spentByMember = members.map((m) => ({
    ...m,
    spent: expenses.filter((e) => e.paid_by === m.user_id).reduce((s, e) => s + Number(e.amount), 0),
  })).filter((m) => m.spent > 0);

  const settlements = calcSettlements(members, expenses, splits);
  const memberName = (uid) => members.find((m) => m.user_id === uid)?.display_name || "Непознат";
  const catInfo = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[4];
  const sharePerPerson = members.length > 0
    ? (parseFloat(amount.replace(",", ".")) / members.length || 0).toFixed(2) : "—";

  function formatDate(iso) {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  }

  const allSettled = settlements.length === 0 && expenses.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <Text style={styles.title}>💸 Разходи</Text>
      <Text style={styles.subtitle}>Кой колко дължи</Text>

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>{total.toFixed(2)} лв.</Text>
          <Text style={styles.summaryLbl}>Общо</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, iOwe > 0 && { color: "#FFD580" }]}>{iOwe.toFixed(2)} лв.</Text>
          <Text style={styles.summaryLbl}>Ти дължиш</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, owedToMe > 0 && { color: "#A8F0D4" }]}>{owedToMe.toFixed(2)} лв.</Text>
          <Text style={styles.summaryLbl}>Дължат ти</Text>
        </View>
      </View>

      {/* Похарчено по участник */}
      {spentByMember.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.spentRow}>
          {spentByMember.map((m, i) => {
            const color = memberColor(m.user_id);
            return (
              <View key={m.user_id} style={styles.spentChip}>
                <View style={[styles.spentDot, { backgroundColor: color }]} />
                <Text style={styles.spentName}>{m.display_name}</Text>
                <Text style={[styles.spentAmt, { color }]}>{m.spent.toFixed(0)} лв.</Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      {allSettled && (
        <View style={styles.settledBanner}>
          <Text style={styles.settledBannerText}>✅ Всички сметки са изравнени!</Text>
        </View>
      )}

      {settlements.length > 0 && (
        <TouchableOpacity style={styles.settleCard} onPress={() => setSettleVisible(true)}>
          <Text style={styles.settleTitle}>⚖️ Как да се изравним</Text>
          <Text style={styles.settleHint}>{settlements.length} превод{settlements.length > 1 ? "а" : ""} · докосни за детайли</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator color="#1D9E75" style={{ marginTop: 30 }} />
      ) : expenses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>💰</Text>
          <Text style={styles.emptyTitle}>Няма разходи все още</Text>
          <Text style={styles.emptyText}>Добави първия разход и системата ще пресметне кой колко дължи.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {expenses.map((exp) => {
            const cat = catInfo(exp.category);
            const expSplits = splits.filter((s) => s.expense_id === exp.id);
            const isFullySettled = expSplits.length > 0 && expSplits.every((s) => s.is_settled);
            const payerColor = memberColor(exp.paid_by);
            return (
              <View key={exp.id} style={[styles.expRow, isFullySettled && styles.expRowSettled]}>
                <Text style={styles.expEmoji}>{isFullySettled ? "✅" : cat.emoji}</Text>
                <View style={styles.expInfo}>
                  <Text style={[styles.expDesc, isFullySettled && styles.expDescSettled]}>{exp.description}</Text>
                  <View style={styles.expMetaRow}>
                    <Text style={styles.expMetaText}>{cat.label} · {formatDate(exp.created_at)} · </Text>
                    <Text style={[styles.expMetaPayer, { color: isFullySettled ? "#aaa" : payerColor }]}>
                      {memberName(exp.paid_by)}
                    </Text>
                  </View>
                </View>
                <View style={styles.expRight}>
                  <Text style={[styles.expAmount, isFullySettled && { color: "#aaa" }]}>{Number(exp.amount).toFixed(2)} лв.</Text>
                  {exp.paid_by === userId && !isFullySettled && (
                    <TouchableOpacity onPress={() => handleDelete(exp.id)}>
                      <Text style={styles.deleteBtn}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.btn} onPress={() => setModalVisible(true)}>
        <Text style={styles.btnText}>+ Добави разход</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Нов разход</Text>
            <Text style={styles.label}>Описание</Text>
            <TextInput style={styles.input} placeholder="Напр. Хотел Хилтън"
              value={desc} onChangeText={setDesc} placeholderTextColor="#bbb" />
            <Text style={styles.label}>Сума (лв.)</Text>
            <TextInput style={styles.input} placeholder="0.00" keyboardType="decimal-pad"
              value={amount} onChangeText={setAmount} placeholderTextColor="#bbb" />
            <Text style={styles.label}>Платил</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {members.map((m, i) => (
                <TouchableOpacity key={m.user_id}
                  style={[styles.chip, paidBy === m.user_id && { backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length] }]}
                  onPress={() => setPaidBy(m.user_id)}>
                  <Text style={[styles.chipText, paidBy === m.user_id && styles.chipTextActive]}>{m.display_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>Категория</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.key}
                  style={[styles.chip, category === c.key && styles.chipActive]}
                  onPress={() => setCategory(c.key)}>
                  <Text style={[styles.chipText, category === c.key && styles.chipTextActive]}>{c.emoji} {c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.splitNote}>
              ✂️ Делене равно между {members.length} участника{amount ? ` — ${sharePerPerson} лв. на човек` : ""}
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setModalVisible(false)}>
                <Text style={styles.btnCancelText}>Отказ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSave} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnSaveText}>Запази</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={settleVisible} animationType="fade" transparent>
        <View style={styles.overlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <Text style={styles.modalTitle}>⚖️ Как да се изравним</Text>
            <Text style={styles.settleSubtitle}>Натисни ✓ когато преводът е направен:</Text>
            {settlements.map((s, i) => (
              <View key={i} style={styles.settleRow}>
                <View style={styles.settleTop}>
                  <Text style={[styles.settleFrom, { color: memberColor(s.from) }]}>{memberName(s.from)}</Text>
                  <Text style={styles.settleArrow}>→</Text>
                  <Text style={[styles.settleTo, { color: memberColor(s.to) }]}>{memberName(s.to)}</Text>
                  <Text style={styles.settleAmt}>{s.amount.toFixed(2)} лв.</Text>
                </View>
                <TouchableOpacity
                  style={styles.settleBtn}
                  onPress={() => handleMarkSettled(s, i)}
                  disabled={settling === i}
                >
                  {settling === i
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.settleBtnText}>✓ Маркирай като платено</Text>}
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={[styles.btnSave, { marginTop: 8 }]} onPress={() => setSettleVisible(false)}>
              <Text style={styles.btnSaveText}>Затвори</Text>
            </TouchableOpacity>
          </ScrollView>
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
  summary: { backgroundColor: "#1D9E75", borderRadius: 16, padding: 20, flexDirection: "row", marginBottom: 10 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryVal: { fontSize: 16, fontWeight: "bold", color: "#fff" },
  summaryLbl: { fontSize: 11, color: "#E1F5EE", marginTop: 4 },
  divider: { width: 0.5, backgroundColor: "rgba(255,255,255,0.3)" },
  spentRow: { flexDirection: "row", marginBottom: 14 },
  spentChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    marginRight: 8,
  },
  spentDot: { width: 8, height: 8, borderRadius: 4 },
  spentName: { fontSize: 12, color: "#555", fontWeight: "500" },
  spentAmt: { fontSize: 12, fontWeight: "700" },
  settledBanner: { backgroundColor: "#E8F8F0", borderRadius: 12, padding: 14, marginBottom: 16, alignItems: "center" },
  settledBannerText: { color: "#1D9E75", fontWeight: "bold", fontSize: 15 },
  settleCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: "#1D9E75" },
  settleTitle: { fontSize: 15, fontWeight: "bold", color: "#1a1a1a" },
  settleHint: { fontSize: 12, color: "#888", marginTop: 4 },
  empty: { alignItems: "center", padding: 40, backgroundColor: "#fff", borderRadius: 16, marginBottom: 20 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  emptyText: { fontSize: 14, color: "#888", textAlign: "center", lineHeight: 20 },
  list: { gap: 10, marginBottom: 20 },
  expRow: { backgroundColor: "#fff", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  expRowSettled: { backgroundColor: "#F9F9F9", opacity: 0.7 },
  expEmoji: { fontSize: 26 },
  expInfo: { flex: 1 },
  expDesc: { fontSize: 14, fontWeight: "600", color: "#1a1a1a" },
  expDescSettled: { textDecorationLine: "line-through", color: "#aaa" },
  expMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 2, flexWrap: "wrap" },
  expMetaText: { fontSize: 11, color: "#888" },
  expMetaPayer: { fontSize: 11, fontWeight: "700" },
  expRight: { alignItems: "flex-end", gap: 4 },
  expAmount: { fontSize: 15, fontWeight: "bold", color: "#1D9E75" },
  deleteBtn: { fontSize: 16 },
  btn: { backgroundColor: "#1D9E75", padding: 16, borderRadius: 14, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 8 },
  modalScroll: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%" },
  modalScrollContent: { padding: 24, gap: 8, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", color: "#555", marginTop: 6 },
  input: { backgroundColor: "#F5F5F5", borderRadius: 10, padding: 12, fontSize: 16, color: "#1a1a1a" },
  chips: { flexDirection: "row", marginVertical: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F0F0F0", marginRight: 8 },
  chipActive: { backgroundColor: "#1D9E75" },
  chipText: { fontSize: 13, color: "#555" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  splitNote: { fontSize: 12, color: "#888", backgroundColor: "#F5F5F5", padding: 10, borderRadius: 8, marginTop: 4 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnCancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  btnCancelText: { color: "#888", fontSize: 15 },
  btnSave: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#1D9E75", alignItems: "center" },
  btnSaveText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  settleSubtitle: { fontSize: 14, color: "#888", marginBottom: 12 },
  settleRow: { backgroundColor: "#F5F5F5", borderRadius: 12, padding: 12, marginBottom: 10 },
  settleTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  settleFrom: { fontWeight: "700", flex: 1, fontSize: 13 },
  settleArrow: { color: "#888" },
  settleTo: { fontWeight: "700", flex: 1, fontSize: 13 },
  settleAmt: { fontWeight: "bold", color: "#1a1a1a", fontSize: 13 },
  settleBtn: { backgroundColor: "#1D9E75", padding: 12, borderRadius: 10, alignItems: "center" },
  settleBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
});
