# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage + Realtime)
- Claude API (Anthropic) — AI Trip Planner, изпълняван през Supabase Edge Function (ключът не е в клиента)
- Resend — SMTP за OTP имейли (домейн: wegotogether.xyz)
- Frankfurter (ECB) — курсове за многовалутни разходи, прокси през Supabase Edge Function
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
  │   └── supabase.js         — връзка с Supabase (anon key хардкоднат, виж "Supabase anon key")
  └── screens/
      ├── SignInScreen.js     — OTP вход (6-цифрен код по имейл) + display name стъпка
      ├── TripSetupScreen.js  — създаване или присъединяване към пътуване + дати + избор на местна валута + blacklist проверка
      ├── DashboardScreen.js  — главен екран, trip card (с дати), участници, блокирани, чат badge
      ├── AIPlannerScreen.js  — AI планиране, вика Supabase Edge Function "ai-trip-planner"
      ├── DocumentsScreen.js  — качване и преглед на документи (Supabase Storage)
      ├── ExpensesScreen.js   — разходи в произволна валута, тегловно делене, изравняване с EUR база, Realtime
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

**Модел:** пълното име `claude-haiku-4-5-20251001` (не съкратеното `claude-haiku-4-5`) — версия 7 на функцията и по-нови изрично използват пълния идентификатор, за да се избегне двусмислие при бъдещи модел updates.

**Rotation на Anthropic ключа** (при компрометиране): ключът трябва да се обнови на **три места**, инак някоя част ще спре да работи:
1. **Supabase Edge Function Secrets** — за GoTogether AI Planner (Dashboard → Project → Edge Functions → Secrets → `ANTHROPIC_API_KEY`)
2. **Vercel Environment Variables** — за SaveCheck (различен проект, същият ключ)
3. **`.env` файл локално** — само ако се ползва за локално тестване с `npx expo start`

След rotation задължително се re-deploy-ва Edge Function-ата (нова версия), защото Supabase може да кешира secrets. Проверка че новият ключ работи: `Invoke-RestMethod` към `api.anthropic.com/v1/messages` с ключа в `x-api-key` header.

## ✅ Supabase anon key — хардкоднат в клиента

`lib/supabase.js` **хардкодва** anon key директно като стринг литерал, не чете от `process.env.SUPABASE_ANON_KEY`. Причината: React Native/Expo env variable зареждането не е надеждно — `process.env` в клиентския бъндъл често идва като `undefined`, което води до `Invalid API key` грешки без ясна причина.

**Това е безопасно, защото anon key е публичен по дизайн** — той е защитен от Row Level Security (RLS) политики в базата, не от secrecy. Всеки клиентски JS бъндъл (React Native, web, mobile) така или иначе експонира ключа при runtime.

**Rotation на anon key** (при компрометиране или ротация): смени в `lib/supabase.js`, commit-ни и push-ни към `master` → CI/CD автоматично прави EAS update.

**Различаване от service_role key:** anon key **винаги** започва с `eyJhbGciOiJIUzI1NiIs...` (JWT формат). Ако видиш `sb_secret_...` или `sb_publishable_...` префикс — това **не са** anon/service_role JWT-та (те са Supabase Vault/новия ключов формат, който не се използва тук). Копирай ключа от Dashboard → Project Settings → API → **Project API keys → anon public**.

## ⏳ Push notifications — изчаква Apple Developer акаунт

Push notifications (нов разход, документ или съобщение в чата) изискват **development build**, не обикновен Expo Go:

- От Expo SDK 53 нататък push notifications функционалността е премахната от Expo Go изцяло — както за iOS, така и за Android. (По-старо предположение, че iOS работи в Expo Go без build, се отнасяше само за SDK 52 и по-стари версии и вече не важи за този проект на SDK 54.)
- За Android трябва Firebase проект с FCM credentials (безплатно, ~15 минути сетъп).
- За iOS физическо устройство трябва APNs ключ, който изисква активен **Apple Developer Program акаунт ($99/година)** — твърдо изискване, не само за App Store release, а дори за push тестване на устройство.

Решение: групираме push notifications с предстоящата стъпка "Apple Developer акаунт → iOS build" по-долу, тъй като и двете изискват преминаване от Expo Go към dev/production build — по-добре един преход за тестерите, отколкото два отделни.

**Вече подготвено, за да не чакаме после:**
- Таблица `push_tokens` (user_id, token, platform, RLS политики — всеки потребител вижда/управлява само своите токени) — създадена в Supabase, готова за popull когато стигнем до клиентската регистрация.

Дотогава чатът, разходите и документите се обновяват автоматично чрез Supabase Realtime, докато приложението е отворено — няма нужда от push за активни тестери.

## ⚠️ Тестване с външни потребители — ограничения на Expo Go

Expo Go има фундаментално ограничение за споделяне: **всеки тестер трябва да е логнат в Expo акаунт** (свой или споделен), за да види проекта в "Projects" секцията. Директният линк към EAS update (`expo.dev/accounts/temelko/projects/gotogether/updates/...`) връща **"Account not found"** за други потребители, защото проектът не е публичен.

**Вариантите за тестване с външен приятел (без покупки):**
1. Приятелят си създава безплатен Expo акаунт, ти го добавяш като member в Expo dashboard (Members → Add member) — най-простото, но изисква акаунт.
2. `npx expo start --tunnel` от твоя компютър, приятелят сканира QR кода директно в Expo Go (не с камерата). Работи и в различни мрежи през ngrok tunnel, но само докато твоят компютър е онлайн и Metro върви. Ако `--tunnel` гърми с `Cannot read properties of undefined (reading 'body')` — това е бъг в новите версии на `@expo/ngrok`, workaround е `npm install -g @expo/ngrok@4.1.0`.
3. Google Play Internal Testing ($25 еднократна такса) — генерира `.apk` от `eas build --platform android --profile preview` → тестерът инсталира от линк без Expo Go изобщо. Много по-евтино от Apple ($99/год).
4. TestFlight — изисква Apple Developer акаунт (виж push notifications секцията).

**Ако линкът се отваря в Safari/Chrome вместо в Expo Go**, тестерът трябва да копира линка и да го постави ръчно в Expo Go. От по-новите версии на Expo Go (SDK 54+) опцията "Open from URL" в Settings **е премахната** — единственият надежден начин е през QR код или през Projects list след като е логнат.

## ⚠️ Кеширане на Expo Go — как да принудим свеж bundle

Expo Go има **три нива на кеш**, които могат да задържат стар код дори след успешен EAS update:

1. **Metro bundler cache** (компютър): `.expo/` и `node_modules/.cache/` папки → чистене с `npx expo start --clear` или ръчно `Remove-Item -Recurse -Force .expo`.
2. **Bundle cache в Expo Go** (телефон): затваряне на GoTogether от app switcher (**не** back button) → отваряне отново. Понякога това не е достатъчно и трябва пълно преинсталиране на Expo Go.
3. **EAS update cache** (Expo сървъри): не се чисти — просто трябва да се публикува нов update. Ако последният `eas update:list` показва скорошен update, но приложението пак показва стар код, вината е в 1) или 2).

**Диагностика "какво зарежда клиентът в момента":** отвори `http://localhost:8081/lib/supabase.bundle?platform=ios&dev=true` в браузър на компютъра, търси конкретна стойност (напр. anon key префикс) — ако Metro сервира правилния код, но Expo Go пак показва стар — вината е в кеша на телефона.

**Ако Expo Go гърми с `PlatformConstants could not be found`** — това означава несъответствие между Expo SDK версията в проекта и версията на Expo Go на телефона. Обикновено се случва след `git reset --hard` или ръчна промяна на `package.json`. Решение: `npx expo install --fix` за автоматично привеждане на всички Expo пакети към правилните версии за SDK 54.

## ⚠️ Опасностите на `git reset --hard`

`git reset --hard origin/master` разсинхронизира локалната среда по три начина едновременно:
- **`node_modules/` не се обновява** — старите nested зависимости остават, но `package.json` вече е нов → mismatch.
- **`.env` файлът остава** (в gitignore е), но приложението може да чете различни версии на конфигурация.
- **Пакети инсталирани от EAS runtime (напр. `expo-updates`, `expo-clipboard`)** — CI workflow-ът ги инсталира при всеки build, но локално те са само в `node_modules/`, не в `package.json`. Reset връща `package.json` без тях и всичко гърми.

**След `git reset --hard` винаги пусни:** `npm install && npx expo install --fix` за да синхронизираш локалната среда с новото състояние на `package.json`.

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

## ✅ Многовалутни разходи — EUR база с реални курсове

Разходите се въвеждат в реалната валута, в която са направени (не само в една обща валута), а изравняването показва общата сума в EUR база плюс местната валута на пътуването, ако е различна.

**Архитектура:**

- **DB**: `expenses.currency` (вече съществуваше, но не се ползваше) + нова `trips.local_currency` (default `EUR`, избираема при създаване на пътуването измежду EUR/BGN/USD/GBP).
- **Курсове**: Supabase Edge Function `currency-rates` проксира [Frankfurter](https://frankfurter.dev) (ECB референтни курсове, безплатна, без API ключ, ~30 активни валути) и пълния ISO списък с имена (`/v1/currencies`), с 6-часов in-memory кеш — ECB публикува веднъж дневно, така че няма нужда от по-чести заявки.
- **Въвеждане на разход** (`ExpensesScreen.js`): нов избирател на валута — chip-ове за чести валути (EUR, BGN, USD, GBP) + търсене в пълния списък от Frankfurter за всичко останало. По подразбиране **EUR**.
- **Изчисления**: `calcSettlements` конвертира всеки `expense_split` в EUR преди баланс смятането (`toEUR()` помощна функция), така че разходи в различни валути в едно пътуване се сумират коректно. Обобщенията ("Общо", "Ти дължиш", "Дължат ти") са винаги в EUR.
- **Показване в "Как да се изравним"**: всяка сума се показва двойно — EUR (основна) + местната валута на пътуването (ако е различна от EUR), малко под нея.
- Ако курс липсва (напр. валута, която Frankfurter не покрива), кодът показва суровата сума без конверсия вместо да гръмне — graceful degradation.

**Важна корекция по време на разработката:** България е приела еврото в текущия сценарий, затова **BGN вече не присъства** в активния ECB референтен feed на Frankfurter (само ~30 "живи" валути). Всички стари default-и от `'BGN'` (в `expenses.currency` и новата `trips.local_currency`) бяха сменени на `'EUR'`, включително backfill на съществуващите редове в базата.

## ✅ Дати на пътуването

`trips.start_date` и `trips.end_date` (nullable `date` колони, по избор) се задават при създаване на пътуването в `TripSetupScreen.js` — текстови полета във формат ГГГГ-ММ-ДД с валидация (формат, валидна дата, край след начало), съзнателно без native date picker, за да не въвеждаме нов native dependency (виж "GitHub Actions CI/CD" по-горе за поуката с липсващи native пакети в CI). `DashboardScreen.js` ги показва в trip card като диапазон (`formatDate` + `dateRange`, формат ДД.MM.ГГГГ).

Засега датите се задават само при създаване — редакция след създаване от организатора предстои.

## Споделяне за тестване

Виж "Тестване с външни потребители" секцията по-горе за пълния списък опции. Основен flow за тестер с Expo акаунт:

1. Инсталирай **Expo Go** от App Store / Play Store
2. Логни се с Expo акаунт, който е добавен като member на проекта
3. Projects секция → gotogether → **Branch: preview** (не `main`!)
4. Влез с имейл → въведи OTP кода → въведи display name
5. Присъедини се с invite код на пътуването

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
- Многовалутни разходи: Edge Function `currency-rates` (Frankfurter/ECB), избор на валута при разход, EUR база за изравняване + местна валута показана отделно (виж "Многовалутни разходи" по-горе)
- Открито и поправено: default валутата навсякъде беше `'BGN'`, но BGN вече не съществува в ECB feed-а (България е в еврозоната) — всички default-и сменени на `'EUR'`

### Ден 6 — 30 юни 2026
- Дати на пътуването: `start_date`/`end_date` вече съществуваха като nullable `date` колони в `trips` (добавени по-рано, неизползвани) — DashboardScreen вече ги показваше в trip card (`formatDate` + `dateRange`), но липсваше въвеждане
- TripSetupScreen: нови полета за начална/крайна дата при създаване на пътуване, текстов вход във формат ГГГГ-ММ-ДД с валидация (формат, валидна дата, край след начало) — съзнателно без native date picker, за да не въвеждаме нов native dependency и риск от повторен CI проблем (виж "GitHub Actions CI/CD" по-горе)
- И двете полета са по избор (NULL, ако се оставят празни)

### Ден 7 — 1-10 юли 2026 — маратонът на deployment проблемите
Целият ден 7 беше посветен не на нови функционалности, а на дебъгване защо новият код от Ден 6 не се появява в приложението. Проблемите се напластиха и всеки нов „опит за поправка" разкриваше поредния скрит слой:

- **Три независими EAS updates** бяха публикувани от repo-то в грешно състояние (без `dateRow`), защото локалният код в `C:\Users\USER\gotogether2` беше на по-стар commit от GitHub (`0b86301` вместо `21cf6c2`). CI update-ите минаваха успешно, но публикуваха стар бъндъл. Причина: `git pull` не работеше поради diverged history; беше нужно `git fetch origin && git reset --hard origin/master` за синхронизация.
- **`git reset --hard` разсинхронизира node_modules** — възстанови `package.json` без `expo-clipboard` версията, което счупи Metro bundler-а с `expo-clipboard is added as dependency but doesn't seem to be installed`. Решение: `npm install && npx expo install --fix`.
- **Тестерски проблеми с Expo Go** — открихме, че линкът към EAS update връща "Account not found" за external потребители (проектът не е публичен), Safari не отваря автоматично в Expo Go, а от SDK 54 опцията "Open from URL" в Settings е премахната. Работещо решение: тестерът се логва в Expo акаунт и отваря през Projects секцията, или `--tunnel` за real-time development sharing.
- **Anthropic API key ротация** — старият ключ беше споделен и се ротира. Нужно е обновяване на **три места**: Supabase Edge Function Secrets, Vercel env vars (SaveCheck), локален `.env`. Пропускането на Supabase → 500 грешка от AI Planner. Освен това `ai-trip-planner` Edge Function трябваше да се re-deploy-не (версия 7), защото Supabase може да кешира secrets. Моделът беше сменен от `claude-haiku-4-5` на пълното `claude-haiku-4-5-20251001`.
- **Supabase anon key проблем** — `process.env.SUPABASE_ANON_KEY` не работи надеждно в Expo/React Native → `lib/supabase.js` показваше `"SUPABASE_KEY_HERE"` fallback вместо реалния ключ → всеки login опит гърмеше с `Invalid API key`. Решение: хардкодване на anon key директно като литерал (безопасно, защото anon key е публичен по дизайн, защитен от RLS). Виж новата секция "Supabase anon key".
- **Открито:** в `.env` файла ключът беше грешен формат — `sb_secret_VhcR...` (Supabase Vault/новия формат), а не JWT anon key (`eyJ...`). Правилният anon key се копира от Dashboard → Project Settings → API → Project API keys → **anon public**.
- **Още открития за Expo Go кеша:** три нива на кеш (Metro `.expo/`, Expo Go bundle, EAS update cache), всеки от които може да задържи стар код независимо от другите. Диагностика: отваряне на `http://localhost:8081/lib/supabase.bundle` в браузър и търсене на конкретна стойност. Виж новата секция "Кеширане на Expo Go".
- **`PlatformConstants could not be found`** грешка — Expo SDK version mismatch, оправено с `npx expo install --fix`.
- **README updated** с четири нови секции: "Supabase anon key", "Тестване с външни потребители", "Кеширане на Expo Go", "Опасностите на git reset --hard". Целта: следващата сесия с този проект (или друг Expo проект) да не мине през същия маратон отново.

### Следващо
- **Apple Developer акаунт → iOS build → push notifications + галерия и камера в Documents** (групирани, защото всички изискват development/production build вместо Expo Go)
- **Редакция на датите/валутата от организатора** след създаване на пътуването (в момента се задават само при създаване) — беше следващата задача, отложена заради маратона в Ден 7
- Оценка на Google Play Internal Testing ($25) като по-евтин път за реални external тестери, преди Apple Developer

## Автор

Temelko Halachev — https://github.com/Tems-git
