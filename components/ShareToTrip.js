import { Modal, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { colors, space, radius, type } from "../theme/tokens";

// Когато някой сподели линк или текст към GoTogether, единственото, което не
// знаем, е в кой чат отива. Затова питаме — и само това.
//
// Показваме и самия текст, защото споделянето от друго приложение става на
// сляпо: човек натиска „Сподели" и вече не вижда какво точно е тръгнало.
export default function ShareToTrip({ visible, text, trips, userId, onDone }) {
  const [sendingTo, setSendingTo] = useState(null);
  const [failed, setFailed] = useState(false);

  async function send(trip) {
    if (sendingTo) return;
    setSendingTo(trip.id);
    setFailed(false);
    try {
      // Името се пази за всяко пътуване поотделно, затова се чете тук, а не
      // веднъж за потребителя.
      const { data: member } = await supabase
        .from("trip_members")
        .select("display_name")
        .eq("trip_id", trip.id)
        .eq("user_id", userId)
        .maybeSingle();

      const { data: inserted, error } = await supabase
        .from("messages")
        .insert({
          trip_id: trip.id,
          user_id: userId,
          display_name: member?.display_name || "Непознат",
          text,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Както в чата: известието тръгва след записа и без await.
      if (inserted?.id) {
        supabase.functions
          .invoke("send-chat-push", { body: { messageId: inserted.id } })
          .catch(() => {});
      }

      onDone(trip);
    } catch {
      // Съобщението не е записано — казваме го и оставяме избора отворен,
      // вместо да затворим и да оставим човек да мисли, че е изпратено.
      setFailed(true);
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => onDone(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Сподели в пътуване</Text>
          <Text style={styles.preview} numberOfLines={3}>{text}</Text>

          {trips.length === 0 ? (
            <Text style={styles.empty}>Нямаш пътувания, в които да споделиш.</Text>
          ) : (
            <ScrollView style={styles.list}>
              {trips.map((trip) => (
                <TouchableOpacity
                  key={trip.id}
                  style={styles.trip}
                  onPress={() => send(trip)}
                  disabled={!!sendingTo}
                >
                  <Text style={styles.tripName}>{trip.name}</Text>
                  {sendingTo === trip.id && <ActivityIndicator color={colors.brand600} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {failed && <Text style={styles.failed}>Не се изпрати. Опитай пак.</Text>}

          <TouchableOpacity style={styles.cancel} onPress={() => onDone(null)} disabled={!!sendingTo}>
            <Text style={styles.cancelText}>Отказ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center", padding: space.xl,
  },
  card: {
    backgroundColor: colors.bg, borderRadius: radius.card,
    padding: space.xl, maxHeight: "80%",
  },
  title: { ...type.heading, color: colors.text900, marginBottom: space.sm },
  preview: {
    ...type.label, color: colors.text600, backgroundColor: colors.surface,
    borderRadius: radius.control, padding: space.md, marginBottom: space.lg,
  },
  list: { flexGrow: 0 },
  trip: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: space.lg, paddingHorizontal: space.md,
    borderRadius: radius.control, backgroundColor: colors.surface,
    marginBottom: space.sm,
  },
  tripName: { ...type.body, color: colors.text900, flex: 1 },
  empty: { ...type.body, color: colors.text400, marginBottom: space.lg },
  failed: { ...type.label, color: "#D64545", marginTop: space.sm },
  cancel: { alignSelf: "center", paddingVertical: space.lg, paddingHorizontal: space.xl },
  cancelText: { ...type.label, color: colors.text600 },
});
