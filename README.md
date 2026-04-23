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

-- app_state теперь хранится "на пользователя": id = 'tg:<id>' или 'email:<email>'.
-- Пустую строку заранее создавать не обязательно, API создаст "пустой кабинет" при первом входе.
```

Дополнительно для входа по email+пароль (быстрый вариант без писем):

```sql
create table if not exists app_accounts (
  user_id text primary key,
  email text unique not null,
  salt text not null,
  pw_hash text not null,
  created_at timestamptz not null default now()
);
```

Дополнительно для приглашений в группы (MVP, токены):

```sql
create table if not exists app_invites (
  token text primary key,
  created_by text not null,
  group_id text not null,
  role text not null default 'participant', -- 'participant' | 'leader'
  created_at timestamptz not null default now(),
  used_by text,
  used_at timestamptz
);

create index if not exists app_invites_created_by_idx on app_invites (created_by);
create index if not exists app_invites_group_id_idx on app_invites (group_id);
```

## 2) Vercel: переменные окружения

В Vercel → Project → Settings → Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET` (любая длинная случайная строка)
- `TELEGRAM_BOT_TOKEN` (токен бота, который открывает WebApp)

## 3) Deploy на Vercel

Импортируйте репозиторий. Для статики укажите Output Directory = `public`.

После деплоя:
- UI: `/`
- Вход: `/#/login`
- API: `/api/state` (GET/PUT), `/api/reset-demo` (POST)

## Вход и привязка

- **Первый вход**: через Telegram WebApp (`/api/auth/telegram`).
- **Привязка email**: внутри Telegram откройте `Профиль` → `Привязать email` (запрос `/api/auth/email-link`).
- **Отвязка email**: в Telegram в `Профиль` — «Отвязать почту» (`POST /api/auth/email-unlink`, нужен пароль).
- **Вход в браузере**: `/#/login` → email+пароль (`/api/auth/email-login`).

## Telegram: ссылка на бота из веб-версии

Чтобы кнопка `Нет привязанной почты?` открывала вашего бота в Telegram, замените в `public/index.html`:

- `<meta name="telegram-bot-username" content="YOUR_BOT_USERNAME" />`

на ваш username бота (без `@`).

## Локальный запуск (без npm install)

```bash
npm start
```

Открыть: `http://localhost:3000`

Примечание: на Vercel сохранение идёт в Supabase, локально — в `data/state.json`.

