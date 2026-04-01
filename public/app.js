// SPA без сборки: hash-роутинг. Данные с сервера (SQLite); localStorage — запасной вариант.
const STORAGE_KEY = "psy_cabinet_v1";
const API_BASE = "";
let currentUserId = null;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateRu(iso) {
  // iso: YYYY-MM-DD
  if (!iso) return "дата не указана";
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(dt);
  return `${wd} ${pad2(d)}.${pad2(m)}`;
}

function formatTimeRange(start, end) {
  if (!start || !end) return "время уточним";
  return `${start}–${end}`;
}

function tryParseISODate(s) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

const RU_MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const GROUP_TYPES = [
  { id: "обучающая", label: "Обучающая" },
  { id: "супервизионная", label: "Супервизионная" },
  { id: "терапевтическая", label: "Терапевтическая" },
  { id: "интервизионная", label: "Интервизионная" },
  { id: "другое", label: "Другое" },
];

function parseISODateParts(iso) {
  if (!tryParseISODate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function blocksInCalendarMonth(session, year, month) {
  return session.blocks.filter((b) => {
    const p = parseISODateParts(b.date);
    return p && p.y === year && p.m === month;
  });
}

function sessionFirstDateInMonth(session, year, month) {
  const bs = blocksInCalendarMonth(session, year, month).map((b) => b.date).filter(Boolean).sort();
  return bs[0] || null;
}

function countSessionsWithBlocksInMonth(sessions, year, month) {
  return sessions.filter((s) => blocksInCalendarMonth(s, year, month).length > 0).length;
}

function buildDemoState() {
  const meId = uid("u");
  const other1 = uid("u");
  const other2 = uid("u");
  const guest = uid("u");
  const g1 = uid("g");
  const g2 = uid("g");
  const g3 = uid("g");

  const iso = (d) => {
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = pad2(dt.getMonth() + 1);
    const dd = pad2(dt.getDate());
    return `${y}-${m}-${dd}`;
  };

  const nextDow = (targetDow) => {
    const dt = new Date();
    const cur = dt.getDay();
    let add = (targetDow - cur + 7) % 7;
    if (add === 0) add = 7;
    dt.setDate(dt.getDate() + add);
    return dt;
  };

  const nextFri = nextDow(5);
  const nextSat = new Date(nextFri);
  nextSat.setDate(nextFri.getDate() + 1);
  const nextSun = new Date(nextFri);
  nextSun.setDate(nextFri.getDate() + 2);
  const nextTue = nextDow(2);

  return {
    meId,
    users: [
      { id: meId, name: "Вы" },
      { id: other1, name: "Анна" },
      { id: other2, name: "Борис" },
      { id: guest, name: "Ирина (гость)" },
    ],
    groups: [
      { id: g1, name: "Обучающая группа", type: "обучающая", color: "#7aa7ff" },
      { id: g2, name: "Супервизионная группа", type: "супервизионная", color: "#55d691" },
      { id: g3, name: "Малая группа", type: "терапевтическая", color: "#ffcc66" },
    ],
    groupMembers: [
      { groupId: g1, userId: meId, isLeader: true, isParticipant: false },
      { groupId: g1, userId: other1, isLeader: true, isParticipant: false },
      { groupId: g1, userId: other2, isLeader: true, isParticipant: false },
      { groupId: g2, userId: meId, isLeader: false, isParticipant: true },
      { groupId: g2, userId: other1, isLeader: true, isParticipant: false },
      { groupId: g3, userId: meId, isLeader: true, isParticipant: false },
    ],
    sessions: [
      {
        id: uid("s"),
        groupId: g1,
        status: "предварительно",
        leaders: [
          { userId: meId, days: "all" },
          { userId: other1, days: "all" },
          { userId: other2, days: "all" },
          { userId: guest, days: "all" },
        ],
        blocks: [
          { id: uid("b"), date: iso(nextFri), startTime: "17:00", endTime: "21:00" },
          { id: uid("b"), date: iso(nextSat), startTime: "11:00", endTime: "19:00" },
          { id: uid("b"), date: iso(nextSun), startTime: "10:00", endTime: "18:00" },
        ],
        note: "Тема: телесные практики (гость).",
      },
      {
        id: uid("s"),
        groupId: g2,
        status: "подтверждено",
        leaders: [{ userId: other1, days: "all" }],
        blocks: [{ id: uid("b"), date: iso(nextSat), startTime: "11:00", endTime: "18:00" }],
        note: "",
      },
      {
        id: uid("s"),
        groupId: g3,
        status: "предварительно",
        leaders: [{ userId: meId, days: "all" }],
        blocks: [{ id: uid("b"), date: iso(nextTue), startTime: "14:00", endTime: "16:00" }],
        note: "",
      },
      {
        id: uid("s"),
        groupId: g3,
        status: "предварительно",
        leaders: [{ userId: meId, days: "all" }],
        blocks: [{ id: uid("b"), date: iso(new Date(nextTue.getTime() + 7 * 86400000)), startTime: "", endTime: "" }],
        note: "Время уточним позже.",
      },
    ],
  };
}

async function loadState() {
  try {
    if (!currentUserId) {
      const me = await fetch(`${API_BASE}/api/me`);
      if (!me.ok) throw new Error(await me.text());
      const mj = await me.json();
      currentUserId = mj.userId;
    }
    const r = await fetch(`${API_BASE}/api/state`);
    if (!r.ok) throw new Error(await r.text());
    return await r.json();
  } catch (e) {
    console.warn("Нет ответа от сервера, пробуем локальное хранилище.", e);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const fallback = buildDemoState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

async function saveState(state) {
  try {
    const r = await fetch(`${API_BASE}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!r.ok) throw new Error(await r.text());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.warn("Сервер недоступен, сохранено только в браузере.", e);
    alert("Сохранено только на этом устройстве (сервер недоступен). Проверьте, что вы открыли сайт через http://localhost:3000, а не файл с диска.");
  }
}

function isTelegramWebApp() {
  return Boolean(window.Telegram && window.Telegram.WebApp);
}

function isTelegramWebAppContext() {
  if (!isTelegramWebApp()) return false;
  const w = window.Telegram.WebApp;
  // Вне Telegram скрипт может существовать, но initData/user будут пустыми.
  const uid = w?.initDataUnsafe?.user?.id;
  if (uid) return true;
  return Boolean(w?.initData && String(w.initData).length > 0);
}

function getBotUsername() {
  // Можно задать в index.html: <meta name="telegram-bot-username" content="my_bot" />
  const meta = document.querySelector('meta[name="telegram-bot-username"]');
  const v = meta?.getAttribute("content") || "";
  return String(v || "").trim().replace(/^@/, "");
}

function openBotInTelegram() {
  const username = getBotUsername();
  if (!username) {
    alert("Не задан username бота. Добавьте meta telegram-bot-username в index.html.");
    return;
  }
  const url = `https://t.me/${encodeURIComponent(username)}`;
  // В браузере: откроет t.me, дальше пользователь нажмёт кнопку Menu / WebApp.
  window.open(url, "_blank", "noopener,noreferrer");
}

async function tryTelegramLogin() {
  if (!isTelegramWebApp()) return { ok: false, skipped: true };
  try {
    // Ensure Telegram считает, что WebApp "готов" (часть клиентов заполняет initData позже).
    try {
      window.Telegram.WebApp.ready();
    } catch {}
    // Иногда initData появляется не сразу — подождём немного.
    let initData = window.Telegram.WebApp.initData;
    if (!initData) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 120));
        initData = window.Telegram.WebApp.initData;
        if (initData) break;
      }
    }
    if (!initData) return { ok: false, error: "Missing initData" };
    const r = await fetch(`${API_BASE}/api/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(txt);
    const j = JSON.parse(txt);
    currentUserId = j.userId;
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e };
  }
}

function renderLogin(stateRef) {
  const tgHint = isTelegramWebAppContext()
    ? "Открыто внутри Telegram. Нажмите «Войти через Telegram»."
    : "Открыто в браузере. Можно войти по ранее привязанному email и паролю (привязка делается внутри Telegram).";

  const emailId = "login_email";
  const passId = "login_pass";

  const doEmail = async () => {
    const email = document.getElementById(emailId)?.value || "";
    const password = document.getElementById(passId)?.value || "";
    const endpoint = "/api/auth/email-login";
    try {
      const r = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const txt = await r.text();
      let j = null;
      try { j = JSON.parse(txt); } catch { j = { error: txt }; }
      if (!r.ok) throw new Error(j?.error || txt);
      currentUserId = j.userId;
      state = await loadState();
      location.hash = "#/upcoming";
      renderApp();
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes("Аккаунт не найден")) {
        alert("Этот email ещё не привязан. Откройте приложение через Telegram-бота, войдите и привяжите email в «Профиль».");
      } else {
        alert(msg);
      }
    }
  };

  const doTg = async () => {
    const r = await tryTelegramLogin();
    if (!r.ok) {
      if (String(r.error || "").includes("Missing initData")) {
        return alert("Не вижу данных Telegram (initData). Откройте приложение именно как WebApp из бота (Menu Button / кнопка), а не как обычную страницу в встроенном браузере Telegram.");
      }
      return alert(`Не удалось войти через Telegram.\n\n${String(r.error?.message || r.error || "")}`);
    }
    state = await loadState();
    location.hash = "#/upcoming";
    renderApp();
  };

  return h("div", {}, [
    topbar("Вход", tgHint, null),
    h("div", { class: "content" }, [
      isTelegramWebAppContext()
        ? h("div", { class: "card" }, [
            h("div", { class: "groupName" }, "Telegram WebApp"),
            h("div", { class: "small" }, "Вход будет подтверждён на сервере по подписи Telegram (initData)."),
            h("div", { class: "actions" }, [h("button", { class: "btn primary", onclick: doTg }, "Войти через Telegram")]),
          ])
        : null,
      h("div", { class: "card" }, [
        h("div", { class: "groupName" }, "Email + пароль"),
        h("div", { class: "small" }, "Вход по уже привязанному email. Чтобы привязать — откройте WebApp в Telegram и сделайте привязку в «Профиль»."),
        h("div", { class: "form" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: emailId }, "Email"),
            h("input", { id: emailId, placeholder: "you@example.com", inputmode: "email", autocomplete: "email" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: passId }, "Пароль"),
            h("input", { id: passId, type: "password", placeholder: "минимум 6 символов", autocomplete: "current-password" }),
          ]),
          h("div", { class: "actions" }, [
            h("button", { class: "btn primary", onclick: () => doEmail() }, "Войти"),
            h(
              "button",
              {
                class: "btn",
                onclick: () => openBotInTelegram(),
              },
              "Нет привязанной почты?"
            ),
          ]),
        ]),
      ]),
      h("div", { class: "small", style: "margin-top:12px; opacity:.85;" }, "После входа данные сохраняются в вашей персональной записи в Supabase, а не в общем demo."),
    ]),
  ]);
}

function getMe(state) {
  return state.users.find((u) => u.id === state.meId);
}

function groupById(state, id) {
  return state.groups.find((g) => g.id === id);
}

function userById(state, id) {
  return state.users.find((u) => u.id === id);
}

function isLeaderInGroup(state, groupId, userId) {
  return state.groupMembers.some((m) => m.groupId === groupId && m.userId === userId && m.isLeader);
}

function isParticipantInGroup(state, groupId, userId) {
  return state.groupMembers.some((m) => m.groupId === groupId && m.userId === userId && m.isParticipant);
}

function sessionVisibleForMe(state, session, mode) {
  // mode: "lead" | "part"
  if (mode === "lead") {
    return session.leaders.some((l) => l.userId === state.meId);
  }
  // participant
  return isParticipantInGroup(state, session.groupId, state.meId);
}

function sessionFirstDate(session) {
  const dates = session.blocks.map((b) => b.date).filter(Boolean).sort();
  return dates[0] || "9999-99-99";
}

function sessionDayLabel(session, idx) {
  const b = session.blocks[idx];
  return `${formatDateRu(b.date)} — ${formatTimeRange(b.startTime, b.endTime)}`;
}

function sameDay(aIso, bIso) {
  return aIso && bIso && aIso === bIso;
}

function timeToMin(t) {
  if (!t) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function blocksOverlap(b1, b2) {
  if (!sameDay(b1.date, b2.date)) return false;
  const a1 = timeToMin(b1.startTime);
  const a2 = timeToMin(b1.endTime);
  const b1m = timeToMin(b2.startTime);
  const b2m = timeToMin(b2.endTime);
  if (a1 == null || a2 == null || b1m == null || b2m == null) return true; // неизвестное время = возможное пересечение
  return Math.max(a1, b1m) < Math.min(a2, b2m);
}

function computeConflicts(state, draftSession) {
  // Возвращает массив текстов конфликтов для всех leaders в draftSession.
  const lines = [];
  const leaderIds = draftSession.leaders.map((l) => l.userId);

  for (const leaderId of leaderIds) {
    for (const s of state.sessions) {
      if (s.id === draftSession.id) continue;
      if (!s.leaders.some((l) => l.userId === leaderId)) continue;
      for (const bA of draftSession.blocks) {
        for (const bB of s.blocks) {
          if (!sameDay(bA.date, bB.date)) continue;
          const overlap = blocksOverlap(bA, bB);
          if (!overlap) continue;
          const who = userById(state, leaderId)?.name ?? "Тренер";
          const g = groupById(state, s.groupId);
          const when = formatDateRu(bA.date);
          const strong = timeToMin(bA.startTime) != null && timeToMin(bA.endTime) != null && timeToMin(bB.startTime) != null && timeToMin(bB.endTime) != null;
          const kind = strong ? "Конфликт по времени" : "Возможное пересечение (время где-то не указано)";
          lines.push(`${kind}: ${who} — ${when} уже занято (${g?.name ?? "другая группа"}).`);
        }
      }
    }
  }
  return Array.from(new Set(lines));
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, k);
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const ch of Array.isArray(children) ? children : [children]) {
    if (ch == null) continue;
    if (typeof ch === "string") el.appendChild(document.createTextNode(ch));
    else el.appendChild(ch);
  }
  return el;
}

function nav(current) {
  const mk = (href, label, key) =>
    h(
      "button",
      {
        class: "navBtn",
        "aria-current": current === key ? "page" : null,
        onclick: () => (location.hash = href),
      },
      label
    );

  return h("div", { class: "nav" }, [
    h("div", { class: "navRow" }, [
      mk("#/upcoming", "Ближайшее", "upcoming"),
      mk("#/groups", "Группы", "groups"),
      mk("#/create", "Создать", "create"),
      mk("#/profile", "Профиль", "profile"),
    ]),
  ]);
}

function topbar(title, subtitle, pills) {
  const pillRow =
    pills && pills.length
      ? h(
          "div",
          { class: "pillRow" },
          pills.map((p) =>
            h(
              "button",
              {
                class: "pill",
                "aria-pressed": p.pressed ? "true" : "false",
                onclick: p.onClick,
              },
              p.label
            )
          )
        )
      : null;

  return h("div", { class: "topbar" }, [
    h("div", { class: "topbarRow" }, [
      h("div", {}, [
        h("div", { class: "title" }, title),
        subtitle ? h("div", { class: "subtitle" }, subtitle) : null,
      ]),
    ]),
    pillRow,
  ]);
}

function renderUpcoming(state, mode = "lead") {
  const me = getMe(state);
  const subtitle = `${me?.name ?? "Пользователь"} • телефонный прототип`;

  const pills = [
    {
      label: "Я веду",
      pressed: mode === "lead",
      onClick: () => (location.hash = "#/upcoming?mode=lead"),
    },
    {
      label: "Я участник",
      pressed: mode === "part",
      onClick: () => (location.hash = "#/upcoming?mode=part"),
    },
  ];

  const sessions = state.sessions
    .filter((s) => sessionVisibleForMe(state, s, mode))
    .slice()
    .sort((a, b) => sessionFirstDate(a).localeCompare(sessionFirstDate(b)));

  const list =
    sessions.length === 0
      ? h("div", { class: "empty" }, "Пока нет встреч в расписании.")
      : h(
          "div",
          {},
          sessions.map((s) => sessionCard(state, s, { showEdit: isLeaderInGroup(state, s.groupId, state.meId) }))
        );

  const yNow = new Date().getFullYear();
  return h("div", {}, [
    topbar("Ближайшее", subtitle, pills),
    h("div", { class: "content" }, [
      h("div", { class: "actions", style: "margin-bottom:14px;" }, [
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => (location.hash = `#/year?y=${yNow}&mode=${encodeURIComponent(mode)}`),
          },
          "Вид на год"
        ),
      ]),
      h("div", { class: "sectionTitle" }, "Список встреч"),
      list,
    ]),
    nav("upcoming"),
  ]);
}

function yearCompactSession(state, session, year, month) {
  const g = groupById(state, session.groupId);
  const blocks = blocksInCalendarMonth(session, year, month).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const badgeClass = session.status === "подтверждено" ? "badge ok" : "badge warn";
  const badgeText = session.status === "подтверждено" ? "Подтверждено" : "Предварительно";

  return h(
    "div",
    {
      class: "compactSession",
      role: "button",
      tabindex: "0",
      onclick: () => (location.hash = `#/session?id=${encodeURIComponent(session.id)}`),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          location.hash = `#/session?id=${encodeURIComponent(session.id)}`;
        }
      },
    },
    [
      h("div", { class: "row" }, [
        h("div", { class: "groupTag" }, [
          h("div", { class: "dot", style: `background:${g?.color ?? "#7aa7ff"}` }),
          h("div", {}, [
            h("div", { class: "groupName" }, g?.name ?? "Группа"),
            h("div", { class: "small" }, g?.type ?? ""),
          ]),
        ]),
        h("div", { class: badgeClass }, badgeText),
      ]),
      h(
        "div",
        { class: "lines" },
        blocks.map((b) =>
          h("div", { class: "line" }, [
            h("div", { class: "k" }, "День"),
            h("div", {}, `${formatDateRu(b.date)} — ${formatTimeRange(b.startTime, b.endTime)}`),
          ])
        )
      ),
    ]
  );
}

function renderYear(state, year, mode = "lead") {
  const me = getMe(state);
  const subtitle = `${me?.name ?? "Пользователь"} • все месяцы выбранного года`;

  const pills = [
    {
      label: "Я веду",
      pressed: mode === "lead",
      onClick: () => (location.hash = `#/year?y=${year}&mode=lead`),
    },
    {
      label: "Я участник",
      pressed: mode === "part",
      onClick: () => (location.hash = `#/year?y=${year}&mode=part`),
    },
  ];

  const sessions = state.sessions.filter((s) => sessionVisibleForMe(state, s, mode));

  const strip = h(
    "div",
    { class: "yearStrip", "aria-label": "Месяцы с встречами" },
    RU_MONTHS.map((_, i) => {
      const m = i + 1;
      const n = countSessionsWithBlocksInMonth(sessions, year, m);
      return h(
        "div",
        { class: `yearDot${n > 0 ? " has" : ""}`, title: `${RU_MONTHS[i]} · встреч: ${n}` },
        String(m)
      );
    })
  );

  const yearBar = h("div", { class: "yearBar" }, [
    h(
      "button",
      { class: "btn", onclick: () => (location.hash = `#/year?y=${year - 1}&mode=${mode}`) },
      `← ${year - 1}`
    ),
    h("div", { class: "yearNum" }, String(year)),
    h(
      "button",
      { class: "btn", onclick: () => (location.hash = `#/year?y=${year + 1}&mode=${mode}`) },
      `${year + 1} →`
    ),
  ]);

  const monthsBlocks = RU_MONTHS.map((name, i) => {
    const m = i + 1;
    const inMonth = sessions
      .filter((s) => blocksInCalendarMonth(s, year, m).length > 0)
      .slice()
      .sort((a, b) => (sessionFirstDateInMonth(a, year, m) || "").localeCompare(sessionFirstDateInMonth(b, year, m) || ""));

    const body =
      inMonth.length === 0
        ? h("div", { class: "small" }, "Нет встреч в этом месяце.")
        : h("div", {}, inMonth.map((s) => yearCompactSession(state, s, year, m)));

    return h("div", { class: "monthBox", id: `m-${year}-${m}` }, [h("div", { class: "monthTitle" }, name), body]);
  });

  return h("div", {}, [
    topbar("Год", subtitle, pills),
    h("div", { class: "content" }, [
      yearBar,
      h("div", { class: "yearMini" }, "Цифры 1–12 — месяцы: подсвечены те, где есть хотя бы одна встреча. Ниже — подробности по каждому месяцу."),
      strip,
      ...monthsBlocks,
      h("div", { class: "actions" }, [
        h("button", { class: "btn", onclick: () => (location.hash = `#/upcoming?mode=${mode}`) }, "К списку «Ближайшее»"),
      ]),
    ]),
    nav("year"),
  ]);
}

function sessionCard(state, session, opts = {}) {
  const g = groupById(state, session.groupId);
  const leaders = session.leaders
    .map((l) => userById(state, l.userId))
    .filter(Boolean)
    .map((u) => u.name);

  const badgeClass = session.status === "подтверждено" ? "badge ok" : "badge warn";
  const badgeText = session.status === "подтверждено" ? "Подтверждено" : "Предварительно";

  return h("div", { class: "card" }, [
    h("div", { class: "row" }, [
      h("div", { class: "groupTag" }, [
        h("div", { class: "dot", style: `background:${g?.color ?? "#7aa7ff"}` }),
        h("div", {}, [
          h("div", { class: "groupName" }, g?.name ?? "Группа"),
          h("div", { class: "small" }, g?.type ?? ""),
        ]),
      ]),
      h("div", { class: badgeClass }, badgeText),
    ]),
    h(
      "div",
      { class: "lines" },
      session.blocks.map((b) =>
        h("div", { class: "line" }, [
          h("div", { class: "k" }, "День"),
          h("div", {}, `${formatDateRu(b.date)} — ${formatTimeRange(b.startTime, b.endTime)}`),
        ])
      )
    ),
    h("div", { class: "small" }, `Ведущие: ${leaders.join(", ")}`),
    session.note ? h("div", { class: "small" }, session.note) : null,
    h("div", { class: "actions" }, [
      h(
        "button",
        { class: "btn", onclick: () => (location.hash = `#/session?id=${encodeURIComponent(session.id)}`) },
        "Открыть"
      ),
      opts.showEdit
        ? h(
            "button",
            { class: "btn primary", onclick: () => (location.hash = `#/edit-session?id=${encodeURIComponent(session.id)}`) },
            "Изменить"
          )
        : null,
    ]),
  ]);
}

function renderGroups(state, tab = "lead") {
  const pills = [
    { label: "Где я ведущий", pressed: tab === "lead", onClick: () => (location.hash = "#/groups?tab=lead") },
    { label: "Где я участник", pressed: tab === "part", onClick: () => (location.hash = "#/groups?tab=part") },
  ];

  const groups = state.groups.filter((g) =>
    tab === "lead" ? isLeaderInGroup(state, g.id, state.meId) : isParticipantInGroup(state, g.id, state.meId)
  );

  const list =
    groups.length === 0
      ? h("div", { class: "empty" }, "Пока нет групп в этом разделе.")
      : h(
          "div",
          {},
          groups.map((g) => groupListCard(state, g))
        );

  return h("div", {}, [
    topbar("Группы", "Откройте группу, чтобы увидеть встречи и участников.", pills),
    h("div", { class: "content" }, [list]),
    nav("groups"),
  ]);
}

function groupNextSession(state, groupId) {
  const sessions = state.sessions.filter((s) => s.groupId === groupId).slice().sort((a, b) => sessionFirstDate(a).localeCompare(sessionFirstDate(b)));
  return sessions[0] || null;
}

function groupListCard(state, group) {
  const next = groupNextSession(state, group.id);
  const nextLine = next
    ? `${formatDateRu(sessionFirstDate(next))}${next.blocks.length > 1 ? ` • ${next.blocks.length} дня` : ""}`
    : "не запланировано";

  return h(
    "div",
    {
      class: "listCard",
      role: "button",
      tabindex: "0",
      onclick: () => (location.hash = `#/group?id=${encodeURIComponent(group.id)}`),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          location.hash = `#/group?id=${encodeURIComponent(group.id)}`;
        }
      },
    },
    [
      h("div", {}, [
        h("div", { class: "listTitle" }, group.name),
        h("div", { class: "listMeta" }, `${group.type} • ближайшее: ${nextLine}`),
      ]),
      h("div", { class: "chev" }, "›"),
    ]
  );
}

function renderGroup(state, groupId) {
  const g = groupById(state, groupId);
  if (!g) return renderNotFound("Группа не найдена");

  const canEdit = isLeaderInGroup(state, g.id, state.meId);

  const sessions = state.sessions
    .filter((s) => s.groupId === g.id)
    .slice()
    .sort((a, b) => sessionFirstDate(a).localeCompare(sessionFirstDate(b)));

  const leaders = state.groupMembers
    .filter((m) => m.groupId === g.id && m.isLeader)
    .map((m) => userById(state, m.userId)?.name)
    .filter(Boolean);

  const participants = state.groupMembers
    .filter((m) => m.groupId === g.id && m.isParticipant)
    .map((m) => userById(state, m.userId)?.name)
    .filter(Boolean);

  return h("div", {}, [
    topbar(g.name, g.type, null),
    h("div", { class: "content" }, [
      h("div", { class: "sectionTitle" }, "Ближайшие встречи"),
      sessions.length ? h("div", {}, sessions.slice(0, 3).map((s) => sessionCard(state, s, { showEdit: canEdit }))) : h("div", { class: "empty" }, "Пока нет встреч."),
      canEdit
        ? h("div", { class: "actions" }, [
            h("button", { class: "btn primary", onclick: () => (location.hash = `#/wizard?groupId=${encodeURIComponent(g.id)}`) }, "+ Запланировать встречу"),
          ])
        : null,
      h("div", { class: "hr" }),
      h("div", { class: "sectionTitle" }, "Ведущие"),
      h("div", { class: "card" }, [
        leaders.length ? h("div", { class: "lines" }, leaders.map((name) => h("div", { class: "line" }, [h("div", { class: "k" }, "•"), h("div", {}, name)]))) : h("div", { class: "empty" }, "Нет ведущих."),
      ]),
      h("div", { class: "sectionTitle" }, "Участники"),
      h("div", { class: "card" }, [
        participants.length ? h("div", { class: "lines" }, participants.map((name) => h("div", { class: "line" }, [h("div", { class: "k" }, "•"), h("div", {}, name)]))) : h("div", { class: "empty" }, "Список участников пока пуст."),
      ]),
      h("div", { class: "actions" }, [
        h("button", { class: "btn", onclick: () => history.back() }, "Назад"),
      ]),
    ]),
    nav("groups"),
  ]);
}

function renderCreate(state) {
  return h("div", {}, [
    topbar("Создать", "Самое частое действие — запланировать встречу группы.", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Группы"),
        h("div", { class: "small" }, "Сначала создайте группу, затем планируйте встречи и добавляйте людей."),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: () => (location.hash = "#/new-group") }, "+ Создать группу"),
        ]),
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "groupName" }, "Что вы хотите сделать?"),
        h("div", { class: "small" }, "Данные сохраняются на сервере (SQLite). Сценарий: плавающие даты и время «уточним позже»."),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: () => (location.hash = "#/wizard") }, "Запланировать встречу группы"),
          h("button", { class: "btn", onclick: () => alert("В MVP можно добавить позже, если нужно отдельным типом.") }, "Личная консультация (позже)"),
        ]),
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Быстрое тестирование"),
        h("div", { class: "small" }, "Сброс на сервере к демо-набору (все текущие правки пропадут)."),
        h("div", { class: "actions" }, [
          h("button", { class: "btn danger", onclick: async () => {
            try {
              const r = await fetch(`${API_BASE}/api/reset-demo`, { method: "POST" });
              if (!r.ok) throw new Error(await r.text());
              state = await r.json();
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
              location.hash = "#/upcoming";
              renderApp();
            } catch (e) {
              alert("Не удалось сбросить на сервере. Запустите npm start или проверьте сеть.");
              console.error(e);
            }
          } }, "Сбросить демо на сервере"),
        ]),
      ]),
    ]),
    nav("create"),
  ]);
}

function renderNewGroup(state) {
  const nameId = "ng_name";
  const typeId = "ng_type";
  const colorId = "ng_color";

  const onSave = async () => {
    const name = (document.getElementById(nameId)?.value || "").trim();
    const type = document.getElementById(typeId)?.value || "другое";
    const color = document.getElementById(colorId)?.value || "#7aa7ff";
    if (!name) return alert("Введите название группы.");

    const g = { id: uid("g"), name, type, color };
    state.groups.push(g);
    state.groupMembers.push({ groupId: g.id, userId: state.meId, isLeader: true, isParticipant: false });
    await saveState(state);
    location.hash = `#/group?id=${encodeURIComponent(g.id)}`;
  };

  const typeSel = h(
    "select",
    { id: typeId },
    GROUP_TYPES.map((t) => h("option", { value: t.id }, t.label))
  );

  return h("div", {}, [
    topbar("Новая группа", "Создайте группу: тип, цвет и название.", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "form" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: nameId }, "Название"),
            h("input", { id: nameId, placeholder: "Например: Супервизия по четвергам" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: typeId }, "Тип"),
            typeSel,
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: colorId }, "Цвет"),
            h("input", { id: colorId, type: "color", value: "#7aa7ff" }),
          ]),
          h("div", { class: "actions" }, [
            h("button", { class: "btn primary", onclick: onSave }, "Создать"),
            h("button", { class: "btn", onclick: () => history.back() }, "Отмена"),
          ]),
        ]),
      ]),
    ]),
    nav("groups"),
  ]);
}

function renderProfile(state) {
  const me = getMe(state);
  const canLinkEmail = isTelegramWebApp() && currentUserId && String(currentUserId).startsWith("tg:");
  return h("div", {}, [
    topbar("Профиль", "Основное хранилище — SQLite на сервере; в браузере дубль на случай недоступности.", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "groupName" }, me?.name ?? "Пользователь"),
        h("div", { class: "small" }, "В будущем здесь будет вход по коду, роли и управление сообществом."),
        h("div", { class: "actions" }, [
          h("button", { class: "btn", onclick: () => alert("Пока нет. Это прототип UI.") }, "Настройки (позже)"),
        ]),
      ]),
      canLinkEmail
        ? (() => {
            const emailId = "link_email";
            const passId = "link_pass";
            const onLink = async () => {
              const email = document.getElementById(emailId)?.value || "";
              const password = document.getElementById(passId)?.value || "";
              try {
                const r = await fetch(`${API_BASE}/api/auth/email-link`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email, password }),
                });
                const txt = await r.text();
                let j = null;
                try { j = JSON.parse(txt); } catch { j = { error: txt }; }
                if (!r.ok) throw new Error(j?.error || txt);
                alert("Email привязан. Теперь можно входить в браузере по email+паролю.");
              } catch (e) {
                alert(String(e.message || e));
              }
            };
            return h("div", { class: "card" }, [
              h("div", { class: "sectionTitle" }, "Привязать email (для входа в браузере)"),
              h("div", { class: "small" }, "Привязка доступна после входа через Telegram. Пароль хранится в Supabase (в хэше)."),
              h("div", { class: "form" }, [
                h("div", { class: "field" }, [
                  h("label", { class: "label", for: emailId }, "Email"),
                  h("input", { id: emailId, placeholder: "you@example.com", inputmode: "email", autocomplete: "email" }),
                ]),
                h("div", { class: "field" }, [
                  h("label", { class: "label", for: passId }, "Пароль"),
                  h("input", { id: passId, type: "password", placeholder: "минимум 6 символов" }),
                ]),
                h("div", { class: "actions" }, [h("button", { class: "btn primary", onclick: onLink }, "Привязать")]),
              ]),
            ]);
          })()
        : null,
      h("div", { class: "actions" }, [
        h(
          "button",
          {
            class: "btn danger",
            onclick: async () => {
              try {
                await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
                currentUserId = null;
                location.hash = "#/login";
                state = buildDemoState();
                renderApp();
                // Внутри Telegram ожидаемо "выйти и сразу войти" — попробуем перелогин.
                if (isTelegramWebApp()) {
                  const r = await tryTelegramLogin();
                  if (r.ok) {
                    state = await loadState();
                    location.hash = "#/upcoming";
                    renderApp();
                  }
                }
              } catch (e) {
                alert("Не удалось выйти. Обновите страницу.");
                console.error(e);
              }
            },
          },
          "Выйти"
        ),
      ]),
    ]),
    nav("profile"),
  ]);
}

function renderSession(state, sessionId) {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s) return renderNotFound("Встреча не найдена");
  const g = groupById(state, s.groupId);

  const leaders = s.leaders
    .map((l) => {
      const name = userById(state, l.userId)?.name ?? "Тренер";
      if (l.days && l.days !== "all") return `${name} — ${l.days.join(", ")}`;
      return name;
    })
    .join(", ");

  const canEdit = isLeaderInGroup(state, s.groupId, state.meId);

  return h("div", {}, [
    topbar("Встреча", g?.name ?? "Группа", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "row" }, [
          h("div", { class: "groupTag" }, [
            h("div", { class: "dot", style: `background:${g?.color ?? "#7aa7ff"}` }),
            h("div", {}, [
              h("div", { class: "groupName" }, g?.name ?? "Группа"),
              h("div", { class: "small" }, g?.type ?? ""),
            ]),
          ]),
          h("div", { class: s.status === "подтверждено" ? "badge ok" : "badge warn" }, s.status === "подтверждено" ? "Подтверждено" : "Предварительно"),
        ]),
        h("div", { class: "lines" }, s.blocks.map((b) => h("div", { class: "line" }, [h("div", { class: "k" }, "День"), h("div", {}, `${formatDateRu(b.date)} — ${formatTimeRange(b.startTime, b.endTime)}`)]))),
        h("div", { class: "small" }, `Ведущие: ${leaders}`),
        s.note ? h("div", { class: "small" }, s.note) : null,
        h("div", { class: "actions" }, [
          canEdit ? h("button", { class: "btn primary", onclick: () => (location.hash = `#/edit-session?id=${encodeURIComponent(s.id)}`) }, "Изменить") : null,
          h("button", { class: "btn", onclick: () => history.back() }, "Назад"),
        ]),
      ]),
    ]),
    nav("upcoming"),
  ]);
}

function renderEditSession(state, sessionId) {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s) return renderNotFound("Встреча не найдена");
  const g = groupById(state, s.groupId);
  const canEdit = isLeaderInGroup(state, s.groupId, state.meId);
  if (!canEdit) return renderNotFound("Нет прав на редактирование");

  const root = h("div", {}, [
    topbar("Изменить", g?.name ?? "Группа", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Статус"),
        h("div", { class: "form" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: "status" }, "Статус встречи"),
            (() => {
              const sel = h("select", { id: "status" }, [
                h("option", { value: "предварительно", selected: s.status === "предварительно" }, "Предварительно"),
                h("option", { value: "подтверждено", selected: s.status === "подтверждено" }, "Подтверждено"),
              ]);
              return sel;
            })(),
          ]),
        ]),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Дни и время"),
        ...s.blocks.map((b, idx) => editBlockUI(b, idx)),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Ведущие этой встречи"),
        editLeadersUI(state, s),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Заметка"),
        (() => {
          const inp = h("input", { id: "note", value: s.note ?? "", placeholder: "Например: тема встречи, ссылка, примечание" });
          return inp;
        })(),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: async () => onSaveEdit(state, s) }, "Сохранить"),
          h("button", { class: "btn", onclick: () => history.back() }, "Отмена"),
        ]),
      ]),
    ]),
    nav("upcoming"),
  ]);

  function editBlockUI(block, idx) {
    const dateId = `d_${idx}`;
    const sId = `s_${idx}`;
    const eId = `e_${idx}`;
    return h("div", { class: "card" }, [
      h("div", { class: "groupName" }, `День ${idx + 1}`),
      h("div", { class: "form" }, [
        h("div", { class: "field" }, [
          h("label", { class: "label", for: dateId }, "Дата"),
          h("input", { id: dateId, type: "date", value: block.date ?? "" }),
        ]),
        h("div", { class: "grid2" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: sId }, "С"),
            h("input", { id: sId, type: "time", value: block.startTime ?? "" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: eId }, "До"),
            h("input", { id: eId, type: "time", value: block.endTime ?? "" }),
          ]),
        ]),
        h("div", { class: "hint" }, "Если время неизвестно — оставьте поля “С/До” пустыми (будет “время уточним”)."),
      ]),
    ]);
  }

  return root;
}

function editLeadersUI(state, session) {
  const container = h("div", { class: "form" }, []);

  const leaderIds = new Set(session.leaders.map((l) => l.userId));
  const people = state.users.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const list = h(
    "div",
    { class: "card" },
    people.map((u) => {
      const id = `leader_${u.id}`;
      const checked = leaderIds.has(u.id);
      const cb = h("input", { type: "checkbox", id, ...(checked ? { checked: true } : {}) });
      cb.style.minHeight = "22px";
      cb.style.width = "22px";
      cb.style.accentColor = "#7aa7ff";

      return h("div", { class: "line" }, [
        h("div", { class: "k" }, ""),
        cb,
        h("label", { for: id }, u.name),
      ]);
    })
  );

  container.appendChild(h("div", { class: "hint" }, "Отметьте, кто ведёт эту встречу. По умолчанию — основные ведущие группы, но можно добавить гостя."));
  container.appendChild(list);
  container.appendChild(h("div", { class: "hint" }, "Расширение (позже): можно будет указать “гость только на один день” без усложнения основного сценария."));
  return container;
}

async function onSaveEdit(state, session) {
  const status = document.getElementById("status")?.value || session.status;
  const note = document.getElementById("note")?.value ?? "";

  const blocks = session.blocks.map((b, idx) => {
    const date = tryParseISODate(document.getElementById(`d_${idx}`)?.value) || b.date;
    const startTime = document.getElementById(`s_${idx}`)?.value ?? "";
    const endTime = document.getElementById(`e_${idx}`)?.value ?? "";
    return { ...b, date, startTime, endTime };
  });

  const leaders = [];
  for (const u of state.users) {
    const id = `leader_${u.id}`;
    const el = document.getElementById(id);
    if (el && el.checked) leaders.push({ userId: u.id, days: "all" });
  }
  if (leaders.length === 0) {
    alert("Нужно выбрать хотя бы одного ведущего встречи.");
    return;
  }

  const updated = { ...session, status, note, blocks, leaders };
  const conflicts = computeConflicts(state, updated);
  if (conflicts.length) {
    const msg = conflicts.slice(0, 6).join("\n") + (conflicts.length > 6 ? "\n…" : "");
    const ok = confirm(`${msg}\n\nСохранить всё равно? (можно сохранить как “предварительно”)`);
    if (!ok) return;
    if (updated.status === "подтверждено") updated.status = "предварительно";
  }

  const idx = state.sessions.findIndex((x) => x.id === session.id);
  state.sessions[idx] = updated;
  await saveState(state);
  location.hash = `#/session?id=${encodeURIComponent(session.id)}`;
}

function renderWizard(state, presetGroupId) {
  // Шаг 1: группа, шаг 2: формат, шаг 3: дни/время, шаг 4: резюме.
  let step = 1;
  let groupId = presetGroupId || "";
  let format = "1"; // "1" | "2" | "3" | "custom"
  let blocks = [];
  let status = "предварительно";

  const root = h("div", {}, [
    topbar("Новая встреча", "Мастер из 3 шагов. Можно оставить время пустым (“уточним”).", null),
    h("div", { class: "content", id: "wiz" }, []),
    nav("create"),
  ]);

  const mount = root.querySelector("#wiz");

  const render = () => {
    mount.innerHTML = "";
    if (step === 1) mount.appendChild(step1());
    if (step === 2) mount.appendChild(step2());
    if (step === 3) mount.appendChild(step3());
    if (step === 4) mount.appendChild(step4());
  };

  const step1 = () => {
    if (!state.groups.length) {
      return h("div", { class: "card" }, [
        h("div", { class: "groupName" }, "Шаг 1: группа"),
        h("div", { class: "small" }, "Пока нет ни одной группы. Сначала создайте группу — потом сможете планировать встречи."),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: () => (location.hash = "#/new-group") }, "+ Создать группу"),
          h("button", { class: "btn", onclick: () => (location.hash = "#/create") }, "Назад"),
        ]),
      ]);
    }
    const sel = h(
      "select",
      { id: "groupSel" },
      [
        h("option", { value: "" }, "— выберите группу —"),
        ...state.groups.map((g) => h("option", { value: g.id, selected: g.id === groupId }, g.name)),
      ]
    );

    return h("div", { class: "card" }, [
      h("div", { class: "groupName" }, "Шаг 1: группа"),
      h("div", { class: "form" }, [
        h("div", { class: "field" }, [h("label", { class: "label", for: "groupSel" }, "Группа"), sel]),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: () => {
            groupId = sel.value;
            if (!groupId) return alert("Выберите группу.");
            step = 2;
            render();
          }}, "Дальше"),
          h("button", { class: "btn", onclick: () => (location.hash = "#/create") }, "Отмена"),
        ]),
      ]),
    ]);
  };

  const step2 = () => {
    const mk = (val, label, hint) =>
      h("button", { class: "btn primary", onclick: () => { format = val; step = 3; render(); } }, `${label}\n`);

    return h("div", { class: "card" }, [
      h("div", { class: "groupName" }, "Шаг 2: формат"),
      h("div", { class: "small" }, "Выберите, сколько дней. Если длительность другая — можно выбрать 1 день и указать время (или оставить пустым)."),
      h("div", { class: "actions" }, [
        mk("1", "1 день"),
        mk("2", "2 дня подряд"),
        mk("3", "3 дня подряд"),
      ]),
      h("div", { class: "actions" }, [
        h("button", { class: "btn", onclick: () => { step = 1; render(); } }, "Назад"),
      ]),
    ]);
  };

  const step3 = () => {
    const count = Number(format);
    blocks = blocks.length ? blocks : Array.from({ length: count }, () => ({ id: uid("b"), date: "", startTime: "", endTime: "" }));
    const group = groupById(state, groupId);

    const blockForms = blocks.map((b, idx) => {
      const dateId = `wd_${idx}`;
      const sId = `ws_${idx}`;
      const eId = `we_${idx}`;
      return h("div", { class: "card" }, [
        h("div", { class: "groupName" }, `День ${idx + 1}`),
        h("div", { class: "form" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: dateId }, "Дата"),
            h("input", { id: dateId, type: "date", value: b.date }),
          ]),
          h("div", { class: "grid2" }, [
            h("div", { class: "field" }, [
              h("label", { class: "label", for: sId }, "С"),
              h("input", { id: sId, type: "time", value: b.startTime }),
            ]),
            h("div", { class: "field" }, [
              h("label", { class: "label", for: eId }, "До"),
              h("input", { id: eId, type: "time", value: b.endTime }),
            ]),
          ]),
          h("div", { class: "hint" }, "Можно не указывать время — будет “время уточним позже”. Дату лучше указать, но в прототипе можно оставить пустой."),
        ]),
      ]);
    });

    const statusSel = h("select", { id: "wStatus" }, [
      h("option", { value: "предварительно", selected: status === "предварительно" }, "Предварительно"),
      h("option", { value: "подтверждено", selected: status === "подтверждено" }, "Подтверждено"),
    ]);

    return h("div", {}, [
      h("div", { class: "card" }, [
        h("div", { class: "groupTag" }, [
          h("div", { class: "dot", style: `background:${group?.color ?? "#7aa7ff"}` }),
          h("div", {}, [
            h("div", { class: "groupName" }, group?.name ?? "Группа"),
            h("div", { class: "small" }, "Шаг 3: даты и время"),
          ]),
        ]),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: "wStatus" }, "Статус"),
          statusSel,
        ]),
      ]),
      ...blockForms,
      h("div", { class: "actions" }, [
        h("button", { class: "btn primary", onclick: () => {
          status = document.getElementById("wStatus")?.value || status;
          blocks = blocks.map((b, idx) => {
            const date = tryParseISODate(document.getElementById(`wd_${idx}`)?.value) || "";
            const startTime = document.getElementById(`ws_${idx}`)?.value ?? "";
            const endTime = document.getElementById(`we_${idx}`)?.value ?? "";
            return { ...b, date, startTime, endTime };
          });
          step = 4;
          render();
        }}, "Дальше"),
        h("button", { class: "btn", onclick: () => { step = 2; render(); } }, "Назад"),
      ]),
    ]);
  };

  const step4 = () => {
    const group = groupById(state, groupId);
    const leaders = state.groupMembers
      .filter((m) => m.groupId === groupId && m.isLeader)
      .map((m) => ({ userId: m.userId, days: "all" }));

    const draft = {
      id: uid("s"),
      groupId,
      status,
      leaders,
      blocks: blocks.map((b) => ({ ...b })),
      note: "",
    };

    const conflicts = computeConflicts(state, draft);

    return h("div", {}, [
      h("div", { class: "card" }, [
        h("div", { class: "groupName" }, "Резюме"),
        h("div", { class: "small" }, "Проверьте и сохраните. Ведущие будут автоматически взяты из “основных ведущих группы”. Гостя можно добавить позже через “Изменить”."),
        h("div", { class: "lines" }, [
          h("div", { class: "line" }, [h("div", { class: "k" }, "Группа"), h("div", {}, group?.name ?? "—")]),
          h("div", { class: "line" }, [h("div", { class: "k" }, "Статус"), h("div", {}, status)]),
          ...draft.blocks.map((b) => h("div", { class: "line" }, [h("div", { class: "k" }, "День"), h("div", {}, `${formatDateRu(b.date)} — ${formatTimeRange(b.startTime, b.endTime)}`)])),
        ]),
        conflicts.length
          ? h("div", { class: "card", style: "margin-top:12px; border-color: rgba(255,204,102,.35);" }, [
              h("div", { class: "groupName" }, "Возможные пересечения"),
              h("div", { class: "small" }, conflicts.slice(0, 6).join("\n")),
              h("div", { class: "hint" }, "Если время где-то не указано, это только предупреждение. Можно сохранить как “предварительно”."),
            ])
          : null,
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: async () => {
            if (conflicts.length && draft.status === "подтверждено") draft.status = "предварительно";
            state.sessions.push(draft);
            await saveState(state);
            location.hash = `#/session?id=${encodeURIComponent(draft.id)}`;
          }}, "Сохранить"),
          h("button", { class: "btn", onclick: () => { step = 3; render(); } }, "Назад"),
        ]),
      ]),
    ]);
  };

  render();
  return root;
}

function renderNotFound(msg) {
  return h("div", {}, [
    topbar("Ошибка", msg, null),
    h("div", { class: "content" }, [
      h("div", { class: "empty" }, msg),
      h("div", { class: "actions" }, [h("button", { class: "btn", onclick: () => (location.hash = "#/upcoming") }, "На главную")]),
    ]),
    nav("upcoming"),
  ]);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const path = "/" + (pathPart || "upcoming");
  const params = new URLSearchParams(queryPart || "");
  return { path, params };
}

let state = null;

function renderApp() {
  const { path, params } = parseHash();
  const app = document.getElementById("app");
  app.innerHTML = "";

  if (!state) {
    app.appendChild(h("div", { class: "content" }, [h("div", { class: "empty" }, "Загрузка…")]));
    return;
  }
  if (path === "/login") {
    app.appendChild(renderLogin(state));
    return;
  }
  if (path === "/new-group") {
    app.appendChild(renderNewGroup(state));
    return;
  }
  if (path === "/") location.hash = "#/upcoming";
  else if (path === "/upcoming") app.appendChild(renderUpcoming(state, params.get("mode") || "lead"));
  else if (path === "/year") {
    const y = Number.parseInt(params.get("y"), 10);
    const year = Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    app.appendChild(renderYear(state, year, params.get("mode") || "lead"));
  }
  else if (path === "/groups") app.appendChild(renderGroups(state, params.get("tab") || "lead"));
  else if (path === "/group") app.appendChild(renderGroup(state, params.get("id")));
  else if (path === "/create") app.appendChild(renderCreate(state));
  else if (path === "/profile") app.appendChild(renderProfile(state));
  else if (path === "/wizard") app.appendChild(renderWizard(state, params.get("groupId")));
  else if (path === "/session") app.appendChild(renderSession(state, params.get("id")));
  else if (path === "/edit-session") app.appendChild(renderEditSession(state, params.get("id")));
  else app.appendChild(renderNotFound("Страница не найдена"));
}

window.addEventListener("hashchange", renderApp);

async function boot() {
  // Подготовка Telegram WebApp (если внутри Telegram).
  if (isTelegramWebApp()) {
    try {
      window.Telegram.WebApp.ready();
    } catch {}
  }
  // 1) Если это Telegram WebApp — пробуем автологин
  if (isTelegramWebApp()) {
    await tryTelegramLogin();
  }
  // 2) Проверим сессию; если нет — покажем вход
  try {
    const me = await fetch(`${API_BASE}/api/me`);
    if (me.ok) {
      const mj = await me.json();
      currentUserId = mj.userId;
      state = await loadState();
      renderApp();
      return;
    }
  } catch {}
  location.hash = "#/login";
  state = buildDemoState();
  renderApp();
}
boot();

