// Изрязване на снимката за кръгчето.
//
// Системното изрязване го махнахме: на Android потвърждението е иконка, която
// не се разпознава като бутон, и човек стои пред екрана без какво да натисне.
// Оставаше средата на кадъра — а лицето рядко е точно в средата.
//
// Затова тук има само едно движение: влачене. Снимката е нагласена така, че
// по-късата ѝ страна точно запълва квадрата; по-дългата стърчи и се движи.
// Няма мащабиране, няма щипка, няма два пръста — нищо, което да се обърка.
// Излиза от кадъра само това, което и без това нямаше да се побере в кръга.
//
// Смятането е просто, защото мащабът е един и не се променя:
//     мащаб   = страна на квадрата / по-късата страна на снимката
//     изрязано = квадрат ÷ мащаб  (тоест по-късата страна, в пиксели на оригинала)
//     начало   = -отместване ÷ мащаб

import { useRef, useState } from "react";
import {
  StyleSheet, View, Text, Image, TouchableOpacity,
  PanResponder, useWindowDimensions,
} from "react-native";
import { colors, space, radius, type } from "../theme/tokens";

export default function AvatarCropper({ asset, busy, onCancel, onDone }) {
  const { width: screenW } = useWindowDimensions();
  // Квадратът е колкото екрана без полетата, но не безкраен на таблет.
  const side = Math.min(screenW - space.xl * 2, 320);

  const srcW = asset?.width || 1;
  const srcH = asset?.height || 1;
  const scale = side / Math.min(srcW, srcH);
  const dispW = srcW * scale;
  const dispH = srcH * scale;

  // Отместването е отрицателно или нула: снимката се дърпа наляво/нагоре.
  const minX = side - dispW;
  const minY = side - dispH;
  const start = { x: minX / 2, y: minY / 2 };

  const [offset, setOffset] = useState(start);
  const offsetRef = useRef(start);

  function clamp(value, low) {
    if (value > 0) return 0;
    if (value < low) return low;
    return value;
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        const next = {
          x: clamp(offsetRef.current.x + g.dx, minX),
          y: clamp(offsetRef.current.y + g.dy, minY),
        };
        setOffset(next);
      },
      onPanResponderRelease: (_e, g) => {
        offsetRef.current = {
          x: clamp(offsetRef.current.x + g.dx, minX),
          y: clamp(offsetRef.current.y + g.dy, minY),
        };
      },
    })
  ).current;

  function handleDone() {
    const size = Math.round(Math.min(srcW, srcH));
    // Стягане в границите. Числата идват от делене на дробен мащаб и един
    // пиксел навън е достатъчен, за да откаже изрязването.
    const fit = (value, limit) => Math.min(Math.max(0, Math.round(value)), Math.max(0, limit - size));
    onDone({
      originX: fit(-offset.x / scale, srcW),
      originY: fit(-offset.y / scale, srcH),
      width: size,
      height: size,
    });
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Нагласи снимката</Text>
        <Text style={styles.hint}>Влачи, за да наместиш лицето в кръга.</Text>

        <View style={[styles.window, { width: side, height: side }]} {...pan.panHandlers}>
          <Image
            source={{ uri: asset?.uri }}
            style={{ width: dispW, height: dispH, left: offset.x, top: offset.y, position: "absolute" }}
          />
          {/* Пръстенът показва какво остава вътре. Рисува се отгоре и не
              прихваща допира, за да не спира влаченето. */}
          <View pointerEvents="none" style={[styles.ring, { width: side, height: side, borderRadius: side / 2 }]} />
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
  // Само очертанието на кръга. Показва какво ще остане вътре — маска не се
  // рисува, защото един кръг с рамка казва същото с два реда.
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
