# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage)
- Claude API (Anthropic) — AI Trip Planner

## База данни — 6 таблици с RLS

profiles, trips, trip_members, expenses, expense_splits, documents

## Структура на проекта

```
GoTogether/
  ├── App.js                  — навигация и сесийно управление
  ├── app.json                — Expo конфигурация + Deep Link схема
  ├── lib/
  │   └── supabase.js         — връзка с Supabase + signInWithEmail
  └── screens/
      ├── SignInScreen.js     — Magic Link вход
      ├── DashboardScreen.js  — главен екран с 4 карти
      ├── AIPlannerScreen.js  — AI планиране на пътуване
      ├── DocumentsScreen.js  — документи и файлове
      └── ExpensesScreen.js   — разходи и изравняване
```

## Стартиране

```bash
git clone https://github.com/Tems-git/GoTogether.git
cd GoTogether
npm install
npx expo start
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
- screens/DocumentsScreen.js — екран за документи
- screens/ExpensesScreen.js — екран за разходи с summary bar
- Пълна навигация между всички екрани
- GitHub repo почистен от API ключове
- API ключове се пазят само локално

### Следващо
- Deep Link тестване
- Expo публикуване за споделяне с колаборатора
- Реална функционалност за качване на документи
- Форма за добавяне на разход с изравняване

## Автор

Temelko Halachev — https://github.com/Tems-git
