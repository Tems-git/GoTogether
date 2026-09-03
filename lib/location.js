// Текущото местоположение — само когато човек натисне „Около мен".
//
// Нищо тук не се случва на заден план и нищо не се пази: координатите живеят
// колкото да построим един адрес към картите и се забравят. Затова и няма
// разрешение „винаги" — само „докато ползваш приложението".
//
// Модулът се зарежда лениво, както при известията. Причината е същата: този
// файл може да пътува като OTA обновление до билд, в който нативната част още
// я няма. Тогава require хвърля, ние го хващаме и връщаме null, а извикващият
// пада назад към старото поведение вместо да се срине.

let cached = null;
let tried = false;

function mod() {
  if (tried) return cached;
  tried = true;
  try {
    cached = require("expo-location");
  } catch {
    cached = null;
  }
  return cached;
}

// Връща { latitude, longitude } или null. null значи „не можах" по която и да е
// причина — липсващ модул, отказано разрешение, изключен GPS, изтекло време.
// Извикващият не различава случаите, защото реакцията му е една и съща.
export async function currentCoords() {
  const Location = mod();
  if (!Location) return null;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    // Запазената позиция идва мигновено, но Android пази обща за системата
    // последна позиция — тя може да е от чуждо приложение, поискало груба
    // точност, и да е на километри. Затова я приемаме само ако е с точност под
    // 200 метра; иначе я подминаваме и вземаме нова.
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60 * 1000,
      requiredAccuracy: 200,
    });
    if (last?.coords) return last.coords;

    // Нова позиция. High, а не Balanced: разликата в чакането е под секунда при
    // включен GPS, а Balanced на Android често връща позиция от мрежата, която
    // сочи квартала, но не и улицата.
    const now = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return now?.coords || null;
  } catch {
    return null;
  }
}
