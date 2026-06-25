# GoTogether

Семейни пътувания без главоболие.

## Стек

- React Native + Expo SDK 54
- Supabase (PostgreSQL + Auth + Storage)
- Claude API (Anthropic)

## База данни — 6 таблици с RLS

profiles, trips, trip_members, expenses, expense_splits, documents

## Структура на проекта

```
GoTogether/
  ├── App.js              — навигация и сесийно управление
  ├── app.json            — Expo конфигурация + Deep Link схема
  ├── lib/
  │   └── supabase.js     — връзка с Supabase + signInWithEmail
  └── screens/
      ├── SignInScreen.js  — Magic Link вход
      └── DashboardScreen.js — главен екран след вход
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

### Следващо
- Deep Link тестване след reset на rate limit
- AI Trip Planner екран (Claude API)
- Expo публикуване за споделяне с Спас

## Автор

Temelko Halachev — https://github.com/Tems-git
