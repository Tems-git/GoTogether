// Смаляване на снимка преди качване.
//
// Изборът на снимка може да свали качеството, но не и размерите — снимка от
// телефон остава 3000-4000 пиксела широка и няколко мегабайта. На екран в чат
// това е чиста загуба: и на нечий мобилен интернет, и на общото място.
//
// Модулът се зарежда лениво и при липса просто връщаме оригинала. По-добре
// по-голяма снимка, отколкото несработило изпращане.

// Две нива, защото решението не е едно и също всеки път. Обикновено човек
// праща „вижте това" и размерът няма значение; понякога праща нещо, което
// после ще гледа на компютър или ще си запази завинаги.
//
// pick е качеството при избора от галерията, преди нашето смаляване. Двете
// компресирания се трупат, затова тук е високо — истинското свиване става
// после, наведнъж.
export const PHOTO_PRESETS = {
  normal: { key: "normal", label: "Обикновено", pick: 0.8, maxWidth: 2048, quality: 0.85 },
  high: { key: "high", label: "Високо", pick: 1, maxWidth: 3200, quality: 0.92 },
};

export function presetFor(key) {
  return PHOTO_PRESETS[key] || PHOTO_PRESETS.normal;
}

let manipulator = null;
let tried = false;

function load() {
  if (tried) return manipulator;
  tried = true;
  try {
    manipulator = require("expo-image-manipulator");
  } catch {
    manipulator = null;
  }
  return manipulator;
}

// Връща адрес на смалено копие или оригиналния адрес, ако смаляването не е
// възможно. Никога не хвърля — качването не бива да пада заради разкрасяване.
export async function shrinkPhoto(uri, width, preset = PHOTO_PRESETS.normal) {
  const M = load();
  if (!M || typeof M.manipulateAsync !== "function") return uri;

  // Снимка, която вече е по-тясна от тавана, не се пипа — повторното
  // компресиране само влошава.
  if (width && width <= preset.maxWidth) return uri;

  try {
    const result = await M.manipulateAsync(
      uri,
      [{ resize: { width: preset.maxWidth } }],
      { compress: preset.quality, format: M.SaveFormat?.JPEG || "jpeg" }
    );
    return result?.uri || uri;
  } catch {
    return uri;
  }
}
