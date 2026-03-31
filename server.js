import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { URL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STATE_PATH = process.env.STATE_PATH || path.join(DATA_DIR, "state.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
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

function serializeDays(days) {
  if (days === "all") return "all";
  return JSON.stringify(days);
}

function parseDays(mode) {
  if (mode === "all") return "all";
  try {
    return JSON.parse(mode);
  } catch {
    return "all";
  }
}

function validateState(s) {
  if (!s || typeof s !== "object") return "Некорректное тело запроса";
  if (typeof s.meId !== "string") return "meId обязателен";
  if (!Array.isArray(s.users)) return "users должен быть массивом";
  if (!Array.isArray(s.groups)) return "groups должен быть массивом";
  if (!Array.isArray(s.groupMembers)) return "groupMembers должен быть массивом";
  if (!Array.isArray(s.sessions)) return "sessions должен быть массивом";
  for (const ses of s.sessions) {
    if (!ses.id || !ses.groupId) return "У сессии нужны id и groupId";
    if (!Array.isArray(ses.blocks) || !Array.isArray(ses.leaders)) return "У сессии нужны blocks и leaders";
  }
  return null;
}

function ensureStateFile() {
  if (fs.existsSync(STATE_PATH)) return;
  const demo = buildDemoState();
  fs.writeFileSync(STATE_PATH, JSON.stringify(demo, null, 2), "utf8");
}

function readState() {
  ensureStateFile();
  const raw = fs.readFileSync(STATE_PATH, "utf8");
  return JSON.parse(raw);
}

function writeState(state) {
  const err = validateState(state);
  if (err) throw new Error(err);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function serveStatic(req, res) {
  const publicDir = path.join(__dirname, "public");
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const buf = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentTypeFor(filePath), "Cache-Control": "no-store" });
  res.end(buf);
}

ensureStateFile();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, stateFile: STATE_PATH });
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      return sendJson(res, 200, readState());
    }

    if (url.pathname === "/api/state" && req.method === "PUT") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}");
      writeState(body);
      return sendJson(res, 200, readState());
    }

    if (url.pathname === "/api/reset-demo" && req.method === "POST") {
      writeState(buildDemoState());
      return sendJson(res, 200, readState());
    }

    return serveStatic(req, res);
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`psy-cabinet: http://localhost:${PORT}`);
  console.log(`State file: ${STATE_PATH}`);
});
