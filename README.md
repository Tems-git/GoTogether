# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage + Realtime)
- Claude API (Anthropic) — AI Trip Planner, изпълняван през Supabase Edge Function (ключът не е в клиента)
- Resend — SMTP за OTP имейли (домейн: wegotogether.xyz)
- EAS Update — публикуване без App Store
- GitHub Actions — автоматичен EAS Update при push към master ✅ Работещ

## База данни — 8 таблици

profiles, trips, trip_members, expenses, expense_splits, documents, messages, removed_members, push_tokens

## Структура на проекта

```
GoTogether/
  ├── App.js                  — навигация, сесийно управление, trip зареждане, invite flow, deep linking
  ├── app.json                — Expo конфигурация + permissions + URL scheme + EAS projectId
  ├── eas.json                — EAS Build/Update конфигурация (cli.version >= 20.4.0)
  ├── .github/workflows/
  │   └── eas-update.yml      — автоматичен EAS Update при push към master (работещ)
  ├── lib/
  │   └── supabase.js         — връзка с Supabase
  └── screens/
      ├── SignInScreen.js     — OTP вход (6-цифрен код по имейл) + display name стъпка
      ├── TripSetupScreen.js  — създаване или присъединяване към пътуване + blacklist проверка
      ├── DashboardScreen.js  — главен екран, trip card, участници, блокирани, чат badge
      ├── AIPlannerScreen.js  — AI планиране, вика Supabase Edge Function "ai-trip-planner"
      ├── DocumentsScreen.js  — качване и преглед на документи (Supabase Storage)
      ├── ExpensesScreen.js   — разходи, тегловно делене, изравняване, Realtime
      └── ChatScreen.js       — групов чат, редакция/изтриване, read receipts, Realtime
```

## Стартиране (локално)

```bash
git clone https://github.com/Tems-git/GoTogether.git
cd GoTogether
npm install
npx expo start
```

Ръчно публикуване на update (винаги достъпно като резервен вариант):
```powershell
eas update --branch preview --message "описание на промяната"
```

## ✅ GitHub Actions CI/CD — работещ

Workflow-ът `.github/workflows/eas-update.yml` автоматично пуска `eas update --branch preview` при всеки push към `master` (с изключение на промени само в `.md` файлове, виж `paths-ignore`).

**История на проблема (за справка):** Дълго време workflow-ът гърмеше с `exited with non-zero code: 1` на различни стъпки от `eas update`, въпреки валиден `EXPO_TOKEN` (`eas whoami` минаваше успешно) и идентична `eas-cli` версия (20.4.0) с локалната среда. Причината се оказа поредица от три липсващи конфигурационни елемента в repo-то, които не пречеха на локалното изпълнение, защото локалната среда вече ги имаше извън git:

1. **`expo-image-picker`** беше реферирана в `app.json` plugins, но липсваше от `package.json` dependencies → `expo config --json` гърмеше тихо без полезен stack trace.
2. **`eas.json`** изобщо не съществуваше в repo-то (само локално, никога некомитнат) → грешка `EAS project not configured`.
3. **`extra.eas.projectId`** липсваше от `app.json` → същата грешка, докато не се добави (`ce8969c9-88b7-42cb-838f-d3849a88cbcc`).
4. **`expo-document-picker`** (използвана в `DocumentsScreen.js`) също липсваше от `package.json` → Metro bundler гърмеше при export фазата на `eas update`.

Поука: при "работи локално, но не в CI" грешки с Expo/EAS — първо проверявай дали **всички** native пакети, реферирани в код или `app.json` plugins, реално присъстват в `package.json`, и дали `eas.json` + `projectId` са комитнати в git, а не само налични локално.

## ✅ AI Trip Planner — ключът е сървърно скрит

Anthropic API ключът никога не достига клиентския JS бъндъл (за разлика от React Native env variables, всеки бъндъл е extractable от инсталирано приложение). Вместо това:

- Supabase Edge Function `ai-trip-planner` (project `neorbblppjpxddldjkwn`) приема параметрите на формата и проксира заявката към `api.anthropic.com`, четейки ключа от `Deno.env.get("ANTHROPIC_API_KEY")` — стойност, която живее само в Supabase Edge Function Secrets, никога в git или клиента.
- `AIPlannerScreen.js` вика функцията през `supabase.functions.invoke("ai-trip-planner", { body: {...} })`.
- `verify_jwt: true` на функцията — само логнати потребители на приложението могат да я викат.
- Тествано и потвърдено работещо (30 юни 2026): заявка през Supabase Dashboard test panel върна `200` с реален генериран план.

Ако някога се пренасочи към друг AI providers или се добавят нови AI функции, същият модел (Edge Function + secret) трябва да се използва — никога директен `fetch` от клиента с ключ.

## ⏳ Push notifications — изчаква Apple Developer акаунт

Push notifications (нов разход, документ или съобщение в чата) изискват **development build**, не обикновен Expo Go:

- От Expo SDK 53 нататък push notifications функционалността е премахната от Expo Go изцяло — както за iOS, така и за Android. (По-старо предположение, че iOS работи в Expo Go без build, се отнасяше само за SDK 52 и по-стари версии и вече не важи за този проект на SDK 54.)
- За Android трябва Firebase проект с FCM credentials (безплатно, ~15 минути сетъп).
- За iOS физическо устройство трябва APNs ключ, който изисква активен **Apple Developer Program акаунт ($99/година)** — твърдо изискване, не само за App Store release, а дори за push тестване на устройство.

Решение: групираме push notifications с предстоящата стъпка "Apple Developer акаунт → iOS build" по-долу, тъй като и двете изискват преминаване от Expo Go към dev/production build — по-добре един преход за тестерите, отколкото два отделни.

**Вече подготвено, за да не чакаме после:**
- Таблица `push_tokens` (user_id, token, platform, RLS политики — всеки потребител вижда/управлява само своите токени) — създадена в Supabase, готова за popull когато стигнем до клиентската регистрация.

Дотогава чатът, разходите и документите се обновяват автоматично чрез Supabase Realtime, докато приложението е отворено — няма нужда от push за активни тестери.

## ✅ Технически дълг — почистен

- **`expo-clipboard` миграция** (30 юни 2026): `Clipboard` от `react-native` беше deprecated в SDK 54. Заменен с `expo-clipboard@~8.0.8` в `DashboardScreen.js` — `Clipboard.setString()` → `Clipboard.setStringAsync()` (асинхронен API). CI build потвърден зелен след промяната.
- **`eas-cli` версия**: пинната нарочно на `20.4.0` в CI workflow заради стабилност (виж "GitHub Actions CI/CD" по-горе). Версия `20.5.0` е налична, но без спешна нужда от ъпгрейд — да се преразгледа само ако нова EAS функционалност го изисква.

## ✅ Връщане на премахнат участник — само с уредени сметки

Когато организаторът премахне участник, неговите минали `expense_splits` записи остават в базата непокътнати (не се трият) — стар дълг е реален и трябва да бъде уреден, не изтрит. Организаторът вече може да потвърди settle вместо напусналия участник (виж "Управление на участници" по-долу).

**Проблем, който решихме (30 юни 2026):** ако организаторът деблокира участник, докато той все още има неуредени сметки, тези стари дългове автоматично се връщат в активните изчисления на `ExpensesScreen` при повторното му присъединяване — независимо дали той реално е участвал в нещо ново. Тъй като в повечето случаи премахнат участник не се връща, а организаторът вече settle-ва вместо него, по-логично е деблокирането да изисква чисти сметки, вместо да добавяме нова "замразяване/съживяване" логика.

**Решение:** `handleUnblock` в `DashboardScreen.js` сега проверява и двете посоки на дълга, преди да позволи деблокиране:
- Дължи ли участникът пари по неуредени `expense_splits` (той е участник, не платец)
- Дължат ли му пари по разходи, които той е платил, с неуредени splits от други

Ако има неуредена сума в която и да е посока, деблокирането се отказва с конкретно съобщение колко лева и в коя посока пречат. Организаторът трябва първо да уреди сметките през Разходи → Как да се изравним (потвърждавайки вместо напусналия, ако той не може лично), и чак тогава да деблокира — гарантирано чист старт без наследени задължения.

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
- Организаторът може да деблокира премахнат участник само ако всичките му сметки в Разходи са уредени (виж "Връщане на премахнат участник" по-горе)
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
- GitHub Actions CI/CD — оправен: добавени липсващи `expo-image-picker`, `expo-document-picker`, `eas.json`, `extra.eas.projectId` (виж "GitHub Actions CI/CD" по-горе)
- CI workflow: добавен `paths-ignore` за `.md` файлове — документационни промени вече не тригерват build
- AI Trip Planner: преместен зад Supabase Edge Function — Anthropic ключът вече не е в клиентския бъндъл (виж "AI Trip Planner" по-горе)
- Първи update публикуван и споделен с тестери чрез EAS preview линк + QR код
- Push notifications: проучени ограничения (Expo Go не поддържа push от SDK 53+, нужен Apple Developer акаунт за iOS) — решено да се групира с iOS build стъпката; таблица `push_tokens` подготвена предварително
- `expo-clipboard` миграция — заменен deprecated `Clipboard` от `react-native` (виж "Технически дълг" по-горе)
- Деблокиране на премахнат участник вече изисква уредени сметки в двете посоки (виж "Връщане на премахнат участник" по-горе)

### Следващо
- **Apple Developer акаунт → iOS build → push notifications + галерия и камера в Documents** (групирани, защото всички изискват development/production build вместо Expo Go)
- Дати на пътуването в trip card

## Автор

Temelko Halachev — https://github.com/Tems-git
