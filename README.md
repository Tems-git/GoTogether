# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage + Realtime)
- Claude API (Anthropic) — AI Trip Planner
- Resend — SMTP за OTP имейли (домейн: wegotogether.xyz)
- EAS Update — публикуване без App Store

## База данни — 6 таблици

profiles, trips, trip_members, expenses, expense_splits, documents

## Структура на проекта

```
GoTogether/
  ├── App.js                  — навигация, сесийно управление, trip зареждане, invite flow
  ├── app.json                — Expo конфигурация + permissions
  ├── eas.json                — EAS Build/Update конфигурация
  ├── lib/
  │   └── supabase.js         — връзка с Supabase
  └── screens/
      ├── SignInScreen.js     — OTP вход (6-цифрен код по имейл) + display name стъпка
      ├── TripSetupScreen.js  — създаване или присъединяване към пътуване + display name
      ├── DashboardScreen.js  — главен екран, trip card, участници, смяна на пътуване
      ├── AIPlannerScreen.js  — AI планиране с Claude API
      ├── DocumentsScreen.js  — качване и преглед на документи (Supabase Storage)
      └── ExpensesScreen.js   — разходи, равно делене, изравняване, Realtime
```

## Стартиране

```bash
git clone https://github.com/Tems-git/GoTogether.git
cd GoTogether
npm install
npx expo start --tunnel
```

След стартиране добави Supabase ключа локално:
```powershell
(Get-Content lib/supabase.js -Raw) -replace 'SUPABASE_KEY_HERE', 'твоят_ключ' | Set-Content lib/supabase.js -Encoding utf8
```

## Споделяне за тестване

Изпрати на тестерите:
1. Инсталирай **Expo Go** от App Store / Play Store
2. Отвори линка: `exp://mb67r-a-temelko-8081.exp.direct` (валиден докато tunnel върви)
3. Влез с имейл → въведи OTP кода → въведи display name
4. Присъедини се с invite код на пътуването

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

### Следващо
- Apple Developer акаунт → iOS build → галерия и камера в Documents
- Push notifications — известия при нов разход или документ
- Дати на пътуването в trip card

## Автор

Temelko Halachev — https://github.com/Tems-git
