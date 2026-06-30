# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage + Realtime)
- Claude API (Anthropic) — AI Trip Planner
- Resend — SMTP за OTP имейли (домейн: wegotogether.xyz)
- EAS Update — публикуване без App Store
- GitHub Actions — автоматичен EAS Update при push към master ⚠️ В ПРОЦЕС НА ОТСТРАНЯВАНЕ (виж по-долу)

## База данни — 7 таблици

profiles, trips, trip_members, expenses, expense_splits, documents, messages, removed_members

## Структура на проекта

```
GoTogether/
  ├── App.js                  — навигация, сесийно управление, trip зареждане, invite flow, deep linking
  ├── app.json                — Expo конфигурация + permissions + URL scheme
  ├── eas.json                — EAS Build/Update конфигурация (cli.version >= 20.4.0)
  ├── .github/workflows/
  │   └── eas-update.yml      — автоматичен EAS Update при push към master (НЕРАБОТЕЩ — виж Известни проблеми)
  ├── lib/
  │   └── supabase.js         — връзка с Supabase
  └── screens/
      ├── SignInScreen.js     — OTP вход (6-цифрен код по имейл) + display name стъпка
      ├── TripSetupScreen.js  — създаване или присъединяване към пътуване + blacklist проверка
      ├── DashboardScreen.js  — главен екран, trip card, участници, блокирани, чат badge
      ├── AIPlannerScreen.js  — AI планиране с Claude API
      ├── DocumentsScreen.js  — качване и преглед на документи (Supabase Storage)
      ├── ExpensesScreen.js   — разходи, тегловно делене, изравняване, Realtime
      └── ChatScreen.js       — групов чат, редакция/изтриване, read receipts, Realtime
```

## Стартиране (локално, работещо)

```bash
git clone https://github.com/Tems-git/GoTogether.git
cd GoTogether
npm install
npx expo start
```

Ръчно публикуване на update (работи перфектно локално):
```powershell
eas update --branch preview --message "описание на промяната"
```

## ⚠️ Известни проблеми — GitHub Actions CI/CD

**Статус: workflow-ът `.github/workflows/eas-update.yml` НЕ работи, въпреки много опити за поправка.**

Грешка във всички опити: `eas update` командата гърми с `exited with non-zero code: 1` на стъпка `expo/bin/cli config --json --type public`, ВЪПРЕКИ че:
- `eas whoami` минава успешно в същия workflow (токенът е валиден)
- Локално (на компютъра на Temelko) `eas update` работи перфектно със същите credentials
- Версията на `eas-cli` е фиксирана да съвпада с локалната (20.4.0)
- Премахнат е `--non-interactive` флагът (нов eas-cli го отхвърля, използва се `CI: true` вместо това)

Допълнителен наблюдаван проблем: GitHub Actions показа временни "Failed to save/restore cache" грешки за `expo/expo-github-action@v8`, които може да са свързани или несвързани с основния проблем.

Пробвани и неуспешни промени:
1. `eas-version: latest` → фиксирано на `20.4.0`
2. `npm ci` (изискваше `package-lock.json`, който липсва) → сменено на `npm install`
3. Премахнат `cache: npm` от setup-node стъпката
4. `--non-interactive` флаг премахнат, заменен с `CI: true` env variable
5. Добавена `eas whoami` debug стъпка — минава успешно
6. Опит с пълен debug изход (`set +e`, cat на eas.json/app.json) — не помогна да видим повече детайли, защото грешката идва преди debug извеждането
7. Пълно пренаписване на workflow файла през GitHub API (push_files) вместо browser editor — за да се избегнат хипотетични скрити encoding проблеми
8. Замяна на `expo/expo-github-action@v8` с директна `npm install -g eas-cli@20.4.0` инсталация — **последен неизпробван докрай вариант, run-ът не показа резултат преди да приключи сесията**

**ВАЖНО:** GitHub MCP connector-ът (инструментът, чрез който Claude чете/пише файлове в repo-то) имаше повтарящи се проблеми цяла сесия:
- `get_file_contents` често връщаше `Tool execution failed` без обяснение
- `create_or_update_file` НЕ успяваше да пише в `.github/workflows/` пътя конкретно (вероятно липсва `workflow` OAuth scope на GitHub App-а), докато проработваше за други пътища
- `push_files` понякога успяваше за `.github/workflows/`, понякога не — без ясна закономерност

**Следваща стъпка за нова сесия:** Провери последния push ("Replace expo-github-action with direct npm eas-cli install", commit ~257d270) — дали workflow run-ът на него е минал успешно. Ако не, разгледай алтернативен подход: ръчно тригериране на EAS update през `workflow_dispatch` с дебъг extensively, или временно изоставяне на GitHub Actions автоматизацията в полза на ръчно пускане на `eas update` от терминала на Temelko (което работи безотказно).

## Текущ работещ начин за деплой (докато CI/CD не се оправи)

```powershell
eas update --branch preview --message "описание"
```

Това публикува update веднага, тестерите го получават автоматично при отваряне на Expo Go — без нов линк, без повторно сканиране.

## Споделяне за тестване

Изпрати на тестерите еднократно:
1. Инсталирай **Expo Go** от App Store / Play Store
2. Отвори линка от EAS Dashboard (виж `eas update:view <update-id>`) или сканирай QR в Expo Go
3. Влез с имейл → въведи OTP кода → въведи display name
4. Присъедини се с invite код на пътуването

След първото отваряне Expo Go запазва проекта и проверява автоматично за нови updates на branch `preview`.

## Управление на участници

- Всеки член на пътуването може да кани нови участници с invite кода
- Само организаторът може да премахва участници
- Премахнатите участници се добавят в blacklist (`removed_members`) — не могат да се присъединят отново без разрешение
- Организаторът може да деблокира премахнат участник по всяко време
- Минали разходи и имена на премахнати участници се запазват в историята

## Дневник

### Ден 1 — 25 юни 2026
- MVP и Problem Statement дефинирани
- Потребителски потоци картографирани
- Supabase проект GoTogether създаден (eu-central-2)
- SQL схема: 6 таблици + RLS + тригер за профили
- Home екран работи на iPhone чрез Expo Go
- lib/supabase.js, SignInScreen, DashboardScreen
- Сесийно управление — auto login при запазена сесия

### Ден 2 — 26 юни 2026
- AI Trip Planner с Claude API
- Documents — качване в Supabase Storage
- Expenses — равно делене, greedy алгоритъм за изравняване
- TripSetupScreen — създаване/присъединяване с код
- Magic Link → OTP (6-цифрен код)
- Resend SMTP интегриран
- RLS политики с SECURITY DEFINER функция
- EAS Build конфигуриран

### Ден 3 — 27 юни 2026
- Home екран — "Имам покана" flow преди логин
- pendingInviteCode — запазва се и се подава след логин
- TripSetupScreen — автоматично join mode
- Resend домейн wegotogether.xyz верифициран
- EAS Update публикувано на branch main
- EAS Secrets добавени
- Първи multi-user тест — двама потребители в едно пътуване

### Ден 4 — 28 юни 2026
- Display name стъпка при регистрация (SignInScreen + TripSetupScreen)
- Dashboard: display name в header + ✏️ редактиране на никнейм
- Dashboard: аватари на участниците (макс 4 + "+N") с tap за пълен списък
- Dashboard: смяна и добавяне на пътуване от trip card
- Expenses: цветни имена на платилия — съвпадат с цветовете от Dashboard
- Expenses: хоризонтален ред "похарчено по участник" под summary
- Expenses: Realtime subscription — автоматичен refresh при всички устройства
- RLS expense_splits UPDATE политика поправена — изравняването работи между потребители
- Supabase Realtime активиран за expenses и expense_splits таблици

### Ден 5 — 29-30 юни 2026
- Chat: групов чат с редакция, изтриване, read receipts
- Chat: edit bar вместо Modal — решен keyboard overlay проблем на iOS/Android
- Members: премахване на участник от организатора
- Members: blacklist (removed_members) — премахнатите не могат да се върнат без разрешение
- Members: деблокиране от организатора, винаги видим бутон дори при 1 участник
- Expenses: имената и сумите на премахнати участници се запазват в историята
- Expenses: settle бутон само за получателя; организатор потвърждава вместо напуснал получател
- Realtime разширен: trip_members, removed_members, messages
- Deep linking: gotogether:// схема (работи в production build, НЕ в Expo Go)
- Опит за GitHub Actions CI/CD автоматизация — НЕУСПЕШЕН, виж "Известни проблеми" по-горе
- Ръчен `eas update --branch preview` работи перфектно като временно решение

### Следващо
- **Приоритет: оправяне на GitHub Actions CI/CD workflow** (виж Известни проблеми)
- Apple Developer акаунт → iOS build → галерия и камера в Documents
- Push notifications — известия при нов разход или документ
- Дати на пътуването в trip card
- Включване на участник в стар разход след повторно присъединяване

## Автор

Temelko Halachev — https://github.com/Tems-git
