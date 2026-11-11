import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, runTransaction, serverTimestamp, arrayUnion, increment, waitForPendingWrites,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------- theme toggle ----------
function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || (systemPrefersDark() ? "dark" : "light");
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("jankenTheme", theme); } catch (e) {}
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
applyTheme(currentTheme());
document.getElementById("themeToggle").onclick = () => {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
};

// ---------- collapsible sections ----------
// Tapping a section's heading folds it away; which ones are folded is remembered per device.
(() => {
  let folded = [];
  try { folded = JSON.parse(localStorage.getItem("jankenFolded") || "[]"); } catch (e) {}
  document.querySelectorAll(".wrap > section").forEach((sec) => {
    const head = sec.querySelector(".sec-head");
    if (!head) return;
    const set = (on) => {
      sec.classList.toggle("collapsed", on);
      head.setAttribute("aria-expanded", String(!on));
    };
    head.setAttribute("role", "button");
    head.tabIndex = 0;
    set(folded.includes(sec.id));
    const toggle = () => {
      const on = !sec.classList.contains("collapsed");
      set(on);
      folded = folded.filter((id) => id !== sec.id);
      if (on) folded.push(sec.id);
      try { localStorage.setItem("jankenFolded", JSON.stringify(folded)); } catch (e) {}
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
})();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const membersCol = collection(db, "members");
const recordsCol = collection(db, "records");
const seasonsCol = collection(db, "seasons");
const sessionRef = doc(db, "session", "current");
const seedRef = doc(db, "meta", "seed");
const seasonMetaRef = doc(db, "meta", "season");

// Icon colours a member can pick (the hex values live in index.html as --c-<key>, one set per
// theme). The first six are also the defaults, handed out in joining order.
const COLOR_CHOICES = [
  ["violet", "紫"], ["yellow", "黄"], ["magenta", "ピンク"], ["green", "緑"], ["blue", "青"], ["red", "赤"],
  ["orange", "オレンジ"], ["aqua", "エメラルド"], ["cyan", "水色"], ["brown", "茶"], ["gray", "グレー"],
];
const DEFAULT_COLORS = 6;
let colorPickerOpen = false;
const HAND_ORDER = ["グー", "チョキ", "パー"];
const BEATS = { "グー": "チョキ", "チョキ": "パー", "パー": "グー" };

let myId = localStorage.getItem("jankenMemberId") || null;
let viewOnly = false;
let members = {};     // id -> data
let membersLoaded = false;  // false until the member list has arrived from the server
let pendingLogin = false;   // the login button was pressed before the member list arrived
let memberOrder = []; // ids sorted by createdAt
let records = [];     // array of {id, ...data}
let session = null;   // current session doc data, or null
let seasons = {};        // id(string) -> {label, startedAt}
let currentSeason = 1;   // the season new rounds are recorded into
let selectedSeason = 1;    // the season currently being viewed (defaults to currentSeason)
let seasonMetaLoaded = false;
let selectedMode = "all";  // "all" | "通常モード" | "男気モード" — filters the stats below

// ---------- seed (embedded, only used once if the store is empty) ----------
const SEED = {"members":[{"id":"2107","name":"上田","points":15,"games":41,"losses":10},{"id":"2111","name":"小林","points":-11,"games":35,"losses":17},{"id":"2152","name":"吉村","points":-4,"games":42,"losses":18}],"records":[{"dateISO":"2026-03-18","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"チョキ"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー","2111":"パー","2152":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-03-19","mode":"通常モード","participantIds":["2111","2152"],"hands":{"2107":"不参加","2111":"パー","2152":"チョキ"},"loserId":"2111","streakText":"小林2連敗","pitches":[{"hands":{"2107":"不参加","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-03-23","mode":"男気モード","participantIds":["2107","2111"],"hands":{"2107":"グー","2111":"パー","2152":"不参加"},"loserId":"2111","streakText":"小林3連敗","pitches":[{"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"result":"最終決着"},{"hands":{"2107":"グー","2111":"パー","2152":"不参加"},"result":"最終決着"}]},{"dateISO":"2026-03-23","mode":"男気モード","participantIds":["2107","2111"],"hands":{"2107":"グー","2111":"パー","2152":"不参加"},"loserId":"2111","streakText":"小林4連敗","pitches":[{"hands":{"2107":"グー","2111":"パー","2152":"不参加"},"result":"最終決着"}]},{"dateISO":"2026-03-24","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"グー","2152":"パー"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"パー","2152":"パー"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー(勝)","2111":"グー","2152":"グー"},"result":"あいこ"},{"hands":{"2107":"グー(勝)","2111":"グー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-03-24","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"グー","2152":"グー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"グー","2152":"パー"},"result":"勝ち抜け発生"},{"hands":{"2107":"パー","2111":"グー(勝)","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"グー(勝)","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"グー(勝)","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-03-25","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"グー","2152":"パー"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"パー","2152":"グー"},"result":"あいこ"},{"hands":{"2107":"グー","2111":"グー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-03-26","mode":"男気モード","participantIds":["2107","2111"],"hands":{"2107":"チョキ","2111":"グー","2152":"不参加"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"パー","2152":"不参加"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"グー","2152":"不参加"},"result":"最終決着"}]},{"dateISO":"2026-03-27","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"チョキ","2111":"グー","2152":"パー"},"loserId":"2152","streakText":"吉村2連敗","pitches":[{"hands":{"2107":"チョキ","2111":"グー","2152":"グー"},"result":"勝ち抜け発生"},{"hands":{"2107":"チョキ(勝)","2111":"グー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-03-30","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"チョキ"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"グー","2152":"グー"},"result":"あいこ"},{"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー","2111":"パー","2152":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-03-31","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"チョキ","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"パー","2152":"グー"},"result":"あいこ"},{"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"2107":"チョキ","2111":"チョキ","2152":"チョキ(勝)"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"チョキ","2152":"チョキ(勝)"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-04-03","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-03","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"グー","2152":"グー"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"チョキ","2152":"グー"},"result":"勝ち抜け発生"},{"hands":{"2107":"パー","2111":"グー","2152":"グー(勝)"},"result":"最終決着"}]},{"dateISO":"2026-04-06","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"グー","2111":"不参加","2152":"チョキ"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"不参加","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-07","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"loserId":"2152","streakText":"吉村2連敗","pitches":[{"hands":{"2107":"パー","2111":"不参加","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-07","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"パー","2152":"グー"},"loserId":"2152","streakText":"吉村3連敗","pitches":[{"hands":{"2107":"チョキ","2111":"グー","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"パー","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-09","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"チョキ","2111":"不参加","2152":"パー"},"loserId":"2152","streakText":"吉村4連敗","pitches":[{"hands":{"2107":"チョキ","2111":"不参加","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-09","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"チョキ","2152":"グー"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"result":"最終決着"},{"hands":{"2107":"グー","2111":"チョキ","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-10","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ"},"result":"最終決着"},{"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-10","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-13","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"チョキ","2152":"パー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"チョキ","2152":"パー"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー","2111":"チョキ(勝)","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-14","mode":"通常モード","participantIds":["2111","2152"],"hands":{"2107":"不参加","2111":"パー","2152":"チョキ"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"チョキ","2152":"グー"},"result":"最終決着"},{"hands":{"2107":"不参加","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-15","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"パー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"パー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-20","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"グー","2152":"パー"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"グー","2152":"グー"},"result":"勝ち抜け発生"},{"hands":{"2107":"パー(勝)","2111":"パー","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"パー(勝)","2111":"チョキ","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"パー(勝)","2111":"グー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-21","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"パー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"パー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-23","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"チョキ","2111":"グー","2152":"チョキ"},"loserId":"2107","streakText":"上田2連敗","pitches":[{"hands":{"2107":"パー","2111":"グー","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"2107":"パー","2111":"パー","2152":"チョキ(勝)"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"グー","2152":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-04-24","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"チョキ","2152":"グー"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"グー","2152":"グー"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"グー","2152":"グー"},"result":"勝ち抜け発生"},{"hands":{"2107":"パー(勝)","2111":"チョキ","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-27","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"グー","2152":"チョキ"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"チョキ","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"グー","2152":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー","2111":"グー(勝)","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-28","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"パー","2111":"不参加","2152":"チョキ"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"不参加","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"不参加","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"チョキ","2111":"不参加","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"不参加","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-01","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"不参加","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-07","mode":"男気モード","participantIds":["2111","2152"],"hands":{"2107":"不参加","2111":"グー","2152":"パー"},"loserId":"2152","streakText":"吉村2連敗","pitches":[{"hands":{"2107":"不参加","2111":"チョキ","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"不参加","2111":"グー","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-05-08","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"パー"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"チョキ","2152":"パー"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー","2111":"パー","2152":"パー(勝)"},"result":"最終決着"}]},{"dateISO":"2026-05-11","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"パー"},"loserId":"2111","streakText":"小林2連敗","pitches":[{"hands":{"2107":"チョキ","2111":"チョキ","2152":"パー"},"result":"勝ち抜け発生"},{"hands":{"2107":"グー","2111":"パー","2152":"パー(勝)"},"result":"最終決着"}]},{"dateISO":"2026-05-12","mode":"男気モード","participantIds":["2107","2152"],"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"不参加","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-13","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"グー"},"loserId":"2111","streakText":"小林3連敗","pitches":[{"hands":{"2107":"グー","2111":"グー","2152":"グー"},"result":"あいこ"},{"hands":{"2107":"グー","2111":"パー","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-14","mode":"男気モード","participantIds":["2107","2152"],"hands":{"2107":"グー","2111":"不参加","2152":"パー"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"不参加","2152":"パー"},"result":"最終決着"}]},{"dateISO":"2026-05-18","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"グー","2111":"パー","2152":"グー"},"loserId":"2111","streakText":"小林4連敗","pitches":[{"hands":{"2107":"グー","2111":"パー","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-20","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-22","mode":"男気モード","participantIds":["2107","2152"],"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"パー","2111":"不参加","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-25","mode":"男気モード","participantIds":["2111","2152"],"hands":{"2107":"不参加","2111":"パー","2152":"チョキ"},"loserId":"2152","streakText":null,"pitches":[{"hands":{"2107":"不参加","2111":"パー","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"不参加","2111":"パー","2152":"パー"},"result":"あいこ"},{"hands":{"2107":"不参加","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-29","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"loserId":"2152","streakText":"吉村2連敗","pitches":[{"hands":{"2107":"パー","2111":"グー","2152":"チョキ"},"result":"あいこ"},{"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-29","mode":"男気モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"loserId":"2152","streakText":"吉村3連敗","pitches":[{"hands":{"2107":"パー","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-06-01","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"パー","2111":"グー","2152":"グー"},"loserId":"2152","streakText":"吉村4連敗","pitches":[{"hands":{"2107":"チョキ","2111":"グー","2152":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"2107":"パー","2111":"グー(勝)","2152":"グー"},"result":"最終決着"}]},{"dateISO":"2026-06-05","mode":"通常モード","participantIds":["2107","2111","2152"],"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ"},"loserId":"2111","streakText":null,"pitches":[{"hands":{"2107":"チョキ","2111":"パー","2152":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-06-10","mode":"通常モード","participantIds":["2107","2152"],"hands":{"2107":"グー","2111":"不参加","2152":"パー"},"loserId":"2107","streakText":null,"pitches":[{"hands":{"2107":"グー","2111":"不参加","2152":"パー"},"result":"最終決着"}]}]};

async function trySeed() {
  try {
    await runTransaction(db, async (tx) => {
      const flag = await tx.get(seedRef);
      if (flag.exists()) return;
      tx.set(seedRef, { seeded: true, at: serverTimestamp() });
      for (const m of SEED.members) {
        tx.set(doc(membersCol, m.id), {
          name: m.name, active: true, points: m.points, games: m.games,
          losses: m.losses, createdAt: serverTimestamp(),
        });
      }
      for (const r of SEED.records) {
        tx.set(doc(recordsCol), { ...r, createdAt: serverTimestamp() });
      }
    });
  } catch (e) {
    // conflict = someone else seeded first; safe to ignore
  }
}

// ---------- auth ----------
onAuthStateChanged(auth, (user) => {
  if (user) boot();
});
signInAnonymously(auth).catch((e) => {
  document.getElementById("gate").innerHTML =
    '<div class="box card pad"><p>接続に失敗しました。ページを再読み込みしてください。</p></div>';
  console.error(e);
});

function boot() {
  trySeed();
  onSnapshot(membersCol, (snap) => {
    members = {};
    const withDates = [];
    snap.forEach((d) => {
      members[d.id] = d.data();
      withDates.push([d.id, d.data().createdAt?.toMillis?.() ?? 0]);
    });
    withDates.sort((a, b) => a[1] - b[1]);
    memberOrder = withDates.map((x) => x[0]);
    membersLoaded = true;
    renderGate();
    scheduleRenderAll();
    if (pendingLogin) { pendingLogin = false; document.getElementById("btnLogin").click(); }
  });
  onSnapshot(recordsCol, (snap) => {
    records = [];
    snap.forEach((d) => records.push({ id: d.id, ...d.data() }));
    records.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1
      : (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)));
    scheduleRenderAll();
  });
  onSnapshot(sessionRef, (snap) => {
    session = snap.exists() ? snap.data() : null;
    maybeResolve();
    renderRound();
  });
  onSnapshot(seasonsCol, (snap) => {
    seasons = {};
    snap.forEach((d) => { seasons[d.id] = d.data(); });
    renderSeason();
  });
  onSnapshot(seasonMetaRef, (snap) => {
    currentSeason = snap.exists() ? (snap.data().current || 1) : 1;
    if (!seasonMetaLoaded) { selectedSeason = currentSeason; seasonMetaLoaded = true; }
    renderSeason();
    scheduleRenderAll();
  });
}

// Several listeners often fire back to back (opening the page, or a round finishing, which
// touches the record and every participant). Redraw once for the whole burst instead of
// rebuilding the page each time.
let renderQueued = false;
function scheduleRenderAll() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; renderAll(); }, 0);
}

function seasonLabel(id) {
  return seasons[String(id)]?.label || `シーズン${id}`;
}

function renderSeason() {
  const el = document.getElementById("season");
  const maxKnown = Math.max(currentSeason, ...Object.keys(seasons).map(Number), 1);
  let chips = "";
  for (let s = 1; s <= maxKnown; s++) {
    chips += `<button class="btn ghost small ${s === selectedSeason ? "on" : ""}" data-season="${s}" style="${s === selectedSeason ? "background:var(--accent);color:var(--accent-ink);border-color:transparent;" : ""}">${esc(seasonLabel(s))}</button>`;
  }
  const modeTabs = [["all", "合計", ""], ["通常モード", "通常モード時", "mode-normal"], ["男気モード", "男気モード時", "mode-otoko"]];
  const modeChips = modeTabs.map(([val, label, cls]) =>
    `<button class="btn ghost small ${cls} ${selectedMode === val ? "on" : ""}" data-mode-filter="${val}" style="${selectedMode === val && !cls ? "background:var(--accent);color:var(--accent-ink);border-color:transparent;" : ""}">${label}</button>`
  ).join("");
  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${chips}</div>
    <div class="sec-note" style="margin-bottom:10px">対戦は常に現在のシーズン（${esc(seasonLabel(currentSeason))}）に記録されます</div>
    <button class="btn ghost small" id="btnNewSeason">＋ 新しいシーズンを開始する</button>`;
  el.querySelectorAll("[data-season]").forEach((b) => {
    b.onclick = () => { selectedSeason = Number(b.dataset.season); trendAnimUntil = 0; renderSeason(); renderAll(); };
  });
  // the mode filter sits right above the stats it filters (below the member list)
  const mf = document.getElementById("modeFilter");
  mf.innerHTML = `<div class="sec-note" style="margin-bottom:6px">モード別に見る</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${modeChips}</div>`;
  mf.querySelectorAll("[data-mode-filter]").forEach((b) => {
    b.onclick = () => { selectedMode = b.dataset.modeFilter; trendAnimUntil = 0; renderSeason(); renderAll(); };
  });
  document.getElementById("btnNewSeason").onclick = startNewSeason;
}

async function startNewSeason() {
  const next = currentSeason + 1;
  const label = prompt("新しいシーズンの名前", `シーズン${next}`);
  if (label === null) return;
  if (!confirm(`「${label}」を開始します。よろしいですか？（これ以降の対戦はこのシーズンに記録されます）`)) return;
  await runTransaction(db, async (tx) => {
    tx.set(seasonMetaRef, { current: next });
    tx.set(doc(seasonsCol, String(next)), { label, startedAt: serverTimestamp() });
  });
  selectedSeason = next;
}

function colorKey(id) {
  // the colour the member picked (saved on their member record, so everyone sees it), or
  // else the default for their place in the joining order
  const picked = members[id]?.color;
  if (COLOR_CHOICES.some(([key]) => key === picked)) return picked;
  const i = memberOrder.indexOf(id);
  return COLOR_CHOICES[i >= 0 ? i % DEFAULT_COLORS : 0][0];
}

function colorVar(id) {
  return `var(--c-${colorKey(id)})`;
}

// ---------- identity gate ----------
document.getElementById("tabLogin").onclick = () => switchTab("login");
document.getElementById("tabJoin").onclick = () => switchTab("join");
function switchTab(which) {
  document.getElementById("tabLogin").classList.toggle("on", which === "login");
  document.getElementById("tabJoin").classList.toggle("on", which === "join");
  document.getElementById("panelLogin").style.display = which === "login" ? "flex" : "none";
  document.getElementById("panelJoin").style.display = which === "join" ? "flex" : "none";
}

document.getElementById("btnLogin").onclick = () => {
  const code = document.getElementById("loginCode").value.trim().toLowerCase();
  const err = document.getElementById("loginErr");
  if (!code) { err.textContent = "IDを入力してください"; return; }
  if (!membersLoaded) {
    // the member list is still on its way: finish the login by itself once it arrives
    pendingLogin = true;
    err.textContent = "データを読み込み中です。このままお待ちください…";
    return;
  }
  if (!members[code]) { err.textContent = "そのIDは見つかりません"; return; }
  err.textContent = "";
  myId = code;
  localStorage.setItem("jankenMemberId", code);
  viewOnly = false;
  renderGate();
  renderAll();
};

async function registerMember(id, name, extra = {}) {
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(doc(membersCol, id));
    if (existing.exists()) throw new Error("id_taken");
    tx.set(doc(membersCol, id), {
      name, active: true, points: 0, games: 0, losses: 0, createdAt: serverTimestamp(), ...extra,
    });
  });
}

// ---------- guests ----------
// A guest is a nameless seat ("ゲスト", "ゲスト2", …) that anyone can add to a round. Seats are
// reused: a guest leaves the member list again when their round ends, and the person's real
// name can be written on each record afterwards (see the record's edit box).
function isGuest(id) {
  const m = members[id];
  return !!m && (m.guest === true || /^ゲスト\d*$/.test(m.name || ""));
}

async function addGuest() {
  // bring back a seat nobody is using, or make a new one
  const idle = memberOrder.find((id) => isGuest(id) && !members[id].active);
  if (idle) {
    await updateDoc(doc(membersCol, idle), { active: true });
    return idle;
  }
  const n = memberOrder.filter(isGuest).length + 1;
  for (let tries = 0; ; tries++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    try {
      await registerMember(id, n === 1 ? "ゲスト" : `ゲスト${n}`, { guest: true });
      return id;
    } catch (e) {
      if (e.message !== "id_taken" || tries >= 3) throw e;
    }
  }
}

function recName(r, id) {
  // the name to show for a participant of one record: a guest's name as written on that
  // record, otherwise the member's name
  return r.guestNames?.[id] || members[id]?.name || id;
}

document.getElementById("btnJoin").onclick = async () => {
  const name = document.getElementById("joinName").value.trim();
  const id = document.getElementById("joinId").value.trim();
  const err = document.getElementById("joinErr");
  if (!name) { err.textContent = "表示名を入力してください"; return; }
  if (!/^[0-9]{1,10}$/.test(id)) { err.textContent = "IDは数字で入力してください"; return; }
  err.textContent = "";
  try {
    await registerMember(id, name);
  } catch (e) {
    err.textContent = e.message === "id_taken" ? "そのIDはすでに使われています。別の番号にしてください" : "登録に失敗しました";
    return;
  }
  myId = id;
  localStorage.setItem("jankenMemberId", id);
  viewOnly = false;
  document.getElementById("codeReveal").style.display = "block";
  document.getElementById("codeRevealVal").textContent = id;
};

document.getElementById("btnGuest").onclick = async () => {
  const id = await addGuest();
  myId = id;
  localStorage.setItem("jankenMemberId", id);
  viewOnly = false;
  renderGate();
  renderAll();
};

document.getElementById("btnViewOnly").onclick = () => {
  viewOnly = true;
  document.getElementById("gate").style.display = "none";
};

function renderGate() {
  const gate = document.getElementById("gate");
  if (myId && members[myId]) {
    gate.style.display = "none";
  } else if (!viewOnly && (membersLoaded || !myId)) {
    // a remembered ID keeps the gate away while the member list loads
    gate.style.display = "flex";
  }
  renderWhoami();
}

function renderWhoami() {
  const el = document.getElementById("whoami");
  if (myId && members[myId]) {
    el.innerHTML = `<span>ようこそ、<b>${esc(members[myId].name)}</b>さん（ID: <code>${myId}</code>）</span><button class="switch" id="btnSwitch">別の人に切り替える</button>`;
    document.getElementById("btnSwitch").onclick = () => {
      localStorage.removeItem("jankenMemberId");
      myId = null;
      renderGate();
      renderAll();
    };
  } else if (myId && !membersLoaded) {
    el.innerHTML = "<span>読み込み中…</span>";
  } else {
    el.innerHTML = `<span>閲覧のみで見ています</span><button class="switch" id="btnSwitch">ログインする</button>`;
    document.getElementById("btnSwitch").onclick = () => {
      viewOnly = false;
      renderGate();
    };
  }
}

renderWhoami();

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- members section ----------
function renderMembers() {
  const el = document.getElementById("members");
  let html = "";
  // guests are listed only while they are in use (added for a round); the named members stay
  const shown = memberOrder.filter((id) => !isGuest(id) || members[id].active);
  shown.forEach((id) => {
    const m = members[id];
    html += `<div class="member-row ${m.active ? "" : "inactive"}">
      <span class="dot" style="background:${colorVar(id)}"></span>
      <span class="name">${esc(m.name)}</span>
      <span class="code">${id}</span>
      ${id === myId ? `<button class="btn ghost small" id="btnColor">色を変える</button>` : ""}
      ${myId ? `<button class="btn ghost small" data-toggle="${id}">${m.active ? "脱退" : "復帰"}</button>` : ""}
    </div>`;
    if (id === myId && colorPickerOpen) {
      // colours other members are showing are greyed out, so no two icons look the same
      const mine = colorKey(id);
      const taken = {};
      memberOrder.forEach((other) => { if (other !== id && members[other].active) taken[colorKey(other)] = members[other].name; });
      html += `<div class="color-picker">
        <div class="sec-note" style="white-space:normal">自分のアイコンの色を選んでください。全員の画面に反映されます（薄い色はほかの人が使用中）</div>
        <div class="swatches">${COLOR_CHOICES.map(([key, label]) => `<button class="swatch ${key === mine ? "on" : ""}" data-color="${key}"
          style="background:var(--c-${key})" ${taken[key] ? "disabled" : ""} aria-label="${label}${taken[key] ? `（${esc(taken[key])}さんが使用中）` : ""}" title="${label}"></button>`).join("")}</div>
      </div>`;
    }
  });
  if (shown.length === 0) html = '<div class="empty">まだメンバーがいません</div>';
  html += `<div class="add-member">
    <input class="field" id="newMemberName" placeholder="表示名">
    <input class="field" id="newMemberId" placeholder="ID（数字）" inputmode="numeric" pattern="[0-9]*" style="max-width:110px">
    <button class="btn" id="btnAddMember">追加</button>
  </div>`;
  el.innerHTML = html;
  const colorBtn = document.getElementById("btnColor");
  if (colorBtn) colorBtn.onclick = () => { colorPickerOpen = !colorPickerOpen; renderMembers(); };
  el.querySelectorAll("[data-color]").forEach((b) => {
    b.onclick = async () => {
      colorPickerOpen = false;
      await updateDoc(doc(membersCol, myId), { color: b.dataset.color });
    };
  });
  el.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.toggle;
      await updateDoc(doc(membersCol, id), { active: !members[id].active });
    };
  });
  document.getElementById("btnAddMember").onclick = async () => {
    const nameInput = document.getElementById("newMemberName");
    const idInput = document.getElementById("newMemberId");
    const name = nameInput.value.trim();
    const id = idInput.value.trim();
    if (!name) return;
    if (!/^[0-9]{1,10}$/.test(id)) { alert("IDは数字で入力してください"); return; }
    try {
      await registerMember(id, name);
    } catch (e) {
      alert(e.message === "id_taken" ? "そのIDはすでに使われています" : "登録に失敗しました");
      return;
    }
    nameInput.value = "";
    idInput.value = "";
    alert(`「${name}」さんのIDは ${id} です。本人に伝えてください。`);
  };
}

// ---------- round ----------
const pickUnchecked = new Set();   // members unticked on the start screen
let pickMode = "通常モード";        // mode chosen on the start screen
function renderRound() {
  const el = document.getElementById("round");
  const note = document.getElementById("round-note");
  const activeIds = memberOrder.filter((id) => members[id]?.active);

  if (!session) {
    note.textContent = "";
    if (!myId) {
      el.innerHTML = '<div class="status-msg">対戦を始めるにはログインしてください。</div>';
      return;
    }
    const otokoPicked = pickMode === "男気モード";
    el.innerHTML = `
      <div class="participant-pick" id="pPick">
        ${activeIds.map((id) => `<label class="chk"><input type="checkbox" value="${id}" ${pickUnchecked.has(id) ? "" : "checked"}> ${esc(members[id].name)}</label>`).join("")}
      </div>
      <button class="btn ghost small" id="btnAddGuest" style="margin-bottom:14px">＋ ゲストを追加</button>
      <div class="mode-pick">
        <button class="btn ghost mode-normal ${otokoPicked ? "" : "on"}" data-mode="通常モード" id="modeA">通常モード</button>
        <button class="btn ghost mode-otoko ${otokoPicked ? "on" : ""}" data-mode="男気モード" id="modeB">男気モード</button>
      </div>
      <div class="sec-note" id="modeNote" style="margin-bottom:14px">${otokoPicked ? "通常と逆に、じゃんけんに勝った人が負けです" : "じゃんけんに負けた人が負けです"}</div>
      <button class="btn" id="btnStart" style="width:100%">対戦を始める</button>
      <div id="secretPreview"></div>`;
    let mode = pickMode;
    const modeNote = document.getElementById("modeNote");
    document.getElementById("btnAddGuest").onclick = async (e) => {
      e.target.disabled = true;
      try { await addGuest(); } catch (err) { alert("ゲストの追加に失敗しました"); e.target.disabled = false; }
    };
    // 裏機能: preview the advice for the round about to start (handy when playing in person
    // and entering hands afterwards); follows the checked participants and the chosen mode
    const updatePreview = () => {
      const box = document.getElementById("secretPreview");
      if (!box) return;
      const picked = [...document.querySelectorAll('#pPick input:checked')].map((i) => i.value);
      box.innerHTML = secretOn && picked.includes(myId) && picked.length >= 2
        ? renderSecretAdvice({ mode, pool: picked, pitches: [] }) : "";
    };
    document.querySelectorAll('#pPick input').forEach((i) => {
      i.onchange = () => {
        // remembered so that a redraw (someone joining, a guest being added) keeps the choice
        if (i.checked) pickUnchecked.delete(i.value); else pickUnchecked.add(i.value);
        updatePreview();
      };
    });
    updatePreview();
    document.getElementById("modeA").onclick = () => {
      mode = pickMode = "通常モード";
      document.getElementById("modeA").classList.add("on");
      document.getElementById("modeB").classList.remove("on");
      modeNote.textContent = "じゃんけんに負けた人が負けです";
      updatePreview();
    };
    document.getElementById("modeB").onclick = () => {
      mode = pickMode = "男気モード";
      document.getElementById("modeB").classList.add("on");
      document.getElementById("modeA").classList.remove("on");
      modeNote.textContent = "通常と逆に、じゃんけんに勝った人が負けです";
      updatePreview();
    };
    document.getElementById("btnStart").onclick = async () => {
      const picked = [...document.querySelectorAll('#pPick input:checked')].map((i) => i.value);
      if (picked.length < 2) { alert("2人以上選んでください"); return; }
      await setDoc(sessionRef, {
        status: "collecting", participantIds: picked, pool: picked, hands: {},
        pitchIndex: 0, pitches: [], withdrawn: [], mode, startedAt: serverTimestamp(),
      });
    };
    return;
  }

  // session in progress
  note.textContent = `${session.mode} ・ ${session.pitchIndex + 1}投目`;
  const inPool = myId && session.pool.includes(myId);
  const safe = myId && session.participantIds.includes(myId) && !session.pool.includes(myId);
  const hands = session.hands || {};

  const chips = session.pool.map((id) => {
    const done = hands[id];
    return `<span class="pool-chip ${done ? "done" : ""}"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id]?.name ?? id)}${done ? " ✓" : ""}</span>`;
  }).join("");

  // anyone can enter a hand for a member who hasn't submitted yet (no need to wait for
  // each person to log in on their own device); the member themselves can always still
  // change their own entry, which overwrites whatever was entered on their behalf
  const editableIds = session.pool.filter((id) => !hands[id] || id === myId);

  let actionHtml = "";
  if (editableIds.length) {
    actionHtml = editableIds.map((id) => {
      const mine = id === myId;
      return `<div class="hand-picker-row">
        <div class="hpr-name"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id]?.name ?? id)}${mine ? '<span class="tag">あなた</span>' : ""}</div>
        <div class="hand-picker">
          ${HAND_ORDER.map((h) => `<button class="btn ghost small ${hands[id] === h ? "on" : ""}" data-hand-for="${id}" data-hand="${h}" style="${hands[id] === h ? "background:var(--accent);color:var(--accent-ink);border-color:transparent;" : ""}">${h}</button>`).join("")}
          <button class="btn ghost small ${hands[id] === "不参加" ? "on" : ""}" data-hand-for="${id}" data-hand="不参加" style="${hands[id] === "不参加" ? "background:var(--muted);color:var(--surface);border-color:transparent;" : "color:var(--muted);"}">不参加</button>
        </div>
      </div>`;
    }).join("");
  } else if (safe) {
    actionHtml = '<div class="status-msg">勝ち抜けました！結果を待っています。</div>';
  } else if (inPool) {
    actionHtml = '<div class="status-msg">全員入力済みです。判定中…</div>';
  } else if (!myId) {
    actionHtml = '<div class="status-msg">対戦を見学中です。他の人の端末からも入力できます。</div>';
  } else {
    actionHtml = '<div class="status-msg">この対戦には参加していません。参加するには、下のボタンで一度中止してから新しく対戦を始めてください。</div>';
  }

  const cancelHtml = myId
    ? '<button class="btn ghost small" id="btnCancel" style="margin-top:12px">この対戦を中止する</button>' : "";

  const logHtml = session.pitches && session.pitches.length
    ? `<div class="pitch-log">${session.pitches.map((p) =>
        `<div>${Object.entries(p.hands).map(([id, h]) => `${(members[id]?.name ?? id)[0]}:${h}`).join(" ")} <span class="res">→ ${p.result}</span></div>`
      ).join("")}</div>` : "";

  const secretHtml = secretOn && inPool
    ? renderSecretAdvice({ mode: session.mode, pool: session.pool, pitches: session.pitches || [] }) : "";

  el.innerHTML = `<div class="pool-chips">${chips}</div>${actionHtml}${secretHtml}${logHtml}${cancelHtml}`;

  el.querySelectorAll("[data-hand-for]").forEach((b) => {
    b.onclick = async () => {
      await updateDoc(sessionRef, { [`hands.${b.dataset.handFor}`]: b.dataset.hand });
    };
  });
  const cancelBtn = document.getElementById("btnCancel");
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (confirm("この対戦を中止しますか？")) await deleteDoc(sessionRef);
  };
}

// ---------- secret advisor (裏機能) ----------
// Tap the page title 5 times in a row to toggle. Only the logged-in member sees it, only on
// their own device: before a round (if they are checked as a participant) and while they are
// still in the pool of the round in progress. It predicts each opponent's next hand from their
// past throws and suggests what the logged-in member should throw.
let secretOn = (() => { try { return localStorage.getItem("jankenSecret") === "1"; } catch (e) { return false; } })();
let secretTaps = 0, secretTapTimer = null;
document.querySelector("header.top h1.title").addEventListener("click", () => {
  secretTaps++;
  clearTimeout(secretTapTimer);
  secretTapTimer = setTimeout(() => { secretTaps = 0; }, 1500);
  if (secretTaps < 5) return;
  secretTaps = 0;
  if (!myId || !members[myId]) return;
  secretOn = !secretOn;
  try { localStorage.setItem("jankenSecret", secretOn ? "1" : "0"); } catch (e) {}
  showToast(secretOn ? "🔮 裏モード ON" : "裏モード OFF");
  renderRound();
  renderSecretStats();
});

function showToast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

function realHand(h) {
  // "(勝)" marks someone who had already advanced and wasn't actually throwing that pitch
  return HAND_ORDER.includes(h) ? h : null;
}

// Relative moves from a reference hand: keep it, switch to the hand that beats it ("up"),
// or switch to the hand it beats ("down"). Habits like "after losing, switch to whatever
// would have won" show up as a consistent relative move even when the absolute hands differ.
const SHIFTS = ["stay", "up", "down"];
const SHIFT_LABEL = { stay: "同じ手を続け", up: "前の手に勝つ手へ変え", down: "前の手に負ける手へ変え" };
const OUTCOME_LABEL = { draw: "あいこの", won: "勝った", lost: "負けた" };
function shiftOf(from, to) { return to === from ? "stay" : BEATS[to] === from ? "up" : "down"; }
function applyShift(from, s) { return s === "stay" ? from : s === "up" ? HAND_ORDER.find((h) => BEATS[h] === from) : BEATS[from]; }

function pitchThrowers(pitch) {
  return Object.entries(pitch?.hands || {}).filter(([, h]) => realHand(h));
}

function pitchOutcome(pitch, id) {
  // how the previous pitch went for this player: "draw" / "won" / "lost"
  const throwers = pitchThrowers(pitch);
  const mine = realHand(pitch?.hands?.[id]);
  if (!mine) return null;
  const types = new Set(throwers.map(([, h]) => h));
  if (types.size !== 2) return "draw";
  const other = [...types].find((h) => h !== mine);
  return BEATS[mine] === other ? "won" : "lost";
}

function othersMajority(pitch, id) {
  const c = {};
  pitchThrowers(pitch).forEach(([pid, h]) => { if (pid !== id) c[h] = (c[h] || 0) + 1; });
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
  return top.length && (top.length === 1 || top[0][1] > top[1][1]) ? top[0][0] : null;
}

function situation(id, mode, prior, poolSize, lastRound) {
  // everything known about one player right before they throw
  const i = prior.length;
  const prevPitch = i ? prior[i - 1] : null;
  const prev = prevPitch ? realHand(prevPitch.hands?.[id]) : null;
  let streak = 0;
  if (prev) {
    for (let j = i - 1; j >= 0 && realHand(prior[j].hands?.[id]) === prev; j--) streak++;
  }
  return {
    id, mode, i, prev, streak, poolSize,
    outcome: prev ? pitchOutcome(prevPitch, id) : null,
    othersPrev: prev ? othersMajority(prevPitch, id) : null,
    lastFirst: i === 0 && lastRound ? lastRound.first : null,
    lastLost: lastRound ? lastRound.lost : null,
  };
}

const POS_LABEL = ["1投目", "2投目", "3投目以降"];
// Each expert looks at one aspect of the situation. `key` returns null when the expert has
// nothing to say (e.g. no previous pitch yet); `anchor` makes it predict a relative move.
// "even" always says 1/3 each: when no habit really predicts better than a coin flip, the
// weight drifts to it and the percentages shown stay modest instead of overconfident.
const EXPERTS = [
  { name: "even", key: () => "*", say: () => "" },
  { name: "base", key: (s) => `${s.id}|${s.mode}`,
    say: (s, top) => `${s.mode === "男気モード" ? "男気" : "通常"}では${top}が多い` },
  { name: "trans", key: (s) => s.prev && `${s.id}|${s.mode}|${s.prev}`,
    say: (s, top) => `前が${s.prev}の次は${top}が多い` },
  { name: "react", key: (s) => s.outcome && `${s.id}|${s.mode}|${s.outcome}`, anchor: "prev",
    say: (s, top, sh) => `${OUTCOME_LABEL[s.outcome]}後は${SHIFT_LABEL[sh]}がち` },
  { name: "reactAny", key: (s) => s.outcome && `${s.id}|${s.outcome}|${s.prev === s.othersPrev ? "same" : "diff"}`, anchor: "prev",
    say: (s, top, sh) => `${OUTCOME_LABEL[s.outcome]}後は${SHIFT_LABEL[sh]}がち（両モード）` },
  { name: "streak", key: (s) => s.prev && `${s.id}|${Math.min(s.streak, 3)}`, anchor: "prev",
    say: (s, top, sh) => s.streak >= 2 ? `${s.prev}が${s.streak}連続の後は${SHIFT_LABEL[sh]}がち` : `1回出した手の次は${SHIFT_LABEL[sh]}がち` },
  { name: "oppPrev", key: (s) => s.othersPrev && `${s.id}|${s.othersPrev}`,
    say: (s, top) => `相手が${s.othersPrev}を出した次は${top}が多い` },
  { name: "opener", key: (s) => s.lastFirst && `${s.id}|${s.lastLost ? "L" : "W"}`, anchor: "lastFirst",
    say: (s, top, sh) => `前回${s.lastLost ? "負けた" : "負けなかった"}時の1投目(${s.lastFirst})から${SHIFT_LABEL[sh].replace("前の手", "前回の手")}がち` },
  { name: "group", key: (s) => s.outcome && `*|${s.mode}|${s.outcome}`, anchor: "prev",
    say: (s, top, sh) => `みんな${OUTCOME_LABEL[s.outcome]}後は${SHIFT_LABEL[sh]}がち` },
  { name: "groupOpen", key: (s) => !s.prev && `*|${s.mode}|open`,
    say: (s, top) => `みんな1投目は${top}が多い` },
];

function anchorOf(ex, s) { return ex.anchor === "prev" ? s.prev : ex.anchor === "lastFirst" ? s.lastFirst : null; }

function baseDist(tables, s) {
  // the player's overall habit in this mode, with the other mode counting half, smoothed
  // firmly toward even odds (backtests showed lighter smoothing overfits the small history)
  const m = tables.get(`base|${s.id}|${s.mode}`) || [0, 0, 0];
  const all = tables.get(`all|${s.id}`) || [0, 0, 0];
  const c = m.map((v, k) => v + 0.5 * (all[k] - v) + 6);
  const t = c[0] + c[1] + c[2];
  return { p: c.map((v) => v / t), n: m[0] + m[1] + m[2] };
}

function expertDist(tables, ex, s, base) {
  const key = ex.key(s);
  if (!key) return null;
  const anchor = anchorOf(ex, s);
  if (ex.anchor && !anchor) return null;
  const c = tables.get(`${ex.name}|${key}`) || [0, 0, 0];
  const n = c[0] + c[1] + c[2];
  // map relative-move counts onto absolute hands, then shrink toward the player's base habit
  // so a situation seen only a couple of times can't swing the prediction on its own
  const abs = [0, 0, 0];
  c.forEach((v, k) => { abs[HAND_ORDER.indexOf(ex.anchor ? applyShift(anchor, SHIFTS[k]) : HAND_ORDER[k])] += v; });
  const B = 6;
  return { p: abs.map((v, k) => (v + B * base.p[k]) / (n + B)), n, c };
}

function bump(tables, key, k) {
  const c = tables.get(key) || [0, 0, 0];
  c[k]++;
  tables.set(key, c);
}

function predictWith(model, s) {
  const base = baseDist(model.tables, s);
  const parts = [];
  EXPERTS.forEach((ex, e) => {
    const d = ex.name === "even" ? { p: [1 / 3, 1 / 3, 1 / 3], n: 0 }
      : ex.name === "base" ? { p: base.p, n: base.n } : expertDist(model.tables, ex, s, base);
    if (d) parts.push({ e, ex, d, w: Math.exp(model.eta * model.regret[e]) });
  });
  const wt = parts.reduce((a, x) => a + x.w, 0);
  const mix = [0, 0, 0];
  parts.forEach((x) => x.d.p.forEach((v, k) => { mix[k] += (x.w / wt) * v; }));
  // what is shown and acted on is pulled halfway back to even odds: in backtests the raw
  // blend scored worse than plain 1/3-each, and this brings it level
  const p = mix.map((v) => (v + 1 / 3) / 2);
  return { p, mix, parts, wt };
}

let secretModel = null, secretModelSrc = null;
function hitCredit(p, k) {
  // 1 when hand k was the top prediction (shared when several hands tie for the top)
  const mx = Math.max(...p);
  return p[k] === mx ? 1 / p.filter((v) => v === mx).length : 0;
}
function getSecretModel() {
  // Replays every recorded pitch in date order. Before learning from a pitch, every expert
  // predicts each thrower from what was known up to then; experts that would have predicted
  // better than the blend gain weight (sleeping-experts Hedge). Each of those "blind"
  // predictions is kept in `log`, which is what the review of the advisor is built from.
  if (secretModelSrc === records && secretModel) return secretModel;
  const model = { tables: new Map(), regret: EXPERTS.map(() => 0), eta: 0.5, lastRound: {}, acc: {}, log: [] };
  for (const r of records) {
    const ps = r.pitches || [];
    ps.forEach((pitch, i) => {
      const throwers = pitchThrowers(pitch);
      const prior = ps.slice(0, i);
      const made = throwers.map(([id]) => {
        const s = situation(id, r.mode, prior, throwers.length, model.lastRound[id]);
        return { s, pred: predictWith(model, s) };
      });
      const entry = { mode: r.mode, throwers, sits: {}, preds: {} };
      throwers.forEach(([id, hand], j) => {
        const { s, pred } = made[j];
        const k = HAND_ORDER.indexOf(hand);
        entry.sits[id] = s;
        entry.preds[id] = pred.p;
        const acc = (model.acc[`${id}|${r.mode}`] ||= { hit: 0, n: 0 });
        acc.n++;
        acc.hit += hitCredit(pred.p, k);
      });
      model.log.push(entry);
      // learn the pitch
      throwers.forEach(([id, hand], j) => {
        const { s, pred } = made[j];
        const k = HAND_ORDER.indexOf(hand);
        const lossMix = -Math.log(pred.mix[k]);
        pred.parts.forEach((x) => { model.regret[x.e] += lossMix + Math.log(x.d.p[k]); });
        bump(model.tables, `base|${id}|${r.mode}`, k);
        bump(model.tables, `all|${id}`, k);
        EXPERTS.forEach((ex) => {
          if (ex.name === "base" || ex.name === "even") return;
          const key = ex.key(s);
          if (!key) return;
          const anchor = anchorOf(ex, s);
          if (ex.anchor && !anchor) return;
          bump(model.tables, `${ex.name}|${key}`, ex.anchor ? SHIFTS.indexOf(shiftOf(anchor, hand)) : k);
        });
      });
    });
    for (const id of r.participantIds || []) {
      const first = realHand(ps[0]?.hands?.[id]);
      if (first) model.lastRound[id] = { first, lost: r.loserId === id };
    }
  }
  secretModel = model;
  secretModelSrc = records;
  return model;
}

function predictHand(id, ctx) {
  const model = getSecretModel();
  const s = situation(id, ctx.mode, ctx.pitches, ctx.pool.length, model.lastRound[id]);
  const pred = predictWith(model, s);
  const p = {};
  HAND_ORDER.forEach((h, k) => { p[h] = pred.p[k]; });
  // the reasons shown are the experts pulling hardest toward the hand predicted overall
  const topK = pred.p.indexOf(Math.max(...pred.p));
  const top = HAND_ORDER[topK];
  const reasons = pred.parts
    .filter((x) => x.d.n >= 2 && x.d.p.indexOf(Math.max(...x.d.p)) === topK)
    .map((x) => {
      const sh = x.ex.anchor ? shiftOf(anchorOf(x.ex, s), top) : null;
      const count = x.ex.anchor ? `${x.d.c[SHIFTS.indexOf(sh)]}/${x.d.n}回` : `${x.d.n}投`;
      return { score: (x.w / pred.wt) * (x.d.p[topK] - 1 / 3), text: `${x.ex.say(s, top, sh)}（${count}）` };
    })
    .filter((x) => x.score > 0.002)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.text);
  const acc = model.acc[`${id}|${ctx.mode}`];
  return { p, reasons, acc };
}

function adviseHands(opps, preds, mode) {
  // enumerate every combination of opponent hands and, for each of my 3 options, add up the
  // chance I get out safely on this pitch vs. the chance I end up the sole loser right now;
  // also remember the likeliest way the round carries on with me still in it
  const out = {};
  HAND_ORDER.forEach((mine) => { out[mine] = { safe: 0, lose: 0, next: null }; });
  const walk = (i, prob, hands) => {
    if (i === opps.length) {
      HAND_ORDER.forEach((mine) => {
        const all = [mine, ...hands];
        const types = new Set(all);
        let pool = null;
        if (types.size !== 2) {
          pool = [myId, ...opps];
        } else {
          const [t1, t2] = [...types];
          const winType = BEATS[t1] === t2 ? t1 : t2;
          const loseType = winType === t1 ? t2 : t1;
          const continueType = mode === "男気モード" ? winType : loseType;
          if (mine !== continueType) { out[mine].safe += prob; return; }
          const cont = all.filter((h) => h === continueType).length;
          if (cont === 1) { out[mine].lose += prob; return; }
          pool = [myId, ...opps.filter((id, j) => hands[j] === continueType)];
        }
        if (!out[mine].next || prob > out[mine].next.prob) {
          const pitchHands = { [myId]: mine };
          opps.forEach((id, j) => { pitchHands[id] = hands[j]; });
          out[mine].next = { prob, pool, hands: pitchHands, draw: types.size !== 2 };
        }
      });
      return;
    }
    HAND_ORDER.forEach((h) => walk(i + 1, prob * preds[opps[i]].p[h], [...hands, h]));
  };
  walk(0, 1, []);
  return out;
}

function isTossUp(odds) {
  // true when the three hands are within 3 points of each other: no real recommendation
  const score = HAND_ORDER.map((h) => odds[h].safe - odds[h].lose).sort((a, b) => b - a);
  return score[0] - score[2] < 0.03;
}

function bestOf(odds) {
  return HAND_ORDER.slice().sort((a, b) => (odds[b].safe - odds[b].lose) - (odds[a].safe - odds[a].lose))[0];
}

function renderSecretAdvice(ctx) {
  // ctx = {mode, pool, pitches}: the round in progress, or a preview of the round about to start
  const opps = ctx.pool.filter((id) => id !== myId);
  if (!opps.length || opps.length > 7) return "";
  const pct = (v) => `${Math.round(v * 100)}%`;
  const otoko = ctx.mode === "男気モード";
  const handColor = { "グー": "var(--hand-gu)", "チョキ": "var(--hand-choki)", "パー": "var(--hand-pa)" };
  const nameOf = (id) => esc(members[id]?.name ?? id);

  const preds = {};
  opps.forEach((id) => { preds[id] = predictHand(id, ctx); });
  const odds = adviseHands(opps, preds, ctx.mode);
  const best = bestOf(odds);
  const pitchNo = ctx.pitches.length + 1;
  const tossUp = isTossUp(odds);

  const options = HAND_ORDER.map((h) => `<div class="secret-opt ${h === best && !tossUp ? "best" : ""}">
      <b>${h}</b><span>抜け ${pct(odds[h].safe)}</span><span class="neg">負け確 ${pct(odds[h].lose)}</span>
    </div>`).join("");

  const oppRows = opps.map((id) => {
    const pr = preds[id];
    const top = HAND_ORDER.slice().sort((a, b) => pr.p[b] - pr.p[a])[0];
    const segs = HAND_ORDER.map((h) =>
      `<div class="habit-seg" style="width:${pr.p[h] * 100}%;background:${handColor[h]};color:#fff">${pr.p[h] >= 0.18 ? pct(pr.p[h]) : ""}</div>`
    ).join("");
    const acc = pr.acc && pr.acc.n >= 5 ? `的中 ${pct(pr.acc.hit / pr.acc.n)}／基準33%（${pr.acc.n}投）` : "データ少なめ";
    return `<div class="secret-opp">
      <div class="habit-row-top"><span class="name"><span class="dot" style="background:${colorVar(id)}"></span>${nameOf(id)}：${pr.p[top] >= 0.4 ? `${top}が濃厚` : pr.p[top] >= 0.36 ? `やや${top}寄り` : "ほぼ五分（読めず）"}</span>
      <span class="total">${acc}</span></div>
      <div class="habit-bar">${segs}</div>
      <div class="secret-why">${pr.p[top] >= 0.36 && pr.reasons.length ? pr.reasons.map((t) => `・${esc(t)}`).join("<br>") : "・この場面でははっきりした癖なし"}</div>
    </div>`;
  }).join("");

  // look ahead: assume the likeliest way the round continues with me still in it, and
  // advise the following pitches the same way
  const steps = [];
  let c = { mode: ctx.mode, pool: ctx.pool, pitches: ctx.pitches };
  let cur = { odds, best }, reach = 1;
  for (let n = 0; n < 2; n++) {
    const nx = cur.odds[cur.best].next;
    if (!nx) break;
    reach *= nx.prob;
    if (reach < 0.02) break;
    const scen = Object.entries(nx.hands).filter(([id]) => id !== myId).map(([id, h]) => `${nameOf(id)}${h}`).join("・");
    c = { mode: c.mode, pool: nx.pool, pitches: [...c.pitches, { hands: nx.hands }] };
    const o2 = c.pool.filter((id) => id !== myId);
    if (!o2.length) break;
    const pr2 = {};
    o2.forEach((id) => { pr2[id] = predictHand(id, c); });
    const od2 = adviseHands(o2, pr2, c.mode);
    const b2 = bestOf(od2);
    if (isTossUp(od2)) break;   // nothing worth saying about a pitch that is a toss-up too
    steps.push(`<div class="secret-step"><span class="sec-note">${nx.draw ? "あいこ" : "残り"}想定（${scen}）→</span> ${c.pitches.length + 1}投目は <b>${b2}</b> <span class="sec-note">抜け ${pct(od2[b2].safe)}</span></div>`);
    cur = { odds: od2, best: b2 };
  }

  return `<div class="secret">
    <div class="secret-head">🔮 ${esc(members[myId]?.name ?? "")}さんへの裏アドバイス<span>${otoko ? "男気モード：じゃんけんに負ける手を狙います" : "通常モード：場面ごとの癖から予測"}</span></div>
    <div class="secret-best">${tossUp ? `${pitchNo}投目は<b style="font-size:16px">どれを出してもほぼ同じ</b>です` : `${pitchNo}投目、あなたのおすすめは <b>${best}</b>`}</div>
    <div class="secret-opts">${options}</div>
    ${steps.length ? `<div class="secret-steps">${steps.join("")}</div>` : ""}
    ${oppRows}
  </div>`;
}

// ---------- secret advisor: review (裏分析の成績 / 自分の癖診断) ----------
// Shown only while 裏モード is on, on the logged-in member's own device. Everything is
// recomputed from the model's blind predictions (`log`), i.e. what the advisor would have
// said at the time with only the data it had then.
function pitchResultFor(mine, oppHands, mode) {
  // what one pitch does to me: "safe" (I'm out of it), "lose" (I'm the one left), "cont"
  const all = [mine, ...oppHands];
  const types = new Set(all);
  if (types.size !== 2) return "cont";
  const [t1, t2] = [...types];
  const winType = BEATS[t1] === t2 ? t1 : t2;
  const continueType = mode === "男気モード" ? winType : (winType === t1 ? t2 : t1);
  if (mine !== continueType) return "safe";
  return all.filter((h) => h === continueType).length === 1 ? "lose" : "cont";
}

function secretReview(model) {
  const tally = () => ({ n: 0, safe: 0, lose: 0 });
  const adv = { followed: tally(), other: tally(), best: tally(), random: tally(), mine: tally(), mineRandom: tally(), tossUps: 0 };
  const opp = {};      // id -> {n, hit, recent: [credit...]}
  const me = { n: 0, hit: 0 };
  const habits = {};   // key -> {text(top), c: [..], shift}
  const habit = (key, k, text) => { (habits[key] ||= { c: [0, 0, 0], text }).c[k]++; };
  for (const e of model.log) {
    for (const [id, hand] of e.throwers) {
      const credit = hitCredit(e.preds[id], HAND_ORDER.indexOf(hand));
      if (id === myId) { me.n++; me.hit += credit; continue; }
      const o = (opp[id] ||= { n: 0, hit: 0, recent: [] });
      o.n++; o.hit += credit; o.recent.push(credit);
    }
    const mine = e.throwers.find(([id]) => id === myId)?.[1];
    if (!mine) continue;
    // my own habits, as an opponent's advisor would see them
    const s = e.sits[myId];
    const k = HAND_ORDER.indexOf(mine);
    const modeShort = e.mode === "男気モード" ? "男気モード" : "通常モード";
    habit(`all|${e.mode}`, k, (top) => `${modeShort}では${top}が多い`);
    if (s.i === 0) habit(`open|${e.mode}`, k, (top) => `${modeShort}の1投目は${top}が多い`);
    if (s.prev) {
      const sh = SHIFTS.indexOf(shiftOf(s.prev, mine));
      habit(`prev|${s.prev}`, k, (top) => `${s.prev}を出した次は${top}が多い`);
      habit(`out|${s.outcome}`, sh, (top) => `${OUTCOME_LABEL[s.outcome]}後は${SHIFT_LABEL[top]}がち`);
      if (s.streak >= 2) habit("streak", sh, (top) => `同じ手が2回以上続いた後は${SHIFT_LABEL[top]}がち`);
    }
    const opps = e.throwers.map(([id]) => id).filter((id) => id !== myId);
    if (!opps.length || opps.length > 7) continue;
    const preds = {};
    opps.forEach((id) => { preds[id] = { p: Object.fromEntries(HAND_ORDER.map((h, j) => [h, e.preds[id][j]])) }; });
    const odds = adviseHands(opps, preds, e.mode);
    const best = bestOf(odds);
    const oppHands = e.throwers.filter(([id]) => id !== myId).map(([, h]) => h);
    const add = (t, res, w = 1) => { t.n += w; if (res === "safe") t.safe += w; if (res === "lose") t.lose += w; };
    HAND_ORDER.forEach((h) => add(adv.mineRandom, pitchResultFor(h, oppHands, e.mode), 1 / 3));
    add(adv.mine, pitchResultFor(mine, oppHands, e.mode));
    // a toss-up is shown as "any hand will do", so it doesn't count as a recommendation
    if (isTossUp(odds)) { adv.tossUps++; continue; }
    add(mine === best ? adv.followed : adv.other, pitchResultFor(mine, oppHands, e.mode));
    add(adv.best, pitchResultFor(best, oppHands, e.mode));
    HAND_ORDER.forEach((h) => add(adv.random, pitchResultFor(h, oppHands, e.mode), 1 / 3));
  }
  const patterns = Object.entries(habits).map(([key, h]) => {
    const n = h.c[0] + h.c[1] + h.c[2];
    const top = h.c.indexOf(Math.max(...h.c));
    const shift = key.startsWith("out|") || key === "streak";
    return { n, c: h.c[top], z: (h.c[top] - n / 3) / Math.sqrt(n * 2 / 9), text: h.text(shift ? SHIFTS[top] : HAND_ORDER[top]) };
  }).filter((x) => x.n >= 9 && x.z >= 1.6).sort((a, b) => b.z - a.z).slice(0, 4);
  return { adv, opp, me, patterns };
}

function renderSecretStats() {
  const sec = document.getElementById("sec-secret");
  if (!sec) return;
  const show = secretOn && myId && members[myId];
  sec.style.display = show ? "" : "none";
  if (!show) return;
  const el = document.getElementById("secretStats");
  const { adv, opp, me, patterns } = secretReview(getSecretModel());
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rate = (t, key) => (t.n ? pct(t[key] / t.n) : "–");
  const verdict = (hit, n) => {
    // how far the hit rate is from the 1/3 a blind guess gets, allowing for the sample size
    const z = (hit / n - 1 / 3) / Math.sqrt((2 / 9) / n);
    return n < 20 ? ["データ少なめ", ""] : z >= 1.6 ? ["読めている", "good"] : z <= -1.6 ? ["外れ気味", "bad"] : ["当て推量並み", ""];
  };

  const advRow = (label, t, ref) => `<tr class="${ref ? "ref" : ""}"><th>${label}</th><td>${Math.round(t.n)}</td><td>${rate(t, "safe")}</td><td>${rate(t, "lose")}</td></tr>`;
  const advHtml = !adv.mine.n ? '<div class="empty">あなたの投球データがまだありません</div>'
    : !adv.best.n ? `<div class="secret-why">これまでの${adv.tossUps}投はすべて「どれを出してもほぼ同じ」で、はっきりしたおすすめが出た場面はまだありません。</div>`
    : `<table class="mini">
      <thead><tr><th></th><th>回数</th><th>抜け</th><th>負け確</th></tr></thead>
      <tbody>
        ${advRow("おすすめと同じ手を出した時", adv.followed)}
        ${advRow("違う手を出した時", adv.other)}
        ${advRow("（参考）全部おすすめ通りなら", adv.best, true)}
        ${advRow("（参考）でたらめに出したら", adv.random, true)}
      </tbody></table>
      <div class="secret-why">おすすめは、その時点までのデータだけで出し直したものです。「抜け」はその1投で抜けられた割合、「負け確」はその1投で負けが決まった割合。参考の2行を比べて差が小さければ、おすすめはまだ効いていません。${adv.tossUps ? `「どれを出してもほぼ同じ」だった${adv.tossUps}投は数えていません。` : ""}</div>`;

  const oppIds = memberOrder.filter((id) => opp[id] && !isGuest(id));
  const oppHtml = oppIds.length ? oppIds.map((id) => {
    const o = opp[id];
    const [label, cls] = verdict(o.hit, o.n);
    const recent = o.recent.slice(-30);
    const recentRate = recent.reduce((a, b) => a + b, 0) / recent.length;
    const w = Math.min(100, (o.hit / o.n) * 100);
    return `<div class="secret-opp">
      <div class="habit-row-top"><span class="name"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id]?.name ?? id)}</span>
      <span class="total">${pct(o.hit / o.n)}（${o.n}投）・直近${recent.length}投 ${pct(recentRate)}</span></div>
      <div class="hitbar"><div class="fill ${cls}" style="width:${w}%"></div><div class="mark"></div></div>
      <div class="secret-why">${label}</div>
    </div>`;
  }).join("") + '<div class="secret-why">縦線が当て推量の33%です。線を大きく超えていなければ、その人の手は読めていません。</div>'
    : '<div class="empty">相手の投球データがまだありません</div>';

  let meHtml = '<div class="empty">あなたの投球データがまだありません</div>';
  if (me.n) {
    const [label, cls] = verdict(me.hit, me.n);
    const mine = adv.mine;
    meHtml = `<div class="secret-opp">
        <div class="habit-row-top"><span class="name">あなたの手が読まれた割合</span><span class="total">${pct(me.hit / me.n)}（${me.n}投）</span></div>
        <div class="hitbar"><div class="fill ${cls === "good" ? "bad" : cls === "bad" ? "good" : ""}" style="width:${Math.min(100, (me.hit / me.n) * 100)}%"></div><div class="mark"></div></div>
        <div class="secret-why">${label === "読めている" ? "読まれています。下の癖を意識して散らしましょう" : label === "外れ気味" ? "うまく裏をかけています" : label === "データ少なめ" ? label : "当て推量並み＝読まれていません"}</div>
      </div>
      ${mine.n ? `<div class="secret-why">あなたが実際に出した手：抜け ${rate(mine, "safe")}・負け確 ${rate(mine, "lose")}（でたらめに出した場合：抜け ${rate(adv.mineRandom, "safe")}・負け確 ${rate(adv.mineRandom, "lose")}）</div>` : ""}
      <div class="secret-why">${patterns.length
        ? "<b>読まれやすい癖</b><br>" + patterns.map((x) => `・${esc(x.text)}（${x.c}/${x.n}回・${pct(x.c / x.n)}）`).join("<br>")
        : "・はっきりした癖は見つかりません（読まれにくい出し方です）"}</div>`;
  }

  el.innerHTML = `<div class="secret" style="margin-top:0">
      <div class="secret-head">📊 おすすめの成績<span>${esc(members[myId].name)}さんの全対戦</span></div>${advHtml}
    </div>
    <div class="secret">
      <div class="secret-head">🎯 相手ごとの的中率<span>当て推量なら33%</span></div>${oppHtml}
    </div>
    <div class="secret">
      <div class="secret-head">🪞 あなたの癖診断<span>相手から見たあなた</span></div>${meHtml}
    </div>`;
}

let resolving = false, resolveTries = 0;
async function maybeResolve() {
  if (!session || session.status !== "collecting" || resolving) return;
  const gotAll = session.pool.every((id) => session.hands && session.hands[id]);
  if (!gotAll || session.pool.length === 0) return;
  resolving = true;
  let settled = true;
  try {
    // The transaction reads the server's copy, and the hand just tapped on this device may
    // not have arrived there yet. Without waiting, the server would look one hand short, the
    // round would not be judged, and nothing would prompt another try.
    await waitForPendingWrites(db);
    await runTransaction(db, async (tx) => {
      settled = true;
      const snap = await tx.get(sessionRef);
      if (!snap.exists()) return;
      const s = snap.data();
      if (s.status !== "collecting") return;
      if (!s.pool.every((id) => s.hands && s.hands[id])) { settled = false; return; }

      const newPitch = { hands: { ...s.hands }, result: "" };
      const withdrawnNow = s.pool.filter((id) => s.hands[id] === "不参加");
      const throwers = s.pool.filter((id) => s.hands[id] !== "不参加");
      const withdrawnAll = [...(s.withdrawn || []), ...withdrawnNow];

      const finalize = (loserId) => {
        const allPitches = [...(s.pitches || []), newPitch];
        const participantIds = s.participantIds.filter((id) => !withdrawnAll.includes(id));
        const finalHands = {};
        for (const id of s.participantIds) {
          for (let i = allPitches.length - 1; i >= 0; i--) {
            if (allPitches[i].hands[id]) { finalHands[id] = allPitches[i].hands[id]; break; }
          }
        }
        const n = participantIds.length;
        const streakText = computeStreakText(loserId);
        const newRecRef = doc(recordsCol);
        tx.set(newRecRef, {
          dateISO: new Date().toISOString().slice(0, 10),
          mode: s.mode, participantIds, hands: finalHands,
          loserId, streakText, pitches: allPitches, createdAt: serverTimestamp(),
          seasonId: currentSeason,
        });
        for (const id of participantIds) {
          tx.update(doc(membersCol, id), {
            games: increment(1),
            points: increment(id === loserId ? -(n - 1) : 1),
            losses: increment(id === loserId ? 1 : 0),
          });
        }
        for (const id of s.participantIds) {
          if (isGuest(id)) tx.update(doc(membersCol, id), { active: false });
        }
        tx.delete(sessionRef);
      };

      if (throwers.length === 0) {
        // everyone still in the pool dropped out on this pitch — nothing left to decide
        tx.delete(sessionRef);
        return;
      }
      if (throwers.length === 1) {
        // only one person left after withdrawals: they lose by default, same as
        // when a hand comparison narrows the pool down to a single person
        newPitch.result = "最終決着";
        finalize(throwers[0]);
        return;
      }

      const types = new Set(throwers.map((id) => s.hands[id]));
      if (types.size === 1 || types.size === 3) {
        newPitch.result = "あいこ";
        tx.update(sessionRef, {
          pool: throwers, hands: {}, pitchIndex: s.pitchIndex + 1,
          pitches: arrayUnion(newPitch), withdrawn: withdrawnAll,
        });
        return;
      }
      const [t1, t2] = [...types];
      const winType = BEATS[t1] === t2 ? t1 : t2;
      const loseType = winType === t1 ? t2 : t1;
      // 通常モード: the losing hand keeps playing (sudden death) until one remains.
      // 男気モード: reversed — the winning hand keeps playing, so a winner can end
      // up the final "loser" who takes the penalty.
      const continueType = s.mode === "男気モード" ? winType : loseType;
      const continuing = throwers.filter((id) => s.hands[id] === continueType);

      if (continuing.length > 1) {
        newPitch.result = "勝ち抜け発生";
        tx.update(sessionRef, {
          pool: continuing, hands: {}, pitchIndex: s.pitchIndex + 1,
          pitches: arrayUnion(newPitch), withdrawn: withdrawnAll,
        });
        return;
      }

      newPitch.result = "最終決着";
      finalize(continuing[0]);
    });
  } catch (e) {
    settled = false;
    console.error(e);
  } finally {
    resolving = false;
  }
  if (settled) { resolveTries = 0; return; }
  // not judged (server still a hand short, or the attempt failed): try again shortly, as long
  // as this device still sees every hand in
  if (resolveTries < 6) setTimeout(maybeResolve, Math.min(4000, 400 * 2 ** resolveTries++));
}

function computeStreakText(loserId) {
  const seasonRecords = records.filter((r) => (r.seasonId || 1) === currentSeason);
  let streak = 1;
  for (let i = seasonRecords.length - 1; i >= 0; i--) {
    if (seasonRecords[i].loserId === loserId) streak++;
    else break;
  }
  if (streak < 2) return null;
  return `${members[loserId]?.name ?? loserId}${streak}連敗`;
}

function visibleRecords() {
  return records.filter((r) => (r.seasonId || 1) === selectedSeason && (selectedMode === "all" || r.mode === selectedMode));
}

function computeSeasonStats(recs) {
  const stats = {};
  for (const r of recs) {
    if (!r.loserId) continue;
    const n = r.participantIds.length;
    for (const id of r.participantIds) {
      stats[id] = stats[id] || { points: 0, games: 0, losses: 0 };
      stats[id].games++;
      if (id === r.loserId) { stats[id].points -= (n - 1); stats[id].losses++; }
      else stats[id].points += 1;
    }
  }
  return stats;
}

// ---------- stats rendering (standings / habits / heatmap / monthly / records) ----------
// Guests are kept out of every table and chart below: their results live only on the records
// of the rounds they played in. A round with a guest still counts for the named members in it.
function renderAll() {
  renderMembers();
  renderRound();
  renderSecretStats();
  renderStandings();
  renderTrend();
  renderPayments();
  renderTreats();
  renderHabits();
  renderLoseHabits();
  renderHeatmap();
  renderMonthly();
  renderMatchups();
  renderTitles();
  renderRecords();
}

function renderStandings() {
  const el = document.getElementById("standings");
  const recs = visibleRecords();
  const stats = computeSeasonStats(recs);
  const players = memberOrder.filter((id) => !isGuest(id) && members[id] && stats[id]);
  if (!players.length) { el.innerHTML = `<div class="empty">${esc(seasonLabel(selectedSeason))}の対戦記録がありません</div>`; return; }
  // 順位表に載るのは参加数の中央値の6割（小数点以下切り捨て）以上に参加した人のみ
  // 中央値は2倍した整数で扱い、割り算の誤差を避ける
  const sortedGames = players.map((id) => stats[id].games).sort((a, b) => a - b);
  const mid = sortedGames.length >> 1;
  const median2 = sortedGames.length % 2 ? sortedGames[mid] * 2 : sortedGames[mid - 1] + sortedGames[mid];
  const minGames = Math.floor(median2 * 3 / 10);
  const qualifies = (id) => stats[id].games >= minGames;
  const ids = players.filter(qualifies);
  const others = players.filter((id) => !qualifies(id));
  const note = others.length
    ? `<div class="stand-note">規定参加数${minGames}（参加数の中央値の6割）未満のため対象外：${others.map((id) => `${esc(members[id].name)}（${stats[id].games}）`).join("、")}</div>`
    : "";
  // 貯金が同じなら敗率が低い方を上位に（割り算の誤差を避けるため交差乗算で比較）
  const cmp = (a, b) => (stats[b].points - stats[a].points)
    || (stats[a].losses * stats[b].games - stats[b].losses * stats[a].games);
  const ranked = ids.slice().sort(cmp);
  let lastRank = 0;
  el.innerHTML = ranked.map((id, i) => {
    const m = members[id];
    const s = stats[id];
    if (i === 0 || cmp(ranked[i - 1], id) !== 0) lastRank = i + 1;
    const good = s.points >= 0;
    const rate = s.games ? ((s.losses / s.games) * 100).toFixed(1) : "0.0";
    return `<div class="card stand-card">
      <div class="rank">${lastRank}位</div>
      <div>
        <div class="stand-name-row"><span class="dot" style="background:${colorVar(id)}"></span><span class="stand-name">${esc(m.name)}</span></div>
        <div class="stand-meta">参加 ${s.games}・負け ${s.losses}・<span class="stand-rate">敗率 ${rate}%</span></div>
      </div>
      <div class="stand-points">
        <div class="pts-val" style="color:${good ? "var(--good)" : "var(--bad)"}">${s.points > 0 ? "+" : ""}${s.points}<span style="font-size:12px;font-weight:500;">pt</span></div>
        <div class="pill ${good ? "good" : "bad"}">${good ? "貯金" : "借金"}</div>
      </div>
    </div>`;
  }).join("") + note;
}

function recordAmounts(r) {
  // {memberId: signedAmount} for one record — each winner gets their own amount,
  // and the loser pays the winners' total. Records with no winner amounts keep the
  // loser's own entry (or the old single `amount` field from before per-player amounts).
  const out = {};
  let winnersTotal = 0;
  for (const [id, v] of Object.entries(r.amounts || {})) {
    const n = Number(v) || 0;
    if (n && id !== r.loserId) { out[id] = n; winnersTotal += n; }
  }
  const loserPays = winnersTotal || legacyLoserAmount(r);
  if (loserPays && r.loserId) out[r.loserId] = -loserPays;
  return out;
}

function legacyLoserAmount(r) {
  return Number((r.amounts || {})[r.loserId]) || (!r.amounts && Number(r.amount)) || 0;
}

function renderPayments() {
  const el = document.getElementById("payments");
  const totals = {};
  for (const r of visibleRecords()) {
    for (const [id, v] of Object.entries(recordAmounts(r))) {
      totals[id] = (totals[id] || 0) + v;
    }
  }
  const ids = memberOrder.filter((id) => !isGuest(id) && members[id] && totals[id]);
  if (!ids.length) { el.innerHTML = '<div class="empty">金額の記録がまだありません（対戦記録の編集から入力できます）</div>'; return; }
  const ranked = ids.slice().sort((a, b) => totals[b] - totals[a]);
  el.innerHTML = ranked.map((id) => {
    const v = totals[id];
    const good = v >= 0;
    return `<div class="card stand-card">
      <div class="rank">💰</div>
      <div><div class="stand-name-row"><span class="dot" style="background:${colorVar(id)}"></span><span class="stand-name">${esc(members[id].name)}</span></div></div>
      <div class="stand-points"><div class="pts-val" style="color:${good ? "var(--good)" : "var(--bad)"}">${v > 0 ? "+" : ""}${v.toLocaleString()}<span style="font-size:12px;font-weight:500;">円</span></div></div>
    </div>`;
  }).join("");
}

function allThrows(recs) {
  // {memberId: {グー,チョキ,パー}} across every pitch of every record
  const out = {};
  for (const r of recs) {
    for (const p of r.pitches || []) {
      for (const [id, h] of Object.entries(p.hands || {})) {
        const clean = (h || "").replace("(勝)", "");
        if (!HAND_ORDER.includes(clean)) continue;
        out[id] = out[id] || { "グー": 0, "チョキ": 0, "パー": 0 };
        out[id][clean]++;
      }
    }
  }
  return out;
}

function loseThrows(recs) {
  // {memberId: {グー,チョキ,パー}} — only the hand each person showed in the round they lost
  const out = {};
  for (const r of recs) {
    if (!r.loserId) continue;
    const h = (r.hands[r.loserId] || "").replace("(勝)", "");
    if (!HAND_ORDER.includes(h)) continue;
    out[r.loserId] = out[r.loserId] || { "グー": 0, "チョキ": 0, "パー": 0 };
    out[r.loserId][h]++;
  }
  return out;
}

function renderHandBars(containerId, throwsMap, emptyMsg, totalSuffix) {
  const el = document.getElementById(containerId);
  const ids = memberOrder.filter((id) => !isGuest(id) && members[id] && throwsMap[id]);
  if (!ids.length) { el.innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
  const handColor = { "グー": "var(--hand-gu)", "チョキ": "var(--hand-choki)", "パー": "var(--hand-pa)" };
  let html = `<div class="habit-legend">
    <span><i style="background:${handColor["グー"]}"></i>グー</span>
    <span><i style="background:${handColor["チョキ"]}"></i>チョキ</span>
    <span><i style="background:${handColor["パー"]}"></i>パー</span>
  </div>`;
  ids.forEach((id) => {
    const h = throwsMap[id];
    const total = h["グー"] + h["チョキ"] + h["パー"];
    const segs = HAND_ORDER.map((k) => {
      const pct = (h[k] / total) * 100;
      return `<div class="habit-seg" style="width:${pct}%;background:${handColor[k]};color:#fff">${pct >= 12 ? h[k] : ""}</div>`;
    }).join("");
    html += `<div class="habit-row">
      <div class="habit-row-top"><span class="name"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id].name)}</span><span class="total">計 ${total}${totalSuffix}</span></div>
      <div class="habit-bar">${segs}</div>
    </div>`;
  });
  el.innerHTML = html;
}

function renderHabits() {
  renderHandBars("habits", allThrows(visibleRecords()), "まだ投球データがありません", "回");
}

function renderLoseHabits() {
  renderHandBars("losehabits", loseThrows(visibleRecords()), "まだ負けた記録がありません", "敗");
}

function renderHeatmap() {
  const el = document.getElementById("heat");
  const days = ["月", "火", "水", "木", "金", "土", "日"];
  const counts = {};
  for (const r of visibleRecords()) {
    if (!r.loserId) continue;
    const wd = days[new Date(r.dateISO + "T00:00:00").getDay() === 0 ? 6 : new Date(r.dateISO + "T00:00:00").getDay() - 1];
    counts[r.loserId] = counts[r.loserId] || {};
    counts[r.loserId][wd] = (counts[r.loserId][wd] || 0) + 1;
  }
  const ids = memberOrder.filter((id) => !isGuest(id) && members[id] && counts[id]);
  if (!ids.length) { el.innerHTML = '<tbody><tr><td class="empty">データなし</td></tr></tbody>'; return; }
  let max = 0;
  ids.forEach((id) => days.forEach((d) => { max = Math.max(max, counts[id][d] || 0); }));
  const thead = `<thead><tr><th class="rowhead"></th>${days.map((d) => `<th>${d}</th>`).join("")}</tr></thead>`;
  const tbody = "<tbody>" + ids.map((id) => {
    const cells = days.map((d) => {
      const v = counts[id][d] || 0;
      const a = v === 0 ? 0 : 0.16 + (v / max) * 0.62;
      const style = v === 0 ? "" : `background:rgba(194,59,52,${a});color:var(--ink)`;
      return `<td class="cell ${v === 0 ? "zero" : ""}" style="${style}">${v === 0 ? "–" : v}</td>`;
    }).join("");
    return `<tr><th class="rowhead"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id].name)}</th>${cells}</tr>`;
  }).join("") + "</tbody>";
  el.innerHTML = thead + tbody;
}

function renderMonthly() {
  const el = document.getElementById("monthly");
  const byMonth = {};
  for (const r of visibleRecords()) {
    if (!r.loserId) continue;
    const key = r.dateISO.slice(0, 7);
    byMonth[key] = byMonth[key] || {};
    byMonth[key][r.loserId] = (byMonth[key][r.loserId] || 0) + 1;
  }
  const months = Object.keys(byMonth).sort();
  const ids = memberOrder.filter((id) => members[id] && !isGuest(id));
  if (!months.length || !ids.length) { el.innerHTML = '<div class="empty">データなし</div>'; return; }
  const legend = `<div class="trend-legend">${ids.map((id) => `<span><i style="background:${colorVar(id)}"></i>${esc(members[id].name)}</span>`).join("")}</div>`;
  let max = 1;
  months.forEach((mo) => ids.forEach((id) => { max = Math.max(max, byMonth[mo][id] || 0); }));
  const groups = months.map((mo) => {
    const bars = ids.map((id) => {
      const v = byMonth[mo][id] || 0;
      const h = Math.max(3, (v / max) * 100);
      return `<div class="trend-bar" style="height:${h}%;background:${colorVar(id)}">${v > 0 ? `<span class="v">${v}</span>` : ""}</div>`;
    }).join("");
    return `<div class="trend-group"><div class="trend-bars">${bars}</div><div class="trend-label">${mo.slice(5)}月</div></div>`;
  }).join("");
  el.innerHTML = legend + `<div class="trend-groups">${groups}</div>`;
}

// ---------- 貯金の推移 ----------
let trendUnit = (() => { try { return localStorage.getItem("jankenTrendUnit"); } catch (e) { return null; } })() || "day";
const TREND_UNITS = [["day", "日別", "日"], ["week", "週別", "週"], ["month", "月別", "か月"]];
function trendBucket(iso) {
  // which day / week (starting Monday) / month a round belongs to, and how to label it
  const md = (dt) => `${dt.getMonth() + 1}/${dt.getDate()}`;
  const dt = new Date(iso + "T00:00:00");
  if (trendUnit === "month") return { key: iso.slice(0, 7), label: `${dt.getMonth() + 1}月` };
  if (trendUnit === "week") {
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return { key: `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`, label: `${md(dt)}週` };
  }
  return { key: iso, label: md(dt) };
}

// The lines are drawn in from the left once per page load, the first time the chart is
// actually on screen (it usually starts below the fold), and again whenever a period is picked.
const TREND_ANIM_MS = 1800;
let trendPlayed = false, trendAnimUntil = 0;
function trendOnScreen() {
  // measured at the moment it matters: while the page is still filling in, the sections
  // above the chart grow and push it out of view
  const r = document.getElementById("trend").getBoundingClientRect();
  return r.width > 0 && r.top < window.innerHeight - 110 && r.top > -150;
}
if ("IntersectionObserver" in window) {
  new IntersectionObserver(() => {
    if (!trendPlayed && trendOnScreen()) renderTrend();
  }, { threshold: [0.2, 0.5, 0.8] }).observe(document.getElementById("trend"));
}

function renderTrend(animate) {
  const el = document.getElementById("trend");
  if (animate !== true && Date.now() < trendAnimUntil) {
    // data arrived while the lines are still being drawn: redraw once they have finished
    clearTimeout(renderTrend.later);
    renderTrend.later = setTimeout(() => renderTrend(), trendAnimUntil - Date.now() + 20);
    return;
  }
  const recs = visibleRecords().filter((r) => r.loserId);
  const ids = memberOrder.filter((id) => members[id] && !isGuest(id) && recs.some((r) => r.participantIds.includes(id)));
  if (recs.length < 2 || !ids.length) { el.innerHTML = '<div class="empty">対戦が2回以上になるとグラフが出ます</div>'; return; }
  // running points after each round; a member's line stays flat while they sit a round out
  const perRound = {};
  ids.forEach((id) => { perRound[id] = [0]; });
  recs.forEach((r) => {
    const n = r.participantIds.length;
    ids.forEach((id) => {
      const prev = perRound[id][perRound[id].length - 1];
      perRound[id].push(!r.participantIds.includes(id) ? prev : id === r.loserId ? prev - (n - 1) : prev + 1);
    });
  });
  // one point per day / week / month: the standing at the end of that period
  const buckets = [];
  recs.forEach((r, i) => {
    const b = trendBucket(r.dateISO);
    if (buckets.length && buckets[buckets.length - 1].key === b.key) buckets[buckets.length - 1].end = i + 1;
    else buckets.push({ ...b, end: i + 1 });
  });
  const N = buckets.length;
  const series = {};
  ids.forEach((id) => { series[id] = [0, ...buckets.map((b) => perRound[id][b.end])]; });
  const all = ids.flatMap((id) => series[id]);
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const W = 600, H = 240, L = 34, R = 62, T = 12, B = 24;
  const x = (i) => L + (i / N) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const fmt = (v) => (v > 0 ? "+" : "") + v;
  // name labels at the right end, pushed apart so they don't overlap
  const labels = ids.map((id) => ({ id, y: y(series[id][N]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
  const over = labels.length ? labels[labels.length - 1].y - (H - B) : 0;
  if (over > 0) labels.forEach((l) => { l.y -= over; });
  const ticks = [...new Set([lo, 0, hi])];
  // period labels along the bottom: all of them when few, otherwise about six evenly spread
  const step = Math.ceil(N / 6);
  const marks = buckets.map((b, i) => ({ i: i + 1, label: b.label })).filter((m) => (N - m.i) % step === 0);
  const unit = TREND_UNITS.find((u) => u[0] === trendUnit);
  // after picking a period the lines are drawn in from the left (skipped for reduced motion)
  if (!trendPlayed && trendOnScreen()) animate = true;
  const grow = animate === true && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const chips = TREND_UNITS.map(([val, label]) => `<button class="btn ghost small ${val === trendUnit ? "on" : ""}" data-trend-unit="${val}">${label}</button>`).join("");
  el.innerHTML = `<div class="trend-head"><div class="trend-units">${chips}</div><span class="sec-note">${N}${unit[2]}分・${recs.length}戦</span></div>
  <svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="貯金・借金の推移（${unit[1]}）">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "zero" : "grid"}"/>
      <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${fmt(v)}</text>`).join("")}
    ${marks.map((m) => `<text x="${x(m.i)}" y="${H - 6}" text-anchor="${m.i === N ? "end" : "middle"}" class="tick">${m.label}</text>`).join("")}
    <defs><clipPath id="trendClip"><rect x="0" y="0" width="${grow ? L : W}" height="${H}">${grow
      ? `<animate attributeName="width" from="${L}" to="${W - R + 6}" dur="1.3s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.3 0 0.2 1"/>` : ""}</rect></clipPath></defs>
    <g clip-path="url(#trendClip)">
    ${ids.map((id) => `<polyline fill="none" style="stroke:${colorVar(id)}" class="line" points="${series[id].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>
      ${N <= 31 ? series[id].slice(1, -1).map((v, i) => `<circle cx="${x(i + 1).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" style="fill:${colorVar(id)}"/>`).join("") : ""}
      <circle cx="${x(N)}" cy="${y(series[id][N])}" r="3.5" style="fill:${colorVar(id)}"/>`).join("")}
    </g>
    ${labels.map((l) => `<text x="${W - R + 8}" y="${l.y + 4}" class="name ${grow ? "late" : ""}">${esc(members[l.id].name)} ${fmt(series[l.id][N])}</text>`).join("")}
  </svg>`;
  if (grow) { trendPlayed = true; trendAnimUntil = Date.now() + TREND_ANIM_MS; }
  el.querySelectorAll("[data-trend-unit]").forEach((b) => {
    b.onclick = () => {
      trendUnit = b.dataset.trendUnit;
      try { localStorage.setItem("jankenTrendUnit", trendUnit); } catch (e) {}
      renderTrend(true);
    };
  });
}

// ---------- おごりの内訳 ----------
function renderTreats() {
  // who has paid whom: each winner's amount in a round is money the loser spent on them
  const el = document.getElementById("treats");
  const paid = {};   // loserId -> winnerId -> {amt, n}
  let skipped = 0;
  for (const r of visibleRecords()) {
    if (!r.loserId) continue;
    const amts = recordAmounts(r);
    const winners = Object.entries(amts).filter(([id, v]) => id !== r.loserId && v > 0);
    if (!winners.length) { if (amts[r.loserId]) skipped++; continue; }
    for (const [id, v] of winners) {
      const c = ((paid[r.loserId] ||= {})[id] ||= { amt: 0, n: 0 });
      c.amt += v; c.n++;
    }
  }
  const involved = new Set();
  Object.entries(paid).forEach(([a, row]) => { involved.add(a); Object.keys(row).forEach((b) => involved.add(b)); });
  const ids = memberOrder.filter((id) => !isGuest(id) && members[id] && involved.has(id));
  if (!ids.length) { el.innerHTML = ""; return; }
  const max = Math.max(...ids.flatMap((a) => ids.map((b) => paid[a]?.[b]?.amt || 0)));
  const sum = (cells) => cells.reduce((t, c) => t + (c?.amt || 0), 0);
  const yen = (v) => (v ? v.toLocaleString() : "–");
  const head = `<thead><tr><th class="rowhead"></th>${ids.map((id) => `<th>${esc(members[id].name)}</th>`).join("")}<th>計</th></tr></thead>`;
  const body = ids.map((a) => `<tr><th class="rowhead"><span class="dot" style="background:${colorVar(a)}"></span>${esc(members[a].name)}</th>${ids.map((b) => {
    if (a === b) return '<td class="cell zero">＼</td>';
    const c = paid[a]?.[b];
    if (!c) return '<td class="cell zero">–</td>';
    return `<td class="cell" style="background:rgba(194,59,52,${(0.1 + (c.amt / max) * 0.6).toFixed(2)});color:var(--ink)">${yen(c.amt)}<span class="times">${c.n}回</span></td>`;
  }).join("")}<td class="cell total">${yen(sum(ids.map((b) => paid[a]?.[b])))}</td></tr>`).join("");
  const foot = `<tr class="foot"><th class="rowhead">計</th>${ids.map((b) => `<td class="cell total">${yen(sum(ids.map((a) => paid[a]?.[b])))}</td>`).join("")}<td></td></tr>`;
  el.innerHTML = `<div class="card heat-card">
    <div class="match-cap"><b>おごりの内訳</b>（左の人が、上の人におごった金額と回数・円）</div>
    <table class="heat treats">${head}<tbody>${body}${foot}</tbody></table>
    <div class="match-cap" style="padding-top:8px;padding-bottom:0">右端の「計」はおごった合計、下の「計」はおごってもらった合計です${skipped ? `。相手ごとの金額が入っていない記録（${skipped}件）は含みません` : ""}</div>
  </div>`;
}

// ---------- 相性表 ----------
let matchupFocus = null;   // whose match-ups are being shown
function renderMatchups() {
  const el = document.getElementById("matchups");
  const recs = visibleRecords().filter((r) => r.loserId);
  const ids = memberOrder.filter((id) => members[id] && !isGuest(id) && recs.some((r) => r.participantIds.includes(id)));
  if (ids.length < 2) { el.innerHTML = '<div class="empty">データなし</div>'; return; }
  const cell = () => ({ games: 0, lost: 0, win: 0, lose: 0, tie: 0 });
  const m = {};
  ids.forEach((a) => { m[a] = {}; ids.forEach((b) => { m[a][b] = cell(); }); });
  for (const r of recs) {
    for (const a of r.participantIds) for (const b of r.participantIds) {
      if (a === b || !m[a]?.[b]) continue;
      m[a][b].games++;
      if (r.loserId === a) m[a][b].lost++;
    }
    for (const p of r.pitches || []) {
      const th = pitchThrowers(p);
      for (const [a, ha] of th) for (const [b, hb] of th) {
        if (a === b || !m[a]?.[b]) continue;
        if (ha === hb) m[a][b].tie++; else if (BEATS[ha] === hb) m[a][b].win++; else m[a][b].lose++;
      }
    }
  }
  // one person at a time: pick who to look at, then one block per opponent
  const me = ids.includes(matchupFocus) ? matchupFocus : ids.includes(myId) ? myId : ids[0];
  const nm = (id) => esc(members[id].name);
  const chips = ids.map((id) => `<button class="btn ghost small ${id === me ? "on" : ""}" data-matchup="${id}">${nm(id)}</button>`).join("");
  const bar = (left, mid, right, leftColor, rightColor) => {
    const total = left + mid + right || 1;
    const seg = (v, bg, ink) => (v ? `<div class="habit-seg" style="width:${(v / total) * 100}%;background:${bg};color:${ink}">${v}</div>` : "");
    return `<div class="habit-bar">${seg(left, leftColor, "#fff")}${seg(mid, "var(--surface-2)", "var(--muted)")}${seg(right, rightColor, "#fff")}</div>`;
  };
  const blocks = ids.filter((id) => id !== me).map((op) => {
    const c = m[me][op], o = m[op][me];
    if (!c.games) return "";
    const others = c.games - c.lost - o.lost;
    // decided by the hands the two threw against each other (wins vs. losses, draws aside)
    const verdict = c.win === c.lose ? "五分" : c.win > c.lose ? `${nm(me)}さんが有利` : `${nm(op)}さんが有利`;
    return `<div class="matchup">
      <div class="habit-row-top"><span class="name"><span class="dot" style="background:${colorVar(op)}"></span>${nm(op)}さんと一緒の対戦 ${c.games}回</span><span class="total">${verdict}</span></div>
      <div class="matchup-label">どちらが負けたか</div>
      ${bar(c.lost, others, o.lost, colorVar(me), colorVar(op))}
      <div class="matchup-legend"><span>${nm(me)}の負け ${c.lost}</span>${others ? `<span>ほかの人の負け ${others}</span>` : ""}<span>${nm(op)}の負け ${o.lost}</span></div>
      <div class="matchup-label">2人の手を比べると（全投球）</div>
      ${bar(c.win, c.tie, c.lose, colorVar(me), colorVar(op))}
      <div class="matchup-legend"><span>${nm(me)}の勝ち ${c.win}</span><span>あいこ ${c.tie}</span><span>${nm(op)}の勝ち ${c.lose}</span></div>
    </div>`;
  }).join("");
  el.innerHTML = `<div class="sec-note" style="white-space:normal;margin-bottom:8px">見たい人を選ぶと、その人と相手1人ずつの成績が出ます</div>
    <div class="matchup-chips">${chips}</div>
    ${blocks || '<div class="empty">一緒に対戦した記録がありません</div>'}`;
  el.querySelectorAll("[data-matchup]").forEach((b) => {
    b.onclick = () => { matchupFocus = b.dataset.matchup; renderMatchups(); };
  });
}

// ---------- 記録・称号 ----------
function renderTitles() {
  const el = document.getElementById("titles");
  const recs = visibleRecords().filter((r) => r.loserId);
  if (!recs.length) { el.innerHTML = '<div class="empty">データなし</div>'; return; }
  const name = (id) => esc(members[id]?.name ?? id);
  const day = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  // keep every holder of the best value, so ties share the title
  const best = () => ({ v: 0, who: [] });
  const offer = (b, v, who) => { if (v > b.v) { b.v = v; b.who = [who]; } else if (v === b.v && v > 0 && !b.who.includes(who)) b.who.push(who); };

  const loseStreak = best(), safeStreak = best(), dayLosses = best(), oneShot = best();
  const longest = best(), draws = best(), priciest = best();
  let run = 0, runId = null;
  const safeRun = {}, perDay = {}, oneShots = {};
  for (const r of recs) {
    run = r.loserId === runId ? run + 1 : 1;
    runId = r.loserId;
    const named = !isGuest(r.loserId);   // guests hold no personal titles
    if (named) offer(loseStreak, run, name(r.loserId));
    for (const id of r.participantIds) {
      safeRun[id] = id === r.loserId ? 0 : (safeRun[id] || 0) + 1;
      if (!isGuest(id)) offer(safeStreak, safeRun[id], name(id));
    }
    const k = `${r.dateISO}|${r.loserId}`;
    perDay[k] = (perDay[k] || 0) + 1;
    if (named) offer(dayLosses, perDay[k], `${name(r.loserId)}（${day(r.dateISO)}）`);
    const ps = (r.pitches || []).filter((p) => pitchThrowers(p).length >= 2);
    if (ps.length === 1) {
      oneShots[r.loserId] = (oneShots[r.loserId] || 0) + 1;
      if (named) offer(oneShot, oneShots[r.loserId], name(r.loserId));
    }
    const label = `${day(r.dateISO)}（負け：${esc(recName(r, r.loserId))}）`;
    offer(longest, ps.length, label);
    offer(draws, ps.filter((p) => new Set(pitchThrowers(p).map(([, h]) => h)).size !== 2).length, label);
    if (named) offer(priciest, -(recordAmounts(r)[r.loserId] || 0), `${name(r.loserId)}（${day(r.dateISO)}）`);
  }
  const rows = [
    ["🔥", "最長連敗", loseStreak, "連敗", 2],
    ["🛡️", "最長連続負けなし", safeStreak, "戦", 2],
    ["⚡", "一発負け最多", oneShot, "回", 1],
    ["😱", "1日の最多負け", dayLosses, "敗", 2],
    ["🥊", "最長の対戦", longest, "投", 2],
    ["🤝", "最多あいこ", draws, "回", 1],
    ["💸", "最高額の負け", priciest, "円", 1],
  ].filter(([, , b, , min]) => b.v >= min);
  if (!rows.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
  el.innerHTML = rows.map(([icon, title, b, unit]) => `<div class="title-row">
      <span class="icon">${icon}</span>
      <div class="body"><div class="t">${title}</div><div class="who">${b.who.slice(0, 3).join("、")}${b.who.length > 3 ? ` ほか${b.who.length - 3}` : ""}</div></div>
      <span class="val">${b.v.toLocaleString()}<span class="unit">${unit}</span></span>
    </div>`).join("");
}

function renderRecords() {
  const recs = visibleRecords();
  document.getElementById("rec-count").textContent = recs.length ? `全${recs.length}戦` : "";
  const el = document.getElementById("records");
  if (!recs.length) { el.innerHTML = `<div class="empty">${esc(seasonLabel(selectedSeason))}の対戦記録がまだありません。</div>`; return; }
  const weekdayJ = ["日", "月", "火", "水", "木", "金", "土"];
  el.innerHTML = recs.slice().reverse().map((r) => {
    const d = new Date(r.dateISO + "T00:00:00");
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const wd = weekdayJ[d.getDay()];
    const amts = recordAmounts(r);
    const hands = r.participantIds.map((id) => {
      const isLose = id === r.loserId;
      const h = (r.hands[id] || "").replace("(勝)", "");
      const amt = amts[id];
      return `<div class="hand-chip ${isLose ? "lose" : ""}">
        <span class="who"><span class="dot" style="width:6px;height:6px;background:${colorVar(id)}"></span>${esc(recName(r, id))}</span>
        <span class="hand">${h}</span>
        <span class="tag">${isLose ? "敗" : ""}</span>
        ${amt ? `<span class="tag" style="color:${amt > 0 ? "var(--good)" : "var(--bad)"}">${amt > 0 ? "+" : ""}${amt.toLocaleString()}円</span>` : ""}
      </div>`;
    }).join("");
    const pitches = (r.pitches || []).map((p) => {
      const hs = Object.entries(p.hands).map(([id, h]) => `${esc(recName(r, id)[0])}:${h.replace("(勝)", "")}`).join(" ");
      const cls = p.result === "最終決着" ? "decide" : p.result === "勝ち抜け発生" ? "advance" : "draw";
      return `<div class="pitch"><span class="hs">${hs}</span><span class="res ${cls}">${p.result}</span></div>`;
    }).join("");
    const editBtn = myId ? `<button class="btn ghost small" data-toggleedit="${r.id}">編集</button>` : "";
    const editBox = myId ? `<div class="rec-edit" id="edit-${r.id}" style="display:none">
      <input type="date" class="field" id="editDate-${r.id}" value="${r.dateISO}">
      <div class="mode-pick" style="margin:10px 0">
        <button class="btn ghost small mode-normal ${r.mode === "通常モード" ? "on" : ""}" data-editmode="通常モード" data-rid="${r.id}">通常モード</button>
        <button class="btn ghost small mode-otoko ${r.mode === "男気モード" ? "on" : ""}" data-editmode="男気モード" data-rid="${r.id}">男気モード</button>
      </div>
      <select class="field" id="editLoser-${r.id}">
        ${r.participantIds.map((id) => `<option value="${id}" ${id === r.loserId ? "selected" : ""}>${esc(recName(r, id))}</option>`).join("")}
      </select>
      ${r.participantIds.some(isGuest) ? `<div class="sec-note" style="margin-top:10px">ゲストの名前（この対戦の記録にだけ表示されます）</div>
        ${r.participantIds.filter(isGuest).map((id) => `
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span style="flex:0 0 76px;font-size:12.5px;display:flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id]?.name ?? id)}
          </span>
          <input type="text" class="field" id="editGuest-${r.id}-${id}" maxlength="12" placeholder="名前（例：田中）" value="${esc(r.guestNames?.[id] || "")}">
        </div>`).join("")}` : ""}
      <div class="sec-note" style="margin-top:10px">メモ（ひとこと）</div>
      <input type="text" class="field" id="editMemo-${r.id}" maxlength="40" placeholder="例：コンビニでアイス" value="${esc(r.memo || "")}" style="margin-top:6px">
      <div class="sec-note" style="margin-top:10px">金額（勝った人の金額を入力すると、負けた人はその合計を支払います）</div>
      ${r.participantIds.map((id) => `
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span style="flex:0 0 76px;font-size:12.5px;display:flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span class="dot" style="background:${colorVar(id)}"></span>${esc(recName(r, id))}
          </span>
          <input type="number" inputmode="numeric" min="0" step="1" class="field" id="editAmt-${r.id}-${id}" data-amtrid="${r.id}" placeholder="0" value="${(r.amounts && id !== r.loserId && r.amounts[id]) || ""}">
        </div>`).join("")}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn small" data-save="${r.id}" style="flex:1">保存</button>
        <button class="btn ghost small" data-canceledit="${r.id}">キャンセル</button>
        <button class="btn ghost small" data-delete="${r.id}" style="color:var(--bad)">削除</button>
      </div>
    </div>` : "";
    return `<div class="card rec">
      <div class="rec-top">
        <div class="rec-date"><span class="d">${label}</span><span class="sec-note">(${wd})</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge ${r.mode === "男気モード" ? "otoko" : "normal"}">${r.mode}</span>
          ${editBtn}
        </div>
      </div>
      <div class="rec-hands">${hands}</div>
      ${r.memo ? `<div class="memo">📝 ${esc(r.memo)}</div>` : ""}
      ${r.streakText ? `<div class="streak">🔥 ${esc(r.streakText)}</div>` : ""}
      ${pitches ? `<details><summary>投球の詳細（${(r.pitches || []).length}球）</summary><div class="pitch-list">${pitches}</div></details>` : ""}
      ${editBox}
    </div>`;
  }).join("");

  const syncLoserAmount = (rid) => {
    // The loser's field is not typed into: it shows the winners' total it pays.
    const rec = records.find((x) => x.id === rid);
    const loserId = document.getElementById("editLoser-" + rid).value;
    let total = 0;
    (rec ? rec.participantIds : []).forEach((id) => {
      const input = document.getElementById(`editAmt-${rid}-${id}`);
      if (!input) return;
      input.disabled = id === loserId;
      if (id !== loserId) total += Math.max(0, Number(input.value) || 0);
    });
    const loserInput = document.getElementById(`editAmt-${rid}-${loserId}`);
    if (loserInput) loserInput.value = total || "";
    if (rec && !total && loserInput && loserId === rec.loserId) {
      // No winner amounts: keep the loser's own amount from an older record.
      loserInput.value = legacyLoserAmount(rec) || "";
    }
  };
  el.querySelectorAll("[data-toggleedit]").forEach((b) => {
    b.onclick = () => {
      const box = document.getElementById("edit-" + b.dataset.toggleedit);
      box.style.display = box.style.display === "none" ? "block" : "none";
      syncLoserAmount(b.dataset.toggleedit);
    };
  });
  el.querySelectorAll("[data-amtrid]").forEach((input) => {
    input.oninput = () => syncLoserAmount(input.dataset.amtrid);
  });
  el.querySelectorAll('select[id^="editLoser-"]').forEach((sel) => {
    sel.onchange = () => {
      const rid = sel.id.slice("editLoser-".length);
      // Whoever becomes the loser no longer has a winner amount of their own.
      const input = document.getElementById(`editAmt-${rid}-${sel.value}`);
      if (input) input.value = "";
      syncLoserAmount(rid);
    };
  });
  el.querySelectorAll("[data-editmode]").forEach((b) => {
    b.onclick = () => {
      el.querySelectorAll(`[data-editmode][data-rid="${b.dataset.rid}"]`).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    };
  });
  el.querySelectorAll("[data-canceledit]").forEach((b) => {
    b.onclick = () => { document.getElementById("edit-" + b.dataset.canceledit).style.display = "none"; };
  });
  el.querySelectorAll("[data-delete]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("この対戦記録を削除しますか？元に戻せません。")) return;
      await deleteDoc(doc(recordsCol, b.dataset.delete));
    };
  });
  el.querySelectorAll("[data-save]").forEach((b) => {
    b.onclick = async () => {
      const rid = b.dataset.save;
      const dateISO = document.getElementById("editDate-" + rid).value;
      const loserId = document.getElementById("editLoser-" + rid).value;
      const modeBtn = el.querySelector(`[data-editmode].on[data-rid="${rid}"]`);
      const mode = modeBtn ? modeBtn.dataset.editmode : "通常モード";
      if (!dateISO) { alert("日付を入力してください"); return; }
      const rec = records.find((x) => x.id === rid);
      const amounts = {};
      (rec ? rec.participantIds : []).forEach((id) => {
        const input = document.getElementById(`editAmt-${rid}-${id}`);
        const v = input ? Math.max(0, Number(input.value) || 0) : 0;
        if (v && id !== loserId) amounts[id] = v;
      });
      if (!Object.keys(amounts).length) {
        // Nothing entered for the winners: keep an older record's loser-only amount.
        const kept = Number(document.getElementById(`editAmt-${rid}-${loserId}`)?.value) || 0;
        if (kept) amounts[loserId] = kept;
      }
      const memo = document.getElementById("editMemo-" + rid).value.trim().slice(0, 40);
      const guestNames = {};
      (rec ? rec.participantIds : []).forEach((id) => {
        const v = document.getElementById(`editGuest-${rid}-${id}`)?.value.trim().slice(0, 12);
        if (v) guestNames[id] = v;
      });
      await updateDoc(doc(recordsCol, rid), { dateISO, mode, loserId, amounts, memo, guestNames, streakText: null });
      document.getElementById("edit-" + rid).style.display = "none";
    };
  });
}
