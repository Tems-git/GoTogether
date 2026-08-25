import { useState, useEffect, useCallback, useMemo } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, Alert, Share, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabase";import { useSafeAreaInsets } from "react-native-safe-area-context";
import DatePicker from "../components/DatePicker";
import { Sparkles, MessageSquare, FileText, CreditCard, MapPin, Users, Plus } from "lucide-react-native";
import { colors, space, radius, type } from "../theme/tokens";

const MAX_VISIBLE = 4;
const LOCAL_CURRENCY_OPTIONS = ["EUR", "USD", "GBP", "CHF"];

// Изчислява статус на пътуване спрямо днешна дата.
// Връща обект с {label, kind, sortOrder}.
//   kind: "upcoming" | "active" | "past" | "undated"
//   sortOrder: цяло число за подредба (по-малко = по-нагоре в trip picker)
function computeTripStatus(startStr, endStr) {
  if (!startStr) {
    return { label: null, kind: "undated", sortOrder: 3000 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startStr + "T00:00:00");
  const end = endStr ? new Date(endStr + "T00:00:00") : start;

  const msPerDay = 86400000;
  const daysToStart = Math.round((start - today) / msPerDay);
  const daysAfterEnd = Math.round((today - end) / msPerDay);

  if (daysToStart > 0) {
    // Предстоящо
    let label;
    if (daysToStart === 1) label = "Утре";
    else if (daysToStart <= 30) label = `След ${daysToStart} дни`;
    else if (daysToStart <= 60) label = `След месец`;
    else label = `След ${Math.round(daysToStart / 30)} месеца`;
    // Sort: колкото по-скоро започва, толкова по-нагоре (1000 + дни до старт)
    return { label, kind: "upcoming", sortOrder: 1000 + daysToStart };
  }

  if (daysAfterEnd <= 0) {
    // В момента — най-нагоре в trip picker
    return { label: "🟢 В момента", kind: "active", sortOrder: 0 };
  }

  // Приключило
  let label;
  if (daysAfterEnd === 1) label = "Приключи вчера";
  else if (daysAfterEnd <= 30) label = `Приключи преди ${daysAfterEnd} дни`;
  else if (daysAfterEnd <= 60) label = `Приключи преди месец`;
  else label = `Приключи преди ${Math.round(daysAfterEnd / 30)} месеца`;
  // Sort: минали накрая, най-скоро приключилите преди по-старите (2000 + дни от край)
  return { label, kind: "past", sortOrder: 2000 + daysAfterEnd };
}

// Конвертира сума в EUR по курс от currency-rates Edge Function.
// Ако курсът липсва (все още не е зареден или валутата не е позната),
// връщаме суровата сума — по-добре приблизителен баланс, отколкото блокиран UI.
function toEUR(amount, currency, rates) {
  if (!currency || currency === "EUR") return amount;
  const rate = rates?.[currency];
  if (!rate) return amount;
  return amount / rate;
}

function formatEUR(amount) {
  return `${amount.toFixed(2)} €`;
}

export default function DashboardScreen({ user, trip, allTrips, onSignOut, onAI, onDocuments, onExpenses, onChat, onSwitchTrip, onNewTrip, onTripUpdated }) {	const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const [tripPickerVisible, setTripPickerVisible] = useState(false);
  const [membersModalVisible, setMembersModalVisible] = useState(false);
  const [members, setMembers] = useState([]);
  const [removedMembers, setRemovedMembers] = useState([]);
  const [displayName, setDisplayName] = useState("");
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unblocking, setUnblocking] = useState(null);

  // Живи данни за краткия контекст под всяка карта на Dashboard-а
  // (брой документи, нетен баланс от разходите) — леки заявки, без
  // да дублираме цялата логика на DocumentsScreen/ExpensesScreen.
  const [docsCount, setDocsCount] = useState(0);
  const [hasPlan, setHasPlan] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [expenseSplits, setExpenseSplits] = useState([]);
  const [rates, setRates] = useState(null);

  // Edit trip modal state (само за организатора).
  // Целта: единно място за корекция на всички основни данни на пътуването,
  // отворено с тап върху trip info частта на картата — така не задръстваме
  // визуално картата с допълнителни бутони.
  const [editTripVisible, setEditTripVisible] = useState(false);
  const [tripName, setTripName] = useState("");
  const [tripDestination, setTripDestination] = useState("");
  const [tripStartDate, setTripStartDate] = useState(null);
  const [tripEndDate, setTripEndDate] = useState(null);
  const [tripCurrency, setTripCurrency] = useState("EUR");
  const [savingTrip, setSavingTrip] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!trip?.id) return;
    const { data } = await supabase
      .from("trip_members")
      .select("user_id, display_name, role, weight")
      .eq("trip_id", trip.id);
    setMembers(data || []);
  }, [trip?.id]);

  const fetchRemovedMembers = useCallback(async () => {
    if (!trip?.id) return;
    const { data } = await supabase
      .from("removed_members")
      .select("id, user_id")
      .eq("trip_id", trip.id);
    if (data && data.length > 0) {
      const ids = data.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles").select("id, display_name").in("id", ids);
      const profileMap = {};
      (profiles || []).forEach((p) => { profileMap[p.id] = p.display_name; });
      setRemovedMembers(data.map((r) => ({ ...r, display_name: profileMap[r.user_id] || "Непознат" })));
    } else {
      setRemovedMembers([]);
    }
  }, [trip?.id]);

  useEffect(() => {
    fetchMembers();
    fetchRemovedMembers();
    if (!trip?.id) return;

    // Channel за trip_members
    const membersChannel = supabase
      .channel(`members-${trip.id}-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${trip.id}` },
        () => { fetchMembers(); fetchRemovedMembers(); }
      )
      .subscribe();

    // Отделен channel за removed_members — БЕЗ filter, защото DELETE events
    // не се филтрират надеждно по колони без специален индекс
    const removedChannel = supabase
      .channel(`removed-${trip.id}-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "removed_members" },
        (payload) => {
          // Проверяваме дали е за нашето пътуване
          const tripId = payload.new?.trip_id || payload.old?.trip_id;
          if (tripId === trip.id) {
            fetchMembers();
            fetchRemovedMembers();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(membersChannel);
      supabase.removeChannel(removedChannel);
    };
  }, [trip?.id, fetchMembers, fetchRemovedMembers, user.id]);

  useEffect(() => {
    if (membersModalVisible) {
      fetchMembers();
      fetchRemovedMembers();
    }
  }, [membersModalVisible, fetchMembers, fetchRemovedMembers]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name);
        else setDisplayName(user.email.split("@")[0]);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!trip?.id || !user?.id) return;

    async function fetchUnread() {
      const { data: member } = await supabase
        .from("trip_members")
        .select("chat_last_read")
        .eq("trip_id", trip.id)
        .eq("user_id", user.id)
        .maybeSingle();
      const lastRead = member?.chat_last_read || "1970-01-01";

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("trip_id", trip.id)
        .neq("user_id", user.id)
        .gt("created_at", lastRead);

      setUnreadCount(count || 0);
    }

    fetchUnread();

    const channel = supabase
      .channel(`dashboard-chat-${trip.id}-${user.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${trip.id}` },
        (payload) => {
          if (payload.new.user_id !== user.id) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [trip?.id, user?.id]);

  // Брой документи — за краткия контекст под картата "Документи".
  const fetchDocsCount = useCallback(async () => {
    if (!trip?.id) return;
    const { count } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", trip.id);
    setDocsCount(count || 0);
  }, [trip?.id]);

  useEffect(() => {
    fetchDocsCount();
    if (!trip?.id) return;
    const channel = supabase
      .channel(`dashboard-docs-${trip.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "documents", filter: `trip_id=eq.${trip.id}` },
        () => fetchDocsCount()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [trip?.id, fetchDocsCount]);

  // Има ли вече запазен AI план за пътуването — за да сменим подписа на
  // картата "Планирай с AI" от "Ново пътуване" на нещо, което показва, че
  // вече има план (иначе не е очевидно, че отваряне на екрана пак ще го
  // покаже, вместо да го подкарва отначало).
  const fetchHasPlan = useCallback(async () => {
    if (!trip?.id) return;
    const { count } = await supabase
      .from("trip_plans")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", trip.id);
    setHasPlan((count || 0) > 0);
  }, [trip?.id]);

  useEffect(() => {
    fetchHasPlan();
    if (!trip?.id) return;
    const channel = supabase
      .channel(`dashboard-plans-${trip.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "trip_plans", filter: `trip_id=eq.${trip.id}` },
        () => fetchHasPlan()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [trip?.id, fetchHasPlan]);

  // Разходи + splits — за нетния баланс, показан горе и под картата "Разходи".
  // Съзнателно е олекотена версия на логиката в ExpensesScreen (само сумите,
  // без категории/описания), за да не дублираме целия екран тук.
  const fetchExpensesData = useCallback(async () => {
    if (!trip?.id) return;
    const { data: eData } = await supabase
      .from("expenses").select("id, amount, currency, paid_by").eq("trip_id", trip.id);
    const expenseIds = (eData || []).map((e) => e.id);
    let sData = [];
    if (expenseIds.length > 0) {
      const { data } = await supabase
        .from("expense_splits").select("user_id, share, expense_id, is_settled").in("expense_id", expenseIds);
      sData = data || [];
    }
    setExpenses(eData || []);
    setExpenseSplits(sData);
  }, [trip?.id]);

  useEffect(() => {
    fetchExpensesData();
    supabase.functions.invoke("currency-rates?action=rates", { method: "GET" })
      .then(({ data, error }) => { if (!error && data) setRates(data.rates || null); })
      .catch(() => {});
    if (!trip?.id) return;
    const channel = supabase
      .channel(`dashboard-expenses-${trip.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `trip_id=eq.${trip.id}` },
        () => fetchExpensesData()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_splits" },
        () => fetchExpensesData()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [trip?.id, fetchExpensesData]);

  // Нетен баланс на текущия потребител в EUR: положително = дължат ти,
  // отрицателно = ти дължиш. Само неуредени (is_settled: false) splits.
  const netBalance = useMemo(() => {
    let net = 0;
    expenses.forEach((exp) => {
      const cur = exp.currency || "EUR";
      if (exp.paid_by === user.id) {
        const owedToMe = expenseSplits
          .filter((s) => s.expense_id === exp.id && s.user_id !== user.id && !s.is_settled)
          .reduce((s, x) => s + toEUR(Number(x.share), cur, rates), 0);
        net += owedToMe;
      } else {
        const mySplit = expenseSplits.find((s) => s.expense_id === exp.id && s.user_id === user.id && !s.is_settled);
        if (mySplit) net -= toEUR(Number(mySplit.share), cur, rates);
      }
    });
    return net;
  }, [expenses, expenseSplits, rates, user.id]);

  async function handleSaveName() {
    const name = newName.trim();
    if (!name) return Alert.alert("Грешка", "Въведи ново име");
    setSavingName(true);
    try {
      await supabase.from("profiles").upsert({ id: user.id, display_name: name });
      if (trip?.id) {
        await supabase.from("trip_members")
          .update({ display_name: name })
          .eq("trip_id", trip.id)
          .eq("user_id", user.id);
      }
      setDisplayName(name);
      setEditNameVisible(false);
      setNewName("");
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setSavingName(false);
    }
  }

  async function handleSetWeight(memberId, newWeight) {
    if (newWeight < 1 || newWeight > 20) return;
    try {
      await supabase.from("trip_members")
        .update({ weight: newWeight })
        .eq("trip_id", trip.id)
        .eq("user_id", memberId);
      setMembers((prev) => prev.map((m) => m.user_id === memberId ? { ...m, weight: newWeight } : m));
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  async function handleRemoveMember(member) {
    Alert.alert(
      "Премахване",
      `Сигурен ли си, че искаш да премахнеш ${member.display_name}?\n\nМинали разходи си остават. Те няма да могат да се върнат без твоето разрешение.`,
      [
        { text: "Отказ", style: "cancel" },
        {
          text: "Премахни", style: "destructive",
          onPress: async () => {
            try {
              await supabase.from("removed_members").upsert({
                trip_id: trip.id,
                user_id: member.user_id,
              });
              await supabase.from("trip_members")
                .delete()
                .eq("trip_id", trip.id)
                .eq("user_id", member.user_id);
            } catch (e) {
              Alert.alert("Грешка", e.message);
            }
          }
        }
      ]
    );
  }

  // Проверява дали премахнат участник има неуредени задължения — както
  // негови дългове към други (той дължи), така и дългове на други към него
  // (той е платил разход, а някой друг още не е уредил своя дял).
  // И двете посоки трябва да са изчистени, преди да позволим деблокиране —
  // иначе старите задължения "оживяват" автоматично в активните изчисления
  // на ExpensesScreen след повторно присъединяване.
  async function checkOutstandingBalances(memberUserId) {
    // Дългове, които ТОЙ дължи (split, в който той е участник, не платец, неуреден)
    const { data: owesData } = await supabase
      .from("expense_splits")
      .select("share, expense_id")
      .eq("user_id", memberUserId)
      .eq("is_settled", false);

    // Разходи, които ТОЙ Е ПЛАТИЛ — после намираме неуредени splits на други хора по тях
    const { data: paidExpenses } = await supabase
      .from("expenses")
      .select("id")
      .eq("trip_id", trip.id)
      .eq("paid_by", memberUserId);

    const paidExpenseIds = (paidExpenses || []).map((e) => e.id);
    let owedToHimData = [];
    if (paidExpenseIds.length > 0) {
      const { data } = await supabase
        .from("expense_splits")
        .select("share, expense_id")
        .in("expense_id", paidExpenseIds)
        .neq("user_id", memberUserId)
        .eq("is_settled", false);
      owedToHimData = data || [];
    }

    const owesTotal = (owesData || []).reduce((s, x) => s + Number(x.share), 0);
    const owedToHimTotal = owedToHimData.reduce((s, x) => s + Number(x.share), 0);

    return {
      clear: owesTotal < 0.01 && owedToHimTotal < 0.01,
      owesTotal,
      owedToHimTotal,
    };
  }

  async function handleUnblock(removed) {
    setUnblocking(removed.id);
    try {
      const balance = await checkOutstandingBalances(removed.user_id);

      if (!balance.clear) {
        const parts = [];
        if (balance.owesTotal >= 0.01) {
          parts.push(`дължи ${balance.owesTotal.toFixed(2)} лв.`);
        }
        if (balance.owedToHimTotal >= 0.01) {
          parts.push(`му дължат ${balance.owedToHimTotal.toFixed(2)} лв.`);
        }
        Alert.alert(
          "Има неуредени сметки",
          `${removed.display_name} не може да бъде деблокиран, докато има неуредени сметки в Разходи (${parts.join(" и ")}).\n\nУреди сметките от организатора в Разходи → Как да се изравним, и опитай пак.`
        );
        return;
      }

      Alert.alert(
        "Деблокиране",
        `Разреши на ${removed.display_name} да се присъедини отново?`,
        [
          { text: "Отказ", style: "cancel" },
          {
            text: "Да, разреши", onPress: async () => {
              try {
                await supabase.from("removed_members")
                  .delete()
                  .eq("id", removed.id);
              } catch (e) {
                Alert.alert("Грешка", e.message);
              }
            }
          }
        ]
      );
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setUnblocking(null);
    }
  }

  const isOwner = members.find((m) => m.user_id === user.id)?.role === "owner";

  // Отваря trip edit модала с текущите стойности prefilled
  function openEditTrip() {
    if (!isOwner || !trip) return;
    setTripName(trip.name || "");
    setTripDestination(trip.destination || "");
    setTripStartDate(trip.start_date || null);
    setTripEndDate(trip.end_date || null);
    setTripCurrency(trip.local_currency || "EUR");
    setEditTripVisible(true);
  }

  async function handleSaveTrip() {
    const nameTrimmed = tripName.trim();
    if (!nameTrimmed) return Alert.alert("Грешка", "Името не може да е празно");
    if (tripStartDate && tripEndDate && tripEndDate < tripStartDate) {
      return Alert.alert("Грешка", "Крайната дата трябва да е след началната");
    }

    setSavingTrip(true);
    try {
      const { data, error } = await supabase
        .from("trips")
        .update({
          name: nameTrimmed,
          destination: tripDestination.trim() || null,
          start_date: tripStartDate,
          end_date: tripEndDate,
          local_currency: tripCurrency,
        })
        .eq("id", trip.id)
        .select()
        .single();
      if (error) throw error;

      setEditTripVisible(false);
      // Уведомяваме App.js за обновеното пътуване, за да refreshне activeTrip
      // и allTrips — иначе Dashboard-ът ще продължи да показва старите данни
      // до следващия cold start.
      if (onTripUpdated) onTripUpdated(data);
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setSavingTrip(false);
    }
  }

  // Кратък "жив" контекст под всяка карта на Dashboard-а — реални данни
  // вместо статичен подпис, така че потребителят вижда какво го чака преди
  // да е отворил екрана.
  const chatSub = unreadCount > 0
    ? `${unreadCount} ${unreadCount === 1 ? "ново съобщение" : "нови съобщения"}`
    : "Няма нови съобщения";
  const docsSub = docsCount > 0
    ? `${docsCount} ${docsCount === 1 ? "документ" : "документа"}`
    : "Няма документи";
  const expensesSub = Math.abs(netBalance) < 0.01
    ? "Всичко е изравнено"
    : netBalance > 0
      ? `Дължат ти ${formatEUR(netBalance)}`
      : `Дължиш ${formatEUR(Math.abs(netBalance))}`;

  const cards = [
    { Icon: Sparkles, title: "Планирай с AI", sub: hasPlan ? "Виж/коригирай плана" : "Ново пътуване", onPress: onAI, color: colors.brand50, badge: hasPlan ? 1 : 0 },
    { Icon: MessageSquare, title: "Чат", sub: chatSub, onPress: () => { setUnreadCount(0); onChat(); }, color: "#E8F4FD", badge: unreadCount },
    { Icon: FileText, title: "Документи", sub: docsSub, onPress: onDocuments, color: "#E6F1FB", badge: 0 },
    { Icon: CreditCard, title: "Разходи", sub: expensesSub, onPress: onExpenses, color: "#FAEEDA", badge: 0 },
  ];

  async function handleShare() {
    if (!trip?.invite_code) return;
    try {
      await Share.share({
        message: `Присъедини се към "${trip.name}" в GoTogether!\n\n1. Инсталирай Expo Go\n2. Отвори GoTogether\n3. Въведи код: ${trip.invite_code}`,
      });
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  async function handleCopyCode() {
    if (!trip?.invite_code) return;
    await Clipboard.setStringAsync(trip.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
  }

  function getInitials(name = "") {
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  }

  const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8"];
  const otherMembers = members.filter((m) => m.user_id !== user.id);
  const visibleMembers = otherMembers.slice(0, MAX_VISIBLE);
  const extraCount = otherMembers.length - MAX_VISIBLE;
  const hasWeights = members.some((m) => (m.weight || 1) > 1);

  const startDate = formatDate(trip?.start_date);
  const endDate = formatDate(trip?.end_date);
  const dateRange = startDate && endDate ? `${startDate} – ${endDate}` : startDate || null;

  // Статус на текущото пътуване (за trip card badge)
  const currentStatus = useMemo(
    () => computeTripStatus(trip?.start_date, trip?.end_date),
    [trip?.start_date, trip?.end_date]
  );

  // Сортирани пътувания за trip picker: активни → предстоящи → без дати → минали.
  // computeTripStatus.sortOrder гарантира тази йерархия.
  const sortedTrips = useMemo(() => {
    const list = (allTrips || []).map((t) => ({
      ...t,
      _status: computeTripStatus(t.start_date, t.end_date),
    }));
    list.sort((a, b) => a._status.sortOrder - b._status.sortOrder);
    return list;
  }, [allTrips]);

  const showMembersRow = otherMembers.length > 0 || isOwner;
  const isSettled = Math.abs(netBalance) < 0.01;

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🧳</Text>
          <Text style={styles.appName}>GoTogether</Text>
          <TouchableOpacity style={styles.nameRow} onPress={() => { setNewName(displayName); setEditNameVisible(true); }}>
            <Text style={styles.displayName}>👤 {displayName}</Text>
            <Text style={styles.editIcon}>✏️</Text>
          </TouchableOpacity>
        </View>

        {trip && (
          <TouchableOpacity
            style={[styles.balanceBar, isSettled ? styles.balanceBarSettled : (netBalance > 0 ? styles.balanceBarPositive : styles.balanceBarNegative)]}
            onPress={onExpenses}
          >
            <Text style={styles.balanceBarLabel}>
              {isSettled ? "💚 Всички сметки са изравнени" : netBalance > 0 ? "Дължат ти" : "Ти дължиш"}
            </Text>
            {!isSettled && (
              <Text style={[styles.balanceBarAmount, netBalance > 0 ? styles.balanceBarAmountPositive : styles.balanceBarAmountNegative]}>
                {formatEUR(Math.abs(netBalance))}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {trip && (
          <View style={styles.tripCard}>
            <View style={styles.tripTop}>
              {/* Организаторът може да тапне върху trip info частта за редакция.
                  Не-организаторите виждат същия layout, но без тап реакция. */}
              <TouchableOpacity
                style={styles.tripInfo}
                onPress={openEditTrip}
                activeOpacity={isOwner ? 0.7 : 1}
                disabled={!isOwner}
              >
                <View style={styles.tripNameRow}>
                  <Text style={styles.tripName}>{trip.name}</Text>
                  {isOwner && <Text style={styles.tripEditIcon}>✏️</Text>}
                </View>
                {trip.destination && (
                  <View style={styles.tripDestRow}>
                    <MapPin size={14} color={colors.onBrandMuted} strokeWidth={1.75} />
                    <Text style={styles.tripDest}>{trip.destination}</Text>
                  </View>
                )}
                {dateRange && <Text style={styles.tripDates}>📅 {dateRange}</Text>}
                {currentStatus.label && (
                  <View style={[styles.statusBadge, styles[`statusBadge_${currentStatus.kind}`]]}>
                    <Text style={styles.statusBadgeText}>{currentStatus.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={styles.inviteBox}>
                <Text style={styles.inviteLabel}>Код</Text>
                <TouchableOpacity onPress={handleCopyCode}>
                  <Text style={styles.inviteCode}>{trip.invite_code}</Text>
                  <Text style={styles.inviteCopy}>{copied ? "✓ Копирано" : "докосни"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {showMembersRow && (
              <TouchableOpacity style={styles.membersRow} onPress={() => setMembersModalVisible(true)}>
                {visibleMembers.map((m, i) => (
                  <View key={m.user_id} style={[styles.avatar, { backgroundColor: COLORS[(i + 1) % COLORS.length], marginLeft: i > 0 ? -8 : 0 }]}>
                    <Text style={styles.avatarText}>{getInitials(m.display_name)}</Text>
                  </View>
                ))}
                {extraCount > 0 && (
                  <View style={[styles.avatar, styles.avatarExtra, { marginLeft: -8 }]}>
                    <Text style={styles.avatarExtraText}>+{extraCount}</Text>
                  </View>
                )}
                {otherMembers.length > 0 ? (
                  <Text style={styles.membersLabel}>
                    {`${members.length} ${members.length === 1 ? "участник" : "участника"}${hasWeights ? " · с тегла" : ""}`}
                  </Text>
                ) : (
                  <View style={styles.membersLabelRow}>
                    <Users size={16} color={colors.onBrandMuted} strokeWidth={1.75} />
                    <Text style={styles.membersLabelInline}>Управление на участници</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.switchBtn} onPress={() => setTripPickerVisible(true)}>
              <Text style={styles.switchBtnText}>🔄 Смени / добави пътуване</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.cards}>
          {cards.map((card, i) => (
            <TouchableOpacity key={i} style={[styles.cardRow, { backgroundColor: card.color }]} onPress={card.onPress}>
              <View style={styles.cardIconWrap}>
                <card.Icon size={22} color={colors.brand600} strokeWidth={1.75} />
              </View>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardSub}>{card.sub}</Text>
              </View>
              <Text style={styles.cardChevron}>›</Text>
              {card.badge > 0 && (
                // Преместено в горния десен ъгъл на цялата карта, а не върху
                // иконата — там се застъпваше с нея на по-малки икони (напр. 22px).
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{card.badge > 99 ? "99+" : card.badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bottomRow}>
          <TouchableOpacity style={[styles.shareBtn, styles.bottomBtnHalf]} onPress={handleShare}>
            <Text style={styles.shareBtnText}>🔗 Покани</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.signOut, styles.bottomBtnHalf]} onPress={onSignOut}>
            <Text style={styles.signOutText}>Изход</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      <Modal visible={membersModalVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
            <View style={styles.modalTitleRow}>
              <Users size={22} color={colors.text900} strokeWidth={1.75} />
              <Text style={[styles.modalTitle, styles.modalTitleInline]}>Участници</Text>
            </View>
            <Text style={styles.modalSubtitle}>Брой хора определя дела от разходите</Text>

            {members.map((m, i) => {
              const weight = m.weight || 1;
              const isMe = m.user_id === user.id;
              const canRemove = isOwner && !isMe;
              return (
                <View key={m.user_id} style={styles.memberRow}>
                  <View style={[styles.avatarLg, { backgroundColor: isMe ? colors.brand600 : COLORS[i % COLORS.length] }]}>
                    <Text style={styles.avatarLgText}>{getInitials(m.display_name)}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberRowName}>{m.display_name}</Text>
                    <View style={styles.memberBadges}>
                      {isMe && <Text style={styles.memberYou}>ти</Text>}
                      {m.role === "owner" && <Text style={styles.memberOwner}>организатор</Text>}
                    </View>
                  </View>
                  <View style={styles.memberRight}>
                    <View style={styles.weightControl}>
                      <TouchableOpacity style={styles.weightBtn} onPress={() => handleSetWeight(m.user_id, weight - 1)} disabled={weight <= 1}>
                        <Text style={[styles.weightBtnText, weight <= 1 && { color: colors.text400 }]}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.weightVal}>{weight}</Text>
                      <TouchableOpacity style={styles.weightBtn} onPress={() => handleSetWeight(m.user_id, weight + 1)}>
                        <Text style={styles.weightBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    {canRemove && (
                      <TouchableOpacity onPress={() => handleRemoveMember(m)} style={styles.removeBtn}>
                        <Text style={styles.removeBtnText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {isOwner && (
              <View style={styles.blockedSection}>
                <Text style={styles.blockedTitle}>🚫 Блокирани</Text>
                {removedMembers.length === 0 ? (
                  <Text style={styles.blockedEmpty}>Няма блокирани участници</Text>
                ) : (
                  removedMembers.map((r) => (
                    <View key={r.id} style={styles.blockedRow}>
                      <Text style={styles.blockedName}>{r.display_name}</Text>
                      <TouchableOpacity
                        onPress={() => handleUnblock(r)}
                        style={styles.unblockBtn}
                        disabled={unblocking === r.id}
                      >
                        <Text style={styles.unblockBtnText}>
                          {unblocking === r.id ? "Проверка…" : "Деблокирай"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            )}

            <Text style={styles.weightHint}>💡 Смени броя хора за пропорционално делене на разходите</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setMembersModalVisible(false)}>
              <Text style={styles.modalCloseText}>Готово</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={editNameVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>Смени никнейм</Text>
            <TextInput
              style={styles.nameInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="Новото ти име"
              placeholderTextColor={colors.text400}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveName}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => { setEditNameVisible(false); setNewName(""); }}>
                <Text style={styles.btnCancelText}>Отказ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSave} onPress={handleSaveName} disabled={savingName}>
                <Text style={styles.btnSaveText}>Запази</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={editTripVisible} animationType="slide" transparent onRequestClose={() => setEditTripVisible(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView style={[styles.modal, styles.editTripModal]} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>✏️ Редактирай пътуването</Text>
            <Text style={styles.modalSubtitle}>Промените се виждат от всички участници</Text>

            <Text style={styles.editLabel}>Име *</Text>
            <TextInput
              style={styles.editInput}
              value={tripName}
              onChangeText={setTripName}
              placeholder="Напр. Лято 2025 в Гърция"
              placeholderTextColor={colors.text400}
            />

            <Text style={styles.editLabel}>Дестинация</Text>
            <TextInput
              style={styles.editInput}
              value={tripDestination}
              onChangeText={setTripDestination}
              placeholder="Напр. Солун"
              placeholderTextColor={colors.text400}
            />

            <Text style={styles.editLabel}>Дати</Text>
            <View style={styles.editDateRow}>
              <View style={styles.editDateCol}>
                <DatePicker
                  value={tripStartDate}
                  onChange={setTripStartDate}
                  placeholder="Начална дата"
                />
              </View>
              <Text style={styles.editDateSep}>→</Text>
              <View style={styles.editDateCol}>
                <DatePicker
                  value={tripEndDate}
                  onChange={setTripEndDate}
                  placeholder="Крайна дата"
                  minDate={tripStartDate}
                />
              </View>
            </View>

            <Text style={styles.editLabel}>Местна валута</Text>
            <View style={styles.editCurrencyRow}>
              {LOCAL_CURRENCY_OPTIONS.map((code) => (
                <TouchableOpacity
                  key={code}
                  style={[styles.editCurrencyChip, tripCurrency === code && styles.editCurrencyChipActive]}
                  onPress={() => setTripCurrency(code)}
                >
                  <Text style={[styles.editCurrencyChipText, tripCurrency === code && styles.editCurrencyChipTextActive]}>
                    {code}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setEditTripVisible(false)} disabled={savingTrip}>
                <Text style={styles.btnCancelText}>Отказ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSave} onPress={handleSaveTrip} disabled={savingTrip}>
                {savingTrip ? <ActivityIndicator color={colors.brand600} /> : <Text style={styles.btnSaveText}>Запази</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={tripPickerVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>Пътувания</Text>
            <ScrollView style={styles.tripList}>
              {sortedTrips.map((t) => {
                const isPast = t._status.kind === "past";
                const isActive = t._status.kind === "active";
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.tripOption,
                      t.id === trip?.id && styles.tripOptionActive,
                      isPast && styles.tripOptionPast,
                    ]}
                    onPress={() => { setTripPickerVisible(false); if (t.id !== trip?.id) onSwitchTrip(t); }}
                  >
                    <View style={styles.tripOptionInfo}>
                      <Text style={[
                        styles.tripOptionName,
                        t.id === trip?.id && styles.tripOptionNameActive,
                        isPast && styles.tripOptionNamePast,
                      ]}>
                        {t.name}
                      </Text>
                      {t.destination && (
                        <View style={styles.tripOptionDestRow}>
                          <MapPin size={12} color={isPast ? colors.text400 : colors.text600} strokeWidth={1.75} />
                          <Text style={[styles.tripOptionDest, isPast && styles.tripOptionDestPast]}>
                            {t.destination}
                          </Text>
                        </View>
                      )}
                      {t._status.label && (
                        <Text style={[
                          styles.tripOptionStatus,
                          isActive && styles.tripOptionStatusActive,
                          isPast && styles.tripOptionStatusPast,
                        ]}>
                          {t._status.label}
                        </Text>
                      )}
                    </View>
                    {t.id === trip?.id && <Text style={styles.tripOptionCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.newTripBtn} onPress={() => { setTripPickerVisible(false); onNewTrip(); }}>
              <View style={styles.btnRow}>
                <Plus size={20} color={colors.onBrand} strokeWidth={1.75} />
                <Text style={styles.newTripBtnText}>Ново пътуване</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalClose} onPress={() => setTripPickerVisible(false)}>
              <Text style={styles.modalCloseText}>Затвори</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.xl },
  header: { alignItems: "center", marginBottom: space.xl },
  headerEmoji: { fontSize: 44, marginBottom: space.sm },
  appName: { ...type.title, color: colors.brand600 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  displayName: { ...type.label, color: colors.text600 },
  editIcon: { fontSize: 12 },
  balanceBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: radius.card, paddingHorizontal: space.lg, paddingVertical: space.md, marginBottom: space.md,
  },
  balanceBarSettled: { backgroundColor: colors.brand50 },
  balanceBarPositive: { backgroundColor: colors.brand50 },
  balanceBarNegative: { backgroundColor: "#FBEAE7" },
  balanceBarLabel: { ...type.label, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.text900 },
  balanceBarAmount: { ...type.body, fontWeight: "bold", fontFamily: "GolosText_700Bold", fontVariant: ["tabular-nums"] },
  balanceBarAmountPositive: { color: colors.brand600 },
  balanceBarAmountNegative: { color: colors.owe600 },
  tripCard: {
    backgroundColor: colors.brand600, borderRadius: radius.card, padding: space.xl, marginBottom: space.xl,
    shadowColor: colors.brand600, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  tripTop: { flexDirection: "row", alignItems: "flex-start" },
  tripInfo: { flex: 1 },
  tripNameRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  tripName: { ...type.heading, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.onBrand },
  tripEditIcon: { fontSize: 12, opacity: 0.7 },
  tripDestRow: { flexDirection: "row", alignItems: "center", gap: space.xs, marginBottom: space.xs },
  tripDest: { ...type.label, color: colors.onBrandMuted },
  tripDates: { ...type.label, color: colors.onBrandMuted },
  statusBadge: {
    alignSelf: "flex-start",
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.control,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  statusBadge_active: { backgroundColor: "rgba(255,255,255,0.35)" },
  statusBadge_upcoming: { backgroundColor: "rgba(255,255,255,0.2)" },
  statusBadge_past: { backgroundColor: "rgba(0,0,0,0.2)" },
  statusBadge_undated: { display: "none" },
  statusBadgeText: { fontSize: 12, lineHeight: 16, color: colors.onBrand, fontWeight: "600" },
  inviteBox: { alignItems: "center", marginLeft: space.md },
  inviteLabel: { fontSize: 12, lineHeight: 16, color: colors.onBrandMuted, marginBottom: space.xs, letterSpacing: 1 },
  inviteCode: {
    fontSize: 22, fontWeight: "bold", color: colors.onBrand, letterSpacing: 4, textAlign: "center",
    backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control,
  },
  inviteCopy: { fontSize: 12, lineHeight: 16, color: colors.onBrandMuted, textAlign: "center", marginTop: space.xs },
  membersRow: { flexDirection: "row", alignItems: "center", marginTop: space.lg },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.brand600 },
  avatarText: { fontSize: 12, lineHeight: 16, fontWeight: "bold", color: colors.onBrand },
  avatarExtra: { backgroundColor: "rgba(255,255,255,0.3)" },
  avatarExtraText: { fontSize: 12, lineHeight: 16, fontWeight: "bold", color: colors.onBrand },
  membersLabel: { fontSize: 12, lineHeight: 16, color: colors.onBrandMuted, marginLeft: space.md },
  membersLabelRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginLeft: space.md },
  membersLabelInline: { fontSize: 12, lineHeight: 16, color: colors.onBrandMuted },
  switchBtn: { marginTop: space.lg, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: radius.control, padding: space.md, alignItems: "center" },
  switchBtnText: { ...type.label, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.onBrand },
  cards: { gap: space.sm, marginBottom: space.md },
  cardRow: { flexDirection: "row", alignItems: "center", borderRadius: radius.card, padding: space.lg, gap: space.md, position: "relative" },
  cardIconWrap: { width: 32, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: space.sm, right: space.sm,
    backgroundColor: colors.owe600, borderRadius: radius.pill,
    minWidth: 18, height: 18, alignItems: "center", justifyContent: "center",
    paddingHorizontal: space.xs,
  },
  badgeText: { color: colors.onBrand, fontSize: 10, fontWeight: "bold" },
  cardTextWrap: { flex: 1 },
  cardTitle: { ...type.body, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.text900 },
  cardSub: { fontSize: 12, lineHeight: 16, color: colors.text600, marginTop: space.xs, fontWeight: "600" },
  cardChevron: { fontSize: 20, color: colors.text400 },
  bottomRow: { flexDirection: "row", gap: space.sm },
  bottomBtnHalf: { flex: 1, marginBottom: 0 },
  shareBtn: { backgroundColor: colors.surface, padding: space.lg, borderRadius: radius.control, alignItems: "center", marginBottom: space.md, borderWidth: 1, borderColor: colors.border },
  shareBtnText: { ...type.label, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.brand600 },
  signOut: { padding: space.lg, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  signOutText: { ...type.label, color: colors.text400 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" },
  modalContent: { padding: space.xl, paddingBottom: space.xxxl },
  modalInner: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.xl, paddingBottom: space.xxxl, maxHeight: "85%" },
  modalTitle: { ...type.heading, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.text900, marginBottom: space.xs },
  modalTitleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs },
  modalTitleInline: { marginBottom: 0 },
  modalSubtitle: { fontSize: 12, lineHeight: 16, color: colors.text600, marginBottom: space.lg },
  editTripModal: { backgroundColor: colors.brand600 },
  editLabel: { ...type.label, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.onBrandMuted, marginTop: space.md, marginBottom: space.sm },
  editInput: {
    ...type.body, backgroundColor: colors.surface, borderRadius: radius.control, padding: space.lg,
    color: colors.text900, marginBottom: space.xs,
  },
  editDateRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  editDateCol: { flex: 1 },
  editDateSep: { color: colors.onBrandMuted, fontSize: 16, fontWeight: "600" },
  editCurrencyRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  editCurrencyChip: {
    flex: 1, paddingVertical: space.md, borderRadius: radius.control, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  editCurrencyChipActive: { backgroundColor: colors.surface },
  editCurrencyChipText: { ...type.label, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.onBrand },
  editCurrencyChipTextActive: { color: colors.brand600 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  avatarLg: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarLgText: { ...type.label, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.onBrand },
  memberInfo: { flex: 1 },
  memberRowName: { ...type.body, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.text900 },
  memberBadges: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  memberYou: { fontSize: 12, lineHeight: 16, color: colors.brand600, backgroundColor: colors.brand50, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.control },
  memberOwner: { fontSize: 12, lineHeight: 16, color: colors.text600, backgroundColor: colors.bg, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.control },
  memberRight: { flexDirection: "row", alignItems: "center", gap: space.sm },
  weightControl: { flexDirection: "row", alignItems: "center", gap: space.sm },
  weightBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
  weightBtnText: { fontSize: 18, fontWeight: "bold", color: colors.brand600, lineHeight: 22 },
  weightVal: { ...type.body, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.text900, minWidth: 20, textAlign: "center", fontVariant: ["tabular-nums"] },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFE8E8", alignItems: "center", justifyContent: "center" },
  removeBtnText: { fontSize: 13, color: colors.owe600, fontWeight: "bold" },
  blockedSection: { marginTop: space.xl, borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: space.lg },
  blockedTitle: { ...type.label, fontWeight: "700", fontFamily: "GolosText_700Bold", color: colors.text600, marginBottom: space.md },
  blockedEmpty: { ...type.label, color: colors.text400, fontStyle: "italic" },
  blockedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  blockedName: { ...type.label, color: colors.text400, flex: 1 },
  unblockBtn: { backgroundColor: colors.brand50, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control },
  unblockBtnText: { color: colors.brand600, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  weightHint: { fontSize: 12, lineHeight: 16, color: colors.text600, marginTop: space.lg, marginBottom: space.sm, textAlign: "center" },
  nameInput: { ...type.body, backgroundColor: colors.bg, borderRadius: radius.control, padding: space.lg, color: colors.text900, marginBottom: space.lg },
  modalBtns: { flexDirection: "row", gap: space.md, marginTop: space.xl },
  btnCancel: { flex: 1, padding: space.lg, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  btnCancelText: { ...type.body, color: colors.onBrand },
  btnSave: { flex: 1, padding: space.lg, borderRadius: radius.control, backgroundColor: colors.surface, alignItems: "center" },
  btnSaveText: { ...type.body, color: colors.brand600, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  tripList: { maxHeight: 400, marginBottom: space.sm },
  tripOption: { flexDirection: "row", alignItems: "center", padding: space.lg, borderRadius: radius.control, marginBottom: space.sm, backgroundColor: colors.bg },
  tripOptionActive: { backgroundColor: colors.brand50, borderWidth: 1.5, borderColor: colors.brand600 },
  tripOptionPast: { backgroundColor: "#FAFAFA", opacity: 0.75 },
  tripOptionInfo: { flex: 1 },
  tripOptionName: { ...type.body, fontWeight: "600", fontFamily: "GolosText_600SemiBold", color: colors.text900 },
  tripOptionNameActive: { color: colors.brand600 },
  tripOptionNamePast: { color: colors.text600 },
  tripOptionDestRow: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs },
  tripOptionDest: { fontSize: 12, lineHeight: 16, color: colors.text600 },
  tripOptionDestPast: { color: colors.text400 },
  tripOptionStatus: { fontSize: 12, lineHeight: 16, color: colors.text600, marginTop: space.xs, fontWeight: "600" },
  tripOptionStatusActive: { color: colors.brand600 },
  tripOptionStatusPast: { color: colors.text400, fontWeight: "500" },
  tripOptionCheck: { fontSize: 18, color: colors.brand600, fontWeight: "bold" },
  newTripBtn: { backgroundColor: colors.brand600, padding: space.lg, borderRadius: radius.control, alignItems: "center", marginTop: space.xs, marginBottom: space.sm },
  newTripBtnText: { ...type.body, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  modalClose: { padding: space.lg, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center", marginTop: space.sm },
  modalCloseText: { ...type.body, color: colors.text600 },
});
