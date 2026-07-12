import { useState, useEffect, useCallback, useMemo } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView,
  Modal, TextInput, ActivityIndicator, Alert,
} from "react-native";
import { supabase } from "../lib/supabase";

const DEV_MEMBERS = [
  { user_id: "00000000-0000-0000-0000-000000000002", display_name: "Теmelko", weight: 2 },
  { user_id: "00000000-0000-0000-0000-000000000003", display_name: "Спас", weight: 3 },
];

const MEMBER_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#DDA0DD", "#98D8C8", "#FFEAA7"];

const COMMON_CURRENCIES = ["EUR", "BGN", "USD", "GBP"];
const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£", BGN: "лв." };

function currencyLabel(code) {
  return CURRENCY_SYMBOLS[code] ? `${code} ${CURRENCY_SYMBOLS[code]}` : code;
}

function formatMoney(amount, code) {
  const symbol = CURRENCY_SYMBOLS[code];
  const num = amount.toFixed(2);
  return symbol ? `${num} ${symbol}` : `${num} ${code}`;
}

function toEUR(amount, currency, rates) {
  if (currency === "EUR") return amount;
  const rate = rates?.[currency];
  if (!rate) return amount;
  return amount / rate;
}

function calcSettlements(allParticipants, expenses, splits, rates) {
  const unsettled = splits.filter((s) => !s.is_settled);
  const balance = {};
  allParticipants.forEach((m) => (balance[m.user_id] = 0));
  expenses.forEach((exp) => {
    const expSplits = unsettled.filter((s) => s.expense_id === exp.id);
    expSplits.forEach((s) => {
      if (s.user_id === exp.paid_by) return;
      const shareEUR = toEUR(Number(s.share), exp.currency || "EUR", rates);
      balance[exp.paid_by] = (balance[exp.paid_by] || 0) + shareEUR;
      balance[s.user_id] = (balance[s.user_id] || 0) - shareEUR;
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
  const [allNames, setAllNames] = useState({});
  const [loading, setLoading] = useState(!devMode);
  const [modalVisible, setModalVisible] = useState(false);
  const [settleVisible, setSettleVisible] = useState(false);
  const [settling, setSettling] = useState(null);

  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(userId);
  const [category, setCategory] = useState("other");
  const [splitWith, setSplitWith] = useState([]);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState("EUR");
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");

  const [localCurrency, setLocalCurrency] = useState("EUR");
  const [rates, setRates] = useState(null);
  const [ratesDate, setRatesDate] = useState(null);
  const [currencyNames, setCurrencyNames] = useState({});

  const fetchAll = useCallback(async () => {
    if (devMode) return;
    try {
      const { data: mData } = await supabase
        .from("trip_members").select("user_id, display_name, weight, role").eq("trip_id", tripId);
      const activeMembers = (mData && mData.length > 0) ? mData : DEV_MEMBERS;

      const { data: tripData } = await supabase
        .from("trips").select("local_currency").eq("id", tripId).maybeSingle();
      if (tripData?.local_currency) setLocalCurrency(tripData.local_currency);

      const { data: eData } = await supabase
        .from("expenses").select("*").eq("trip_id", tripId).order("created_at", { ascending: false });
      const expenseIds = (eData || []).map((e) => e.id);
      let sData = [];
      if (expenseIds.length > 0) {
        const { data } = await supabase.from("expense_splits").select("*").in("expense_id", expenseIds);
        sData = data || [];
      }

      const namesMap = {};
      activeMembers.forEach((m) => { namesMap[m.user_id] = m.display_name; });

      const activeIdsSet = new Set(activeMembers.map((m) => m.user_id));
      const allPayers = [...new Set((eData || []).map((e) => e.paid_by))];
      const allSplitUsers = [...new Set(sData.map((s) => s.user_id))];
      const missingIds = [...new Set([...allPayers, ...allSplitUsers])].filter((id) => !activeIdsSet.has(id));

      if (missingIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles").select("id, display_name").in("id", missingIds);
        (profilesData || []).forEach((p) => {
          namesMap[p.id] = p.display_name || "Бивш участник";
        });
      }

      setMembers(activeMembers);
      setAllNames(namesMap);
      setExpenses(eData || []);
      setSplits(sData);
    } catch (e) {
      setMembers(DEV_MEMBERS);
    }
  }, [tripId, devMode]);

  const fetchRatesAndCurrencies = useCallback(async () => {
    try {
      const [ratesRes, currenciesRes] = await Promise.all([
        supabase.functions.invoke("currency-rates?action=rates", { method: "GET" }),
        supabase.functions.invoke("currency-rates?action=currencies", { method: "GET" }),
      ]);
      if (!ratesRes.error && ratesRes.data) {
        setRates(ratesRes.data.rates || null);
        setRatesDate(ratesRes.data.date || null);
      }
      if (!currenciesRes.error && currenciesRes.data) {
        setCurrencyNames(currenciesRes.data.currencies || {});
      }
    } catch (e) { /* тихо */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
    fetchRatesAndCurrencies();
    if (devMode) return;
    const channel = supabase
      .channel(`expenses-${tripId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `trip_id=eq.${tripId}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_splits" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` }, () => fetchAll())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAll, fetchRatesAndCurrencies, tripId, devMode]);

  function openModal() {
    setSplitWith(members.map((m) => m.user_id));
    setPaidBy(userId); setDesc(""); setAmount("");
    setCategory("other"); setCurrency("EUR");
    setCurrencyPickerOpen(false); setCurrencySearch("");
    setModalVisible(true);
  }

  function toggleSplitWith(uid) {
    setSplitWith((prev) => prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]);
  }

  const memberColor = (uid) => {
    const idx = Object.keys(allNames).indexOf(uid);
    return MEMBER_COLORS[idx >= 0 ? idx % MEMBER_COLORS.length : 0];
  };
  const getMemberWeight = (uid) => { const m = members.find((m) => m.user_id === uid); return m?.weight || 1; };
  const memberName = (uid) => allNames[uid] || "Непознат";
  const activeIds = new Set(members.map((m) => m.user_id));
  const isOwner = members.find((m) => m.user_id === userId)?.role === "owner";

  function calcShares(amt, participantIds, payerId) {
    const totalWeight = participantIds.reduce((s, uid) => s + getMemberWeight(uid), 0);
    const nonPayers = participantIds.filter((uid) => uid !== payerId);
    return nonPayers.map((uid) => ({
      uid, share: parseFloat(((amt * getMemberWeight(uid)) / totalWeight).toFixed(2)),
    }));
  }

  function convertAmount(amt, fromCurrency) {
    const eur = toEUR(amt, fromCurrency, rates);
    if (localCurrency === "EUR" || !rates) return { eur, local: null };
    const localRate = rates[localCurrency];
    if (!localRate) return { eur, local: null };
    return { eur, local: eur * localRate };
  }

  async function handleMarkSettled(settlement, index, asAdmin = false) {
    const msg = asAdmin
      ? `Потвърди като организатор, че преводът ${formatMoney(settlement.amount, "EUR")} от ${memberName(settlement.from)} към ${memberName(settlement.to)} е уреден?`
      : `Получи ли ${formatMoney(settlement.amount, "EUR")} от ${memberName(settlement.from)}?`;
    Alert.alert("Потвърди", msg, [
      { text: "Не", style: "cancel" },
      { text: "Да, потвърждавам!", onPress: async () => {
          setSettling(index);
          try {
            const relevantExpenseIds = expenses.filter((e) => e.paid_by === settlement.to).map((e) => e.id);
            const splitsToSettle = splits.filter((s) => s.user_id === settlement.from && relevantExpenseIds.includes(s.expense_id) && !s.is_settled);
            if (splitsToSettle.length > 0) {
              await supabase.from("expense_splits").update({ is_settled: true }).in("expense_id", splitsToSettle.map((s) => s.expense_id)).eq("user_id", settlement.from);
            }
            await fetchAll();
          } catch (e) { Alert.alert("Грешка", e.message); } finally { setSettling(null); }
        }
      },
    ]);
  }

  async function handleSave() {
    if (!desc.trim()) return Alert.alert("Грешка", "Въведи описание");
    const amt = parseFloat(amount.replace(",", "."));
    if (isNaN(amt) || amt <= 0) return Alert.alert("Грешка", "Въведи валидна сума");
    const nonPayers = splitWith.filter((uid) => uid !== paidBy);
    if (nonPayers.length === 0) return Alert.alert("Грешка", "Избери поне един участник");
    setSaving(true);
    try {
      const { data: exp, error } = await supabase.from("expenses").insert({
        trip_id: tripId, paid_by: paidBy, amount: amt,
        description: desc.trim(), category, split_type: "weighted", currency,
      }).select().single();
      if (error) throw error;
      const shares = calcShares(amt, splitWith, paidBy);
      const { error: splitError } = await supabase.from("expense_splits").insert(
        shares.map(({ uid, share }) => ({ expense_id: exp.id, user_id: uid, share, is_settled: false }))
      );
      if (splitError) throw splitError;
      setModalVisible(false);
      await fetchAll();
    } catch (e) { Alert.alert("Грешка", e.message); } finally { setSaving(false); }
  }

  async function handleDelete(expId) {
    Alert.alert("Изтриване", "Сигурен ли си?", [
      { text: "Отказ", style: "cancel" },
      { text: "Изтрий", style: "destructive", onPress: async () => {
          await supabase.from("expense_splits").delete().eq("expense_id", expId);
          await supabase.from("expenses").delete().eq("id", expId);
          await fetchAll();
        },
      },
    ]);
  }

  const totalEUR = expenses.reduce((s, e) => s + toEUR(Number(e.amount), e.currency || "EUR", rates), 0);
  const iOweEUR = expenses.reduce((sum, exp) => {
    if (exp.paid_by === userId) return sum;
    const mySplit = splits.find((s) => s.expense_id === exp.id && s.user_id === userId && !s.is_settled);
    return mySplit ? sum + toEUR(Number(mySplit.share), exp.currency || "EUR", rates) : sum;
  }, 0);
  const owedToMeEUR = expenses.reduce((sum, exp) => {
    if (exp.paid_by !== userId) return sum;
    const unsettled = splits.filter((s) => s.expense_id === exp.id && s.user_id !== userId && !s.is_settled);
    return sum + unsettled.reduce((s, x) => s + toEUR(Number(x.share), exp.currency || "EUR", rates), 0);
  }, 0);
  const spentByMember = Object.entries(allNames).map(([uid, name]) => ({
    user_id: uid, display_name: name,
    spentEUR: expenses.filter((e) => e.paid_by === uid).reduce((s, e) => s + toEUR(Number(e.amount), e.currency || "EUR", rates), 0),
  })).filter((m) => m.spentEUR > 0);

  const allParticipants = Object.keys(allNames).map((uid) => ({ user_id: uid }));
  const settlements = useMemo(() => calcSettlements(allParticipants, expenses, splits, rates), [expenses, splits, rates, JSON.stringify(allParticipants)]);
  const catInfo = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[4];
  const amtNum = parseFloat(amount.replace(",", ".")) || 0;
  const nonPayerIds = splitWith.filter((uid) => uid !== paidBy);
  const previewShares = amtNum > 0 && nonPayerIds.length > 0 ? calcShares(amtNum, splitWith, paidBy) : [];
  const allEqual = previewShares.length > 0 && previewShares.every((s) => s.share === previewShares[0].share);

  function formatDate(iso) {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  }
  function isExpenseSettled(exp) {
    const nonPayerSplits = splits.filter((s) => s.expense_id === exp.id && s.user_id !== exp.paid_by);
    return nonPayerSplits.length > 0 && nonPayerSplits.every((s) => s.is_settled);
  }
  const allSettled = settlements.length === 0 && expenses.length > 0;

  const allCurrencyCodes = useMemo(() => {
    const fromApi = Object.keys(currencyNames);
    return Array.from(new Set([...COMMON_CURRENCIES, "EUR", ...fromApi]));
  }, [currencyNames]);

  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toUpperCase();
    const codes = allCurrencyCodes.filter((c) => !COMMON_CURRENCIES.includes(c));
    return (q ? codes.filter((c) => c.includes(q) || (currencyNames[c] || "").toUpperCase().includes(q)) : codes).sort();
  }, [allCurrencyCodes, currencyNames, currencySearch]);

  function selectCurrency(code) {
    setCurrency(code); setCurrencyPickerOpen(false); setCurrencySearch("");
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <Text style={styles.title}>💸 Разходи</Text>
      <Text style={styles.subtitle}>Кой колко дължи</Text>

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>{formatMoney(totalEUR, "EUR")}</Text>
          <Text style={styles.summaryLbl}>Общо</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, iOweEUR > 0 && { color: "#FFD580" }]}>{formatMoney(iOweEUR, "EUR")}</Text>
          <Text style={styles.summaryLbl}>Ти дължиш</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, owedToMeEUR > 0 && { color: "#A8F0D4" }]}>{formatMoney(owedToMeEUR, "EUR")}</Text>
          <Text style={styles.summaryLbl}>Дължат ти</Text>
        </View>
      </View>

      {spentByMember.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.spentRow}>
          {spentByMember.map((m) => {
            const color = memberColor(m.user_id);
            return (
              <View key={m.user_id} style={styles.spentChip}>
                <View style={[styles.spentDot, { backgroundColor: color }]} />
                <Text style={styles.spentName}>{m.display_name}</Text>
                <Text style={[styles.spentAmt, { color }]}>{formatMoney(m.spentEUR, "EUR")}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      {allSettled && (
        <View style={styles.settledBanner}><Text style={styles.settledBannerText}>✅ Всички сметки са изравнени!</Text></View>
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
            const settled = isExpenseSettled(exp);
            const payerColor = memberColor(exp.paid_by);
            const expCurrency = exp.currency || "EUR";
            return (
              <View key={exp.id} style={[styles.expRow, settled && styles.expRowSettled]}>
                <Text style={styles.expEmoji}>{settled ? "✅" : cat.emoji}</Text>
                <View style={styles.expInfo}>
                  <Text style={[styles.expDesc, settled && styles.expDescSettled]}>{exp.description}</Text>
                  <View style={styles.expMetaRow}>
                    <Text style={styles.expMetaText}>{cat.label} · {formatDate(exp.created_at)} · </Text>
                    <Text style={[styles.expMetaPayer, { color: settled ? "#aaa" : payerColor }]}>{memberName(exp.paid_by)}</Text>
                  </View>
                </View>
                <View style={styles.expRight}>
                  <Text style={[styles.expAmount, settled && { color: "#aaa" }]}>{formatMoney(Number(exp.amount), expCurrency)}</Text>
                  {exp.paid_by === userId && !settled && (
                    <TouchableOpacity onPress={() => handleDelete(exp.id)}><Text style={styles.deleteBtn}>🗑</Text></TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.btn} onPress={openModal}>
        <Text style={styles.btnText}>+ Добави разход</Text>
      </TouchableOpacity>

      {/* ───── Модал за нов разход ───── */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Нов разход</Text>

            {currencyPickerOpen ? (
              <View>
                {/* Бутонът за връщане е ОТГОРЕ — винаги видим, независимо от дължината на списъка */}
                <TouchableOpacity style={styles.currencyBackBtn} onPress={() => { setCurrencyPickerOpen(false); setCurrencySearch(""); }}>
                  <Text style={styles.currencyBackBtnText}>← Назад към разхода</Text>
                </TouchableOpacity>

                <Text style={styles.currencySectionLabel}>Чести</Text>
                <View style={styles.currencyCommonRow}>
                  {COMMON_CURRENCIES.map((code) => (
                    <TouchableOpacity key={code}
                      style={[styles.currencyCommonChip, currency === code && styles.currencyCommonChipActive]}
                      onPress={() => selectCurrency(code)}>
                      <Text style={[styles.currencyCommonChipText, currency === code && styles.currencyCommonChipTextActive]}>
                        {currencyLabel(code)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.currencySectionLabel}>Всички валути</Text>
                <TextInput style={styles.currencySearchInput}
                  placeholder="Търси по код или име..." placeholderTextColor="#bbb"
                  value={currencySearch} onChangeText={setCurrencySearch}
                  autoCapitalize="characters" autoFocus />

                <ScrollView style={styles.currencyListScroll} nestedScrollEnabled>
                  {filteredCurrencies.slice(0, 50).map((item) => (
                    <TouchableOpacity key={item}
                      style={[styles.currencyRow, currency === item && styles.currencyRowActive]}
                      onPress={() => selectCurrency(item)}>
                      <Text style={[styles.currencyRowCode, currency === item && styles.currencyRowCodeActive]}>{item}</Text>
                      <Text style={styles.currencyRowName} numberOfLines={1}>{currencyNames[item] || ""}</Text>
                    </TouchableOpacity>
                  ))}
                  {filteredCurrencies.length === 0 && (
                    <Text style={styles.currencyEmpty}>Няма намерени валути</Text>
                  )}
                </ScrollView>
              </View>
            ) : (
              <View>
                <Text style={styles.label}>Описание</Text>
                <TextInput style={styles.input} placeholder="Напр. Хотел Хилтън"
                  value={desc} onChangeText={setDesc} placeholderTextColor="#bbb" />

                <Text style={styles.label}>Сума</Text>
                <View style={styles.amountRow}>
                  <TextInput style={[styles.input, styles.amountInput]} placeholder="0.00" keyboardType="decimal-pad"
                    value={amount} onChangeText={setAmount} placeholderTextColor="#bbb" />
                  <TouchableOpacity style={styles.currencyBtn} onPress={() => setCurrencyPickerOpen(true)}>
                    <Text style={styles.currencyBtnText}>{currencyLabel(currency)}</Text>
                    <Text style={styles.currencyBtnChevron}>▾</Text>
                  </TouchableOpacity>
                </View>

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

                <Text style={styles.label}>Дели между</Text>
                {members.map((m, i) => {
                  const isPayer = m.user_id === paidBy;
                  const checked = splitWith.includes(m.user_id);
                  const color = MEMBER_COLORS[i % MEMBER_COLORS.length];
                  const weight = m.weight || 1;
                  const preview = previewShares.find((s) => s.uid === m.user_id);
                  return (
                    <TouchableOpacity key={m.user_id} style={styles.checkRow}
                      onPress={() => !isPayer && toggleSplitWith(m.user_id)} disabled={isPayer}>
                      <View style={[styles.checkbox, isPayer && styles.checkboxDisabled, !isPayer && checked && { backgroundColor: color, borderColor: color }]}>
                        {isPayer ? <Text style={styles.checkmarkDisabled}>–</Text> : checked && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <View style={styles.checkInfo}>
                        <Text style={[styles.checkLabel, isPayer && { color: "#aaa" }, !isPayer && checked && { color }]}>
                          {m.display_name}{weight > 1 ? ` ×${weight}` : ""}{isPayer ? " (платил)" : ""}
                        </Text>
                        {preview && <Text style={[styles.checkShare, { color: isPayer ? "#aaa" : color }]}>{formatMoney(preview.share, currency)}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {previewShares.length > 0 && (
                  <View style={styles.splitNote}>
                    <Text style={styles.splitNoteText}>
                      {allEqual ? `✂️ ${nonPayerIds.length} участника · ${formatMoney(previewShares[0].share, currency)} на човек` : `✂️ Пропорционално по брой хора`}
                    </Text>
                  </View>
                )}

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.btnCancel} onPress={() => setModalVisible(false)}>
                    <Text style={styles.btnCancelText}>Отказ</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnSave} onPress={handleSave} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnSaveText}>Запази</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ───── Модал за изравняване ───── */}
      <Modal visible={settleVisible} animationType="fade" transparent>
        <View style={styles.overlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <Text style={styles.modalTitle}>⚖️ Как да се изравним</Text>
            <Text style={styles.settleSubtitle}>Получателят потвърждава когато са получени парите:</Text>
            {ratesDate && <Text style={styles.settleRatesNote}>Курсове от {ratesDate} (ECB)</Text>}
            {settlements.map((s, i) => {
              const iAmReceiver = s.to === userId;
              const iAmSender = s.from === userId;
              const receiverLeft = !activeIds.has(s.to);
              const iAmAdminForThis = isOwner && receiverLeft && !iAmReceiver;
              const converted = convertAmount(s.amount, "EUR");
              return (
                <View key={i} style={styles.settleRow}>
                  <View style={styles.settleTop}>
                    <Text style={[styles.settleFrom, { color: memberColor(s.from) }]}>{memberName(s.from)}</Text>
                    <Text style={styles.settleArrow}>→</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.settleTo, { color: memberColor(s.to) }]}>{memberName(s.to)}</Text>
                      {receiverLeft && <Text style={styles.settleLeftLabel}>напуснал</Text>}
                    </View>
                    <View style={styles.settleAmtCol}>
                      <Text style={styles.settleAmt}>{formatMoney(s.amount, "EUR")}</Text>
                      {converted.local !== null && <Text style={styles.settleAmtLocal}>≈ {formatMoney(converted.local, localCurrency)}</Text>}
                    </View>
                  </View>
                  {iAmReceiver ? (
                    <TouchableOpacity style={styles.settleBtn} onPress={() => handleMarkSettled(s, i, false)} disabled={settling === i}>
                      {settling === i ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.settleBtnText}>✓ Получих парите</Text>}
                    </TouchableOpacity>
                  ) : iAmAdminForThis ? (
                    <TouchableOpacity style={styles.settleBtnAdmin} onPress={() => handleMarkSettled(s, i, true)} disabled={settling === i}>
                      {settling === i ? <ActivityIndicator size="small" color="#1D9E75" /> : <Text style={styles.settleBtnAdminText}>✓ Потвърди като организатор</Text>}
                    </TouchableOpacity>
                  ) : iAmSender ? (
                    <View style={styles.settlePending}><Text style={styles.settlePendingText}>⏳ Изпрати {formatMoney(s.amount, "EUR")} на {memberName(s.to)}</Text></View>
                  ) : (
                    <View style={styles.settlePending}><Text style={styles.settlePendingText}>⏳ Очаква потвърждение</Text></View>
                  )}
                </View>
              );
            })}
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
  spentChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8 },
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
  modalScroll: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  modalScrollContent: { padding: 24, paddingBottom: 40, gap: 8 },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#1a1a1a", marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", color: "#555", marginTop: 6 },
  input: { backgroundColor: "#F5F5F5", borderRadius: 10, padding: 12, fontSize: 16, color: "#1a1a1a" },
  amountRow: { flexDirection: "row", gap: 8, alignItems: "stretch" },
  amountInput: { flex: 1 },
  currencyBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F5F5F5", borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
  currencyBtnText: { fontSize: 15, fontWeight: "600", color: "#1D9E75" },
  currencyBtnChevron: { fontSize: 11, color: "#1D9E75" },
  currencyBackBtn: { backgroundColor: "#F5F5F5", padding: 12, borderRadius: 10, alignItems: "center", marginBottom: 12 },
  currencyBackBtnText: { color: "#1D9E75", fontSize: 15, fontWeight: "600" },
  chips: { flexDirection: "row", marginVertical: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F0F0F0", marginRight: 8 },
  chipActive: { backgroundColor: "#1D9E75" },
  chipText: { fontSize: 13, color: "#555" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  checkInfo: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  checkboxDisabled: { backgroundColor: "#f0f0f0", borderColor: "#e0e0e0" },
  checkmark: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  checkmarkDisabled: { color: "#ccc", fontSize: 14 },
  checkLabel: { fontSize: 14, fontWeight: "500" },
  checkShare: { fontSize: 12, fontWeight: "700" },
  splitNote: { backgroundColor: "#F0F9F5", borderRadius: 10, padding: 10, marginTop: 4 },
  splitNoteText: { fontSize: 12, color: "#1D9E75", fontWeight: "600" },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnCancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  btnCancelText: { color: "#888", fontSize: 15 },
  btnSave: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#1D9E75", alignItems: "center" },
  btnSaveText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  settleSubtitle: { fontSize: 13, color: "#888", marginBottom: 4 },
  settleRatesNote: { fontSize: 11, color: "#bbb", marginBottom: 10 },
  settleRow: { backgroundColor: "#F5F5F5", borderRadius: 12, padding: 12, marginBottom: 10 },
  settleTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  settleFrom: { fontWeight: "700", flex: 1, fontSize: 13 },
  settleArrow: { color: "#888" },
  settleTo: { fontWeight: "700", fontSize: 13 },
  settleLeftLabel: { fontSize: 10, color: "#FF6B6B", fontStyle: "italic" },
  settleAmtCol: { alignItems: "flex-end" },
  settleAmt: { fontWeight: "bold", color: "#1a1a1a", fontSize: 13 },
  settleAmtLocal: { fontSize: 11, color: "#888", marginTop: 1 },
  settleBtn: { backgroundColor: "#1D9E75", padding: 12, borderRadius: 10, alignItems: "center" },
  settleBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  settleBtnAdmin: { backgroundColor: "#fff", padding: 12, borderRadius: 10, alignItems: "center", borderWidth: 1.5, borderColor: "#1D9E75" },
  settleBtnAdminText: { color: "#1D9E75", fontSize: 14, fontWeight: "bold" },
  settlePending: { backgroundColor: "#F0F0F0", padding: 12, borderRadius: 10, alignItems: "center" },
  settlePendingText: { color: "#888", fontSize: 13 },
  currencySectionLabel: { fontSize: 12, fontWeight: "700", color: "#888", marginTop: 12, marginBottom: 8 },
  currencyCommonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyCommonChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F5F5F5" },
  currencyCommonChipActive: { backgroundColor: "#1D9E75" },
  currencyCommonChipText: { fontSize: 14, fontWeight: "600", color: "#555" },
  currencyCommonChipTextActive: { color: "#fff" },
  currencySearchInput: { backgroundColor: "#F5F5F5", borderRadius: 10, padding: 12, fontSize: 15, color: "#1a1a1a", marginBottom: 8 },
  currencyListScroll: { maxHeight: 280 },
  currencyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  currencyRowActive: { backgroundColor: "#F0F9F5" },
  currencyRowCode: { fontSize: 14, fontWeight: "700", color: "#1a1a1a", width: 48 },
  currencyRowCodeActive: { color: "#1D9E75" },
  currencyRowName: { fontSize: 13, color: "#888", flex: 1 },
  currencyEmpty: { textAlign: "center", color: "#bbb", fontSize: 13, paddingVertical: 20 },
});
