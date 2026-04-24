// SPA без сборки: hash-роутинг. Данные с сервера (SQLite); localStorage — запасной вариант.
const STORAGE_KEY = "psy_cabinet_v1";
const API_BASE = "";
let currentUserId = null;
/** undefined — ещё не запрашивали; null — нет записи в app_accounts; string — привязанный email */
let profileLinkedEmail = undefined;
const SUPERADMIN_USER_ID = "tg:373134197";

function isSuperAdmin() {
  return String(currentUserId || "") === SUPERADMIN_USER_ID;
}

async function refreshLinkedEmail() {
  try {
    const r = await fetch(`${API_BASE}/api/me`);
    if (!r.ok) {
      profileLinkedEmail = null;
      return;
    }
    const j = await r.json();
    profileLinkedEmail = j.linkedEmail != null ? j.linkedEmail : null;
  } catch {
    profileLinkedEmail = null;
  }
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/** Поля сессии для карточки встречи (этап 1): тема, резюме, приватные заметки ведущего. */
function emptySessionFields() {
  return { theme: "", summary: "", privateNotes: "" };
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

/** ДД.ММ для компактной строки в PDF. */
function formatDateDot(iso) {
  if (!iso || !tryParseISODate(iso)) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${pad2(d)}.${pad2(m)}`;
}

function truncateText(s, max) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatTimeRange(start, end) {
  if (!start || !end) return "время уточним";
  return `${start}–${end}`;
}

const RU_DOW_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const RU_DOW_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

function formatWeeklySlotLine(session) {
  if (session.weeklyDay == null || typeof session.weeklyDay !== "number") return null;
  const d = RU_DOW_SHORT[session.weeklyDay];
  if (!d) return null;
  const tr = formatTimeRange(session.weeklyStart, session.weeklyEnd);
  return `Обычно: ${d} · ${tr}`;
}

function addDaysToIso(iso, deltaDays) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Копия встречи со сдвигом дат блоков; статус «предварительно». Возвращает новую сессию. */
function cloneSessionShiftDays(state, session, deltaDays) {
  const blocks = session.blocks.map((b) => {
    const d = tryParseISODate(b.date);
    if (!d) return { ...b };
    return { ...b, date: addDaysToIso(d, deltaDays) };
  });
  const copy = {
    ...session,
    id: uid("s"),
    status: "предварительно",
    blocks,
    note: session.note ?? "",
    theme: session.theme ?? "",
    summary: session.summary ?? "",
    privateNotes: session.privateNotes ?? "",
    leaders: session.leaders.map((l) => ({ ...l })),
  };
  delete copy.homework;
  if (typeof session.weeklyDay === "number") copy.weeklyDay = session.weeklyDay;
  else delete copy.weeklyDay;
  if (session.weeklyStart) copy.weeklyStart = session.weeklyStart;
  else delete copy.weeklyStart;
  if (session.weeklyEnd) copy.weeklyEnd = session.weeklyEnd;
  else delete copy.weeklyEnd;
  state.sessions.push(copy);
  return copy;
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
  { id: "личная", label: "Личная консультация" },
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

function normalizeClientState(state) {
  if (!state || !Array.isArray(state.sessions)) return;
  for (const s of state.sessions) {
    if (s && "homework" in s) delete s.homework;
  }
}

function ensureMeMatchesSession(state) {
  if (!state || typeof state !== "object") return;
  if (!currentUserId) return;
  // Когда пользователь залогинен, идентификатор "я" должен совпадать с userId сессии (tg:... / email:...).
  // Но если раньше данные велись под другим meId (демо u_... или другой способ входа),
  // нужно мигрировать ссылочные поля, иначе группы "пропадут" из фильтров.
  let changed = false;
  const prevMeId = typeof state.meId === "string" ? state.meId : null;
  const nextMeId = String(currentUserId);
  const needMigrate = prevMeId && prevMeId !== nextMeId;
  // Важно: не "угадываем" legacy id — это может перепривязать чужих людей и сломать данные.
  // Мигрируем только явный случай: старый meId был локальным u_..., а новый — реальный аккаунт.
  const legacyMeId =
    needMigrate && String(prevMeId).startsWith("u_") && (String(nextMeId).startsWith("tg:") || String(nextMeId).startsWith("email:"))
      ? prevMeId
      : null;

  if (legacyMeId && legacyMeId !== nextMeId) {
    if (Array.isArray(state.users)) {
      for (const u of state.users) {
        if (u && u.id === legacyMeId) u.id = nextMeId;
      }
    }
    if (Array.isArray(state.groupMembers)) {
      for (const m of state.groupMembers) {
        if (m && m.userId === legacyMeId) m.userId = nextMeId;
      }
    }
    if (Array.isArray(state.sessions)) {
      for (const s of state.sessions) {
        if (!s || !Array.isArray(s.leaders)) continue;
        for (const l of s.leaders) {
          if (l && l.userId === legacyMeId) l.userId = nextMeId;
        }
      }
    }
    changed = true;
  }

  if (state.meId !== nextMeId) {
    state.meId = nextMeId;
    changed = true;
  }
  if (!Array.isArray(state.users)) state.users = [];
  if (!state.users.some((u) => u && u.id === state.meId)) {
    state.users.push({ id: state.meId, name: "Вы", profile: {} });
    changed = true;
  }

  return changed;
}

async function reconcileSharedGroupsRemote(state) {
  if (!state) return;
  if (!currentUserId) return;
  // Только на сервере (Vercel). Локально endpoint отсутствует — тихо пропускаем.
  try {
    async function postJson(endpoint, body) {
      const r = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      let j = null;
      try {
        j = await r.json();
      } catch {
        j = null;
      }
      if (!r.ok) {
        const msg = String(j?.message || j?.error || `HTTP ${r.status}`);
        const err = new Error(msg);
        err.status = r.status;
        err.payload = j;
        throw err;
      }
      return j;
    }

    const me = String(currentUserId || "");
    const groups = Array.isArray(state.groups) ? state.groups : [];
    const targets = [];
    for (const g of groups) {
      if (!g || !g.id) continue;
      const gid = String(g.id);
      const owner = g.ownerLeaderId ? String(g.ownerLeaderId) : null;
      const isMember = (state.groupMembers || []).some(
        (m) => m && m.groupId === gid && m.userId === me && (m.isLeader || m.isParticipant)
      );
      // Если группа "чужая" (есть ownerLeaderId) или я не владелец кабинета, но участник — подтянем встречи с сервера.
      const should =
        isMember &&
        (Boolean(owner) ||
          (state.groupMembers || []).some((m) => m && m.groupId === gid && m.isLeader && m.userId && m.userId !== me));
      if (should) targets.push(gid);
    }
    const uniq = Array.from(new Set(targets));
    for (const gid of uniq) {
      try {
        await postJson("/api/sync/shared-group", { groupId: gid });
      } catch {
        // ignore: endpoint может быть недоступен локально
      }
    }
    if (uniq.length) {
      // перечитаем state после серверного merge
      const r = await fetch(`${API_BASE}/api/state`);
      if (r.ok) {
        const st = await r.json();
        normalizeClientState(st);
        ensureMeMatchesSession(st);
        Object.assign(state, st);
      }
    }
  } catch {
    // ignore
  }
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
    const st = await r.json();
    normalizeClientState(st);
    ensureMeMatchesSession(st);
    await reconcileSharedGroupsRemote(st);
    return st;
  } catch (e) {
    console.warn("Нет ответа от сервера, пробуем локальное хранилище.", e);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      normalizeClientState(st);
      ensureMeMatchesSession(st);
      return st;
    }
    const fallback = buildDemoState();
    ensureMeMatchesSession(fallback);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

async function saveState(state) {
  ensureMeMatchesSession(state);
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

function canSendPdfToTelegram() {
  return Boolean(currentUserId && String(currentUserId).startsWith("tg:"));
}

function depsPdfRasterReady() {
  return typeof window.html2canvas === "function" && window.jspdf && window.jspdf.jsPDF;
}

/** Перед снимком задаём ширину ~лист A4, иначе с телефона канвас узкий → в PDF полоска по центру. */
function applyPdfCaptureViewport(sheetEl, landscape) {
  const wrap = sheetEl.closest(".pdfYearWrap, .pdfClientWrap");
  const targetPx = landscape ? 1180 : 840;
  const els = [sheetEl, wrap].filter(Boolean);
  const prev = els.map((el) => ({
    el,
    width: el.style.width,
    maxWidth: el.style.maxWidth,
    minWidth: el.style.minWidth,
    boxSizing: el.style.boxSizing,
    marginLeft: el.style.marginLeft,
    marginRight: el.style.marginRight,
  }));
  const body = document.body;
  const app = document.getElementById("app");
  const prevBodyOx = body.style.overflowX;
  const prevAppMin = app ? app.style.minWidth : "";
  const prevAppOv = app ? app.style.overflow : "";

  body.classList.add("pdf-capture-active");
  body.style.overflowX = "visible";
  if (app) {
    app.style.overflow = "visible";
    app.style.minWidth = `${targetPx}px`;
  }
  for (const el of els) {
    el.style.boxSizing = "border-box";
    el.style.width = `${targetPx}px`;
    el.style.maxWidth = `${targetPx}px`;
    el.style.minWidth = `${targetPx}px`;
    el.style.marginLeft = "auto";
    el.style.marginRight = "auto";
  }

  return function restorePdfCaptureViewport() {
    body.classList.remove("pdf-capture-active");
    body.style.overflowX = prevBodyOx;
    if (app) {
      app.style.minWidth = prevAppMin;
      app.style.overflow = prevAppOv;
    }
    for (const p of prev) {
      p.el.style.width = p.width;
      p.el.style.maxWidth = p.maxWidth;
      p.el.style.minWidth = p.minWidth;
      p.el.style.boxSizing = p.boxSizing;
      p.el.style.marginLeft = p.marginLeft;
      p.el.style.marginRight = p.marginRight;
    }
  };
}

/**
 * Растр блока .pdfYearSheet / .pdfClientSheet в PDF (кириллица сохраняется).
 * @param {{ singlePage?: boolean }} opts — для года: singlePage=true (вписать весь лист в одну страницу, как при печати).
 */
async function captureSheetToPdfBlob(sheetEl, landscape, opts = {}) {
  const singlePage = Boolean(opts.singlePage);
  if (!depsPdfRasterReady() || !sheetEl) return null;
  const scale = singlePage ? (isTelegramWebApp() ? 2.25 : 2.5) : isTelegramWebApp() ? 2 : 2.25;
  window.scrollTo(0, 0);
  const restoreViewport = applyPdfCaptureViewport(sheetEl, landscape);
  let canvas;
  try {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    canvas = await window.html2canvas(sheetEl, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      imageTimeout: 20000,
      removeContainer: true,
    });
  } finally {
    restoreViewport();
  }
  if (!canvas) return null;
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (srcW < 2 || srcH < 2) return null;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = singlePage ? 4 : 6;
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin;

  const imgData = canvas.toDataURL("image/jpeg", 0.9);

  const fitContainOnePage = () => {
    let wMm = maxW;
    let hMm = (maxW * srcH) / srcW;
    if (hMm > maxH) {
      hMm = maxH;
      wMm = (maxH * srcW) / srcH;
    }
    const x = margin + (maxW - wMm) / 2;
    const y = margin + (maxH - hMm) / 2;
    doc.addImage(imgData, "JPEG", x, y, wMm, hMm);
  };

  if (singlePage) {
    fitContainOnePage();
    return doc.output("blob");
  }

  const naturalHmm = (maxW * srcH) / srcW;
  if (naturalHmm <= maxH + 0.5) {
    fitContainOnePage();
  } else {
    const sliceH = Math.max(1, Math.floor((maxH * srcW) / maxW));
    let y0 = 0;
    let first = true;
    while (y0 < srcH) {
      if (!first) doc.addPage("a4", landscape ? "l" : "p");
      first = false;
      const sh = Math.min(sliceH, srcH - y0);
      const c2 = document.createElement("canvas");
      c2.width = srcW;
      c2.height = sh;
      c2.getContext("2d").drawImage(canvas, 0, y0, srcW, sh, 0, 0, srcW, sh);
      const part = c2.toDataURL("image/jpeg", 0.9);
      const hMm = (maxW * sh) / srcW;
      doc.addImage(part, "JPEG", margin, margin, maxW, hMm);
      y0 += sh;
    }
  }
  return doc.output("blob");
}

function blobToBase64ForUpload(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const u = String(fr.result || "");
      const i = u.indexOf(",");
      resolve(i === -1 ? u : u.slice(i + 1));
    };
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}

async function sendPdfToTelegramApi(blob, filename, caption) {
  const data = await blobToBase64ForUpload(blob);
  const r = await fetch(`${API_BASE}/api/telegram/send-document`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      filename,
      caption: String(caption || "").slice(0, 900),
      data,
    }),
  });
  const txt = await r.text();
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    j = { error: txt };
  }
  if (!r.ok) {
    const msg = j.message || j.error || txt;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(j));
  }
}

function pdfTelegramSendButton({ sheetSelector, landscape, filename, caption, btnId, singlePage }) {
  if (!canSendPdfToTelegram()) return null;
  const label = "В чат с ботом (PDF)";
  return h(
    "button",
    {
      class: "btn primary",
      id: btnId,
      onclick: async () => {
        const el = document.querySelector(sheetSelector);
        if (!el) return alert("Не найден блок для PDF.");
        if (!depsPdfRasterReady()) {
          return alert("Не загрузились библиотеки для PDF. Проверьте сеть и обновите страницу.");
        }
        const btn = document.getElementById(btnId);
        const prev = btn ? btn.textContent : label;
        try {
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Формирую PDF…";
          }
          await new Promise((r) => setTimeout(r, 80));
          const blob = await captureSheetToPdfBlob(el, landscape, { singlePage: !!singlePage });
          if (!blob || blob.size < 32) throw new Error("Не удалось сформировать PDF");
          if (btn) btn.textContent = "Отправляю…";
          await sendPdfToTelegramApi(blob, filename, caption);
          alert("PDF отправлен в чат с ботом.");
        } catch (e) {
          const m = String(e.message || e);
          if (m.includes("local_server") || m.includes("501")) {
            alert(
              "На локальном сервере (npm start) бот недоступен. Отправка работает на сайте с Vercel, открытом через Telegram."
            );
          } else if (m.includes("Unauthorized") || m.includes("401")) {
            alert("Сессия недействительна. Закройте WebApp и откройте снова из Telegram.");
          } else if (m.toLowerCase().includes("only_telegram")) {
            alert("Отправка в Telegram доступна только при входе через бота.");
          } else if (m.includes("chat not found") || m.includes("bot was blocked")) {
            alert("Не удалось доставить: напишите боту /start в личке и попробуйте снова.");
          } else {
            alert(m || "Не удалось отправить файл.");
          }
          console.error(e);
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = prev;
          }
        }
      },
    },
    label
  );
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
    await refreshLinkedEmail();
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
      await refreshLinkedEmail();
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

function getMeIndex(state) {
  return state.users.findIndex((u) => u.id === state.meId);
}

function fullNameFromProfile(p) {
  const first = String(p?.firstName || "").trim();
  const last = String(p?.lastName || "").trim();
  const s = `${first} ${last}`.trim();
  return s || null;
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

function sortSessionsChronological(sessions) {
  return sessions.slice().sort((a, b) => {
    const da = sessionFirstDate(a);
    const db = sessionFirstDate(b);
    const aBad = da === "9999-99-99";
    const bBad = db === "9999-99-99";
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;
    return da.localeCompare(db);
  });
}

function todayISOLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Все блоки с известной датой и каждая дата раньше сегодняшнего дня (локальный календарь). */
function sessionIsFullyPast(session) {
  const today = todayISOLocal();
  const dated = session.blocks.filter((b) => b.date && tryParseISODate(b.date));
  if (dated.length === 0) return false;
  const allBlocksHaveIsoDate = session.blocks.length > 0 && session.blocks.every((b) => b.date && tryParseISODate(b.date));
  if (!allBlocksHaveIsoDate) return false;
  return session.blocks.every((b) => b.date < today);
}

function myClientUserIds(state) {
  const ids = new Set();
  for (const g of state.groups) {
    if (g.type !== "личная") continue;
    if (!isLeaderInGroup(state, g.id, state.meId)) continue;
    for (const m of state.groupMembers) {
      if (m.groupId !== g.id || !m.isParticipant) continue;
      if (m.userId === state.meId) continue;
      ids.add(m.userId);
    }
  }
  return [...ids];
}

function sessionsForClientConsultation(state, clientUserId) {
  const myLeadPersonal = new Set(
    state.groups.filter((g) => g.type === "личная" && isLeaderInGroup(state, g.id, state.meId)).map((g) => g.id)
  );
  const clientParticipantIn = new Set(
    state.groupMembers.filter((m) => m.userId === clientUserId && m.isParticipant).map((m) => m.groupId)
  );
  const groupIds = [...myLeadPersonal].filter((gid) => clientParticipantIn.has(gid));
  const gset = new Set(groupIds);
  return state.sessions
    .filter((s) => gset.has(s.groupId))
    .slice()
    .sort((a, b) => sessionFirstDate(b).localeCompare(sessionFirstDate(a)));
}

function sessionDynamicsSnippet(s) {
  const t = (s.theme || "").trim();
  const sum = (s.summary || "").trim();
  const n = (s.note || "").trim();
  const pick = t || sum || n || "";
  if (!pick) return "—";
  const one = pick.split("\n")[0];
  return one.length > 120 ? `${one.slice(0, 117)}…` : one;
}

/** Ссылка на «Ближайшее» с сохранением фильтров. mode: lead | part; statusKey: all | prelim | ok */
function hashUpcoming(mode, groupId, statusKey) {
  const p = new URLSearchParams();
  p.set("mode", mode === "part" ? "part" : "lead");
  if (groupId) p.set("group", groupId);
  if (statusKey && statusKey !== "all") p.set("st", statusKey);
  return `#/upcoming?${p.toString()}`;
}

function groupsVisibleInMode(state, mode) {
  return state.groups
    .filter((g) => (mode === "lead" ? isLeaderInGroup(state, g.id, state.meId) : isParticipantInGroup(state, g.id, state.meId)))
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
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
      isSuperAdmin() ? mk("#/admin", "Админ", "admin") : null,
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

function renderUpcoming(state, mode = "lead", urlParams = null) {
  const params = urlParams instanceof URLSearchParams ? urlParams : new URLSearchParams();
  const me = getMe(state);
  const subtitle = `${me?.name ?? "Пользователь"} • здесь только предстоящие; прошедшие — в «Вид на год»`;

  const groupsInMode = groupsVisibleInMode(state, mode);
  const groupFilterRaw = params.get("group") || "";
  const groupFilter = groupsInMode.some((g) => g.id === groupFilterRaw) ? groupFilterRaw : "";
  const stRaw = params.get("st") || "all";
  const statusFilter = stRaw === "prelim" || stRaw === "ok" ? stRaw : "all";

  const pills = [
    {
      label: "Я веду",
      pressed: mode === "lead",
      onClick: () => (location.hash = hashUpcoming("lead", groupFilter, statusFilter)),
    },
    {
      label: "Я участник",
      pressed: mode === "part",
      onClick: () => (location.hash = hashUpcoming("part", groupFilter, statusFilter)),
    },
  ];

  const baseSessions = state.sessions
    .filter((s) => sessionVisibleForMe(state, s, mode))
    .filter((s) => !sessionIsFullyPast(s));

  let sessions = baseSessions.slice();
  if (groupFilter) sessions = sessions.filter((s) => s.groupId === groupFilter);
  if (statusFilter === "prelim") sessions = sessions.filter((s) => s.status === "предварительно");
  if (statusFilter === "ok") sessions = sessions.filter((s) => s.status === "подтверждено");
  sessions.sort((a, b) => sessionFirstDate(a).localeCompare(sessionFirstDate(b)));

  const hasFilters = Boolean(groupFilter || statusFilter !== "all");
  const yNow = new Date().getFullYear();

  const onFilterApply = () => {
    const g = document.getElementById("upcoming_f_group")?.value || "";
    const st = document.getElementById("upcoming_f_st")?.value || "all";
    location.hash = hashUpcoming(mode, g, st);
  };

  const filterCard =
    groupsInMode.length > 0
      ? h("div", { class: "card filterCard" }, [
          h("div", { class: "sectionTitle" }, "Фильтры"),
          h("div", { class: "hint", style: "margin-bottom:10px;" }, "Можно сузить список по группе и по статусу (черновик или подтверждено)."),
          h("div", { class: "grid2" }, [
            h("div", { class: "field" }, [
              h("label", { class: "label", for: "upcoming_f_group" }, "Группа"),
              h(
                "select",
                { id: "upcoming_f_group" },
                [
                  h("option", { value: "", ...(!groupFilter ? { selected: true } : {}) }, "Все группы"),
                  ...groupsInMode.map((g) =>
                    h("option", { value: g.id, ...(g.id === groupFilter ? { selected: true } : {}) }, g.name || "Без названия")
                  ),
                ]
              ),
            ]),
            h("div", { class: "field" }, [
              h("label", { class: "label", for: "upcoming_f_st" }, "Статус"),
              h(
                "select",
                { id: "upcoming_f_st" },
                [
                  h("option", { value: "all", ...(statusFilter === "all" ? { selected: true } : {}) }, "Все"),
                  h("option", { value: "prelim", ...(statusFilter === "prelim" ? { selected: true } : {}) }, "Предварительно"),
                  h("option", { value: "ok", ...(statusFilter === "ok" ? { selected: true } : {}) }, "Подтверждено"),
                ]
              ),
            ]),
          ]),
          h("div", { class: "actions", style: "margin-top:4px;" }, [
            h("button", { class: "btn primary", onclick: onFilterApply }, "Применить"),
            hasFilters
              ? h("button", { class: "btn", onclick: () => (location.hash = hashUpcoming(mode, "", "all")) }, "Сбросить")
              : null,
          ]),
        ])
      : null;

  let list = null;
  if (sessions.length > 0) {
    list = h(
      "div",
      {},
      sessions.map((s) => sessionCard(state, s, { showEdit: isLeaderInGroup(state, s.groupId, state.meId) }))
    );
  } else if (groupsInMode.length === 0 && mode === "lead") {
    list = h("div", { class: "empty" }, [
      h("div", {}, "Пока нет групп, где вы ведущий. Создайте группу — затем можно планировать встречи."),
      h("div", { class: "actions", style: "margin-top:14px;" }, [
        h("button", { class: "btn primary", onclick: () => (location.hash = "#/new-group") }, "Создать группу"),
      ]),
    ]);
  } else if (groupsInMode.length === 0 && mode === "part") {
    list = h(
      "div",
      { class: "empty" },
      "Вас пока не добавили ни в одну группу. Когда ведущий добавит вас, список появится в разделе «Группы»."
    );
  } else if (hasFilters && baseSessions.length > 0) {
    list = h("div", { class: "empty" }, [
      h("div", {}, "Нет встреч с выбранными фильтрами."),
      h("div", { class: "actions", style: "margin-top:14px;" }, [
        h("button", { class: "btn primary", onclick: () => (location.hash = hashUpcoming(mode, "", "all")) }, "Сбросить фильтры"),
      ]),
    ]);
  } else {
    const actions =
      mode === "lead"
        ? [
            h("button", { class: "btn primary", onclick: () => (location.hash = "#/wizard") }, "Запланировать встречу"),
            h("button", { class: "btn", onclick: () => (location.hash = "#/new-consultation") }, "Личная консультация"),
            h("button", { class: "btn", onclick: () => (location.hash = `#/year?y=${yNow}&mode=${encodeURIComponent(mode)}`) }, "Вид на год"),
          ]
        : [
            h(
              "button",
              { class: "btn primary", onclick: () => (location.hash = `#/year?y=${yNow}&mode=${encodeURIComponent(mode)}`) },
              "Вид на год"
            ),
          ];
    list = h("div", { class: "empty" }, [
      h(
        "div",
        {},
        mode === "lead"
          ? "Нет предстоящих встреч. Запланируйте новую или откройте календарь за год, если нужны прошедшие."
          : "Нет предстоящих встреч, где вы участник. Прошедшие и будущие по всем датам — в «Вид на год»."
      ),
      h("div", { class: "actions", style: "margin-top:14px;" }, actions),
    ]);
  }

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
      filterCard,
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
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => (location.hash = `#/pdf-year?y=${year}&mode=${encodeURIComponent(mode)}`),
          },
          "PDF / печать года"
        ),
        h("button", { class: "btn", onclick: () => (location.hash = `#/upcoming?mode=${mode}`) }, "К списку «Ближайшее»"),
      ]),
    ]),
    nav("year"),
  ]);
}

function renderPdfYear(state, year, mode = "lead") {
  const me = getMe(state);
  const modeLabel = mode === "part" ? "участник" : "ведущий";
  const sessions = state.sessions.filter((s) => sessionVisibleForMe(state, s, mode));
  const genStr = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date());

  const monthCells = RU_MONTHS.map((name, i) => {
    const m = i + 1;
    const inMonth = sessions
      .filter((s) => blocksInCalendarMonth(s, year, m).length > 0)
      .slice()
      .sort((a, b) => (sessionFirstDateInMonth(a, year, m) || "").localeCompare(sessionFirstDateInMonth(b, year, m) || ""));

    const items = [];
    for (const s of inMonth) {
      const g = groupById(state, s.groupId);
      const blocks = blocksInCalendarMonth(s, year, m).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const stMark = s.status === "подтверждено" ? "✓" : "?";
      const gShort = truncateText(g?.name, 20);
      for (const b of blocks) {
        const t = `${formatDateDot(b.date)} ${gShort} ${formatTimeRange(b.startTime, b.endTime)} ${stMark}`.trim();
        items.push(t);
      }
    }

    return h("div", { class: "pdfMonthCell" }, [
      h("div", { class: "pdfMonthTitle" }, name),
      items.length === 0
        ? h("div", { class: "pdfMonthEmpty" }, "нет встреч")
        : h("ul", { class: "pdfMonthList" }, items.map((t) => h("li", {}, t))),
    ]);
  });

  return h("div", { class: "pdfYearWrap" }, [
    h("div", { class: "no-print pdfToolbar" }, [
      pdfTelegramSendButton({
        sheetSelector: ".pdfYearSheet",
        landscape: true,
        filename: `raspisanie_${year}.pdf`,
        caption: `Расписание ${year} · ${modeLabel}`,
        btnId: "pdf_tg_year",
        singlePage: true,
      }),
      h("button", { class: "btn", onclick: () => window.print() }, isTelegramWebApp() ? "Печать (часто только на ПК)" : "Печать или сохранить PDF"),
      h(
        "button",
        { class: "btn", onclick: () => (location.hash = `#/year?y=${year}&mode=${encodeURIComponent(mode)}`) },
        "Назад к году"
      ),
      h(
        "div",
        { class: "hint pdfToolbarHint" },
        canSendPdfToTelegram()
          ? "В Telegram на телефоне «Печать» часто не открывается — используйте «В чат с ботом»: PDF сформируется и придёт в личку с ботом (нужен /start у бота)."
          : "В окне печати выберите «Сохранить как PDF». Рекомендуется альбомная ориентация и при обрезании — «Вписать на страницу»."
      ),
    ].filter(Boolean)),
    h("div", { class: "pdfYearSheet" }, [
      h("header", { class: "pdfYearHead" }, [
        h("h1", { class: "pdfYearH1" }, `Расписание — ${year}`),
        h("div", { class: "pdfYearSub" }, `${me?.name ?? "Пользователь"} · режим: ${modeLabel} · ${genStr}`),
        h("div", { class: "pdfYearLegend" }, "✓ подтверждено · ? предварительно · время «уточним», если слот не задан"),
      ]),
      h("div", { class: "pdfYearGrid" }, monthCells),
    ]),
  ]);
}

function pdfClientSessionBlock(state, s) {
  const g = groupById(state, s.groupId);
  const weekly = formatWeeklySlotLine(s);
  const parts = [
    h("div", { class: "pdfClientSessionHead" }, [
      h("div", { class: "pdfClientSessionTitle" }, g?.name ?? "Личная консультация"),
      h("div", { class: "pdfClientSessionMeta" }, `Статус: ${s.status}`),
    ]),
    (s.blocks || []).length === 0
      ? h("div", { class: "pdfClientBlocks pdfClientBlocksEmpty" }, "Дни встречи не заданы.")
      : h(
          "div",
          { class: "pdfClientBlocks" },
          s.blocks.map((b) =>
            h("div", { class: "pdfClientBlockLine" }, `${formatDateRu(b.date)} — ${formatTimeRange(b.startTime, b.endTime)}`)
          )
        ),
  ];
  if (weekly) parts.push(h("div", { class: "pdfClientField" }, [h("span", { class: "pdfClientK" }, "Постоянный слот: "), weekly]));
  const addPara = (label, text) => {
    const t = String(text || "").trim();
    if (!t) return null;
    return h("div", { class: "pdfClientField" }, [
      h("div", { class: "pdfClientK" }, label),
      h("div", { class: "pdfClientV" }, t),
    ]);
  };
  const p1 = addPara("Тема", s.theme);
  const p2 = addPara("Резюме", s.summary);
  const p3 = addPara("Общая заметка", s.note);
  const p4 = addPara("Приватные заметки", s.privateNotes);
  if (p1) parts.push(p1);
  if (p2) parts.push(p2);
  if (p3) parts.push(p3);
  if (p4) parts.push(p4);
  return h("div", { class: "pdfClientSession" }, parts.filter(Boolean));
}

function renderPdfClient(state, userId) {
  if (!userId) return renderNotFound("Клиент не указан");
  if (!myClientUserIds(state).includes(userId)) return renderNotFound("Нет доступа или клиент не найден");
  const u = userById(state, userId);
  if (!u) return renderNotFound("Клиент не найден");

  const sessions = sortSessionsChronological(sessionsForClientConsultation(state, userId));
  const genStr = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  const anam = String(u.clientAnamnesis || "").trim();

  return h("div", { class: "pdfClientWrap" }, [
    h("div", { class: "no-print pdfToolbar" }, [
      pdfTelegramSendButton({
        sheetSelector: ".pdfClientSheet",
        landscape: false,
        filename: `klient_${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
        caption: `Клиент: ${u.name || "—"}`,
        btnId: "pdf_tg_client",
      }),
      h("button", { class: "btn", onclick: () => window.print() }, isTelegramWebApp() ? "Печать (часто только на ПК)" : "Печать или сохранить PDF"),
      h("button", { class: "btn", onclick: () => (location.hash = `#/client?id=${encodeURIComponent(userId)}`) }, "Назад к карточке"),
      h(
        "div",
        { class: "hint pdfToolbarHint" },
        canSendPdfToTelegram()
          ? "Анамнез и встречи (включая приватные заметки). На телефоне в WebApp удобнее «В чат с ботом»."
          : "В PDF попадут анамнез и все поля встреч (включая приватные заметки). Сохраняйте файл с осторожностью."
      ),
    ].filter(Boolean)),
    h("div", { class: "pdfClientSheet" }, [
      h("header", { class: "pdfClientDocHead" }, [
        h("h1", { class: "pdfClientH1" }, `Клиент: ${u.name || "—"}`),
        h("div", { class: "pdfClientSub" }, `Выгрузка для ведущего · ${genStr}`),
      ]),
      h("section", { class: "pdfClientSection" }, [
        h("h2", { class: "pdfClientH2" }, "Анамнез / контекст"),
        h("div", { class: "pdfClientAnam" }, anam || "—"),
      ]),
      h("section", { class: "pdfClientSection" }, [
        h("h2", { class: "pdfClientH2" }, `Встречи (${sessions.length})`),
        sessions.length === 0
          ? h("div", { class: "pdfClientEmpty" }, "Запланированных встреч в консультации с этим человеком пока нет.")
          : h("div", { class: "pdfClientSessions" }, sessions.map((s) => pdfClientSessionBlock(state, s))),
      ]),
    ]),
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
  const weeklyLine = formatWeeklySlotLine(session);

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
    weeklyLine ? h("div", { class: "small", style: "opacity:.9;" }, weeklyLine) : null,
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
      ? h("div", {}, [
          h(
            "div",
            { class: "empty" },
            tab === "lead"
              ? "Пока нет групп, где вы указаны как ведущий."
              : "Пока нет групп, где вы указаны как участник."
          ),
          tab === "lead"
            ? h("div", { class: "actions", style: "margin-top:12px;" }, [
                h("button", { class: "btn primary", onclick: () => (location.hash = "#/new-group") }, "Создать группу"),
              ])
            : h("div", { class: "small", style: "margin-top:12px; opacity:.92;" }, "Попросите ведущего добавить вас в группу — тогда она появится здесь."),
        ])
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
  const canLeaveGroup = !canEdit && isParticipantInGroup(state, g.id, state.meId);

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

  const leaderMembers = state.groupMembers.filter((m) => m.groupId === g.id && m.isLeader);
  const participantMembers = state.groupMembers.filter((m) => m.groupId === g.id && m.isParticipant);

  const peopleOptions = state.users
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"))
    .map((u) => h("option", { value: u.id }, u.name));

  const manageUI = canEdit
    ? (() => {
        const addPersonId = "gm_person";
        const addPersonNameId = "gm_new_person";
        const myLeadersCount = leaderMembers.length;
        const inviteOutId = "gm_invite_out";

        const onAddNewPerson = async () => {
          const nm = (document.getElementById(addPersonNameId)?.value || "").trim();
          if (!nm) return alert("Введите имя человека.");
          const key = nm.toLowerCase();
          const existing = state.users.find((u) => (u.name || "").trim().toLowerCase() === key);
          if (existing) {
            alert(`Человек «${existing.name}» уже есть в списке. Выберите его в списке «Выберите человека».`);
            document.getElementById(addPersonNameId).value = "";
            return;
          }
          state.users.push({ id: uid("u"), name: nm, profile: {} });
          document.getElementById(addPersonNameId).value = "";
          await saveState(state);
          renderApp();
        };

        const onSetLeader = async () => {
          const userId = document.getElementById(addPersonId)?.value || "";
          if (!userId) return alert("Выберите человека.");
          if (userId === state.meId) {
            // already me
          }
          upsertGroupMembership(state, g.id, userId, { asLeader: true, asParticipant: false });
          await saveState(state);
          renderApp();
        };

        const onSetParticipant = async () => {
          const userId = document.getElementById(addPersonId)?.value || "";
          if (!userId) return alert("Выберите человека.");
          upsertGroupMembership(state, g.id, userId, { asLeader: false, asParticipant: true });
          await saveState(state);
          renderApp();
        };

        const onRemoveMember = async () => {
          const userId = document.getElementById(addPersonId)?.value || "";
          if (!userId) return alert("Выберите человека.");
          const isLeader = leaderMembers.some((m) => m.userId === userId);
          if (isLeader && myLeadersCount <= 1) {
            return alert("Нельзя убрать последнего ведущего группы. Сделайте хотя бы одного ведущего.");
          }
          state.groupMembers = state.groupMembers.filter((m) => !(m.groupId === g.id && m.userId === userId));
          await saveState(state);
          renderApp();
        };

        const onDeleteGroup = async () => {
          if (!confirm("Удалить группу и все встречи внутри неё? Это действие нельзя отменить.")) return;
          await deleteGroup(state, g.id);
          location.hash = "#/groups";
          renderApp();
        };

        const onCreateInvite = async () => {
          try {
            const r = await apiJson("/api/invites?action=create", { method: "POST", body: { groupId: g.id, role: "participant" } });
            const token = String(r.token || "");
            const links = inviteLinksForToken(token);
            const link = links.tg || links.web;
            const el = document.getElementById(inviteOutId);
            if (el) el.value = link;
            setPendingInviteToken(token);
            const ok = await copyText(link);
            alert(
              ok
                ? "Приглашение скопировано. Отправьте ссылку человеку — она откроется в Telegram."
                : "Ссылка готова. Скопируйте её из поля ниже."
            );
          } catch (e) {
            alert(String(e.message || e));
          }
        };

        return h("div", { class: "card" }, [
          h("div", { class: "sectionTitle" }, "Управление группой"),
          h("div", { class: "small" }, [
            "Ведущий — планирует встречи и видит приватные заметки. Участник — в списке группы, без прав редактирования. ",
            "Участники видят расписание встреч; обновления подтягиваются при следующем открытии приложения.",
          ]),
          h("div", { class: "hr" }),
          h("div", { class: "sectionTitle" }, "Приглашение (Telegram)"),
          h("div", { class: "small" }, "MVP: создаём ссылку-приглашение. Человек должен открыть приложение через Telegram и нажать «Присоединиться»."),
          h("div", { class: "actions profile-actions" }, [
            h("button", { class: "btn primary", onclick: onCreateInvite }, "Скопировать приглашение"),
            h("button", { class: "btn", onclick: () => openBotInTelegram() }, "Открыть бота"),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: inviteOutId }, "Ссылка-приглашение"),
            h("input", { id: inviteOutId, placeholder: "Нажмите «Скопировать приглашение»", readonly: true }),
          ]),
          h("div", { class: "hr" }),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: addPersonId }, "Выберите человека из списка"),
            h("select", { id: addPersonId }, [
              h("option", { value: "" }, "— выберите —"),
              ...peopleOptions,
            ]),
          ]),
          h("div", { class: "actions profile-actions" }, [
            h("button", { class: "btn primary", onclick: onSetLeader }, "Сделать ведущим"),
            h("button", { class: "btn primary", onclick: onSetParticipant }, "Сделать участником"),
            h("button", { class: "btn danger", onclick: onRemoveMember }, "Удалить из группы"),
          ]),
          h("div", { class: "hr" }),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: addPersonNameId }, "Если человека ещё нет — добавьте по имени"),
            h("input", { id: addPersonNameId, placeholder: "Например: Мария" }),
          ]),
          h("div", { class: "actions profile-actions" }, [
            h("button", { class: "btn", onclick: onAddNewPerson }, "Добавить человека в систему"),
          ]),
          h("div", { class: "hr" }),
          h("div", { class: "actions profile-actions" }, [
            h("button", { class: "btn danger", onclick: onDeleteGroup }, "Удалить группу"),
          ]),
        ]);
      })()
    : null;

  return h("div", {}, [
    topbar(g.name, g.type, null),
    h("div", { class: "content" }, [
      canEdit
        ? h("div", { class: "actions", style: "margin-bottom:10px;" }, [
            h("button", { class: "btn", onclick: () => (location.hash = `#/edit-group?id=${encodeURIComponent(g.id)}`) }, "Изменить группу"),
          ])
        : null,
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
      manageUI,
      canLeaveGroup
        ? h("div", { class: "actions", style: "margin-top:12px;" }, [
            h(
              "button",
              {
                class: "btn danger",
                onclick: async () => {
                  if (
                    !confirm(
                      "Покинуть группу? Она пропадёт из списка «Где я участник», встречи не будут показываться у вас как у участника."
                    )
                  )
                    return;
                  state.groupMembers = state.groupMembers.filter((m) => !(m.groupId === g.id && m.userId === state.meId));
                  await saveState(state);
                  location.hash = "#/groups";
                  renderApp();
                },
              },
              "Покинуть группу"
            ),
          ])
        : null,
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
        h("div", { class: "small" }, "Данные сохраняются в вашем кабинете. Даты и время можно уточнять позже."),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: () => (location.hash = "#/wizard") }, "Запланировать встречу группы"),
          h("button", { class: "btn", onclick: () => (location.hash = "#/new-consultation") }, "Личная консультация"),
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
  const myRoleId = "ng_my_role";

  const onSave = async () => {
    const name = (document.getElementById(nameId)?.value || "").trim();
    const type = document.getElementById(typeId)?.value || "другое";
    const color = document.getElementById(colorId)?.value || "#7aa7ff";
    const myRole = document.getElementById(myRoleId)?.value || "leader";
    if (!name) return alert("Введите название группы.");

    const g = { id: uid("g"), name, type, color };
    state.groups.push(g);
    state.groupMembers.push({
      groupId: g.id,
      userId: state.meId,
      isLeader: myRole === "leader",
      isParticipant: myRole === "participant",
    });
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
            h("label", { class: "label", for: myRoleId }, "Моя роль в группе"),
            h("select", { id: myRoleId }, [
              h("option", { value: "leader", selected: true }, "Я веду (ведущий)"),
              h("option", { value: "participant" }, "Я участник"),
            ]),
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

function renderEditGroup(state, groupId) {
  const g = groupById(state, groupId);
  if (!g) return renderNotFound("Группа не найдена");
  if (!isLeaderInGroup(state, g.id, state.meId)) return renderNotFound("Нет прав на редактирование");

  const nameId = "eg_name";
  const typeId = "eg_type";
  const colorId = "eg_color";

  const onSave = async () => {
    const name = (document.getElementById(nameId)?.value || "").trim();
    const type = document.getElementById(typeId)?.value || "другое";
    const color = document.getElementById(colorId)?.value || "#7aa7ff";
    if (!name) return alert("Введите название группы.");
    const idx = state.groups.findIndex((x) => x.id === g.id);
    if (idx === -1) return;
    state.groups[idx] = { ...state.groups[idx], name, type, color };
    await saveState(state);
    location.hash = `#/group?id=${encodeURIComponent(g.id)}`;
  };

  const typeSel = h(
    "select",
    { id: typeId },
    GROUP_TYPES.map((t) => h("option", { value: t.id, selected: t.id === g.type }, t.label))
  );

  return h("div", {}, [
    topbar("Изменить группу", g.name, null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "form" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: nameId }, "Название"),
            h("input", { id: nameId, value: g.name || "" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: typeId }, "Тип"),
            typeSel,
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: colorId }, "Цвет"),
            h("input", { id: colorId, type: "color", value: g.color || "#7aa7ff" }),
          ]),
          h("div", { class: "actions" }, [
            h("button", { class: "btn primary", onclick: onSave }, "Сохранить"),
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
  if (profileLinkedEmail === undefined) {
    refreshLinkedEmail().then(() => renderApp());
    return h("div", {}, [
      topbar("Профиль", "Загрузка…", null),
      h("div", { class: "content profile-page" }, [h("div", { class: "empty" }, "Загружаем данные аккаунта…")]),
      nav("profile"),
    ]);
  }
  const p = me?.profile || {};
  const firstId = "p_first";
  const lastId = "p_last";
  const titleId = "p_title";
  const stageId = "p_stage";
  const tzId = "p_tz";
  const cityId = "p_city";
  const phoneId = "p_phone";
  const workDaysId = "p_workdays";
  const workHoursId = "p_workhours";

  const onSaveProfile = async () => {
    try {
      const firstName = (document.getElementById(firstId)?.value || "").trim();
      const lastName = (document.getElementById(lastId)?.value || "").trim();
      const title = (document.getElementById(titleId)?.value || "").trim();
      const stage = (document.getElementById(stageId)?.value || "").trim();
      const tz = (document.getElementById(tzId)?.value || "").trim();
      const city = (document.getElementById(cityId)?.value || "").trim();
      const phone = (document.getElementById(phoneId)?.value || "").trim();
      const workDays = (document.getElementById(workDaysId)?.value || "").trim();
      const workHours = (document.getElementById(workHoursId)?.value || "").trim();

      const idx = getMeIndex(state);
      if (idx === -1) throw new Error("Пользователь не найден");

      const nextProfile = {
        firstName,
        lastName,
        title, // например: гештальт-терапевт, психолог
        stage, // например: студент / практикующий / супервизор
        tz, // например: Europe/Moscow
        city,
        phone,
        workDays, // например: Пн,Вт,Чт
        workHours, // например: 10:00-19:00
      };

      state.users[idx] = { ...state.users[idx], profile: nextProfile };

      const nameFromProfile = fullNameFromProfile(nextProfile);
      if (nameFromProfile) {
        state.users[idx].name = nameFromProfile;
      }

      await saveState(state);
      alert("Профиль сохранён.");
      renderApp();
    } catch (e) {
      alert(String(e.message || e));
      console.error(e);
    }
  };

  return h("div", {}, [
    topbar("Профиль", "Данные сохраняются в Supabase.", null),
    h("div", { class: "content profile-page" }, [
      h("div", { class: "card" }, [
        h("div", { class: "groupName" }, me?.name ?? "Пользователь"),
        h("div", { class: "small" }, "Заполните профиль — это пригодится для расписания, приглашений и уведомлений."),
        h("div", { class: "form profile-form" }, [
          h("div", { class: "grid2 profile-grid2" }, [
            h("div", { class: "field" }, [
              h("label", { class: "label", for: firstId }, "Имя"),
              h("input", { id: firstId, value: p.firstName || "", autocomplete: "given-name", placeholder: "Имя" }),
            ]),
            h("div", { class: "field" }, [
              h("label", { class: "label", for: lastId }, "Фамилия"),
              h("input", { id: lastId, value: p.lastName || "", autocomplete: "family-name", placeholder: "Фамилия" }),
            ]),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: titleId }, "Профессия / направление"),
            h("input", { id: titleId, value: p.title || "", placeholder: "Напр.: гештальт-терапевт, психолог" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: stageId }, "Статус"),
            h("input", { id: stageId, value: p.stage || "", placeholder: "Напр.: студент, практикующий, супервизор" }),
          ]),
          h("div", { class: "grid2 profile-grid2" }, [
            h("div", { class: "field" }, [
              h("label", { class: "label", for: tzId }, "Часовой пояс"),
              h("input", { id: tzId, value: p.tz || "", placeholder: "Напр.: Europe/Moscow" }),
            ]),
            h("div", { class: "field" }, [
              h("label", { class: "label", for: cityId }, "Город"),
              h("input", { id: cityId, value: p.city || "", placeholder: "Город" }),
            ]),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: phoneId }, "Телефон (для связи)"),
            h("input", { id: phoneId, value: p.phone || "", inputmode: "tel", placeholder: "+7..." }),
          ]),
          h("div", { class: "grid2 profile-grid2" }, [
            h("div", { class: "field" }, [
              h("label", { class: "label", for: workDaysId }, "Рабочие дни"),
              h("input", { id: workDaysId, value: p.workDays || "", placeholder: "Пн,Вт,Чт" }),
            ]),
            h("div", { class: "field" }, [
              h("label", { class: "label", for: workHoursId }, "Рабочие часы"),
              h("input", { id: workHoursId, value: p.workHours || "", placeholder: "10:00-19:00" }),
            ]),
          ]),
          h("div", { class: "actions" }, [
            h("button", { class: "btn primary", onclick: onSaveProfile }, "Сохранить профиль"),
          ]),
        ]),
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Справочник и клиенты"),
        h("div", { class: "small" }, "Контакты и карточки клиентов — здесь, чтобы нижнее меню оставалось короче."),
        h("div", { class: "actions profile-actions" }, [
          h("button", { class: "btn", onclick: () => (location.hash = "#/people") }, "Контакты"),
          h("button", { class: "btn primary", onclick: () => (location.hash = "#/clients") }, "Мои клиенты"),
        ]),
      ]),
      profileLinkedEmail && !canLinkEmail
        ? h("div", { class: "card" }, [
            h("div", { class: "sectionTitle" }, "Вход в браузере"),
            h("div", { class: "small" }, `Аккаунт привязан к почте: ${profileLinkedEmail}`),
          ])
        : null,
      canLinkEmail && profileLinkedEmail
        ? (() => {
            const unlinkPassId = "unlink_pass";
            const onUnlink = async () => {
              const password = document.getElementById(unlinkPassId)?.value || "";
              if (!password) return alert("Введите пароль, чтобы отвязать почту.");
              if (!confirm("Отвязать почту? Войти в браузере по email больше не получится, пока не привяжете снова.")) return;
              try {
                const r = await fetch(`${API_BASE}/api/auth/email-unlink`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ password }),
                });
                const txt = await r.text();
                let j = null;
                try { j = JSON.parse(txt); } catch { j = { error: txt }; }
                if (!r.ok) throw new Error(j?.error || txt);
                profileLinkedEmail = null;
                alert("Почта отвязана.");
                renderApp();
              } catch (e) {
                alert(String(e.message || e));
              }
            };
            return h("div", { class: "card" }, [
              h("div", { class: "sectionTitle" }, "Почта для входа в браузере"),
              h("div", { class: "small" }, `Привязано: ${profileLinkedEmail}`),
              h("div", { class: "form profile-form" }, [
                h("div", { class: "field" }, [
                  h("label", { class: "label", for: unlinkPassId }, "Пароль для подтверждения"),
                  h("input", { id: unlinkPassId, type: "password", placeholder: "Пароль от этой почты", autocomplete: "current-password" }),
                ]),
                h("div", { class: "actions profile-actions" }, [
                  h("button", { class: "btn danger", onclick: onUnlink }, "Отвязать почту"),
                ]),
              ]),
            ]);
          })()
        : null,
      canLinkEmail && !profileLinkedEmail
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
                profileLinkedEmail = j.email || String(email || "").trim().toLowerCase() || null;
                alert("Email привязан. Теперь можно входить в браузере по email+паролю.");
                renderApp();
              } catch (e) {
                alert(String(e.message || e));
              }
            };
            return h("div", { class: "card" }, [
              h("div", { class: "sectionTitle" }, "Привязать email (для входа в браузере)"),
              h("div", { class: "small" }, "Привязка доступна после входа через Telegram. Пароль хранится в Supabase (в хэше)."),
              h("div", { class: "form profile-form" }, [
                h("div", { class: "field" }, [
                  h("label", { class: "label", for: emailId }, "Email"),
                  h("input", { id: emailId, placeholder: "you@example.com", inputmode: "email", autocomplete: "email" }),
                ]),
                h("div", { class: "field" }, [
                  h("label", { class: "label", for: passId }, "Пароль"),
                  h("input", { id: passId, type: "password", placeholder: "минимум 6 символов" }),
                ]),
                h("div", { class: "actions profile-actions" }, [h("button", { class: "btn primary", onclick: onLink }, "Привязать")]),
              ]),
            ]);
          })()
        : null,
      h("div", { class: "actions profile-actions" }, [
        h(
          "button",
          {
            class: "btn danger",
            onclick: async () => {
              try {
                await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
                currentUserId = null;
                profileLinkedEmail = undefined;
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

function renderAdmin() {
  if (!isSuperAdmin()) return renderNotFound("Нет доступа");

  const uidId = "adm_uid";
  const emailId = "adm_email";
  const fromId = "adm_from";
  const outId = "adm_out";

  const setOut = (txt) => {
    const el = document.getElementById(outId);
    if (el) el.value = String(txt || "");
  };

  const getJson = async (endpoint) => {
    const r = await fetch(`${API_BASE}${endpoint}`);
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      j = { raw: t };
    }
    if (!r.ok) throw new Error(String(j?.error || j?.message || `HTTP ${r.status}`));
    return j;
  };

  return h("div", {}, [
    topbar("Админ", "Служебный раздел (пока базовый).", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Диагностика"),
        h("div", { class: "small" }, `userId: ${String(currentUserId || "—")}`),
        h("div", { class: "small" }, `Telegram WebApp: ${isTelegramWebAppContext() ? "да" : "нет"}`),
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Где данные? (поиск)"),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: uidId }, "Посмотреть app_state по userId"),
          h("input", { id: uidId, placeholder: "например: tg:373134197" }),
        ]),
        h("div", { class: "actions profile-actions" }, [
          h(
            "button",
            {
              class: "btn primary",
              onclick: async () => {
                try {
                  const uid = String(document.getElementById(uidId)?.value || "").trim();
                  const j = await getJson(`/api/admin?action=state_get&userId=${encodeURIComponent(uid)}`);
                  const st = j.state || {};
                  const memberCounts = {};
                  for (const m of Array.isArray(st.groupMembers) ? st.groupMembers : []) {
                    if (!m || !m.userId) continue;
                    const k = String(m.userId);
                    memberCounts[k] = (memberCounts[k] || 0) + 1;
                  }
                  const topMembers = Object.entries(memberCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([userId, cnt]) => ({ userId, cnt }));

                  setOut(
                    JSON.stringify(
                      {
                        row: j.row,
                        counts: j.counts,
                        stateMeId: st.meId,
                        topMemberUserIds: topMembers,
                        users: (Array.isArray(st.users) ? st.users : []).map((u) => ({ id: u?.id, name: u?.name })).slice(0, 20),
                      },
                      null,
                      2
                    )
                  );
                } catch (e) {
                  setOut(String(e.message || e));
                }
              },
            },
            "Проверить"
          ),
          h("button", { class: "btn", onclick: () => setOut("") }, "Очистить"),
        ]),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Починка: перепривязать meId"),
        h("div", { class: "small" }, "Если группы не отображаются, чаще всего ваши записи в groupMembers ссылаются на старый id (например u_...)."),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: fromId }, "Старый id (из вывода выше)"),
          h("input", { id: fromId, placeholder: "например: u_abc123_..." }),
        ]),
        h("div", { class: "actions profile-actions" }, [
          h(
            "button",
            {
              class: "btn danger",
              onclick: async () => {
                try {
                  const uid = String(document.getElementById(uidId)?.value || "").trim();
                  const from = String(document.getElementById(fromId)?.value || "").trim();
                  if (!uid || !from) return alert("Нужны userId и старый id.");
                  if (!confirm(`Заменить во всём state id ${from} → ${uid}?`)) return;
                  const j = await getJson(
                    `/api/admin?action=migrate_me&userId=${encodeURIComponent(uid)}&from=${encodeURIComponent(from)}`
                  );
                  setOut(JSON.stringify(j, null, 2));
                  // Перезагрузим данные текущего пользователя, чтобы UI сразу обновился
                  state = await loadState();
                  renderApp();
                } catch (e) {
                  setOut(String(e.message || e));
                }
              },
            },
            "Перепривязать"
          ),
        ]),
        h("div", { class: "hr" }),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: emailId }, "Найти userId по привязанной почте"),
          h("input", { id: emailId, placeholder: "email@example.com" }),
        ]),
        h("div", { class: "actions profile-actions" }, [
          h(
            "button",
            {
              class: "btn",
              onclick: async () => {
                try {
                  const email = String(document.getElementById(emailId)?.value || "").trim();
                  const j = await getJson(`/api/admin?action=lookup_email&email=${encodeURIComponent(email)}`);
                  document.getElementById(uidId).value = j.userId;
                  setOut(JSON.stringify(j, null, 2));
                } catch (e) {
                  setOut(String(e.message || e));
                }
              },
            },
            "Найти"
          ),
        ]),
        h("div", { class: "hr" }),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: outId }, "Результат"),
          h("textarea", { id: outId, rows: "8", style: "width:100%; resize:vertical;" }),
        ]),
      ]),
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Действия"),
        h("div", { class: "actions profile-actions" }, [
          h("button", { class: "btn", onclick: () => (location.hash = "#/join") }, "Экран приглашения"),
          h(
            "button",
            {
              class: "btn danger",
              onclick: async () => {
                if (!confirm("Сбросить демо-данные для текущего пользователя?")) return;
                try {
                  await fetch(`${API_BASE}/api/reset-demo`, { method: "POST" });
                  state = await loadState();
                  location.hash = "#/groups";
                  renderApp();
                } catch (e) {
                  alert("Не удалось сбросить.");
                }
              },
            },
            "Сбросить демо"
          ),
        ]),
      ]),
    ]),
    nav("admin"),
  ]);
}

async function deleteSession(state, sessionId) {
  const idx = state.sessions.findIndex((x) => x.id === sessionId);
  if (idx === -1) return;
  state.sessions.splice(idx, 1);
  await saveState(state);
}

function getGroupMemberEntries(state, groupId) {
  return state.groupMembers.filter((m) => m.groupId === groupId);
}

function getGroupLeaderIds(state, groupId) {
  return getGroupMemberEntries(state, groupId).filter((m) => m.isLeader).map((m) => m.userId);
}

function upsertGroupMembership(state, groupId, userId, { asLeader, asParticipant }) {
  const existingIdx = state.groupMembers.findIndex((m) => m.groupId === groupId && m.userId === userId);
  const isLeader = Boolean(asLeader);
  const isParticipant = Boolean(asParticipant);
  const next = { groupId, userId, isLeader, isParticipant };
  if (existingIdx === -1) state.groupMembers.push(next);
  else state.groupMembers[existingIdx] = next;
}

async function deleteGroup(state, groupId) {
  state.groups = state.groups.filter((g) => g.id !== groupId);
  state.groupMembers = state.groupMembers.filter((m) => m.groupId !== groupId);
  state.sessions = state.sessions.filter((s) => s.groupId !== groupId);
  await saveState(state);
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
  const weeklyLine = formatWeeklySlotLine(s);

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
        weeklyLine ? h("div", { class: "small", style: "opacity:.9;" }, weeklyLine) : null,
        h("div", { class: "small" }, `Ведущие: ${leaders}`),
        s.note ? h("div", { class: "small" }, s.note) : null,
        (s.theme || "").trim()
          ? h("div", { class: "card", style: "margin-top:12px;" }, [
              h("div", { class: "sectionTitle" }, "Тема встречи"),
              h("div", { class: "small", style: "margin-top:0; white-space:pre-wrap;" }, s.theme.trim()),
            ])
          : null,
        (s.summary || "").trim()
          ? h("div", { class: "card", style: "margin-top:12px;" }, [
              h("div", { class: "sectionTitle" }, "Краткое резюме"),
              h("div", { class: "small", style: "margin-top:0; white-space:pre-wrap;" }, s.summary.trim()),
            ])
          : null,
        canEdit && (s.privateNotes || "").trim()
          ? h("div", { class: "card", style: "margin-top:12px; border-color: rgba(122,167,255,.35);" }, [
              h("div", { class: "sectionTitle" }, "Приватные заметки (только ведущие)"),
              h("div", { class: "small", style: "margin-top:0; white-space:pre-wrap;" }, s.privateNotes.trim()),
            ])
          : null,
        h("div", { class: "actions" }, [
          canEdit ? h("button", { class: "btn primary", onclick: () => (location.hash = `#/edit-session?id=${encodeURIComponent(s.id)}`) }, "Изменить") : null,
          canEdit
            ? h(
                "button",
                {
                  class: "btn",
                  onclick: async () => {
                    const copy = cloneSessionShiftDays(state, s, 7);
                    await saveState(state);
                    location.hash = `#/session?id=${encodeURIComponent(copy.id)}`;
                    renderApp();
                  },
                },
                "Копия на +7 дней"
              )
            : null,
          canEdit
            ? h(
                "button",
                {
                  class: "btn danger",
                  onclick: async () => {
                    if (!confirm("Удалить эту встречу? Действие нельзя отменить.")) return;
                    try {
                      await deleteSession(state, s.id);
                      location.hash = g?.id ? `#/group?id=${encodeURIComponent(g.id)}` : "#/upcoming";
                      renderApp();
                    } catch (e) {
                      alert(String(e.message || e));
                      console.error(e);
                    }
                  },
                },
                "Удалить встречу"
              )
            : null,
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
        h("div", { class: "sectionTitle" }, "Постоянный слот недели"),
        h("div", { class: "hint" }, "Удобно для годового плана: типичный день и время. Конкретные даты в блоках выше можно менять отдельно."),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: "sess_weekly_dow" }, "День недели"),
          h(
            "select",
            { id: "sess_weekly_dow" },
            [
              h("option", { value: "", ...(typeof s.weeklyDay !== "number" ? { selected: true } : {}) }, "— не задано —"),
              ...[0, 1, 2, 3, 4, 5, 6].map((d) =>
                h(
                  "option",
                  { value: String(d), ...(s.weeklyDay === d ? { selected: true } : {}) },
                  `${RU_DOW_FULL[d]} (${RU_DOW_SHORT[d]})`
                )
              ),
            ]
          ),
        ]),
        h("div", { class: "grid2" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: "sess_weekly_start" }, "Обычно с"),
            h("input", { id: "sess_weekly_start", type: "time", value: s.weeklyStart ?? "" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: "sess_weekly_end" }, "Обычно до"),
            h("input", { id: "sess_weekly_end", type: "time", value: s.weeklyEnd ?? "" }),
          ]),
        ]),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Ведущие этой встречи"),
        editLeadersUI(state, s),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Короткая заметка (видна всем)"),
        h("div", { class: "hint" }, "Одна строка: ссылка, напоминание, что увидят и участники."),
        h("input", { id: "note", value: s.note ?? "", placeholder: "Например: ссылка на Zoom, общее напоминание" }),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Тема и содержание"),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: "sess_theme" }, "Тема встречи"),
          h("textarea", { id: "sess_theme", placeholder: "О чём встреча, фокус" }, s.theme ?? ""),
        ]),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: "sess_summary" }, "Краткое резюме"),
          h("textarea", { id: "sess_summary", placeholder: "Итоги, важные моменты" }, s.summary ?? ""),
        ]),
        h("div", { class: "hr" }),
        h("div", { class: "sectionTitle" }, "Только для ведущих"),
        h("div", { class: "hint" }, "Участники эту часть не увидят. Подходит для личных наблюдений."),
        h("div", { class: "field" }, [
          h("label", { class: "label", for: "sess_private" }, "Приватные заметки"),
          h("textarea", { id: "sess_private", placeholder: "Для себя: процесс, риски, супервизия…" }, s.privateNotes ?? ""),
        ]),
        h("div", { class: "actions" }, [
          h("button", { class: "btn primary", onclick: async () => onSaveEdit(state, s) }, "Сохранить"),
          h(
            "button",
            {
              class: "btn",
              onclick: async () => {
                const copy = cloneSessionShiftDays(state, s, 7);
                await saveState(state);
                location.hash = `#/session?id=${encodeURIComponent(copy.id)}`;
                renderApp();
              },
            },
            "Копия на +7 дней"
          ),
          h(
            "button",
            {
              class: "btn danger",
              onclick: async () => {
                if (!confirm("Удалить эту встречу? Действие нельзя отменить.")) return;
                try {
                  await deleteSession(state, s.id);
                  location.hash = g?.id ? `#/group?id=${encodeURIComponent(g.id)}` : "#/upcoming";
                  renderApp();
                } catch (e) {
                  alert(String(e.message || e));
                  console.error(e);
                }
              },
            },
            "Удалить встречу"
          ),
          h("button", { class: "btn", onclick: () => history.back() }, "Отмена"),
        ]),
        h("div", { class: "hint", style: "margin-top:8px;" }, "«Копия на +7 дней» берёт последнее сохранённое состояние встречи (если меняли форму — сначала «Сохранить»)."),
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
  const theme = document.getElementById("sess_theme")?.value ?? "";
  const summary = document.getElementById("sess_summary")?.value ?? "";
  const privateNotes = document.getElementById("sess_private")?.value ?? "";
  const wdRaw = document.getElementById("sess_weekly_dow")?.value ?? "";
  let weeklyDay;
  if (wdRaw === "") weeklyDay = undefined;
  else {
    const n = Number(wdRaw);
    weeklyDay = Number.isInteger(n) && n >= 0 && n <= 6 ? n : undefined;
  }
  const weeklyStart = (document.getElementById("sess_weekly_start")?.value ?? "").trim();
  const weeklyEnd = (document.getElementById("sess_weekly_end")?.value ?? "").trim();

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

  const updated = { ...session, status, note, theme, summary, privateNotes, blocks, leaders };
  delete updated.homework;
  if (weeklyDay === undefined) {
    delete updated.weeklyDay;
    delete updated.weeklyStart;
    delete updated.weeklyEnd;
  } else {
    updated.weeklyDay = weeklyDay;
    updated.weeklyStart = weeklyStart;
    updated.weeklyEnd = weeklyEnd;
  }
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

function renderNewConsultation(state) {
  const roleId = "pc_role";
  const otherNameId = "pc_other";
  const noteId = "pc_note";

  const onCreate = async () => {
    const role = document.getElementById(roleId)?.value || "therapist";
    const otherName = (document.getElementById(otherNameId)?.value || "").trim();
    const note = (document.getElementById(noteId)?.value || "").trim();
    if (!otherName) return alert("Введите имя второй стороны (клиента/терапевта).");

    const key = otherName.toLowerCase();
    let otherId = state.users.find((u) => (u.name || "").trim().toLowerCase() === key)?.id;
    if (!otherId) {
      otherId = uid("u");
      state.users.push({ id: otherId, name: otherName });
    }

    const isTherapist = role === "therapist";
    const g = {
      id: uid("g"),
      name: isTherapist ? `Консультация • ${otherName}` : `Консультация • мой терапевт: ${otherName}`,
      type: "личная",
      color: isTherapist ? "#ffcc66" : "#55d691",
    };
    state.groups.push(g);

    // В личной консультации: терапевт = leader, клиент = participant.
    state.groupMembers.push({
      groupId: g.id,
      userId: state.meId,
      isLeader: isTherapist,
      isParticipant: !isTherapist,
    });
    state.groupMembers.push({
      groupId: g.id,
      userId: otherId,
      isLeader: !isTherapist,
      isParticipant: isTherapist,
    });

    const s = {
      id: uid("s"),
      groupId: g.id,
      status: "предварительно",
      leaders: [
        { userId: isTherapist ? state.meId : otherId, days: "all" },
      ],
      blocks: [{ id: uid("b"), date: "", startTime: "", endTime: "" }],
      note: note || "",
      ...emptySessionFields(),
    };
    state.sessions.push(s);

    await saveState(state);
    location.hash = `#/edit-session?id=${encodeURIComponent(s.id)}`;
  };

  return h("div", {}, [
    topbar("Личная консультация", "Уточните роль и создайте первую встречу.", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "form" }, [
          h("div", { class: "field" }, [
            h("label", { class: "label", for: roleId }, "Моя роль"),
            h("select", { id: roleId }, [
              h("option", { value: "therapist" }, "Я терапевт"),
              h("option", { value: "client" }, "Я клиент"),
            ]),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: otherNameId }, "Имя второй стороны"),
            h("input", { id: otherNameId, placeholder: "Например: Мария" }),
          ]),
          h("div", { class: "field" }, [
            h("label", { class: "label", for: noteId }, "Заметка (опционально)"),
            h("input", { id: noteId, placeholder: "Напр.: формат, оплата, ссылка" }),
          ]),
          h("div", { class: "actions" }, [
            h("button", { class: "btn primary", onclick: onCreate }, "Создать и назначить время"),
            h("button", { class: "btn", onclick: () => history.back() }, "Отмена"),
          ]),
        ]),
      ]),
      h(
        "div",
        { class: "small", style: "margin-top:10px; opacity:.85;" },
        "В личной консультации терапевт считается «ведущим», клиент — «участником». Это повлияет на видимость в разделах «Я веду / Я участник»."
      ),
    ]),
    nav("create"),
  ]);
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
      ...emptySessionFields(),
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

function renderClients(state) {
  const ids = myClientUserIds(state);
  const clients = ids
    .map((id) => userById(state, id))
    .filter(Boolean)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));

  const list =
    clients.length === 0
      ? h(
          "div",
          { class: "empty" },
          "Здесь появятся люди из личных консультаций, где вы — терапевт (ведущий). Создайте консультацию: «Создать» → «Личная консультация»."
        )
      : h(
          "div",
          {},
          clients.map((u) =>
            h(
              "div",
              {
                class: "listCard",
                role: "button",
                tabindex: "0",
                onclick: () => (location.hash = `#/client?id=${encodeURIComponent(u.id)}`),
                onkeydown: (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    location.hash = `#/client?id=${encodeURIComponent(u.id)}`;
                  }
                },
              },
              [
                h("div", {}, [
                  h("div", { class: "listTitle" }, u.name || "Без имени"),
                  h("div", { class: "listMeta" }, "Анамнез и записи по встречам"),
                ]),
                h("div", { class: "chev" }, "›"),
              ]
            )
          )
        );

  return h("div", {}, [
    topbar("Мои клиенты", "Общий анамнез и краткая динамика по сессиям — внутри карточки клиента.", null),
    h("div", { class: "content" }, [
      list,
      h("div", { class: "actions", style: "margin-top:14px;" }, [
        h("button", { class: "btn", onclick: () => (location.hash = "#/profile") }, "К профилю"),
      ]),
    ]),
    nav("profile"),
  ]);
}

function renderClient(state, userId) {
  if (!userId) return renderNotFound("Клиент не указан");
  if (!myClientUserIds(state).includes(userId)) return renderNotFound("Нет доступа или клиент не найден");
  const u = userById(state, userId);
  if (!u) return renderNotFound("Клиент не найден");

  const anamId = "cl_anam";
  const sessions = sessionsForClientConsultation(state, userId);

  const onSaveAnam = async () => {
    const text = document.getElementById(anamId)?.value ?? "";
    const idx = state.users.findIndex((x) => x.id === userId);
    if (idx < 0) return;
    state.users[idx] = { ...state.users[idx], clientAnamnesis: text };
    await saveState(state);
    alert("Анамнез сохранён.");
    renderApp();
  };

  const sessionWhenLabel = (s) => {
    const d0 = sessionFirstDate(s);
    return d0 === "9999-99-99" ? "Дата уточняется" : formatDateRu(d0);
  };

  return h("div", {}, [
    topbar(u.name || "Клиент", "Личная консультация • ваши заметки", null),
    h("div", { class: "content" }, [
      h("div", { class: "card" }, [
        h("div", { class: "sectionTitle" }, "Анамнез / контекст"),
        h("div", { class: "small" }, "Общие сведения на человека (для всех консультаций с ним в этом кабинете)."),
        h("textarea", { id: anamId, placeholder: "Запрос, обстоятельства, важное…" }, u.clientAnamnesis ?? ""),
        h("div", { class: "actions profile-actions" }, [
          h("button", { class: "btn primary", onclick: onSaveAnam }, "Сохранить анамнез"),
        ]),
      ]),
      h("div", { class: "sectionTitle", style: "margin-top:8px;" }, "Встречи и динамика"),
      h("div", { class: "small", style: "margin-bottom:10px;" }, "Строка из темы, резюме или общей заметки; полный текст — во встрече."),
      sessions.length === 0
        ? h("div", { class: "empty" }, "Пока нет встреч в консультации с этим человеком.")
        : h(
            "div",
            {},
            sessions.map((s) => {
              const g = groupById(state, s.groupId);
              const open = () => (location.hash = `#/session?id=${encodeURIComponent(s.id)}`);
              return h(
                "div",
                {
                  class: "card",
                  style: "margin-bottom:10px; cursor:pointer;",
                  role: "button",
                  tabindex: "0",
                  onclick: open,
                  onkeydown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  },
                },
                [
                  h("div", { class: "groupName" }, `${sessionWhenLabel(s)} • ${g?.name ?? "Консультация"}`),
                  h("div", { class: "small", style: "white-space:pre-wrap; opacity:.9;" }, sessionDynamicsSnippet(s)),
                ]
              );
            })
          ),
      h("div", { class: "actions" }, [
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => (location.hash = `#/pdf-client?id=${encodeURIComponent(userId)}`),
          },
          "PDF / печать"
        ),
        h("button", { class: "btn", onclick: () => (location.hash = "#/clients") }, "К списку клиентов"),
      ]),
    ]),
    nav("profile"),
  ]);
}

function renderPeople(state) {
  const list = state.users.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));

  const rows = list.map((u) => {
    const nameInputId = `ppl_${u.id}`;
    if (u.id === state.meId) {
      return h("div", { class: "card" }, [
        h("div", { class: "line" }, [
          h("div", { class: "k" }, "Вы"),
          h("div", {}, u.name || "Без имени"),
        ]),
        h("div", { class: "small" }, "Имя и данные профиля — в разделе «Профиль»."),
      ]);
    }
    const onSave = async () => {
      const nm = (document.getElementById(nameInputId)?.value || "").trim();
      if (!nm) return alert("Имя не может быть пустым.");
      const idx = state.users.findIndex((x) => x.id === u.id);
      if (idx >= 0) {
        state.users[idx] = { ...state.users[idx], name: nm };
        await saveState(state);
        renderApp();
      }
    };
    const onDel = async () => {
      if (!confirm(`Удалить контакт «${u.name}»? Он будет убран из всех групп и из списков ведущих встреч.`)) return;
      const wouldBreak = state.sessions.some((s) => {
        if (!s.leaders.some((l) => l.userId === u.id)) return false;
        const remaining = s.leaders.filter((l) => l.userId !== u.id);
        return remaining.length === 0;
      });
      if (wouldBreak) {
        return alert("Нельзя удалить: для какой-то встречи этот человек единственный ведущий. Сначала назначьте другого ведущего.");
      }
      state.users = state.users.filter((x) => x.id !== u.id);
      state.groupMembers = state.groupMembers.filter((m) => m.userId !== u.id);
      for (const s of state.sessions) {
        s.leaders = s.leaders.filter((l) => l.userId !== u.id);
      }
      await saveState(state);
      renderApp();
    };
    return h("div", { class: "card" }, [
      h("div", { class: "field" }, [h("input", { id: nameInputId, value: u.name || "" })]),
      h("div", { class: "actions profile-actions" }, [
        h("button", { class: "btn primary", onclick: onSave }, "Сохранить"),
        h("button", { class: "btn danger", onclick: onDel }, "Удалить"),
      ]),
    ]);
  });

  return h("div", {}, [
    topbar("Контакты", "Справочник людей: правка имени и удаление. Одинаковые имена при добавлении больше не плодятся.", null),
    h("div", { class: "content" }, rows),
    nav("profile"),
  ]);
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
let pendingInviteToken = null;

function setPendingInviteToken(token) {
  const t = String(token || "").trim();
  pendingInviteToken = t || null;
  try {
    if (pendingInviteToken) localStorage.setItem("pendingInviteToken", pendingInviteToken);
    else localStorage.removeItem("pendingInviteToken");
  } catch {}
}

function loadPendingInviteToken() {
  try {
    const t = String(localStorage.getItem("pendingInviteToken") || "").trim();
    pendingInviteToken = t || null;
  } catch {
    pendingInviteToken = null;
  }
  return pendingInviteToken;
}

function inviteLinksForToken(token) {
  const t = String(token || "").trim();
  const base = location.origin + location.pathname;
  const web = `${base}#/join?token=${encodeURIComponent(t)}`;
  const bot = getBotUsername();
  // Telegram deep link: открывает чат с ботом, а внутри кнопка WebApp передаст start_param.
  // startapp поддерживается Telegram, а start_param будет доступен через initDataUnsafe.start_param.
  const tg = bot ? `https://t.me/${encodeURIComponent(bot)}?startapp=${encodeURIComponent(`join_${t}`)}` : null;
  return { web, tg };
}

function inviteTokenFromTelegramStartParam() {
  try {
    if (!isTelegramWebApp()) return null;
    const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    const raw = String(sp || "").trim();
    if (!raw) return null;
    // ожидаем join_<token>
    if (raw.startsWith("join_")) return raw.slice("join_".length).trim() || null;
    return null;
  } catch {
    return null;
  }
}

async function copyText(text) {
  const t = String(text || "");
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = h("textarea", { style: "position:fixed; left:-9999px; top:-9999px;" }, t);
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return Boolean(ok);
    } catch {
      return false;
    }
  }
}

async function apiJson(endpoint, { method = "GET", body } = {}) {
  const opts = { method, headers: {} };
  if (body != null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${API_BASE}${endpoint}`, opts);
  let j = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  if (!r.ok) {
    const msg = String(j?.message || j?.error || `HTTP ${r.status}`);
    const err = new Error(msg);
    err.status = r.status;
    err.payload = j;
    throw err;
  }
  return j;
}

function renderJoin() {
  const { params } = parseHash();
  const token = String(params.get("token") || pendingInviteToken || "").trim();
  if (token) setPendingInviteToken(token);

  const inTg = isTelegramWebAppContext();
  const loggedIn = Boolean(currentUserId);
  const canAccept = inTg && loggedIn && String(currentUserId).startsWith("tg:");

  const content = [];
  content.push(
    h("div", { class: "card" }, [
      h("div", { class: "sectionTitle" }, "Вас пригласили в группу"),
      h(
        "div",
        { class: "small" },
        inTg
          ? "Нажмите «Присоединиться». Если вход ещё не выполнен — сначала войдите через Telegram."
          : "Откройте эту ссылку в Telegram (через бота), и приложение само присоединит вас к группе."
      ),
    ])
  );

  content.push(
    h("div", { class: "card" }, [
      h("div", { class: "actions profile-actions" }, [
        !inTg ? h("button", { class: "btn primary", onclick: () => openBotInTelegram() }, "Открыть в Telegram") : null,
        inTg && !loggedIn ? h("button", { class: "btn primary", onclick: () => (location.hash = "#/login") }, "Войти") : null,
        h(
          "button",
          {
            class: "btn primary",
            disabled: canAccept ? null : true,
            onclick: async () => {
              try {
          const r = await apiJson("/api/invites?action=accept", { method: "POST", body: { token } });
                setPendingInviteToken(null);
                state = await loadState();
                location.hash = `#/group?id=${encodeURIComponent(r.groupId)}`;
                renderApp();
              } catch (e) {
                const status = Number(e?.status || 0);
                if (status === 401) return alert("Нужно войти. Откройте приложение внутри Telegram и выполните вход.");
                alert(String(e.message || e));
              }
            },
          },
          "Присоединиться"
        ),
      ]),
      !canAccept
        ? h(
            "div",
            { class: "small", style: "margin-top:10px; opacity:.9;" },
            inTg ? "Кнопка станет активной после входа через Telegram." : "Эта страница должна быть открыта внутри Telegram."
          )
        : null,
    ])
  );

  return h("div", {}, [
    topbar("Присоединиться", "Приглашение в группу по ссылке.", null),
    h("div", { class: "content" }, content),
    nav("groups"),
  ]);
}

function renderApp() {
  const { path, params } = parseHash();
  const app = document.getElementById("app");
  app.classList.toggle("isPdfExport", path === "/pdf-year" || (path === "/pdf-client" && params.get("id")));
  app.innerHTML = "";

  if (!state) {
    app.appendChild(h("div", { class: "content" }, [h("div", { class: "empty" }, "Загрузка…")]));
    return;
  }
  if (path === "/login") {
    app.appendChild(renderLogin(state));
    return;
  }
  if (path === "/join") {
    app.appendChild(renderJoin());
    return;
  }
  if (path === "/new-group") {
    app.appendChild(renderNewGroup(state));
    return;
  }
  if (path === "/edit-group") {
    app.appendChild(renderEditGroup(state, params.get("id")));
    return;
  }
  if (path === "/new-consultation") {
    app.appendChild(renderNewConsultation(state));
    return;
  }
  if (path === "/") location.hash = "#/upcoming";
  else if (path === "/upcoming") app.appendChild(renderUpcoming(state, params.get("mode") || "lead", params));
  else if (path === "/year") {
    const y = Number.parseInt(params.get("y"), 10);
    const year = Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    app.appendChild(renderYear(state, year, params.get("mode") || "lead"));
  }
  else if (path === "/pdf-year") {
    const y = Number.parseInt(params.get("y"), 10);
    const year = Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    app.appendChild(renderPdfYear(state, year, params.get("mode") || "lead"));
  }
  else if (path === "/pdf-client") {
    app.appendChild(renderPdfClient(state, params.get("id")));
  }
  else if (path === "/groups") app.appendChild(renderGroups(state, params.get("tab") || "lead"));
  else if (path === "/group") app.appendChild(renderGroup(state, params.get("id")));
  else if (path === "/create") app.appendChild(renderCreate(state));
  else if (path === "/people") app.appendChild(renderPeople(state));
  else if (path === "/clients") app.appendChild(renderClients(state));
  else if (path === "/client") app.appendChild(renderClient(state, params.get("id")));
  else if (path === "/profile") app.appendChild(renderProfile(state));
  else if (path === "/admin") app.appendChild(renderAdmin());
  else if (path === "/wizard") app.appendChild(renderWizard(state, params.get("groupId")));
  else if (path === "/session") app.appendChild(renderSession(state, params.get("id")));
  else if (path === "/edit-session") app.appendChild(renderEditSession(state, params.get("id")));
  else app.appendChild(renderNotFound("Страница не найдена"));
}

window.addEventListener("hashchange", renderApp);

async function boot() {
  loadPendingInviteToken();
  // Подготовка Telegram WebApp (если внутри Telegram).
  if (isTelegramWebApp()) {
    try {
      window.Telegram.WebApp.ready();
    } catch {}
  }
  // Если открыто из Telegram с start_param — запомним токен приглашения.
  const spToken = inviteTokenFromTelegramStartParam();
  if (spToken) setPendingInviteToken(spToken);
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
      profileLinkedEmail = mj.linkedEmail != null ? mj.linkedEmail : null;
      state = await loadState();
      // Если есть незавершённое приглашение и мы внутри Telegram — присоединим автоматически.
      if (pendingInviteToken && isTelegramWebAppContext() && String(currentUserId || "").startsWith("tg:")) {
        try {
          const r = await apiJson("/api/invites?action=accept", { method: "POST", body: { token: pendingInviteToken } });
          setPendingInviteToken(null);
          state = await loadState();
          location.hash = `#/group?id=${encodeURIComponent(r.groupId)}`;
        } catch (e) {
          // Не ломаем загрузку: просто покажем экран join.
          location.hash = "#/join";
        }
      }
      renderApp();
      return;
    }
  } catch {}
  // Если пользователь пришёл по приглашению — не теряем токен, показываем вход.
  const { path, params } = parseHash();
  if (path === "/join") {
    const t = String(params.get("token") || "").trim();
    if (t) setPendingInviteToken(t);
  }
  location.hash = "#/login";
  state = buildDemoState();
  renderApp();
}
boot();

