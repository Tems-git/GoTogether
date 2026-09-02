import { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, TouchableWithoutFeedback,
  FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Linking, Modal, Image, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageSquare } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabase";
import ZoomableImage from "../components/ZoomableImage";
import { saveToGallery, canSaveToGallery } from "../lib/gallery";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { shrinkPhoto, presetFor, PHOTO_PRESETS } from "../lib/image";
import { colors, space, radius, type } from "../theme/tokens";

// Цветът на аватара се избира по user_id, а не по мястото в списъка. Така
// един и същи човек е с един и същи цвят при всяко отваряне, на всяко
// устройство и при всички участници — иначе цветовете щяха да скачат при
// зареждане на по-стари съобщения.
// Колко дълго важи връзката към снимка. По-дълго от документите, защото в чата
// се скролва напред-назад и не искаме връзките да умират под пръстите.
const PHOTO_URL_SECONDS = 3600;

// Къде се помни изборът на качество. На телефона, не в базата — това е
// предпочитание на човека, не на пътуването.
const PHOTO_QUALITY_KEY = "gotogether.photoQuality";

// Кои снимки вече са записани в галерията на ТОЗИ телефон. На телефона, защото
// въпросът е „аз имам ли я", а не „изпратена ли е". Пази се ограничен брой —
// списъкът няма причина да расте вечно.
const SAVED_PHOTOS_KEY = "gotogether.savedPhotos";
const SAVED_PHOTOS_MAX = 500;

// Предпазител срещу нещо огромно, което да изяде мястото на всички.
const PHOTO_MAX_MB = 8;

// Колко снимки наведнъж. Не заради код, а заради чакането: качват се една по
// една, а на мобилен интернет десет вече са минута с телефон в ръка.
const PHOTO_MAX_COUNT = 10;

const AVATAR_COLORS = [
  "#0A6B57", "#B4531F", "#3D5A98", "#7A3E9D",
  "#177A6B", "#9B2C46", "#4C6B1A", "#2B5F7A",
];

function avatarColor(id) {
  const key = String(id || "");
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// Разпознаване на адреси в текста на съобщение. Умишлено просто: пълен адрес
// с http/https, или започващ с www. Каквото не отговаря на това, си остава
// обикновен текст — по-добре един линк да не се хване, отколкото половин
// изречение да посинее и да води наникъде.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

// Крайната пунктуация почти винаги принадлежи на изречението, не на адреса.
// „…виж https://maps.app.goo.gl/abc." трябва да отвори адреса без точката.
const TRAILING_PUNCT = /[.,;:!?)\]}»„“"'…]+$/;

// Картовите адреси се подават на системата, за да ги поеме приложението за
// карти. Вътрешният браузър би показал уеб версията и би загубил навигацията,
// запазените места и профила на човека.
const MAP_URL = /(maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]{2,8}\/maps|maps\.google\.|maps\.apple\.com|waze\.com)/i;

// Връща текста, нарязан на парчета: обикновените имат само `text`, адресите
// имат и `url`. Един елемент без `url` означава съобщение без линкове.
function splitByLinks(value) {
  const source = String(value || "");
  const parts = [];
  let cursor = 0;

  source.replace(URL_REGEX, (match, _captured, offset) => {
    const clean = match.replace(TRAILING_PUNCT, "");
    if (!clean) return match;
    if (offset > cursor) parts.push({ text: source.slice(cursor, offset) });
    parts.push({
      text: clean,
      url: clean.toLowerCase().startsWith("www.") ? `https://${clean}` : clean,
    });
    cursor = offset + clean.length;
    return match;
  });

  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts.length ? parts : [{ text: source }];
}

// Телефон: започва с + или с 0, следват цифри, интервали, тирета и скоби.
// Точки нарочно НЕ се допускат — иначе „01.09.2026" става телефон.
//
// Първата група е знакът преди номера. Тя съществува само за да отреже
// съвпадения по средата на дълга поредица цифри — без нея IBAN-ът
// „BG80 BNBG 9661 1020 3456 78" се разпознаваше като телефон, защото някъде
// вътре в него има нула, последвана от достатъчно цифри.
const PHONE_REGEX = /(^|[^\d+])(\+\d[\d\s\-()]{7,17}\d|0[\d\s\-()]{7,15}\d)/g;

// Броят цифри решава. Международен номер е 8–15 цифри; български, започващ с
// нула, е 9–12. Всичко извън тези граници е нещо друго — сума, дата, код.
function looksLikePhone(value) {
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15;
  return digits.length >= 9 && digits.length <= 12;
}

// Търси номера само в частите, които не са линк — иначе цифрите в един адрес
// биха се разпаднали на „телефони".
function splitPhones(value) {
  const source = String(value || "");
  const parts = [];
  let cursor = 0;

  source.replace(PHONE_REGEX, (match, before, candidate, offset) => {
    if (!looksLikePhone(candidate)) return match;
    const clean = candidate.trim();
    const start = offset + before.length + candidate.indexOf(clean);
    if (start > cursor) parts.push({ text: source.slice(cursor, start) });
    parts.push({ text: clean, phone: clean.replace(/[^\d+]/g, "") });
    cursor = start + clean.length;
    return match;
  });

  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts.length ? parts : [{ text: source }];
}

// Първо адресите, после телефоните вътре в останалия текст.
function splitMessage(value) {
  const out = [];
  splitByLinks(value).forEach((part) => {
    if (part.url) {
      out.push(part);
      return;
    }
    splitPhones(part.text).forEach((piece) => out.push(piece));
  });
  return out;
}

export default function ChatScreen({ onBack, tripId, userId, tripName, onOpenPlan }) {
  // insets дава реалните височини на status bar (top) и navigation bar (bottom)
  // за конкретното устройство. Без тях Android навигационната лента застъпва
  // полето за писане — тапването задейства системните бутони вместо input-а.
  const insets = useSafeAreaInsets();
  // Ширината на страница при прелистването на снимките.
  const { width: windowWidth } = useWindowDimensions();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [memberReads, setMemberReads] = useState([]);
  // Съобщението, за което в момента гледаме кой го е прочел.
  const [readInfo, setReadInfo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [editText, setEditText] = useState("");
  const [showJump, setShowJump] = useState(false);
  // Пътят на снимка → временна връзка към нея. Пази се, за да не издаваме нова
  // връзка при всяко превъртане на списъка.
  const [photoUrls, setPhotoUrls] = useState({});
  const [sendingPhoto, setSendingPhoto] = useState(false);
  // „3/7" докато върви многото; празно при една снимка.
  const [photoProgress, setPhotoProgress] = useState("");
  // Съобщението, чието меню с действия е отворено.
  const [msgActions, setMsgActions] = useState(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoQuality, setPhotoQuality] = useState("normal");
  // Менюто за нова снимка: откъде и с какво качество.
  const [photoMenu, setPhotoMenu] = useState(false);
  // Мястото в лентата със снимки, отворена на цял екран. null значи затворена.
  const [photoIndex, setPhotoIndex] = useState(null);
  // Докато снимката е увеличена, прелистването настрани трябва да спре.
  const [photoZoomed, setPhotoZoomed] = useState(false);
  // Пътищата на вече записаните снимки.
  const [savedPhotos, setSavedPhotos] = useState([]);
  // Търсенето е отворено само когато има какво да се търси.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Съобщението, до което току-що скочихме — свети кратко, за да го хване окото.
  const [highlightId, setHighlightId] = useState(null);
  // Докато трае скокът, автоматичното сваляне надолу трябва да мълчи.
  const jumping = useRef(false);
  const flatRef = useRef(null);
  const editInputRef = useRef(null);
  // Дали в момента сме в дъното на списъка. Държим го в ref, а не в state,
  // защото се чете вътре в onContentSizeChange, където state би бил стар.
  const atBottom = useRef(true);

  const markAsRead = useCallback(async () => {
    await supabase.from("trip_members")
      .update({ chat_last_read: new Date().toISOString() })
      .eq("trip_id", tripId)
      .eq("user_id", userId);
  }, [tripId, userId]);

  const fetchMemberReads = useCallback(async () => {
    const { data } = await supabase
      .from("trip_members")
      .select("user_id, display_name, chat_last_read")
      .eq("trip_id", tripId)
      .neq("user_id", userId);
    setMemberReads(data || []);
  }, [tripId, userId]);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });
    setMessages(data || []);
    setLoading(false);
    await markAsRead();
  }, [tripId, markAsRead]);

  useEffect(() => {
    supabase.from("trip_members")
      .select("display_name")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || "Непознат"));

    fetchMessages();
    fetchMemberReads();

    const msgChannel = supabase
      .channel(`messages-${tripId}-${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        async (payload) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
          await markAsRead();
        }
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new : m));
        }
      )
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      )
      .subscribe();

    const membersChannel = supabase
      .channel(`members-reads-${tripId}-${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` },
        () => fetchMemberReads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(membersChannel);
    };
  }, [tripId, userId, fetchMessages, fetchMemberReads, markAsRead]);

  useEffect(() => {
    // Същото условие като при onContentSizeChange: смъкваме списъка само ако
    // човекът вече е долу. Този ефект беше пропуснат при предишната поправка и
    // продължаваше да дърпа екрана надолу при всяко ново съобщение.
    if (messages.length > 0 && atBottom.current) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  useEffect(() => {
    if (editingMsg) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editingMsg]);

  useEffect(() => {
    AsyncStorage.getItem(PHOTO_QUALITY_KEY)
      .then((value) => { if (value) setPhotoQuality(value); })
      .catch(() => {});

    AsyncStorage.getItem(SAVED_PHOTOS_KEY)
      .then((value) => {
        const list = value ? JSON.parse(value) : [];
        if (Array.isArray(list)) setSavedPhotos(list);
      })
      .catch(() => {});
  }, []);

  function rememberSaved(path) {
    setSavedPhotos((prev) => {
      if (prev.includes(path)) return prev;
      const next = [...prev, path].slice(-SAVED_PHOTOS_MAX);
      AsyncStorage.setItem(SAVED_PHOTOS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function switchQuality() {
    const next = photoQuality === "high" ? "normal" : "high";
    setPhotoQuality(next);
    AsyncStorage.setItem(PHOTO_QUALITY_KEY, next).catch(() => {});
  }

  // Временните връзки се издават на групи, за всички нови снимки наведнъж.
  useEffect(() => {
    const missing = messages
      .map((m) => m.image_path)
      .filter((p) => p && !photoUrls[p]);
    if (missing.length === 0) return;

    let alive = true;
    supabase.storage
      .from("documents")
      .createSignedUrls([...new Set(missing)], PHOTO_URL_SECONDS)
      .then(({ data }) => {
        if (!alive || !data) return;
        const next = {};
        data.forEach((row) => {
          if (row.signedUrl && row.path) next[row.path] = row.signedUrl;
        });
        if (Object.keys(next).length > 0) setPhotoUrls((prev) => ({ ...prev, ...next }));
      });

    return () => { alive = false; };
  }, [messages]);

  // Всички снимки в чата, по реда на чата. Отварянето на една значи заставане
  // на нейното място в тази лента, а не показване на самотен файл.
  const photoList = messages.filter((m) => m.image_path && photoUrls[m.image_path]);
  const openPhoto = (msg) => {
    const index = photoList.findIndex((m) => m.id === msg.id);
    if (index >= 0) {
      setPhotoZoomed(false);
      setPhotoIndex(index);
    }
  };
  const currentPhoto = photoIndex != null ? photoList[photoIndex] : null;

  async function savePhotoFrom(msg) {
    const url = msg?.image_path ? photoUrls[msg.image_path] : null;
    if (!url || savingPhoto) return;

    setSavingPhoto(true);
    const result = await saveToGallery(url);
    setSavingPhoto(false);

    if (result.ok) {
      rememberSaved(msg.image_path);
      Alert.alert("Записано", "Снимката е в галерията ти.");
      return;
    }
    if (result.reason === "unsupported") {
      Alert.alert("Още не мога", "Записването в галерията идва със следващата версия на приложението.");
      return;
    }
    if (result.reason === "denied") {
      Alert.alert("Няма достъп", "Без разрешение за галерията не мога да запиша снимката.");
      return;
    }
    Alert.alert("Не се записа", "Опитай пак.");
  }

  // Питаме откъде идва снимката, вместо да налагаме едното. На път по-често се
  // снима на място, но понякога човек праща нещо отпреди малко.
  function handlePhoto() {
    if (sendingPhoto) return;
    setPhotoMenu(true);
  }

  async function pickPhoto(source) {
    try {
      const permission = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Няма достъп", "Без разрешение не мога да взема снимката.");
        return;
      }

      const preset = presetFor(photoQuality);
      const options = { quality: preset.pick, mediaTypes: ["images"] };
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
            selectionLimit: PHOTO_MAX_COUNT,
          });
      if (result.canceled) return;

      await sendPhotos(result.assets || []);
    } catch (e) {
      Alert.alert("Грешка", e.message);
    }
  }

  // Качва една снимка и връща id-то на съобщението. Хвърля при провал —
  // извикващият решава дали да спре, или да продължи с останалите.
  async function uploadOnePhoto(asset, caption) {
    // Смаляването е преди четенето на байтовете — иначе четем мегабайти, за да
    // ги изхвърлим веднага след това.
    const uri = await shrinkPhoto(asset.uri, asset.width, presetFor(photoQuality));
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.byteLength > PHOTO_MAX_MB * 1024 * 1024) {
      throw new Error(`Снимка над ${PHOTO_MAX_MB} MB.`);
    }

    // Папката е пътуването — така важат същите правила за достъп, както при
    // документите. Подпапката „chat" ги държи настрани от Документи.
    // Случайното окончание пази две снимки в една и съща милисекунда да не се
    // презапишат — при избор на няколко това е напълно възможно.
    const suffix = Math.random().toString(36).slice(2, 8);
    const path = `${tripId}/chat/${Date.now()}_${suffix}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, bytes, { contentType: "image/jpeg" });
    if (uploadError) throw uploadError;

    const { data: inserted, error } = await supabase
      .from("messages")
      .insert({
        trip_id: tripId,
        user_id: userId,
        display_name: displayName,
        text: caption,
        image_path: path,
      })
      .select("id")
      .single();
    if (error) throw error;
    return inserted?.id || null;
  }

  async function sendPhotos(assets) {
    if (assets.length === 0) return;

    // Текстът от полето става подпис — но само на първата снимка. Иначе един и
    // същи ред се повтаря под всяка и чатът заприличва на заяждаща плоча.
    const caption = text.trim();
    setSendingPhoto(true);
    setText("");

    let lastId = null;
    let failed = 0;

    try {
      for (let i = 0; i < assets.length; i += 1) {
        setPhotoProgress(assets.length > 1 ? `${i + 1}/${assets.length}` : "");
        try {
          const id = await uploadOnePhoto(assets[i], i === 0 ? caption : "");
          if (id) lastId = id;
        } catch {
          // Една провалена снимка не бива да спира останалите — на слаба мрежа
          // това е разликата между „нищо не тръгна" и „едната не мина".
          failed += 1;
        }
      }

      // Едно известие за целия избор, не по едно на снимка.
      if (lastId) {
        supabase.functions
          .invoke("send-chat-push", { body: { messageId: lastId } })
          .catch(() => {});
      }

      if (failed > 0) {
        if (!lastId) setText(caption);
        Alert.alert(
          "Не всички снимки тръгнаха",
          failed === assets.length
            ? "Нито една не се изпрати. Провери мрежата."
            : `${failed} от ${assets.length} не се изпратиха.`
        );
      }
    } finally {
      setSendingPhoto(false);
      setPhotoProgress("");
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setText("");
    try {
      const { data: inserted } = await supabase
        .from("messages")
        .insert({
          trip_id: tripId,
          user_id: userId,
          display_name: displayName,
          text: trimmed,
        })
        .select("id")
        .single();

      // Известието тръгва след като съобщението е записано и нарочно без
      // await — ако функцията се забави или се провали, съобщението вече е в
      // чата. Известието е удобство, не част от изпращането.
      if (inserted?.id) {
        supabase.functions
          .invoke("send-chat-push", { body: { messageId: inserted.id } })
          .catch(() => {});
      }
    } catch (e) {
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }

  // Задържането отваря собствен прозорец, а не Alert: Android показва най-много
  // три бутона в Alert, а действията вече са повече. И се отваря за всяко
  // съобщение, не само за свое — запазването на снимка е точно за чуждите.
  function handleLongPress(msg) {
    const isMine = msg.user_id === userId;
    const hasPhoto = !!msg.image_path;
    if (!isMine && !hasPhoto) return;
    setMsgActions(msg);
  }

  async function handleSavePhoto(msg) {
    setMsgActions(null);
    await savePhotoFrom(msg);
  }

  async function handleDelete(msg) {
    Alert.alert("Изтриване", "Сигурен ли си?", [
      { text: "Отказ", style: "cancel" },
      {
        text: "Изтрий", style: "destructive",
        onPress: async () => {
          try {
            await supabase.from("messages").delete().eq("id", msg.id).eq("user_id", userId);
            // Редът си отива, файлът остава да заема място — затова и него.
            if (msg.image_path) {
              await supabase.storage.from("documents").remove([msg.image_path]).catch(() => {});
            }
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          } catch (e) {
            Alert.alert("Грешка", e.message);
          }
        }
      }
    ]);
  }

  function cancelEdit() {
    setEditingMsg(null);
    setEditText("");
  }

  async function handleSaveEdit() {
    const trimmed = editText.trim();
    if (!trimmed) return;
    try {
      await supabase.from("messages")
        .update({ text: trimmed, updated_at: new Date().toISOString() })
        .eq("id", editingMsg.id)
        .eq("user_id", userId);
      setMessages((prev) => prev.map((m) =>
        m.id === editingMsg.id ? { ...m, text: trimmed, updated_at: new Date().toISOString() } : m
      ));
    } catch (e) {
      Alert.alert("Грешка", e.message);
    } finally {
      setEditingMsg(null);
      setEditText("");
    }
  }

  const myMessages = messages.filter((m) => m.user_id === userId);
  const lastMyMsgId = myMessages.length > 0 ? myMessages[myMessages.length - 1].id : null;

  function getReadStatus(msgId, createdAt) {
    if (msgId !== lastMyMsgId) return null;
    if (memberReads.length === 0) return "delivered";
    const allRead = memberReads.every(
      (m) => m.chat_last_read && new Date(m.chat_last_read) >= new Date(createdAt)
    );
    return allRead ? "read" : "delivered";
  }

  // Прочитането се пази като момент, не като списък: chat_last_read на
  // участника. Съобщение е прочетено от него, ако е било написано преди този
  // момент. Затова „прочел" не значи, че го е погледнал — значи, че е бил в
  // чата след него.
  function readersFor(msg) {
    const at = new Date(msg.created_at).getTime();
    const read = [];
    const pending = [];
    memberReads.forEach((m) => {
      const name = m.display_name || "Участник";
      if (m.chat_last_read && new Date(m.chat_last_read).getTime() >= at) read.push(name);
      else pending.push(name);
    });
    return { read, pending };
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Днес";
    if (d.toDateString() === yesterday.toDateString()) return "Вчера";
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  }

  // Две различни разстояния нарочно: списъкът се влачи надолу сам само ако
  // сме почти долу, а бутонът се появява доста по-късно — иначе би мигал при
  // всяко леко превъртане.
  function handleScroll(e) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    atBottom.current = fromBottom < 120;
    setShowJump(fromBottom > 400);
  }

  function jumpToLatest() {
    atBottom.current = true;
    setShowJump(false);
    flatRef.current?.scrollToEnd({ animated: true });
  }

  // Тапването не звъни само. Показва избор, защото най-често човек иска или
  // да набере, или да запише номера — а случайно позвъняване е неприятно.
  function handlePhone(phone) {
    Alert.alert(phone, undefined, [
      {
        text: "📞 Обади се",
        onPress: () => { Linking.openURL(`tel:${phone}`).catch(() => {}); },
      },
      {
        text: "📋 Копирай",
        onPress: async () => {
          try {
            const Clipboard = require("expo-clipboard");
            await Clipboard.setStringAsync(phone);
          } catch {
            // Няма модула в този билд — тихо пропускаме.
          }
        },
      },
      { text: "Отказ", style: "cancel" },
    ]);
  }

  async function openLink(url) {
    try {
      if (MAP_URL.test(url)) {
        await Linking.openURL(url);
        return;
      }
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
        // Билдът няма нативния модул — минаваме към системния браузър.
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Не мога да отворя линка", url);
    }
  }

  // Дългото натискане върху линк трябва да отваря същото меню като върху
  // останалата част от балона — иначе редакцията и изтриването изчезват за
  // съобщения, които са само линк.
  function renderMessageText(item, isMe) {
    const parts = splitMessage(item.text);
    const textStyle = [styles.msgText, isMe && styles.msgTextMe];

    if (parts.length === 1 && !parts[0].url && !parts[0].phone) {
      return <Text style={textStyle}>{item.text}</Text>;
    }

    return (
      <Text style={textStyle}>
        {parts.map((part, i) => {
          if (part.url) {
            return (
              <Text
                key={`l${i}`}
                style={[styles.link, isMe && styles.linkMe]}
                onPress={() => openLink(part.url)}
                onLongPress={() => handleLongPress(item)}
              >
                {part.text}
              </Text>
            );
          }
          if (part.phone) {
            return (
              <Text
                key={`p${i}`}
                style={[styles.link, isMe && styles.linkMe]}
                onPress={() => handlePhone(part.phone)}
                onLongPress={() => handleLongPress(item)}
              >
                {part.text}
              </Text>
            );
          }
          return part.text;
        })}
      </Text>
    );
  }

  // Търси и в текста, и в името на изпращача — „какво писа Иван" е също толкова
  // честo, колкото „къде беше линкът". Малки/главни букви не значат нищо.
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? messages.filter((m) =>
        `${m.text || ""} ${m.display_name || ""}`.toLowerCase().includes(needle)
      )
    : messages;

  // Пълният списък се строи винаги — от него се вади и мястото, до което скачаме
  // след търсене. Филтрирането после е само отсяване на редове.
  const groupedAll = [];
  let lastDate = null;
  messages.forEach((msg) => {
    const d = new Date(msg.created_at).toDateString();
    if (d !== lastDate) {
      groupedAll.push({ type: "date", date: msg.created_at, key: `date-${msg.created_at}` });
      lastDate = d;
    }
    groupedAll.push({ type: "msg", ...msg, key: msg.id });
  });

  const matchIds = new Set(visible.map((m) => m.id));
  const grouped = needle
    ? groupedAll.filter((item) => item.type === "msg" && matchIds.has(item.id))
    : groupedAll;

  // От резултат обратно в разговора. Затваряме търсенето, изчакваме списъкът да
  // се пресъздаде в пълния си вид и чак тогава скачаме — иначе индексът сочи
  // ред, който още не съществува.
  function jumpToMessage(msg) {
    const index = groupedAll.findIndex((item) => item.key === msg.id);
    if (index < 0) return;

    jumping.current = true;
    setSearching(false);
    setQuery("");
    setHighlightId(msg.id);

    setTimeout(() => {
      flatRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    }, 60);

    // Светенето е кратко: достатъчно да го намериш с око, не толкова, че да
    // остане да виси на екрана.
    setTimeout(() => {
      setHighlightId(null);
      jumping.current = false;
    }, 1800);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <View style={styles.headerTitleRow}>
            <MessageSquare size={24} color={colors.brand600} strokeWidth={1.75} />
            <Text style={styles.headerTitle}>Чат</Text>
          </View>
          <Text style={styles.headerSub}>{tripName}</Text>
        </View>
        <TouchableOpacity
          style={styles.searchBtn}
          onPress={() => {
            // Затварянето изчиства търсенето — иначе човек се връща в чат, в
            // който липсват съобщения, и не помни защо.
            setSearching((open) => !open);
            setQuery("");
          }}
        >
          <Text style={styles.searchIcon}>{searching ? "✕" : "🔍"}</Text>
        </TouchableOpacity>
      </View>

      {searching && (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Търси в чата"
            placeholderTextColor={colors.text400}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity style={styles.clearBtn} onPress={() => setQuery("")}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
          {!!needle && (
            <Text style={styles.searchCount}>
              {visible.length === 0 ? "няма" : `${visible.length}`}
            </Text>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand600} />
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={grouped}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          onScroll={handleScroll}
          scrollEventThrottle={64}
          // Редовете са различни по височина, затова точният скок понякога не
          // успява от раз. Тогава отиваме приблизително и опитваме пак — вторият
          // път списъкът вече е измерил дотам.
          onScrollToIndexFailed={(info) => {
            flatRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(() => {
              flatRef.current?.scrollToIndex({
                index: info.index, animated: false, viewPosition: 0.5,
              });
            }, 80);
          }}
          // Ново съобщение сваля списъка надолу само ако човекът вече е долу.
          // Иначе четенето на стар разговор се прекъсваше от всяко пристигащо
          // съобщение — екранът просто отскачаше.
          onContentSizeChange={() => {
            // При търсене списъкът се сменя изцяло; сваляне надолу тогава значи
            // да гледаш последния резултат вместо първия.
            if (atBottom.current && !needle && !jumping.current) {
              flatRef.current?.scrollToEnd({ animated: false });
            }
          }}
          renderItem={({ item }) => {
            if (item.type === "date") {
              return (
                <View style={styles.dateSep}>
                  <Text style={styles.dateText}>{formatDate(item.date)}</Text>
                </View>
              );
            }
            const isMe = item.user_id === userId;
            const readStatus = isMe ? getReadStatus(item.id, item.created_at) : null;

            return (
              <View style={[styles.msgWrapper, isMe && styles.msgWrapperMe]}>
                <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
                  {!isMe && (
                    <View style={[styles.avatar, { backgroundColor: avatarColor(item.user_id) }]}>
                      <Text style={styles.avatarText}>
                        {(item.display_name || "?")[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <TouchableWithoutFeedback
                    onLongPress={() => handleLongPress(item)}
                    onPress={needle ? () => jumpToMessage(item) : undefined}
                  >
                    <View style={[
                      styles.bubble,
                      isMe && styles.bubbleMe,
                      highlightId === item.id && styles.bubbleFound,
                    ]}>
                      {!isMe && <Text style={styles.senderName}>{item.display_name}</Text>}
                      {item.plan_id ? (
                        // Споделен AI план — карта с бутон към Планера, не целия
                        // текст на плана (иначе чатът се задръства при дълъг план).
                        <View style={styles.planCard}>
                          {renderMessageText(item, isMe)}
                          <TouchableOpacity
                            style={[styles.planCardBtn, isMe && styles.planCardBtnMe]}
                            onPress={() => onOpenPlan && onOpenPlan(item.plan_id)}
                          >
                            <Text style={[styles.planCardBtnText, isMe && styles.planCardBtnTextMe]}>🗺 Отвори плана →</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <>
                          {item.image_path && (
                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() => photoUrls[item.image_path] && openPhoto(item)}
                              onLongPress={() => handleLongPress(item)}
                            >
                              {photoUrls[item.image_path] ? (
                                <Image
                                  source={{ uri: photoUrls[item.image_path] }}
                                  style={styles.msgImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={[styles.msgImage, styles.msgImageLoading]}>
                                  <ActivityIndicator color={colors.text400} />
                                </View>
                              )}
                            </TouchableOpacity>
                          )}
                          {!!item.text && renderMessageText(item, isMe)}
                        </>
                      )}
                      <View style={styles.timeLine}>
                        <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>
                          {formatTime(item.created_at)}
                          {item.updated_at ? " · редактирано" : ""}
                        </Text>
                      </View>
                    </View>
                  </TouchableWithoutFeedback>
                </View>
                {readStatus && (
                  <TouchableOpacity
                    style={styles.tickRow}
                    onPress={() => setReadInfo(item)}
                    activeOpacity={0.6}
                  >
                    <Text style={readStatus === "read" ? styles.tickRead : styles.tickDelivered}>
                      {readStatus === "read" ? "✓✓ Прочетено" : "✓✓ Доставено"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>{needle ? "🔍" : "💬"}</Text>
              <Text style={styles.emptyText}>
                {needle
                  ? `Нищо не намерих за „${query.trim()}".`
                  : `Няма съобщения още.\nБъди първият!`}
              </Text>
            </View>
          }
        />
      )}

      {showJump && !editingMsg && (
        <TouchableOpacity
          style={[styles.jumpBtn, { bottom: insets.bottom + 76 }]}
          onPress={jumpToLatest}
          activeOpacity={0.85}
          accessibilityLabel="Към последното съобщение"
        >
          <Text style={styles.jumpBtnIcon}>↓</Text>
        </TouchableOpacity>
      )}

      {editingMsg ? (
        <View style={[styles.editBar, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.editBarTop}>
            <Text style={styles.editBarLabel}>✏️ Редактиране</Text>
            <TouchableOpacity onPress={cancelEdit}>
              <Text style={styles.editBarCancel}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.editBarRow}>
            <TextInput
              ref={editInputRef}
              style={styles.editBarInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              maxLength={500}
              placeholderTextColor={colors.text400}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !editText.trim() && styles.sendBtnDisabled]}
              onPress={handleSaveEdit}
              disabled={!editText.trim()}
            >
              <Text style={styles.sendIcon}>✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={handlePhoto}
            disabled={sendingPhoto}
          >
            <Text style={[styles.photoIcon, sendingPhoto && styles.photoIconBusy]}>
              {sendingPhoto ? (photoProgress || "…") : "📷"}
            </Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Напиши съобщение..."
            placeholderTextColor={colors.text400}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            <Text style={styles.sendIcon}>{sending ? "..." : "➤"}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Modal visible={photoMenu} animationType="fade" transparent onRequestClose={() => setPhotoMenu(false)}>
        <TouchableWithoutFeedback onPress={() => setPhotoMenu(false)}>
          <View style={styles.readOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.actionSheet}>
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => { setPhotoMenu(false); pickPhoto("camera"); }}
                >
                  <Text style={styles.actionText}>📷 Снимай</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => { setPhotoMenu(false); pickPhoto("library"); }}
                >
                  <Text style={styles.actionText}>🖼 От галерията</Text>
                </TouchableOpacity>

                {/* Не затваря менюто — сменяш и виждаш новото, преди да избереш. */}
                <TouchableOpacity style={[styles.actionRow, styles.actionQuality]} onPress={switchQuality}>
                  <Text style={styles.actionQualityText}>
                    Качество: {PHOTO_PRESETS[photoQuality]?.label || "Обикновено"}
                  </Text>
                  <Text style={styles.actionQualityHint}>
                    {photoQuality === "high"
                      ? "по-едри файлове, за снимки, които ще пазиш"
                      : "по-малки файлове, достатъчно за екран"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionRow} onPress={() => setPhotoMenu(false)}>
                  <Text style={[styles.actionText, styles.actionCancel]}>Отказ</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={!!msgActions} animationType="fade" transparent onRequestClose={() => setMsgActions(null)}>
        <TouchableWithoutFeedback onPress={() => setMsgActions(null)}>
          <View style={styles.readOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.actionSheet}>
                {msgActions?.image_path && (
                  savedPhotos.includes(msgActions.image_path) ? (
                    <View style={styles.actionRow}>
                      <Text style={[styles.actionText, styles.actionDone]}>
                        ✓ Вече е в галерията ти
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => handleSavePhoto(msgActions)}
                      disabled={savingPhoto}
                    >
                      <Text style={styles.actionText}>
                        {savingPhoto ? "Записвам…" : "⬇️ Запази в галерията"}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
                {msgActions?.user_id === userId && (
                  <>
                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => { const m = msgActions; setMsgActions(null); setReadInfo(m); }}
                    >
                      <Text style={styles.actionText}>👁 Кой е прочел</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => {
                        const m = msgActions;
                        setMsgActions(null);
                        setEditingMsg(m);
                        setEditText(m.text);
                      }}
                    >
                      <Text style={styles.actionText}>
                        {msgActions?.image_path ? "✏️ Редактирай подписа" : "✏️ Редактирай"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => { const m = msgActions; setMsgActions(null); handleDelete(m); }}
                    >
                      <Text style={[styles.actionText, styles.actionDanger]}>🗑 Изтрий</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.actionRow} onPress={() => setMsgActions(null)}>
                  <Text style={[styles.actionText, styles.actionCancel]}>Отказ</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={photoIndex != null}
        animationType="fade"
        onRequestClose={() => setPhotoIndex(null)}
      >
        <View style={styles.photoFull}>
          <FlatList
            data={photoList}
            horizontal
            pagingEnabled
            scrollEnabled={!photoZoomed}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            initialScrollIndex={photoIndex || 0}
            getItemLayout={(_d, index) => ({
              length: windowWidth, offset: windowWidth * index, index,
            })}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
              if (next !== photoIndex) {
                setPhotoZoomed(false);
                setPhotoIndex(next);
              }
            }}
            renderItem={({ item }) => (
              <View style={{ width: windowWidth }}>
                <ZoomableImage uri={photoUrls[item.image_path]} onZoomChange={setPhotoZoomed} />
              </View>
            )}
          />

          {/* Броячът е само надпис — нищо за натискане горе, където системните
              жестове на iPhone спорят с нас. */}
          {photoList.length > 1 && (
            <View
              style={[styles.photoTop, { paddingTop: Math.max(insets.top, 28) + space.xs }]}
              pointerEvents="none"
            >
              <Text style={styles.photoCloseText}>
                {(photoIndex || 0) + 1} / {photoList.length}
              </Text>
            </View>
          )}

          {/* Всичко за натискане е долу: там няма изрез, няма статуслента и
              няма системен жест, който да отнеме допира. */}
          <View style={[styles.photoBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity
              style={styles.photoBarBtn}
              onPress={() => setPhotoIndex(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.photoCloseText}>✕ Затвори</Text>
            </TouchableOpacity>

            {canSaveToGallery() && currentPhoto && (
              savedPhotos.includes(currentPhoto.image_path) ? (
                <View style={styles.photoBarBtn}>
                  <Text style={[styles.photoCloseText, styles.photoSavedText]}>
                    ✓ В галерията ти
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.photoBarBtn}
                  onPress={() => savePhotoFrom(currentPhoto)}
                  disabled={savingPhoto}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.photoCloseText}>
                    {savingPhoto ? "Записвам…" : "⬇️ Запази"}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!readInfo} animationType="fade" transparent onRequestClose={() => setReadInfo(null)}>
        <TouchableWithoutFeedback onPress={() => setReadInfo(null)}>
          <View style={styles.readOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.readSheet}>
                <Text style={styles.readTitle}>Кой е прочел</Text>
                {readInfo && (
                  <>
                    <Text style={styles.readQuote} numberOfLines={2}>„{readInfo.text}"</Text>
                    {(() => {
                      const { read, pending } = readersFor(readInfo);
                      return (
                        <>
                          <Text style={styles.readGroupLabel}>
                            ✓✓ Прочели ({read.length})
                          </Text>
                          {read.length === 0
                            ? <Text style={styles.readEmpty}>Още никой</Text>
                            : read.map((n) => <Text key={`r-${n}`} style={styles.readName}>{n}</Text>)}

                          <Text style={styles.readGroupLabel}>
                            Още не ({pending.length})
                          </Text>
                          {pending.length === 0
                            ? <Text style={styles.readEmpty}>Никой не остана</Text>
                            : pending.map((n) => <Text key={`p-${n}`} style={styles.readNamePending}>{n}</Text>)}
                        </>
                      );
                    })()}
                    <Text style={styles.readNote}>
                      „Прочел" значи, че човекът е отварял чата след това съобщение.
                    </Text>
                  </>
                )}
                <TouchableOpacity style={styles.readClose} onPress={() => setReadInfo(null)}>
                  <Text style={styles.readCloseText}>Затвори</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface, paddingBottom: space.md,
    paddingHorizontal: space.lg, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { marginRight: space.md },
  backText: { ...type.body, color: colors.brand600 },
  headerInfo: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerTitle: { ...type.subhead, fontWeight: "bold", color: colors.text900, fontFamily: "GolosText_700Bold" },
  headerSub: { fontSize: 12, lineHeight: 16, color: colors.text600, marginTop: space.xs },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: space.lg, paddingBottom: space.sm },
  dateSep: { alignItems: "center", marginVertical: space.md },
  dateText: {
    fontSize: 12, lineHeight: 16, color: colors.text600, backgroundColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.control,
  },
  msgWrapper: { marginBottom: space.sm },
  msgWrapperMe: { alignItems: "flex-end" },
  msgRow: { flexDirection: "row", alignItems: "flex-end" },
  msgRowMe: { flexDirection: "row-reverse" },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: AVATAR_COLORS[0], alignItems: "center", justifyContent: "center",
    marginRight: space.sm,
  },
  avatarText: { ...type.label, fontWeight: "bold", color: colors.onBrand, fontFamily: "GolosText_700Bold" },
  bubble: {
    maxWidth: "75%", backgroundColor: colors.surface,
    borderRadius: radius.card, borderBottomLeftRadius: 4,
    padding: space.md, paddingBottom: space.sm,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  // Кратко просветване след скок от търсенето.
  bubbleFound: { borderWidth: 2, borderColor: colors.brand600 },
  bubbleMe: {
    backgroundColor: colors.brand600,
    borderBottomLeftRadius: radius.card, borderBottomRightRadius: 4,
    marginLeft: space.sm,
  },
  senderName: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.brand600, marginBottom: space.xs },
  planCard: { gap: space.xs },
  planCardBtn: {
    marginTop: space.xs, alignSelf: "flex-start",
    backgroundColor: colors.bg, borderRadius: radius.control,
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  planCardBtnMe: { backgroundColor: "rgba(255,255,255,0.2)" },
  planCardBtnText: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.brand600 },
  planCardBtnTextMe: { color: colors.onBrand },
  msgText: { ...type.body, color: colors.text900 },
  msgImage: {
    width: 220, height: 220, borderRadius: radius.control,
    marginBottom: space.xs, backgroundColor: colors.border,
  },
  msgImageLoading: { alignItems: "center", justifyContent: "center" },
  photoBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", marginRight: space.xs,
  },
  photoIcon: { fontSize: 22 },
  searchBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  searchIcon: { fontSize: 20 },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: space.sm,
    paddingHorizontal: space.lg, paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  searchInput: {
    flex: 1, backgroundColor: colors.surface,
    borderRadius: radius.control, borderWidth: 0.5, borderColor: colors.border,
    paddingVertical: space.sm, paddingHorizontal: space.md,
    fontSize: 15, color: colors.text900,
  },
  searchCount: { ...type.label, color: colors.text400, minWidth: 36, textAlign: "right" },
  photoIconBusy: { fontSize: 13, fontWeight: "700", color: colors.text600 },
  photoFull: { flex: 1, backgroundColor: "#000" },
  actionSheet: {
    backgroundColor: colors.bg, borderRadius: radius.card,
    paddingVertical: space.sm, width: "100%", maxWidth: 420,
  },
  actionRow: { paddingVertical: space.lg, paddingHorizontal: space.xl },
  actionText: { ...type.body, color: colors.text900 },
  actionDanger: { color: "#D64545" },
  actionCancel: { color: colors.text400 },
  actionQuality: {
    borderTopWidth: 0.5, borderTopColor: colors.border,
    marginTop: space.sm, paddingTop: space.lg,
  },
  actionQualityText: { ...type.body, color: colors.brand600, fontWeight: "600" },
  actionQualityHint: { ...type.label, color: colors.text400, marginTop: 2 },
  photoCloseText: { ...type.label, color: "#FFFFFF" },
  photoTop: {
    position: "absolute", top: 0, left: 0, right: 0,
    alignItems: "center", paddingBottom: space.sm,
  },
  photoBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: space.lg, paddingTop: space.md,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  photoBarBtn: { paddingVertical: space.md, paddingHorizontal: space.md },
  photoSavedText: { color: "#8FD3C0" },
  clearBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  clearIcon: { fontSize: 15, color: colors.text400 },
  actionDone: { color: colors.brand600 },
  msgTextMe: { color: colors.onBrand },
  jumpBtn: {
    position: "absolute", right: space.lg,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brand600,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  jumpBtnIcon: { color: colors.onBrand, fontSize: 22, lineHeight: 26, fontWeight: "700" },
  link: { color: colors.brand600, textDecorationLine: "underline" },
  linkMe: { color: colors.onBrand, textDecorationLine: "underline", fontWeight: "600" },
  timeLine: { flexDirection: "row", justifyContent: "flex-end", marginTop: space.xs },
  msgTime: { fontSize: 12, lineHeight: 16, color: colors.text400 },
  msgTimeMe: { color: colors.onBrandMuted },
  tickRow: { marginTop: space.xs, marginRight: space.xs },
  readOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", padding: space.lg,
  },
  readSheet: {
    width: "100%", maxWidth: 380, backgroundColor: colors.surface,
    borderRadius: radius.card, padding: space.lg,
  },
  readTitle: { ...type.subhead, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.text900 },
  readQuote: { ...type.body, color: colors.text600, fontStyle: "italic", marginTop: space.xs },
  readGroupLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.text600,
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: space.md,
  },
  readName: { ...type.body, color: colors.text900, marginTop: space.xs },
  readNamePending: { ...type.body, color: colors.text400, marginTop: space.xs },
  readEmpty: { ...type.body, color: colors.text400, fontStyle: "italic", marginTop: space.xs },
  readNote: { fontSize: 12, lineHeight: 16, color: colors.text400, marginTop: space.md },
  readClose: {
    marginTop: space.lg, backgroundColor: colors.brand600,
    borderRadius: radius.control, padding: space.md, alignItems: "center",
  },
  readCloseText: { ...type.label, fontWeight: "700", fontFamily: "GolosText_700Bold", color: colors.onBrand },
  tickRead: { fontSize: 12, lineHeight: 16, color: colors.brand600, fontWeight: "600" },
  tickDelivered: { fontSize: 12, lineHeight: 16, color: colors.text400, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: space.xxxl },
  emptyEmoji: { fontSize: 48, marginBottom: space.md },
  emptyText: { ...type.label, color: colors.text400, textAlign: "center" },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end",
    backgroundColor: colors.surface, paddingTop: space.md, paddingHorizontal: space.lg,
    borderTopWidth: 0.5, borderTopColor: colors.border,
  },
  input: {
    ...type.body,
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    color: colors.text900, maxHeight: 100, marginRight: space.md,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.brand600, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#ccc" },
  sendIcon: { color: colors.onBrand, fontSize: 16, marginLeft: space.xs },
  editBar: {
    backgroundColor: colors.surface, borderTopWidth: 0.5, borderTopColor: colors.border,
    paddingHorizontal: space.lg, paddingTop: space.sm,
  },
  editBarTop: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: space.sm,
  },
  editBarLabel: { fontSize: 12, lineHeight: 16, color: colors.brand600, fontWeight: "600" },
  editBarCancel: { fontSize: 18, color: colors.text400, padding: space.xs },
  editBarRow: { flexDirection: "row", alignItems: "flex-end" },
  editBarInput: {
    ...type.body,
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    color: colors.text900, maxHeight: 100, marginRight: space.md,
    borderWidth: 1.5, borderColor: colors.brand600,
  },
});
