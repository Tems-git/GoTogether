import { StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Linking, KeyboardAvoidingView, Platform, Modal, FlatList } from "react-native";
import { useState, useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sparkles } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import DatePicker from "../components/DatePicker";
import { colors, space, radius, type } from "../theme/tokens";

const TRANSPORT_OPTIONS = ["коли", "самолет", "автобус", "влак", "смесен"];
const ACCOMMODATION_TYPES = ["хотел", "хостел", "къща", "къмпинг", "Airbnb", "апартамент", "семеен хотел"];
const COMFORT_OPTIONS = ["без значение", "3+ звезди", "4+ звезди", "5 звезди"];

// Какво да търсим около мястото. Думата отива направо в търсенето на картите —
// затова е на български и звучи като нещо, което човек би написал сам.
// „най-добри" при заведенията не е сортиране (адресът на картите не приема
// такъв параметър), а подсказка към търсачката, която реално вдига оценените
// нагоре в резултатите.
// Подредени по това колко често потрябват, а не по азбучен ред — първата е и
// избраната по подразбиране. Думите са категории, които картите разпознават,
// затова работят и в чужбина.
const NEARBY_KINDS = [
  { key: "sights", label: "🏛 Забележителности", query: "забележителности" },
  { key: "food", label: "🍽 Заведения", query: "най-добри ресторанти и заведения" },
  { key: "kids", label: "🎠 За деца", query: "атракции за деца" },
  { key: "shop", label: "🛒 Магазини", query: "супермаркет" },
  { key: "fuel", label: "⛽ Бензиностанции", query: "бензиностанция" },
  { key: "pharmacy", label: "💊 Аптеки", query: "аптека" },
];

// --- Форматиране на текста на плана -----------------------------------------
// AI-то връща markdown-подобен текст (## заглавия, **удебелено**, "- " списъци,
// "---" разделители). Преди го показвахме в един <Text> и всички тези маркери
// се виждаха буквално на екрана. Тук ги превръщаме в реално форматиране:
// заглавия на раздели, удебелени части, списъци с водещи точки и линии, като
// линковете си остават натискаеми. Нарочно е клиентско — така се подреждат и
// вече запазените стари планове, без да пипаме edge функцията.

const URL_TEST_REGEX = /^https?:\/\//;
// Разделя ред на части: **удебелено** и URL адреси, останалото е обикновен текст.
const INLINE_SPLIT_REGEX = /(\*\*[^*]+\*\*|https?:\/\/[^\s)<>"']+)/g;

const HEADING_REGEX = /^#{1,6}\s+/;
const DIVIDER_REGEX = /^\s*([-*_])\1{2,}\s*$/;
const BULLET_REGEX = /^\s*[-*•]\s+/;
const NUMBERED_REGEX = /^\s*(\d+)[.)]\s+/;
const BOLD_ONLY_REGEX = /^\*\*(.+?)\*\*:?$/;

function stripInlineMarks(s) {
  return (s || "").replace(/\*\*/g, "").trim();
}

// Ред като "1. МАРШРУТ" или "НАСТАНЯВАНЕ" е заглавие на раздел, а не елемент
// от номериран списък — разпознаваме го по това, че е кратък и изцяло с
// главни букви (така програмните точки "1. Тръгване в 8:00" не стават заглавия).
function isSectionHeading(text) {
  const plain = stripInlineMarks(text);
  if (!plain || plain.length > 40) return false;
  if (!/[A-Za-zА-Яа-яЁё]/.test(plain)) return false;
  return plain === plain.toUpperCase();
}

function renderInline(text, keyPrefix) {
  return (text || "").split(INLINE_SPLIT_REGEX).filter(Boolean).map((segment, i) => {
    const key = `${keyPrefix}-i${i}`;
    if (URL_TEST_REGEX.test(segment)) {
      return (
        <Text key={key} style={styles.planLink} onPress={() => Linking.openURL(segment)}>
          {segment}
        </Text>
      );
    }
    if (/^\*\*[^*]+\*\*$/.test(segment)) {
      return <Text key={key} style={styles.planBold}>{segment.slice(2, -2)}</Text>;
    }
    return <Text key={key}>{segment}</Text>;
  });
}

function renderPlanBlocks(text) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let lastWasGap = true; // за да не слагаме празнина най-отгоре

  function pushHeading(key, label) {
    blocks.push(
      <Text key={key} style={[styles.planHeading, blocks.length === 0 && styles.planHeadingFirst]}>
        {label}
      </Text>
    );
    lastWasGap = false;
  }

  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/\s+$/, "");
    const key = `b${idx}`;

    if (!line.trim()) {
      // Свиваме поредица от празни редове до една празнина — иначе разстоянията
      // между разделите стават огромни.
      if (!lastWasGap) {
        blocks.push(<View key={key} style={styles.planGap} />);
        lastWasGap = true;
      }
      return;
    }

    if (DIVIDER_REGEX.test(line)) {
      blocks.push(<View key={key} style={styles.planDivider} />);
      lastWasGap = true;
      return;
    }

    if (HEADING_REGEX.test(line)) {
      pushHeading(key, stripInlineMarks(line.replace(HEADING_REGEX, "")));
      return;
    }

    const numbered = line.match(NUMBERED_REGEX);
    if (numbered) {
      const rest = line.replace(NUMBERED_REGEX, "");
      if (isSectionHeading(rest)) {
        pushHeading(key, `${numbered[1]}. ${stripInlineMarks(rest)}`);
        return;
      }
      blocks.push(
        <View key={key} style={styles.planListRow}>
          <Text style={styles.planListMarker}>{numbered[1]}.</Text>
          <Text style={styles.planListText}>{renderInline(rest, key)}</Text>
        </View>
      );
      lastWasGap = false;
      return;
    }

    if (BULLET_REGEX.test(line)) {
      blocks.push(
        <View key={key} style={styles.planListRow}>
          <Text style={styles.planListMarker}>•</Text>
          <Text style={styles.planListText}>{renderInline(line.replace(BULLET_REGEX, ""), key)}</Text>
        </View>
      );
      lastWasGap = false;
      return;
    }

    if (isSectionHeading(line)) {
      pushHeading(key, stripInlineMarks(line));
      return;
    }

    // Ред, който целият е в **...** — подзаглавие (напр. име на хотел или ден).
    const boldOnly = line.trim().match(BOLD_ONLY_REGEX);
    if (boldOnly) {
      blocks.push(<Text key={key} style={styles.planSubheading}>{boldOnly[1].trim()}</Text>);
      lastWasGap = false;
      return;
    }

    blocks.push(<Text key={key} style={styles.planParagraph}>{renderInline(line, key)}</Text>);
    lastWasGap = false;
  });

  return blocks;
}

// ISO "YYYY-MM-DD" (форматът, който връща DatePicker) → четим за AI-то низ
// "ДД.ММ.ГГГГ", за да не подаваме суров ISO в промпта.
function formatDateForPrompt(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function buildDatesText(startDate, endDate) {
  if (startDate && endDate) return `${formatDateForPrompt(startDate)} - ${formatDateForPrompt(endDate)}`;
  if (startDate) return `от ${formatDateForPrompt(startDate)}`;
  if (endDate) return `до ${formatDateForPrompt(endDate)}`;
  return "";
}

export default function AIPlannerScreen({ onBack, trip, userId, openPlanId }) {
  // Реални safe area отстояния — без тях Android навигационната лента
  // застъпва бутона "Генерирай план", а status bar-ът закрива "← Назад".
  const insets = useSafeAreaInsets();
  // Бюджетът следва валутата на пътуването (зададена в TripSetup), за да е
  // консистентно с Разходи, вместо да е хардкоднат на лева/евро.
  const tripCurrency = trip?.local_currency || "EUR";
  // Планерът е достъпен и от началния екран без вписан потребител/пътуване
  // (маркетингова разходка) — запазване/споделяне/корекция изискват и двете.
  const canPersist = !!(trip?.id && userId);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(canPersist);
  const [displayName, setDisplayName] = useState("");
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const [sharing, setSharing] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  // Грешка от кръстосана проверка на датите (край преди начало) — показва се
  // веднага под избора на дати, вместо генерично alert някъде другаде.
  const [dateError, setDateError] = useState("");
  // id-то на реда в trip_plans, който в момента се показва — нужно е, за да
  // споделим в чата линк точно към тази версия, а не да копираме целия текст.
  const [currentPlanId, setCurrentPlanId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyPlans, setHistoryPlans] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Реалните начало/дестинация, които AI-то е използвало в текущия план —
  // идват от отговора на edge function-а (ROUTE_META), не само от формата,
  // защото потребителят може да е оставил дестинацията празна за AI да избере.
  // Пазим ги, за да ги запишем в params при всяко persistPlan извикване.
  const [resolvedMeta, setResolvedMeta] = useState({ start: null, dest: null, places: [] });
  // Какво търсим около местата. Категориите само го попълват — човек може
  // да напише каквото си иска и то отива буквално в картите.
  const [nearbyQuery, setNearbyQuery] = useState(NEARBY_KINDS[0].query);
  // Място извън плана — човек рядко се движи точно по написаното.
  const [nearbyPlace, setNearbyPlace] = useState("");
  // Идентификатор на "родословието" на плана — един и същ за първоначално
  // генерирания план и всички негови последващи корекции (refine), различен
  // за всеки чисто нов план (генериран от празна форма). Ползва се само за
  // да броим РЕАЛНИТЕ отделни планове на дашборда (виж fetchPlanCount в
  // DashboardScreen.js), а не всяка отделна версия/корекция като нов план.
  const [planGroupId, setPlanGroupId] = useState(null);

  const [form, setForm] = useState({
    startPoint: "София",
    // Наследяваме дестинацията от самото пътуване — иначе я въвеждаш втори път
    // тук, след като вече си я задал при създаването/редакцията на пътуването.
    // Може да се изчисти ръчно, ако искаш AI-то само да предложи дестинация.
    destination: trip?.destination || "",
    waypoints: [],
    // Датите вече идват от календарен избор (DatePicker), не от свободен
    // текст — иначе AI-то получаваше невалидни/нечетими дати и питаше за
    // корекция, вместо да генерира план.
    startDate: trip?.start_date || null,
    endDate: trip?.end_date || null,
    families: "2",
    children: "3",
    budget: "",
    transport: "коли",
    accommodationType: null,
    comfort: "без значение",
  });

  // Състав на групата — колко участници има пътуването, колко души са общо
  // (сборът от теглата) и колко от тях са деца. Ползва се за предварително
  // попълване на "Семейства" и "Деца" и за подсказката под полетата.
  const [tripMemberCount, setTripMemberCount] = useState(0);
  const [tripPeopleCount, setTripPeopleCount] = useState(0);
  const [tripChildrenCount, setTripChildrenCount] = useState(0);

  // Възстановява от вече запазен план САМО полетата, които нямат друг източник
  // (начална точка, спирки, бюджет, транспорт, настаняване) — те не се пазят
  // никъде в пътуването, затова формата ги помни от миналия път.
  // ВАЖНО: "Семейства" и "Деца" НЕ се възстановяват оттук. Те се смятат от
  // реалния състав на участниците (виж ефекта по-долу) и това е живата истина —
  // ако ги възстановявахме и от плана, пътуване с вече запазен план щеше да
  // показва старите стойности и промените в "Участници" нямаше да се виждат.
  // Празните стойности се игнорират, за да не изтрият наследеното от пътуването.
  function applyFormFromParams(params) {
    if (!params) return;
    setForm((f) => ({
      ...f,
      startPoint: params.startPoint || f.startPoint,
      destination: params.destination || f.destination,
      waypoints: Array.isArray(params.waypoints) && params.waypoints.length
        ? params.waypoints.map((w, i) => ({
            id: w?.id || `restored-${i}`,
            name: w?.name || "",
            overnight: !!w?.overnight,
          }))
        : f.waypoints,
      budget: params.budget || f.budget,
      transport: params.transport || f.transport,
      accommodationType: params.accommodationType || f.accommodationType,
      comfort: params.comfort || f.comfort,
    }));
  }

  // Ако пътуването вече си има запазен план, го показваме директно вместо
  // празна форма — така групата вижда последния съгласуван план при отваряне.
  // Ако сме дошли от линк към план в чата (openPlanId), зареждаме точно тази
  // версия вместо последната — с fallback към последната, ако вече не съществува
  // (напр. изтрита).
  useEffect(() => {
    if (!canPersist) return;
    const query = openPlanId
      ? supabase.from("trip_plans").select("id, content, params").eq("id", openPlanId).eq("trip_id", trip.id).maybeSingle()
      : supabase.from("trip_plans").select("id, content, params").eq("trip_id", trip.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

    query.then(async ({ data }) => {
      if (data?.content) {
        setPlan(data.content);
        setSaveStatus("saved");
        setCurrentPlanId(data.id);
        setResolvedMeta({
          start: data.params?.resolvedStart || null,
          dest: data.params?.resolvedDestination || null,
          places: data.params?.resolvedPlaces || [],
        });
        setPlanGroupId(data.params?.planGroupId || data.id);
        applyFormFromParams(data.params);
        return;
      }
      if (openPlanId) {
        // Планът, към който сочи чат линкът, вече не съществува — падаме
        // назад към последния запазен, вместо да покажем празен екран.
        const { data: latest } = await supabase
          .from("trip_plans")
          .select("id, content, params")
          .eq("trip_id", trip.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest?.content) {
          setPlan(latest.content);
          setSaveStatus("saved");
          setCurrentPlanId(latest.id);
          setResolvedMeta({
            start: latest.params?.resolvedStart || null,
            dest: latest.params?.resolvedDestination || null,
            places: latest.params?.resolvedPlaces || [],
          });
          setPlanGroupId(latest.params?.planGroupId || latest.id);
          applyFormFromParams(latest.params);
        }
      }
    }).finally(() => setLoadingSavedPlan(false));
  }, [canPersist, trip?.id, openPlanId]);

  // Един запис за целия състав на групата — от него взимаме и собственото име
  // (за подписа при споделяне в чата), и реалния състав: брой участници →
  // "Семейства", сбор от децата им → "Деца". И двете се въвеждаха ръчно преди
  // да пазим children при участниците.
  useEffect(() => {
    if (!canPersist) return;
    supabase
      .from("trip_members")
      .select("user_id, display_name, weight, children")
      .eq("trip_id", trip.id)
      .then(({ data }) => {
        const members = data || [];
        setDisplayName(members.find((m) => m.user_id === userId)?.display_name || "");
        if (!members.length) return;
        const people = members.reduce((sum, m) => sum + (m.weight || 1), 0);
        const kids = members.reduce((sum, m) => sum + (m.children || 0), 0);
        setTripMemberCount(members.length);
        setTripPeopleCount(people);
        setTripChildrenCount(kids);
        // Съставът на групата винаги идва оттук, дори когато пътуването вече
        // има запазен план — промените в "Участници" трябва да се виждат
        // веднага в планера. Ръчна корекция в самата форма остава валидна за
        // текущата сесия (ефектът се изпълнява само при отваряне на екрана).
        setForm((f) => ({ ...f, families: String(members.length), children: String(kids) }));
      });
  }, [canPersist, trip?.id, userId]);

  const scrollPadding = { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 };

  function addWaypoint() {
    setForm(f => ({
      ...f,
      waypoints: [...f.waypoints, { id: `${Date.now()}-${f.waypoints.length}`, name: "", overnight: false }],
    }));
  }

  function updateWaypoint(id, patch) {
    setForm(f => ({ ...f, waypoints: f.waypoints.map(w => (w.id === id ? { ...w, ...patch } : w)) }));
  }

  function removeWaypoint(id) {
    setForm(f => ({ ...f, waypoints: f.waypoints.filter(w => w.id !== id) }));
  }

  // Отваря картите с търсене около мястото. Нарочно е само адрес, а не наша
  // функция: не струва нищо, не влиза в никаква квота и показва снимки, оценки
  // и работно време, каквито ние няма да имаме.
  // Двете части са независими. Без място картите търсят около текущото
  // положение — те си знаят къде е телефонът, затова ние не искаме разрешение
  // за местоположение и не пишем нито ред за GPS. Без „какво" пък просто
  // показват самото място.
  function openNearby(place) {
    const parts = [nearbyQuery.trim(), String(place || "").trim()].filter(Boolean);
    if (parts.length === 0) return;
    const query = encodeURIComponent(parts.join(" "));
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => {});
  }

  // Местата идват от служебния ред на плана. Планове отпреди тази версия го
  // нямат — тогава падаме назад към дестинацията, за да има поне един бутон.
  const nearbyPlaces =
    resolvedMeta.places && resolvedMeta.places.length > 0
      ? resolvedMeta.places
      : [resolvedMeta.dest || trip?.destination].filter(Boolean);

  // Обединява текущите формулярни данни с реалните начало/дестинация, които
  // AI-то е използвало (meta) — това пазим в params на всеки запис, за да
  // може историята да показва истинския маршрут дори когато потребителят е
  // оставил дестинацията празна и AI сам я е избрал.
  function buildParams(meta, groupId) {
    return {
      ...form,
      resolvedStart: meta?.start || null,
      resolvedDestination: meta?.dest || null,
      // Местата от служебния ред на плана — от тях идват бутоните
      // „Какво има наоколо". Пазят се тук, за да ги имат и старите записи
      // при повторно отваряне.
      resolvedPlaces: meta?.places || [],
      planGroupId: groupId !== undefined ? groupId : planGroupId,
    };
  }

  // Общо запазване, извикано автоматично след всяко генериране/коригиране на
  // план (когато е възможно) — така план никога не се губи само защото
  // потребителят е забравил да натисне "Запази" (както се случи с втори,
  // ненатиснат план). Бутонът "Запази" по-долу вика същата функция ръчно.
  async function persistPlan(content, params) {
    if (!canPersist || !content) return null;
    setSaveStatus("saving");
    try {
      const { data, error } = await supabase
        .from("trip_plans")
        .insert({ trip_id: trip.id, created_by: userId, content, params })
        .select("id")
        .single();
      if (error) throw error;
      setSaveStatus("saved");
      setCurrentPlanId(data.id);
      return data.id;
    } catch (e) {
      setSaveStatus(null);
      alert("Грешка при автоматично запазване: " + e.message);
      return null;
    }
  }

  async function generatePlan() {
    // Кръстосана проверка на датите (форматът вече е гарантирано валиден,
    // защото идва от DatePicker, не от свободен текст) — само тук може да
    // сгрешиш, ако избереш край преди начало.
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setDateError("Крайната дата трябва да е след началната — провери избора на дати по-горе.");
      return;
    }
    setDateError("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-trip-planner", {
        body: {
          startPoint: form.startPoint,
          destination: form.destination,
          waypoints: form.waypoints
            .filter(w => w.name.trim())
            .map(w => ({ name: w.name.trim(), overnight: w.overnight })),
          dates: buildDatesText(form.startDate, form.endDate),
          families: form.families,
          children: form.children,
          budget: form.budget,
          currency: tripCurrency,
          transport: form.transport,
          accommodationType: form.accommodationType || "без значение",
          comfort: form.comfort,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Чисто нов план (генериран от празна форма) — получава свое ново
      // "родословие", различно от всеки предишен план, за да се брои като
      // отделен план на дашборда, а не като корекция на предишния.
      const newGroupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPlanGroupId(newGroupId);
      setPlan(data.plan);
      setSaveStatus(null);
      setResolvedMeta(data.meta || { start: null, dest: null, places: [] });
      persistPlan(data.plan, buildParams(data.meta, newGroupId));
    } catch (e) {
      alert("Грешка: " + e.message);
    }
    setLoading(false);
  }

  async function handleSaveToTrip() {
    if (!plan) return;
    persistPlan(plan, buildParams(resolvedMeta));
  }

  async function handleShareToChat() {
    if (!canPersist || !plan) return;
    setSharing(true);
    try {
      // Споделяме линк към запазената версия, не целия текст — иначе дълъг
      // план задръства чата за всички. Ако все още няма запазено id (напр.
      // автоматичното запазване е било неуспешно), пробваме да запазим сега.
      let planId = currentPlanId;
      if (!planId) planId = await persistPlan(plan, buildParams(resolvedMeta));
      if (!planId) throw new Error("Планът не можа да се запази, опитай пак.");

      // По-конкретно съобщение вместо еднакъв генеричен текст за всеки план —
      // включва реалния маршрут (и датите, ако са зададени), за да личи от
      // самия чат кой план е кой, без да се налага да го отваряш.
      const routeLabel = formatHistoryRoute({ params: buildParams(resolvedMeta), content: plan });
      const dateLabel = buildDatesText(form.startDate, form.endDate);
      const shareText = dateLabel
        ? `📋 AI план е готов: ${routeLabel} (${dateLabel})`
        : `📋 AI план е готов: ${routeLabel}`;

      const { error } = await supabase.from("messages").insert({
        trip_id: trip.id,
        user_id: userId,
        display_name: displayName || "AI Планер",
        text: shareText,
        plan_id: planId,
      });
      if (error) throw error;
      alert("Линк към плана е споделен в чата.");
    } catch (e) {
      alert("Грешка: " + e.message);
    } finally {
      setSharing(false);
    }
  }

  async function openHistory() {
    if (!canPersist) return;
    setShowHistory(true);
    setLoadingHistory(true);
    const { data } = await supabase
      .from("trip_plans")
      .select("id, content, created_at, params")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: false });
    setHistoryPlans(data || []);
    setLoadingHistory(false);
  }

  function selectHistoryPlan(item) {
    setPlan(item.content);
    setCurrentPlanId(item.id);
    setSaveStatus("saved");
    setShowRefine(false);
    setShowHistory(false);
    setResolvedMeta({ start: item.params?.resolvedStart || null, dest: item.params?.resolvedDestination || null });
    setPlanGroupId(item.params?.planGroupId || item.id);
    applyFormFromParams(item.params);
  }

  function formatHistoryDate(iso) {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // Първи що-годе съдържателен ред от текста на плана — резервен етикет за
  // по-стари записи, запазени преди да пазим и реално избраната от AI
  // дестинация (resolvedDestination), при които params.destination е празно,
  // защото потребителят е оставил AI да избере дестинацията.
  function extractFallbackLabel(content) {
    if (!content) return null;
    const lines = content.split("\n").map((l) =>
      l.replace(/^#+\s*/, "").replace(/^[-*]+\s*/, "").replace(/\*\*/g, "").trim()
    );
    const line = lines.find((l) => l && l !== "---" && l.length > 3 && !/^\d+\.\s/.test(l));
    return line ? line.slice(0, 60) : null;
  }

  // Показваме маршрута (начало → спирки → дестинация) вместо суровата дата
  // като основен етикет на всеки ред в историята — по-лесно е да разпознаеш
  // кой план кой е, отколкото по час на запазване. Датата остава като
  // по-дребен подетикет под маршрута, а редовете пак са подредени хронологично
  // (най-новите отгоре — заявката по-горе е с order created_at desc).
  // Предпочитаме resolvedStart/resolvedDestination (реално използваните от
  // AI-то, идващи от ROUTE_META в отговора) пред суровите полета от формата,
  // защото потребителят може да е оставил дестинацията празна за AI да избере.
  function formatHistoryRoute(item) {
    const params = item?.params;
    const start = (params?.resolvedStart || params?.startPoint || "").trim();
    const dest = (params?.resolvedDestination || params?.destination || "").trim();
    const waypointNames = (params?.waypoints || [])
      .map((w) => (w?.name || "").trim())
      .filter(Boolean);
    const points = [start, ...waypointNames, dest].filter(Boolean);
    if (points.length > 1) return points.join(" → ");
    const fallback = extractFallbackLabel(item?.content);
    if (fallback) return fallback;
    return points.length ? points.join(" → ") : "План";
  }

  async function handleRefine() {
    if (!feedback.trim() || !plan) return;
    setRefining(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-trip-planner", {
        body: { previousPlan: plan, feedback: feedback.trim(), currency: tripCurrency },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPlan(data.plan);
      setSaveStatus(null);
      setResolvedMeta(data.meta || { start: null, dest: null, places: [] });
      persistPlan(data.plan, buildParams(data.meta));
      setFeedback("");
      setShowRefine(false);
    } catch (e) {
      alert("Грешка: " + e.message);
    } finally {
      setRefining(false);
    }
  }

  function startNewPlan() {
    setPlan(null);
    setSaveStatus(null);
    setShowRefine(false);
    setFeedback("");
    setResolvedMeta({ start: null, dest: null });
    setPlanGroupId(null);
  }

  if (loadingSavedPlan) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.brand600} />
      </View>
    );
  }

  if (plan) {
    // Фиксирани хедър (← Назад) и футър (Запази/Сподели/Коригирай) извън
    // ScrollView-а — иначе при дълъг AI отговор трябва да скролираш чак
    // догоре за бутона за връщане и чак додолу за действията върху плана.
    // KeyboardAvoidingView около всичко — иначе клавиатурата при писане в
    // полето за корекция застава върху него, вместо да го избутва нагоре.
    return (
      <KeyboardAvoidingView style={styles.flexOne} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.planHeader}>
          <TouchableOpacity onPress={onBack} style={styles.headerBackBtn}>
            <Text style={styles.backText}>← Назад</Text>
          </TouchableOpacity>
          <Text style={styles.planHeaderTitle}>🗺 Твоят план</Text>
          {canPersist && (
            <TouchableOpacity onPress={openHistory} style={styles.historyBtn}>
              <Text style={styles.historyBtnText}>🕘 История</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={styles.planScroll} contentContainerStyle={styles.planScrollContent}>
          {nearbyPlaces.length > 0 && (
            <View style={styles.nearbyBox}>
              <Text style={styles.nearbyLabel}>📍 Какво има наоколо</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.nearbyKindRow}
              >
                {NEARBY_KINDS.map((kind) => {
                  // Осветен е само докато текстът съвпада дума по дума. Напише ли
                  // човек нещо свое, никой чип не е осветен — и това е честно.
                  const active = kind.query === nearbyQuery;
                  return (
                    <TouchableOpacity
                      key={kind.key}
                      style={[styles.nearbyKind, active && styles.nearbyKindOn]}
                      onPress={() => setNearbyQuery(kind.query)}
                    >
                      <Text style={[styles.nearbyKindText, active && styles.nearbyKindTextOn]}>
                        {kind.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TextInput
                style={styles.nearbyInput}
                value={nearbyQuery}
                onChangeText={setNearbyQuery}
                placeholder="какво да търся"
                placeholderTextColor={colors.text400}
                returnKeyType="done"
              />
              <View style={styles.nearbyRow}>
                {nearbyPlaces.map((place) => (
                  <TouchableOpacity
                    key={place}
                    style={styles.nearbyChip}
                    onPress={() => openNearby(place)}
                  >
                    <Text style={styles.nearbyChipText}>{place}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.nearbyChip, styles.nearbyChipMe]}
                  onPress={() => openNearby(null)}
                >
                  <Text style={[styles.nearbyChipText, styles.nearbyChipTextMe]}>
                    📍 Около мен
                  </Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.nearbyChip, styles.nearbyPlaceInput]}
                  value={nearbyPlace}
                  onChangeText={setNearbyPlace}
                  placeholder="друго място…"
                  placeholderTextColor={colors.text400}
                  returnKeyType="search"
                  onSubmitEditing={() => openNearby(nearbyPlace)}
                />
              </View>
            </View>
          )}
          <View style={styles.planBox}>
            {renderPlanBlocks(plan)}
          </View>
        </ScrollView>

        <View style={[styles.planFooter, { paddingBottom: insets.bottom + space.md }]}>
          {canPersist && !showRefine && (
            <View style={styles.planActionsRow}>
              <TouchableOpacity style={styles.planActionBtn} onPress={handleSaveToTrip} disabled={saveStatus === "saving"}>
                {saveStatus === "saving" ? <ActivityIndicator color={colors.brand600} /> : (
                  <Text style={styles.planActionText}>{saveStatus === "saved" ? "✓ Запазено" : "💾 Запази"}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.planActionBtn} onPress={handleShareToChat} disabled={sharing}>
                {sharing ? <ActivityIndicator color={colors.brand600} /> : <Text style={styles.planActionText}>📤 Сподели</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.planActionBtn} onPress={() => setShowRefine(true)}>
                <Text style={styles.planActionText}>✏️ Коригирай</Text>
              </TouchableOpacity>
            </View>
          )}

          {canPersist && showRefine && (
            <View style={styles.refineBox}>
              <Text style={styles.label}>Каква промяна искаш?</Text>
              <TextInput
                style={[styles.input, styles.refineInput]}
                placeholder="напр. искаме хотел по-близо до плажа"
                value={feedback}
                onChangeText={setFeedback}
                multiline
              />
              <View style={styles.refineBtnRow}>
                <TouchableOpacity style={styles.btnSecondarySmall} onPress={() => { setShowRefine(false); setFeedback(""); }}>
                  <Text style={styles.btnSecondarySmallText}>Отказ</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSmall} onPress={handleRefine} disabled={refining || !feedback.trim()}>
                  {refining ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnSmallText}>Обнови плана</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!showRefine && (
            <TouchableOpacity style={styles.newPlanLink} onPress={startNewPlan}>
              <Text style={styles.newPlanLinkText}>Нов план</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal visible={showHistory} transparent animationType="fade" onRequestClose={() => setShowHistory(false)}>
        <View style={styles.historyBackdrop}>
          <View style={styles.historyModal}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>История на плановете</Text>
              <TouchableOpacity onPress={() => setShowHistory(false)}>
                <Text style={styles.historyClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {loadingHistory ? (
              <ActivityIndicator color={colors.brand600} style={{ marginVertical: space.xl }} />
            ) : (
              <FlatList
                data={historyPlans}
                keyExtractor={(item) => item.id}
                style={styles.historyList}
                ListEmptyComponent={<Text style={styles.historyEmpty}>Няма запазени планове.</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.historyItem} onPress={() => selectHistoryPlan(item)}>
                    <View style={styles.historyItemRow}>
                      <Text style={styles.historyItemDate} numberOfLines={1}>{formatHistoryRoute(item)}</Text>
                      {item.id === currentPlanId && <Text style={styles.historyItemCurrent}>● показан сега</Text>}
                    </View>
                    <Text style={styles.historyItemDateSub}>{formatHistoryDate(item.created_at)}</Text>
                    <Text style={styles.historyItemPreview} numberOfLines={2}>
                      {item.content.replace(/\n+/g, " ").slice(0, 140)}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, scrollPadding]}>
      <TouchableOpacity onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Sparkles size={24} color={colors.brand600} strokeWidth={1.75} />
        <Text style={styles.title}>AI Планиране</Text>
      </View>
      <Text style={styles.subtitle}>Разкажи ни за пътуването и ще получиш готов план</Text>

      <Text style={styles.label}>Начална точка</Text>
      <TextInput style={styles.input} placeholder="напр. София" value={form.startPoint} onChangeText={v => setForm({...form, startPoint: v})} />

      <Text style={styles.label}>Крайна точка / дестинация (или остави празно за предложение)</Text>
      <TextInput style={styles.input} placeholder="напр. Тасос, Гърция" value={form.destination} onChangeText={v => setForm({...form, destination: v})} />

      <Text style={styles.label}>Междинни точки (по желание)</Text>
      {form.waypoints.map((w, idx) => (
        <View key={w.id} style={styles.waypointRow}>
          <TextInput
            style={[styles.input, styles.waypointInput]}
            placeholder={`Спирка ${idx + 1}`}
            value={w.name}
            onChangeText={v => updateWaypoint(w.id, { name: v })}
          />
          <TouchableOpacity
            style={[styles.overnightChip, w.overnight && styles.overnightChipActive]}
            onPress={() => updateWaypoint(w.id, { overnight: !w.overnight })}
          >
            <Text style={[styles.overnightChipText, w.overnight && styles.overnightChipTextActive]}>🌙 преспиване</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeWaypoint(w.id)} style={styles.removeWaypointBtn}>
            <Text style={styles.removeWaypointText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={addWaypoint} style={styles.addWaypointBtn}>
        <Text style={styles.addWaypointText}>+ Добави спирка</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Период</Text>
      <View style={styles.dateRow}>
        <View style={styles.dateCol}>
          <DatePicker
            value={form.startDate}
            onChange={v => {
              // Ресетваме крайната дата при промяна на началната — иначе тя
              // пази старата си стойност (напр. датите на самото пътуване,
              // с които формата се предзарежда по подразбиране) и календарът
              // за крайна дата отваря нейния месец, вместо месеца на
              // новоизбраната начална дата.
              setForm({ ...form, startDate: v, endDate: null });
              setDateError("");
            }}
            placeholder="Начална дата"
          />
        </View>
        <Text style={styles.dateSep}>→</Text>
        <View style={styles.dateCol}>
          <DatePicker
            value={form.endDate}
            onChange={v => { setForm({ ...form, endDate: v }); setDateError(""); }}
            placeholder="Крайна дата"
            minDate={form.startDate}
          />
        </View>
      </View>
      {!!dateError && <Text style={styles.dateErrorText}>{dateError}</Text>}

      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={styles.label}>Семейства</Text>
          <TextInput style={styles.input} keyboardType="number-pad" value={form.families} onChangeText={v => setForm({...form, families: v})} />
        </View>
        <View style={styles.half}>
          <Text style={styles.label}>Деца</Text>
          <TextInput style={styles.input} keyboardType="number-pad" value={form.children} onChangeText={v => setForm({...form, children: v})} />
        </View>
      </View>
      {tripMemberCount > 0 && (
        <Text style={styles.fieldHint}>
          {`Взето от участниците: ${tripPeopleCount} ${tripPeopleCount === 1 ? "човек" : "души"} общо, от които ${tripChildrenCount} ${tripChildrenCount === 1 ? "дете" : "деца"}. Броят се променя от "Участници" на началния екран.`}
        </Text>
      )}

      <Text style={styles.label}>Бюджет ({tripCurrency})</Text>
      <TextInput style={styles.input} placeholder="напр. 2500" keyboardType="number-pad" value={form.budget} onChangeText={v => setForm({...form, budget: v})} />

      <Text style={styles.label}>Транспорт</Text>
      <View style={styles.transportRow}>
        {TRANSPORT_OPTIONS.map(t => (
          <TouchableOpacity key={t} style={[styles.transportBtn, form.transport === t && styles.transportActive]} onPress={() => setForm({...form, transport: t})}>
            <Text style={[styles.transportText, form.transport === t && styles.transportTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Тип настаняване</Text>
      <View style={styles.chipsWrap}>
        {ACCOMMODATION_TYPES.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.typeChip, form.accommodationType === t && styles.typeChipActive]}
            onPress={() => setForm({...form, accommodationType: form.accommodationType === t ? null : t})}
          >
            <Text style={[styles.typeChipText, form.accommodationType === t && styles.typeChipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Комфорт на настаняване</Text>
      <View style={styles.chipsWrap}>
        {COMFORT_OPTIONS.map(c => (
          <TouchableOpacity key={c} style={[styles.typeChip, form.comfort === c && styles.typeChipActive]} onPress={() => setForm({...form, comfort: c})}>
            <Text style={[styles.typeChipText, form.comfort === c && styles.typeChipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.btn} onPress={generatePlan} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.onBrand} /> : (
          <View style={styles.btnRow}>
            <Sparkles size={20} color={colors.onBrand} strokeWidth={1.75} />
            <Text style={styles.btnText}>Генерирай план с AI</Text>
          </View>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.xl },
  back: { marginBottom: space.lg },
  backText: { ...type.body, color: colors.brand600 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  title: { ...type.title, color: colors.text900 },
  subtitle: { ...type.label, color: colors.text600, marginBottom: space.xl },
  label: { ...type.label, color: colors.text600, marginBottom: space.sm, marginTop: space.md },
  input: { ...type.body, backgroundColor: colors.surface, padding: space.lg, borderRadius: radius.control, borderWidth: 0.5, borderColor: colors.border },
  dateRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dateCol: { flex: 1 },
  dateSep: { ...type.body, color: colors.text400, fontWeight: "600" },
  dateErrorText: { ...type.label, color: "#D64545", marginTop: -space.xs, marginBottom: space.sm },
  fieldHint: { fontSize: 12, lineHeight: 16, color: colors.text400, marginTop: space.sm },
  row: { flexDirection: "row", gap: space.md },
  half: { flex: 1 },
  waypointRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  waypointInput: { flex: 1, marginBottom: 0 },
  overnightChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  overnightChipActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  overnightChipText: { ...type.label, color: colors.text600, fontSize: 12 },
  overnightChipTextActive: { color: colors.onBrand },
  removeWaypointBtn: { padding: space.sm },
  removeWaypointText: { ...type.body, color: colors.text400 },
  addWaypointBtn: { alignSelf: "flex-start", marginBottom: space.md },
  addWaypointText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  transportRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  transportBtn: { minWidth: "30%", flexGrow: 1, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.surface },
  transportActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  transportText: { ...type.label, color: colors.text600 },
  transportTextActive: { color: colors.onBrand },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  typeChip: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  typeChipText: { ...type.label, color: colors.text600 },
  typeChipTextActive: { color: colors.onBrand, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  btn: { backgroundColor: colors.brand600, padding: space.lg, borderRadius: radius.card, alignItems: "center", marginTop: space.xl },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  btnText: { ...type.body, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  planHeader: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, backgroundColor: colors.bg, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  headerBackBtn: { paddingVertical: space.xs },
  planHeaderTitle: { ...type.title, color: colors.text900, flex: 1 },
  historyBtn: { paddingVertical: space.xs, paddingHorizontal: space.sm },
  historyBtnText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  historyBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: space.xl },
  historyModal: { backgroundColor: colors.bg, borderRadius: radius.card, maxHeight: "75%", padding: space.lg },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.md },
  historyTitle: { ...type.subhead, color: colors.text900, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
  historyClose: { ...type.title, color: colors.text400, paddingHorizontal: space.sm },
  historyList: { flexGrow: 0 },
  historyEmpty: { ...type.label, color: colors.text400, textAlign: "center", marginVertical: space.xl },
  historyItem: { backgroundColor: colors.surface, borderRadius: radius.control, padding: space.md, marginBottom: space.sm },
  historyItemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.xs },
  historyItemDate: { ...type.label, color: colors.text600, fontWeight: "600", fontFamily: "GolosText_600SemiBold", flex: 1, marginRight: space.sm },
  historyItemDateSub: { fontSize: 11, lineHeight: 14, color: colors.text400, marginBottom: space.xs },
  historyItemCurrent: { ...type.label, color: colors.brand600, fontSize: 11 },
  historyItemPreview: { ...type.label, color: colors.text400 },
  planScroll: { flex: 1 },
  planScrollContent: { padding: space.xl },
  planFooter: { paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: colors.bg, borderTopWidth: 0.5, borderTopColor: colors.border },
  planTitle: { ...type.title, color: colors.text900, marginBottom: space.lg },
  planBox: { backgroundColor: colors.surface, borderRadius: radius.card, padding: space.xl },
  nearbyBox: { marginBottom: space.lg },
  nearbyLabel: {
    fontSize: 13, lineHeight: 18, fontWeight: "700",
    color: colors.text600, marginBottom: space.sm,
  },
  nearbyKindRow: { gap: space.sm, paddingRight: space.xl, paddingBottom: space.sm },
  nearbyKind: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingVertical: 6, paddingHorizontal: space.md,
  },
  nearbyKindOn: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  nearbyKindText: { fontSize: 13, lineHeight: 17, color: colors.text600, fontWeight: "600" },
  nearbyKindTextOn: { color: "#FFFFFF" },
  nearbyInput: {
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.control, paddingVertical: space.sm, paddingHorizontal: space.md,
    fontSize: 14, lineHeight: 18, color: colors.text900, marginBottom: space.sm,
  },
  nearbyRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  nearbyChip: {
    backgroundColor: colors.brand50, borderWidth: 1, borderColor: colors.brand600,
    borderRadius: radius.pill, paddingVertical: space.sm, paddingHorizontal: space.md,
  },
  nearbyChipText: { fontSize: 14, lineHeight: 18, color: colors.brand600, fontWeight: "600" },
  nearbyChipMe: { backgroundColor: colors.brand600 },
  nearbyChipTextMe: { color: "#FFFFFF" },
  // Пунктирът казва „тук се пише", без да има нужда от надпис за това.
  nearbyPlaceInput: {
    backgroundColor: "transparent", borderStyle: "dashed", borderColor: colors.text400,
    minWidth: 140, fontSize: 14, color: colors.text900,
    paddingVertical: space.sm, paddingHorizontal: space.md,
  },
  planLink: { ...type.body, color: colors.brand600, textDecorationLine: "underline" },
  // Форматиране на плана (виж renderPlanBlocks по-горе).
  planHeading: {
    ...type.subhead, fontWeight: "bold", fontFamily: "GolosText_700Bold",
    color: colors.text900, marginTop: space.lg, marginBottom: space.sm,
  },
  planHeadingFirst: { marginTop: 0 },
  planSubheading: {
    ...type.body, fontWeight: "600", fontFamily: "GolosText_600SemiBold",
    color: colors.text900, marginTop: space.md, marginBottom: space.xs,
  },
  planParagraph: { ...type.body, color: colors.text900, marginBottom: space.xs },
  planBold: { fontWeight: "700", fontFamily: "GolosText_700Bold" },
  planListRow: { flexDirection: "row", gap: space.sm, marginBottom: space.xs, paddingLeft: space.xs },
  planListMarker: { ...type.body, color: colors.text600, minWidth: 16 },
  planListText: { ...type.body, color: colors.text900, flex: 1 },
  planDivider: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
  planGap: { height: space.sm },
  planActionsRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  planActionBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand600, borderRadius: radius.control, padding: space.md, alignItems: "center" },
  planActionText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  newPlanLink: { alignItems: "center", padding: space.sm },
  newPlanLinkText: { ...type.label, color: colors.text600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  refineToggleBtn: { alignItems: "center", padding: space.md, marginBottom: space.md },
  refineToggleText: { ...type.label, color: colors.brand600, fontWeight: "600", fontFamily: "GolosText_600SemiBold" },
  refineBox: { backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, marginBottom: space.sm },
  refineInput: { minHeight: 80, textAlignVertical: "top", marginTop: space.sm },
  refineBtnRow: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  btnSecondarySmall: { flex: 1, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  btnSecondarySmallText: { ...type.label, color: colors.text600 },
  btnSmall: { flex: 1, backgroundColor: colors.brand600, padding: space.md, borderRadius: radius.control, alignItems: "center" },
  btnSmallText: { ...type.label, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
});
