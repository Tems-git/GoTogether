# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage)
- Claude API (Anthropic) — AI Trip Planner
- Resend — SMTP за OTP имейли

## База данни — 6 таблици

profiles, trips, trip_members, expenses, expense_splits, documents

## Структура на проекта

```
GoTogether/
  ├── App.js                  — навигация, сесийно управление, trip зареждане
  ├── app.json                — Expo конфигурация + permissions
  ├── eas.json                — EAS Build конфигурация
  ├── lib/
  │   └── supabase.js         — връзка с Supabase
  └── screens/
      ├── SignInScreen.js     — OTP вход (6-цифрен код по имейл)
      ├── TripSetupScreen.js  — създаване или присъединяване към пътуване
      ├── DashboardScreen.js  — главен екран с trip card + 4 карти
      ├── AIPlannerScreen.js  — AI планиране с Claude API
      ├── DocumentsScreen.js  — качване и преглед на документи (Supabase Storage)
      └── ExpensesScreen.js   — разходи, равно делене, алгоритъм за изравняване
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

## Дневник

### Ден 1 — 25 юни 2026
- MVP и Problem Statement дефинирани
- Потребителски потоци картографирани (организатор + гост без регистрация)
- Supabase проект GoTogether създаден (eu-central-2)
- SQL схема: 6 таблици + RLS + тригер за профили
- Node.js v24 + Expo SDK 54 инсталирани
- Home екран работи на iPhone чрез Expo Go
- Два бутона: Планирай с AI / Присъедини се с код
- lib/supabase.js — връзка с базата данни
- screens/SignInScreen.js — Magic Link автентикация
- screens/DashboardScreen.js — 4 карти (AI / Документи / Разходи / Покани)
- Сесийно управление — auto login при запазена сесия
- Deep Link конфигуриран (gotogether://)
- Първи реален потребител регистриран в Supabase

### Ден 2 — 26 юни 2026
- screens/AIPlannerScreen.js — AI Trip Planner с Claude API
- Форма: дестинация, период, брой семейства, деца, бюджет, транспорт
- Claude генерира пълен план: маршрут, настаняване, програма по дни, бюджет, съвети
- Тестван с реален план за Халкидики — 3 семейства, 5 деца, 6000 лв.
- screens/DocumentsScreen.js — реално качване в Supabase Storage, списък, изтриване
- screens/ExpensesScreen.js — форма за разход, равно делене, greedy алгоритъм за изравняване
- screens/TripSetupScreen.js — създаване на ново пътуване или присъединяване с код
- DashboardScreen обновен — trip card с име, дестинация, invite код (copy/share)
- Magic Link → OTP (6-цифрен код) за по-добра мобилна UX
- Resend SMTP интегриран — без rate limit ограничения
- RLS политики поправени — security definer функция за trip_members
- EAS Build конфигуриран за бъдещ iOS/Android build
- Първо реално пътуване създадено и тествано в базата
- Разходи добавени и изравняването тествано

### Следващо
- RLS върнат правилно (сега е изключен за тестване)
- Home екран — "Имам покана" директно без логин
- Expo публикуване (eas update) за споделяне с колаборатора Спас
- Верификация на домейн в Resend за изпращане до всякакви имейли
- Apple Developer акаунт → iOS build → галерия и камера в Documents

## Автор

Temelko Halachev — https://github.com/Tems-git
