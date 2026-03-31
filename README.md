# Публикация демо на Vercel (с сохранением)

Этот репозиторий содержит:
- фронт: `public/` (чистый HTML/CSS/JS)
- локальный сервер для разработки: `server.js` (Node.js, хранение в `data/state.json`)
- Vercel API (serverless): `api/` (хранение в Supabase Postgres в таблице `app_state`)

## 1) Supabase: таблица

В Supabase SQL Editor выполните:

```sql
create table if not exists app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_state (id, state)
values ('default', '{}'::jsonb)
on conflict (id) do nothing;
```

## 2) Vercel: переменные окружения

В Vercel → Project → Settings → Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## 3) Deploy на Vercel

Импортируйте репозиторий. Для статики укажите Output Directory = `public`.

После деплоя:
- UI: `/`
- API: `/api/state` (GET/PUT), `/api/reset-demo` (POST)

## Локальный запуск (без npm install)

```bash
npm start
```

Открыть: `http://localhost:3000`

Примечание: на Vercel сохранение идёт в Supabase, локально — в `data/state.json`.

