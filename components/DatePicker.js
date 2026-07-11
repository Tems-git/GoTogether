import { useState, useMemo } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, Modal, Pressable,
} from "react-native";

// Reusable календарен date picker без native dependency.
// Пълен контрол над логиката — по-безопасно от @react-native-community/datetimepicker
// (виж README "GitHub Actions CI/CD" за поуката с native пакети в CI).
//
// Props:
//   value      — избраната дата като string "YYYY-MM-DD" или null
//   onChange   — callback(dateString | null)
//   minDate    — string "YYYY-MM-DD" (по избор), дати преди тази са disabled
//   placeholder— текст в бутона когато няма избрана дата
//   label      — label над бутона (по избор)

const MONTHS_BG = [
  "Януари", "Февруари", "Март", "Април", "Май", "Юни",
  "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември",
];
const DAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function toISODate(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function parseISODate(str) {
  if (!str) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  return { year: +m[1], month: +m[2] - 1, day: +m[3] };
}

function formatDisplay(str) {
  const p = parseISODate(str);
  if (!p) return "";
  return `${pad(p.day)}.${pad(p.month + 1)}.${p.year}`;
}

// Връща масив от 42 клетки (6 седмици × 7 дни) за месеца.
// null стойност = празна клетка (за подравняване в началото/края).
function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS getDay(): 0=неделя, 6=събота. Правим Понеделник=0.
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);
  return cells;
}

export default function DatePicker({ value, onChange, minDate, placeholder = "Избери дата", label }) {
  const [visible, setVisible] = useState(false);
  const parsed = parseISODate(value);
  const today = new Date();
  const initial = parsed || { year: today.getFullYear(), month: today.getMonth() };
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  const grid = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const minParsed = parseISODate(minDate);

  function isDisabled(day) {
    if (!minParsed) return false;
    const dateStr = toISODate(viewYear, viewMonth, day);
    return dateStr < minDate;
  }

  function isSelected(day) {
    if (!parsed) return false;
    return parsed.year === viewYear && parsed.month === viewMonth && parsed.day === day;
  }

  function isToday(day) {
    return today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11); setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0); setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function selectDay(day) {
    if (isDisabled(day)) return;
    onChange(toISODate(viewYear, viewMonth, day));
    setVisible(false);
  }

  function clear() {
    onChange(null);
    setVisible(false);
  }

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.trigger} onPress={() => setVisible(true)}>
        <Text style={value ? styles.triggerText : styles.triggerPlaceholder}>
          {value ? formatDisplay(value) : placeholder}
        </Text>
        <Text style={styles.triggerIcon}>📅</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={styles.calendar} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
                <Text style={styles.navText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{MONTHS_BG[viewMonth]} {viewYear}</Text>
              <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
                <Text style={styles.navText}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {DAYS_SHORT.map((d) => (
                <Text key={d} style={styles.weekDay}>{d}</Text>
              ))}
            </View>

            <View style={styles.grid}>
              {grid.map((day, i) => {
                if (day === null) return <View key={i} style={styles.cell} />;
                const disabled = isDisabled(day);
                const selected = isSelected(day);
                const todayCell = isToday(day);
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.cell,
                      selected && styles.cellSelected,
                      todayCell && !selected && styles.cellToday,
                    ]}
                    onPress={() => selectDay(day)}
                    disabled={disabled}
                  >
                    <Text style={[
                      styles.cellText,
                      selected && styles.cellTextSelected,
                      disabled && styles.cellTextDisabled,
                      todayCell && !selected && styles.cellTextToday,
                    ]}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.footer}>
              <TouchableOpacity onPress={clear} style={styles.footerBtn}>
                <Text style={styles.footerBtnText}>Изчисти</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setVisible(false)} style={styles.footerBtn}>
                <Text style={styles.footerBtnText}>Затвори</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: "#E1F5EE", fontWeight: "600", marginTop: 8, marginBottom: 4 },
  trigger: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 8,
  },
  triggerText: { fontSize: 16, color: "#1a1a1a" },
  triggerPlaceholder: { fontSize: 16, color: "#bbb" },
  triggerIcon: { fontSize: 18 },
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  calendar: {
    backgroundColor: "#fff", borderRadius: 16, padding: 16, width: "100%", maxWidth: 360,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 12,
  },
  navBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "#F0F0F0",
  },
  navText: { fontSize: 24, color: "#1D9E75", fontWeight: "600" },
  monthLabel: { fontSize: 16, fontWeight: "600", color: "#1a1a1a" },
  weekRow: { flexDirection: "row", marginBottom: 8 },
  weekDay: {
    flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600",
    color: "#888",
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center",
  },
  cellSelected: {
    backgroundColor: "#1D9E75", borderRadius: 999,
  },
  cellToday: {
    borderWidth: 1.5, borderColor: "#1D9E75", borderRadius: 999,
  },
  cellText: { fontSize: 15, color: "#1a1a1a" },
  cellTextSelected: { color: "#fff", fontWeight: "700" },
  cellTextDisabled: { color: "#ccc" },
  cellTextToday: { color: "#1D9E75", fontWeight: "600" },
  footer: {
    flexDirection: "row", justifyContent: "space-between",
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F0F0F0",
  },
  footerBtn: { padding: 8 },
  footerBtnText: { color: "#1D9E75", fontSize: 15, fontWeight: "600" },
});
