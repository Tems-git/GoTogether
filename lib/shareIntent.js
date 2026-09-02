// Приемане на споделено съдържание от други приложения.
//
// Нативната част се зарежда лениво, както при известията и локацията. Тук
// причината е по-остра: ако този файл стигне до телефон като OTA обновление,
// а билдът още няма модула, обикновен import най-горе на App.js би сринал
// приложението при пускане — тоест ще счупим апа на всички, преди новият билд
// изобщо да е излязъл.
//
// За реда на hook-овете: get() дава един и същ отговор през целия живот на
// процеса — модулът или го има, или го няма. Затова условното извикване тук е
// стабилно и React не вижда разместване между рендерите.

let cached = null;
let tried = false;

function get() {
  if (tried) return cached;
  tried = true;
  try {
    cached = require("expo-share-intent");
  } catch {
    cached = null;
  }
  return cached;
}

const EMPTY = {
  hasShareIntent: false,
  shareIntent: null,
  resetShareIntent: () => {},
};

export function useIncomingShare() {
  const impl = get();
  if (impl?.useShareIntent) return impl.useShareIntent();
  return EMPTY;
}

// От споделеното вадим текста, който има смисъл в чат. Някои приложения пращат
// само линк, други — заглавие и линк в едно поле. Файлове засега не приемаме.
export function sharedTextOf(shareIntent) {
  if (!shareIntent) return "";
  const text = String(shareIntent.text || "").trim();
  const url = String(shareIntent.webUrl || "").trim();
  if (text && url && !text.includes(url)) return `${text}\n${url}`;
  return text || url;
}
