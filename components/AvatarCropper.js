// Изрязване на снимката за кръгчето.
//
// Системното изрязване го махнахме: на Android потвърждението е иконка, която
// не се разпознава като бутон, и човек стои пред екрана без какво да натисне.
//
// Първият опит имаше само влачене, при мащаб „по-късата страна запълва
// квадрата". При изправена снимка ширината точно се побира — тоест наляво и
// надясно няма накъде да се мърда, колкото и да дърпаш. Затова има и
// приближаване: щом снимката стане по-голяма от квадрата и по двете страни,
// местенето работи и в двете посоки.
//
// Жестовете минават през ЕДИН PanResponder — два пръста значат приближаване,
// един значи местене. Две системи за допир върху един елемент не се
// договарят; това го платихме веднъж при разглеждането на снимки и бележката
// стои и там.
//
// Сметките, понеже мащабът вече не е един:
//     основа   = страна на квадрата / по-късата страна на снимката
//     мащаб    = основа × приближение
//     изрязано = квадрат ÷ мащаб      (в пиксели на оригинала)
//     начало   = -отместване ÷ мащаб

import { useRef, useState } from "react";
import {
  StyleSheet, View, Text, Image, TouchableOpacity,
  PanResponder, useWindowDimensions,
} from "react-native";
import { colors, space, radius, type } from "../theme/tokens";

// Над четири пъти няма какво да се види — снимката свършва като разделителна
// способност, а и лице, увеличено повече, вече не е портрет.
const MAX_ZOOM = 4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export default function AvatarCropper({ asset, busy, onCancel, onDone }) {
  const { width: screenW } = useWindowDimensions();
  // Квадратът е колкото екрана без полетата, но не безкраен на таблет.
  const side = Math.min(screenW - space.xl * 2, 320);

  const srcW = asset?.width || 1;
  const srcH = asset?.height || 1;
  const base = side / Math.min(srcW, srcH);

  // Начално положение: снимката е центрирана в квадрата. По късата страна
  // отместването излиза нула, по дългата — половината от това, което стърчи.
  const startView = {
    zoom: 1,
    x: Math.min(0, (side - srcW * base) / 2),
    y: Math.min(0, (side - srcH * base) / 2),
  };

  // Числено копие на състоянието: по време на жест трябва да четем синхронно.
  const cur = useRef(startView);
  const [view, setView] = useState(startView);
  const pinch = useRef({ active: false, dist: 0, zoom: 1 });
  const startPan = useRef({ x: startView.x, y: startView.y });

  function sizesAt(zoom) {
    return { w: srcW * base * zoom, h: srcH * base * zoom };
  }

  // Отместването е между „долният/десният край опира в квадрата" и нула.
  function limit(value, span) {
    return clamp(value, Math.min(0, side - span), 0);
  }

  function apply(next) {
    cur.current = next;
    setView(next);
  }

  // Центърът остава на място при приближаване — иначе снимката бяга изпод
  // пръстите и наместването започва отначало.
  function rescale(nextZoom) {
    const k = nextZoom / cur.current.zoom;
    const mid = side / 2;
    const { w, h } = sizesAt(nextZoom);
    apply({
      zoom: nextZoom,
      x: limit(mid - (mid - cur.current.x) * k, w),
      y: limit(mid - (mid - cur.current.y) * k, h),
    });
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        pinch.current = { active: false, dist: 0, zoom: cur.current.zoom };
        startPan.current = { x: cur.current.x, y: cur.current.y };
      },

      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;

        if (touches.length === 2) {
          const d = touchDistance(touches);
          if (!pinch.current.active) {
            pinch.current = { active: true, dist: d, zoom: cur.current.zoom };
            return;
          }
          rescale(clamp((pinch.current.zoom * d) / pinch.current.dist, 1, MAX_ZOOM));
          return;
        }

        if (touches.length === 1) {
          // Вдигането на втория пръст не бива да дръпне снимката рязко.
          if (pinch.current.active) {
            pinch.current.active = false;
            startPan.current = { x: cur.current.x - g.dx, y: cur.current.y - g.dy };
          }
          const { w, h } = sizesAt(cur.current.zoom);
          apply({
            zoom: cur.current.zoom,
            x: limit(startPan.current.x + g.dx, w),
            y: limit(startPan.current.y + g.dy, h),
          });
        }
      },

      onPanResponderRelease: () => {
        pinch.current.active = false;
        startPan.current = { x: cur.current.x, y: cur.current.y };
      },
      onPanResponderTerminate: () => {
        pinch.current.active = false;
        startPan.current = { x: cur.current.x, y: cur.current.y };
      },
    })
  ).current;

  function handleDone() {
    const scale = base * cur.current.zoom;
    const size = Math.min(Math.round(side / scale), Math.round(srcW), Math.round(srcH));
    // Стягане в границите. Числата идват от делене на дробен мащаб и един
    // пиксел навън е достатъчен, за да откаже изрязването.
    const fit = (value, limitTo) =>
      Math.min(Math.max(0, Math.round(value)), Math.max(0, Math.round(limitTo) - size));
    onDone({
      originX: fit(-cur.current.x / scale, srcW),
      originY: fit(-cur.current.y / scale, srcH),
      width: size,
      height: size,
    });
  }

  const { w: dispW, h: dispH } = sizesAt(view.zoom);

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Нагласи снимката</Text>
        <Text style={styles.hint}>
          Влачи, за да наместиш. С два пръста приближаваш.
        </Text>

        <View
          style={[styles.window, { width: side, height: side }]}
          {...responder.panHandlers}
        >
          <Image
            source={{ uri: asset?.uri }}
            style={{ width: dispW, height: dispH, left: view.x, top: view.y, position: "absolute" }}
          />
          {/* Само очертанието на кръга — показва какво ще остане вътре. Не
              прихваща допира, за да не спира влаченето. */}
          <View
            pointerEvents="none"
            style={[styles.ring, { width: side, height: side, borderRadius: side / 2 }]}
          />
        </View>

        <View style={styles.btns}>
          <TouchableOpacity style={styles.btnGhost} onPress={onCancel} disabled={busy}>
            <Text style={styles.btnGhostText}>Отказ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnMain} onPress={handleDone} disabled={busy}>
            <Text style={styles.btnMainText}>{busy ? "Качва се..." : "Готово"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.xl,
    alignItems: "center",
    gap: space.md,
  },
  title: { ...type.heading, fontWeight: "bold", fontFamily: "GolosText_700Bold", color: colors.text900 },
  hint: { ...type.label, color: colors.text600, textAlign: "center" },
  window: { overflow: "hidden", backgroundColor: colors.bg, borderRadius: radius.card },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: colors.brand400,
  },
  btns: { flexDirection: "row", gap: space.md, marginTop: space.xs },
  btnGhost: {
    flex: 1, paddingVertical: space.md, paddingHorizontal: space.xl,
    borderRadius: radius.control, borderWidth: 1, borderColor: colors.border,
    alignItems: "center",
  },
  btnGhostText: { ...type.body, color: colors.text600 },
  btnMain: {
    flex: 1, paddingVertical: space.md, paddingHorizontal: space.xl,
    borderRadius: radius.control, backgroundColor: colors.brand600,
    alignItems: "center",
  },
  btnMainText: { ...type.body, color: colors.onBrand, fontWeight: "bold", fontFamily: "GolosText_700Bold" },
});
