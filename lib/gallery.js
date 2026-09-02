// Записване на снимка от чата в галерията на телефона.
//
// Двата модула се зареждат лениво, както при известията и локацията: този файл
// може да стигне до телефон като OTA обновление преди билда, който ги съдържа.
// Тогава saveToGallery връща причина, а екранът казва честно, че още не може.

let media = null;
let files = null;
let tried = false;

function load() {
  if (tried) return;
  tried = true;
  try {
    media = require("expo-media-library");
  } catch {
    media = null;
  }
  try {
    // Нарочно старият интерфейс. В SDK 54 файловата система има изцяло нов
    // API, но старият е запазен и работи; тук трябва само едно сваляне и няма
    // причина да заложим на по-новото, докато не се наложи.
    files = require("expo-file-system/legacy");
  } catch {
    files = null;
  }
}

export function canSaveToGallery() {
  load();
  return !!(media && files);
}

// Връща { ok: true } или { ok: false, reason }.
export async function saveToGallery(url) {
  load();
  if (!media || !files) return { ok: false, reason: "unsupported" };

  try {
    const permission = await media.requestPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: "denied" };

    // Свалямe във временната папка на приложението. Тя се чисти от системата,
    // а копието в галерията остава — точно каквото искаме.
    const target = `${files.cacheDirectory}gotogether-${Date.now()}.jpg`;
    const { uri, status } = await files.downloadAsync(url, target);
    if (status !== 200 || !uri) return { ok: false, reason: "download" };

    await media.saveToLibraryAsync(uri);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || "error" };
  }
}
