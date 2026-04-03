function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function buildDemoState() {
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

export function buildEmptyState({ userId, displayName }) {
  const meId = String(userId || "");
  return {
    meId,
    users: [{ id: meId, name: displayName || "Вы" }],
    groups: [],
    groupMembers: [],
    sessions: [],
  };
}

export function validateState(s) {
  if (!s || typeof s !== "object") return "Некорректное тело запроса";
  if (typeof s.meId !== "string") return "meId обязателен";
  if (!Array.isArray(s.users)) return "users должен быть массивом";
  if (!Array.isArray(s.groups)) return "groups должен быть массивом";
  if (!Array.isArray(s.groupMembers)) return "groupMembers должен быть массивом";
  if (!Array.isArray(s.sessions)) return "sessions должен быть массивом";
  for (const ses of s.sessions) {
    if (!ses.id || !ses.groupId) return "У сессии нужны id и groupId";
    if (!Array.isArray(ses.blocks) || !Array.isArray(ses.leaders)) return "У сессии нужны blocks и leaders";
    for (const key of ["note", "theme", "summary", "homework", "privateNotes"]) {
      if (ses[key] !== undefined && typeof ses[key] !== "string") return `Поле сессии ${key} должно быть строкой`;
    }
  }
  return null;
}

