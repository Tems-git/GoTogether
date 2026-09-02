import { useRef } from "react";
import { View, Animated, PanResponder, TouchableWithoutFeedback, StyleSheet } from "react-native";

// Увеличаване с два пръста, местене с един и двойно тапване за бързо
// приближаване. Написано на PanResponder и Animated, тоест само с това, което
// React Native носи — библиотека за жестове би значела нов нативен билд, а
// така поправката пътува като обикновен ъпдейт.
//
// Живее тук, а не в екрана на документите, защото същото гледане на снимка
// трябва и в чата. Един компонент, две места.
//
// Важното при жестовете: докато снимката е в естествен размер, компонентът НЕ
// поема допира. Иначе прелистването между снимките в чата никога не би тръгнало
// — родителският списък не може да скролира, ако дете е взело жеста. Затова
// двойното тапване е на отделен touchable, а PanResponder се събужда само при
// два пръста или когато вече сме увеличили.

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

export default function ZoomableImage({ uri, onZoomChange }) {
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

  function handleTap() {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (cur.current.scale > 1.05) animateTo(1);
      else animateTo(DOUBLE_TAP_ZOOM);
      return;
    }
    lastTap.current = now;
  }

  const responder = useRef(
    PanResponder.create({
      // При допир не поемаме нищо — иначе списъкът отгоре не може да прелиства.
      onStartShouldSetPanResponder: () => false,

      // Събуждаме се само при щипка с два пръста или когато вече е увеличено.
      onMoveShouldSetPanResponder: (_e, g) => {
        if (g.numberActiveTouches === 2) return true;
        if (cur.current.scale <= 1.01) return false;
        return Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2;
      },

      onPanResponderGrant: () => {
        pinch.current = { active: false, dist: 0, scale: cur.current.scale };
        pan.current = { x: cur.current.x, y: cur.current.y };
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
        if (cur.current.scale <= 1.02) animateTo(1);
        else reportZoom();
      },
      onPanResponderTerminate: () => {
        pinch.current.active = false;
        pan.current = { x: cur.current.x, y: cur.current.y };
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <View
        style={styles.wrap}
        onLayout={(e) => { box.current = e.nativeEvent.layout; }}
        {...responder.panHandlers}
      >
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={[
            styles.image,
            { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
          ]}
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: "100%", overflow: "hidden" },
  image: { flex: 1, width: "100%" },
});
