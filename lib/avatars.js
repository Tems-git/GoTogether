// Снимката на човека.
//
// Тя не принадлежи на едно пътуване, затова не може да живее в кофата
// „documents", където първата папка е пътуването. Има отделна кофа „avatars",
// в която първата папка е самият човек: пише се само в своята, а се чете
// снимката на всеки, с когото делим пътуване.
//
// В `profiles.avatar_url` стои пътят във вътрешното хранилище, не адрес.
// Кофата е затворена, тоест адресът се издава временно при всяко показване —
// същото, което чатът прави със снимките.

import { supabase } from "./supabase";
import { AVATAR, cropTo, shrinkPhoto } from "./image";

const BUCKET = "avatars";
const URL_SECONDS = 3600;

// Всеки екран взима снимките веднъж, при отваряне. Без този знак смяната се
// вижда само там, където е направена, а другаде стои старата до следващото
// отваряне. Списъкът е малък — толкова екрана, колкото са отворени.
const listeners = new Set();

export function onAvatarsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  listeners.forEach((fn) => { try { fn(); } catch {} });
}

// Идентификатор → временен адрес на снимката. Хората без снимка просто ги няма
// в отговора; викащият показва буквата, както досега.
export async function fetchAvatarUrls(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return {};

  const { data } = await supabase
    .from("profiles")
    .select("id, avatar_url")
    .in("id", ids);

  const ownerOf = {};
  (data || []).forEach((p) => { if (p.avatar_url) ownerOf[p.avatar_url] = p.id; });
  const paths = Object.keys(ownerOf);
  if (paths.length === 0) return {};

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, URL_SECONDS);

  const out = {};
  (signed || []).forEach((row) => {
    if (row.signedUrl && row.path && ownerOf[row.path]) out[ownerOf[row.path]] = row.signedUrl;
  });
  return out;
}

// Качва избраната снимка и записва пътя ѝ в профила. Връща новия път.
export async function uploadAvatar(userId, assetUri, previousPath, crop) {
  // Първо изрязване, после смаляване: обратното би изрязало по числа от
  // оригинала върху вече смалена снимка.
  const cropped = await cropTo(assetUri, crop);
  const uri = await shrinkPhoto(cropped, null, AVATAR, true);
  const response = await fetch(uri);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Ново име при всяка смяна. Иначе телефонът показва запомненото копие с дни
  // и човек остава с усещането, че смяната не е станала.
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;

  // Обновяване, НЕ upsert. `upsert` се превежда като „вмъкни, а при
  // сблъсък обнови", а Postgres проверява задължителните колони върху реда,
  // който се вмъква, преди изобщо да стигне до сблъсъка. Тоест вмъкване само
  // с (id, avatar_url) пада заради празното display_name, макар редът да
  // съществува и име в него да има. Профилът и без това винаги е налице —
  // прави се при влизането.
  const { data: updated, error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_url: path })
    .eq("id", userId)
    .select("id");
  if (profileError) throw profileError;
  if (!updated || updated.length === 0) throw new Error("Профилът не е намерен.");

  // Старият файл вече не е нужен. Провалът тук не е причина да се провали
  // смяната — остава един забравен файл, нищо повече.
  if (previousPath && previousPath !== path) {
    try { await supabase.storage.from(BUCKET).remove([previousPath]); } catch {}
  }
  announce();
  return path;
}

export async function clearAvatar(userId, currentPath) {
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", userId);
  if (error) throw error;
  if (currentPath) {
    try { await supabase.storage.from(BUCKET).remove([currentPath]); } catch {}
  }
  announce();
}
