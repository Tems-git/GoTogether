// Кой код върви в момента.
//
// Три пъти днес спорихме дали поправка не работи, или ъпдейтът не е стигнал до
// телефона. Отвън двете изглеждат еднакво и се различават само с гадаене.
// Затова приложението вече го казва само: къс печат, който показва коя пратка
// е заредена и кога е направена.
//
// „вграден" значи, че върви кодът от самия билд — тоест никакъв ъпдейт не е
// приложен. Осемте знака са началото на номера на пратката; сравняват се с
// това, което показва `eas update:list`.

let updates = null;
let tried = false;

function load() {
  if (tried) return updates;
  tried = true;
  try {
    updates = require("expo-updates");
  } catch {
    updates = null;
  }
  return updates;
}

export function bundleStamp() {
  const U = load();
  if (!U) return "без ъпдейти";

  try {
    if (U.isEmbeddedLaunch) return "вграден";

    const id = String(U.updateId || "").slice(0, 8);
    if (!id) return "вграден";

    const at = U.createdAt ? new Date(U.createdAt) : null;
    if (!at || Number.isNaN(at.getTime())) return id;

    const two = (n) => String(n).padStart(2, "0");
    return `${id} · ${two(at.getDate())}.${two(at.getMonth() + 1)} ${two(at.getHours())}:${two(at.getMinutes())}`;
  } catch {
    return "?";
  }
}
