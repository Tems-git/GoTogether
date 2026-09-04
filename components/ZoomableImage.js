import { useRef, useState } from "react";
import {
  View, Animated, PanResponder, StyleSheet, ActivityIndicator,
} from "react-native";

// Увеличаване с два пръста, местене с един и двойно тапване за бързо
// приближаване. Написано на PanResponder и Animated, тоест само с това, което
// React Native носи — библиотека за жестове би значела нов нативен билд, а
// така поправката пътува като обикновен ъпдейт.
//
// Живее тук, а не в екрана на документите, защото същото гледане на снимка
// трябва и в чата. Един компонент, две места.
//
// Важното при жестовете: ВСИЧКО минава през един PanResponder — щипката,
// местенето и тапването. Двете системи за допир (Touchable за тапването и
// PanResponder за останалото) не се договарят надеждно върху един и същи
// елемент; обвивката налага своите handler-и и щипката мълчи.
//
// Прелистването между снимките в чата продължава да работи, защото
// onPanResponderTerminationRequest отстъпва жеста, докато снимката е в
// естествен размер. При увеличена снимка не отстъпваме — иначе местенето би
// избягало в прелистване.

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

export default function ZoomableImage({ uri, placeholderUri, onZoomChange, onSingleTap }) {
  // Докато голямата снимка се тегли, показваме умаленото копие — то вече е в
  // паметта от списъка. Без подложка няма какво да чакаме и рисуваме веднага.
  const [ready, setReady] = useState(!placeholderUri);
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
  const wasZoomed = useRef(false);

  // Родителят трябва да знае кога да спре прелистването — но само при промяна,
  // не при всяко движение на пръста.
  function reportZoom() {
    const zoomed = cur.current.scale > 1.01;
    if (zoomed !== wasZoomed.current) {
      wasZoomed.current = zoomed;
      onZoomChange && onZoomChange(zoomed);
    }
  }

  // Границите на местенето: колкото по-увеличена е снимката, толкова повече
  // има какво да се покаже извън екрана.
  function limit(value, size, s) {
    const max = Math.max(0, (size * (s - 1)) / 2);
    return clamp(value, -max, max);
  }

  function animateTo(nextScale, x = 0, y = 0) {
    cur.current = { scale: nextScale, x, y };
    pan.current = { x, y };
    reportZoom();
    Animated.parallel([
      Animated.timing(scale, { toValue: nextScale, duration: 180, useNativeDriver: true }),
      Animated.timing(tx, { toValue: x, duration: 180, useNativeDriver: true }),
      Animated.timing(ty, { toValue: y, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  // Единично и двойно тапване се различават само по чакане: второто тапване
  // отменя вече насроченото единично.
  const singleTapTimer = useRef(null);

  function handleTap() {
    const now = Date.now();

    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      if (cur.current.scale > 1.05) animateTo(1);
      else animateTo(DOUBLE_TAP_ZOOM);
      return;
    }

    lastTap.current = now;

    // Единичното действие има смисъл само при неувеличена снимка — иначе
    // тапването докато разглеждаш отблизо би я затворило под пръста ти.
    if (!onSingleTap) return;
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      if (cur.current.scale <= 1.05) onSingleTap();
    }, DOUBLE_TAP_MS + 20);
  }

  // Докосване, което не е мръднало и не е траяло дълго, е тапване.
  const touchStart = useRef({ at: 0, moved: false });
  const TAP_SLOP = 8;
  const TAP_MS = 300;

  const responder = useRef(
    PanResponder.create({
      // Поемаме жеста още при докосване — това е единственият начин да получим
      // и вдигането на пръста, а без него тапването не се разпознава.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        touchStart.current = { at: Date.now(), moved: false };
        pinch.current = { active: false, dist: 0, scale: cur.current.scale };
        pan.current = { x: cur.current.x, y: cur.current.y };
      },

      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        const size = box.current;

        if (Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP) {
          touchStart.current.moved = true;
        }

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
          reportZoom();
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

        // Нищо не се е преместило и е било кратко — значи е тапване, а не жест.
        const { at, moved } = touchStart.current;
        if (!moved && Date.now() - at < TAP_MS) {
          handleTap();
          return;
        }

        if (cur.current.scale <= 1.02) animateTo(1);
        else reportZoom();
      },
      onPanResponderTerminate: () => {
        pinch.current.active = false;
        pan.current = { x: cur.current.x, y: cur.current.y };
      },
      // Докато снимката е в естествен размер, отстъпваме жеста на лентата със
      // снимки — тогава хоризонталното плъзгане значи прелистване. При
      // увеличена снимка не отстъпваме, иначе местенето би избягало.
      onPanResponderTerminationRequest: () => cur.current.scale <= 1.01,
    })
  ).current;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => { box.current = e.nativeEvent.layout; }}
      {...responder.panHandlers}
    >
        {placeholderUri && !ready && (
          <>
            <Animated.Image
              source={{ uri: placeholderUri }}
              resizeMode="contain"
              blurRadius={2}
              style={[
                styles.imageUnder,
                { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
              ]}
            />
            <View style={styles.spinner} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" />
            </View>
          </>
        )}
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          onLoad={() => setReady(true)}
          style={[
            styles.image,
            !ready && styles.hidden,
            { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
          ]}
        />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: "100%", overflow: "hidden" },
  // Голямата снимка стои в потока — от нейното измерване зависят границите на
  // местенето и попадането на допира. Не я вадѝ оттам заради разкрасяване.
  image: { flex: 1, width: "100%" },
  // Подложката е временна и нищо не зависи от размера ѝ, затова тя се наслагва.
  imageUnder: { ...StyleSheet.absoluteFillObject },
  hidden: { opacity: 0 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
