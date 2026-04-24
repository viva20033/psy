-- v2 schema: shared data model for cross-user sync
-- Run in Supabase SQL editor.

-- Users table (app-level; auth is via Telegram session cookie)
create table if not exists app_users (
  id text primary key, -- 'tg:<id>' or 'email:<email>'
  display_name text,
  tg_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Groups: shared across users
create table if not exists app_groups (
  id text primary key,
  name text not null,
  type text not null default 'другое', -- обучающая/супервизионная/терапевтическая/личная/другое
  color text not null default '#7aa7ff',
  created_by text not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Memberships
create table if not exists app_group_members (
  group_id text not null references app_groups(id) on delete cascade,
  user_id text not null references app_users(id) on delete cascade,
  role text not null default 'participant', -- leader | participant
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists app_group_members_user_idx on app_group_members (user_id);

-- Seminar = one entity spanning multiple days (blocks)
create table if not exists app_seminars (
  id text primary key,
  group_id text not null references app_groups(id) on delete cascade,
  status text not null default 'предварительно', -- предварительно | подтверждено | отменено
  title text, -- optional short title
  note text, -- one line: zoom link / reminder
  theme text,
  summary text,
  private_notes text, -- only leaders should see (enforced in app layer for now)
  created_by text not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_seminars_group_idx on app_seminars (group_id);

create table if not exists app_seminar_blocks (
  id text primary key,
  seminar_id text not null references app_seminars(id) on delete cascade,
  day date not null,
  start_time text not null default '', -- 'HH:MM' or ''
  end_time text not null default '',
  sort_order int not null default 0
);
create index if not exists app_seminar_blocks_seminar_idx on app_seminar_blocks (seminar_id);
create index if not exists app_seminar_blocks_day_idx on app_seminar_blocks (day);

-- Seminar leaders (supports guest experts per seminar)
create table if not exists app_seminar_leaders (
  seminar_id text not null references app_seminars(id) on delete cascade,
  user_id text not null references app_users(id) on delete cascade,
  days jsonb, -- 'all' or array of weekday strings; keep flexible for now
  primary key (seminar_id, user_id)
);
create index if not exists app_seminar_leaders_user_idx on app_seminar_leaders (user_id);

-- Invites for joining group
create table if not exists app_group_invites (
  token text primary key,
  group_id text not null references app_groups(id) on delete cascade,
  role text not null default 'participant',
  created_by text not null references app_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_by text references app_users(id),
  used_at timestamptz
);
create index if not exists app_group_invites_group_idx on app_group_invites (group_id);

