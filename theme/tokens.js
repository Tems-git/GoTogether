// Цветови токъни за GoTogether.
//
// Правилото, което определя палитрата: бял текст се слага САМО върху
// brand600 или по-тъмно. Старото зелено (#1D9E75) дава контраст 2.9:1
// с бяло — под минимума 4.5:1 по WCAG AA — и на слънце бутоните стават
// нечетими. brand600 дава 6.4:1.

export const colors = {
  brand600: "#0A6B57",  // бутони, header фонове — носи бял текст
  brand700: "#085443",  // pressed състояние
  brand400: "#1D9E75",  // само графики, НИКОГА под бял текст
  brand50:  "#E6F2EE",  // тинт фон на икони и чипове

  owe600:   "#C0442F",  // "дължиш", грешки, изтриване
  warn500:  "#E8A33D",  // изтичащ документ, чакащо действие

  text900:  "#0F1A16",
  text600:  "#4A5A54",
  text400:  "#8A9691",

  border:   "#DDE3E0",
  bg:       "#F7F9F8",  // лек зелен подтон, не студено сиво
  surface:  "#FFFFFF",

  onBrand:      "#FFFFFF",
  onBrandMuted: "#C5DDD5",
};

// Отстояния — база 4. Всяка стойност извън скалата е бъг (вкл. старите 14, 18, 22).
export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
};

export const radius = {
  control: 10, card: 16, pill: 999,
};

// Минимум 14pt за всичко видимо — аудитория 30–50, чете на слънце.
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.6 },
  title:   { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.2 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: "600" },
  subhead: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
  body:    { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  label:   { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  // tabular-nums, иначе колоните в списъка с разходи танцуват
  amount:  { fontSize: 28, lineHeight: 32, fontWeight: "700", fontVariant: ["tabular-nums"] },
};

// Минимум 48×48, не 44 — палец на едната ръка, движеща се кола, слънце.
export const touch = {
  min: 48, primaryButtonHeight: 56, gapBetweenTargets: 8,
};