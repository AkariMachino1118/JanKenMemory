import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, runTransaction, serverTimestamp, arrayUnion, increment,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const membersCol = collection(db, "members");
const recordsCol = collection(db, "records");
const sessionRef = doc(db, "session", "current");
const seedRef = doc(db, "meta", "seed");

const PLAYER_COLORS = ["--p1", "--p2", "--p3", "--p4", "--p5", "--p6"];
const HAND_ORDER = ["グー", "チョキ", "パー"];
const BEATS = { "グー": "チョキ", "チョキ": "パー", "パー": "グー" };

let myId = localStorage.getItem("jankenMemberId") || null;
let viewOnly = false;
let members = {};     // id -> data
let memberOrder = []; // ids sorted by createdAt
let records = [];     // array of {id, ...data}
let session = null;   // current session doc data, or null

// ---------- seed (embedded, only used once if the store is empty) ----------
const SEED = {"members":[{"id":"ueda","name":"上田","points":15,"games":41,"losses":10},{"id":"kobayashi","name":"小林","points":-11,"games":35,"losses":17},{"id":"yoshimura","name":"吉村","points":-4,"games":42,"losses":18}],"records":[{"dateISO":"2026-03-18","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-03-19","mode":"通常モード","participantIds":["kobayashi","yoshimura"],"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"kobayashi","streakText":"小林2連敗","pitches":[{"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-03-23","mode":"男気モード","participantIds":["ueda","kobayashi"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"不参加"},"loserId":"kobayashi","streakText":"小林3連敗","pitches":[{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"result":"最終決着"},{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"不参加"},"result":"最終決着"}]},{"dateISO":"2026-03-23","mode":"男気モード","participantIds":["ueda","kobayashi"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"不参加"},"loserId":"kobayashi","streakText":"小林4連敗","pitches":[{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"不参加"},"result":"最終決着"}]},{"dateISO":"2026-03-24","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"パー"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー(勝)","kobayashi":"グー","yoshimura":"グー"},"result":"あいこ"},{"hands":{"ueda":"グー(勝)","kobayashi":"グー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-03-24","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"グー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"パー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"パー","kobayashi":"グー(勝)","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"グー(勝)","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"グー(勝)","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-03-25","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"パー"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"グー"},"result":"あいこ"},{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-03-26","mode":"男気モード","participantIds":["ueda","kobayashi"],"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"不参加"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"不参加"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"不参加"},"result":"最終決着"}]},{"dateISO":"2026-03-27","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"パー"},"loserId":"yoshimura","streakText":"吉村2連敗","pitches":[{"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"グー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"チョキ(勝)","kobayashi":"グー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-03-30","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"グー"},"result":"あいこ"},{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-03-31","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"チョキ","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"グー"},"result":"あいこ"},{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"ueda":"チョキ","kobayashi":"チョキ","yoshimura":"チョキ(勝)"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"チョキ","yoshimura":"チョキ(勝)"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-04-03","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-03","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"グー"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"チョキ","yoshimura":"グー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"グー(勝)"},"result":"最終決着"}]},{"dateISO":"2026-04-06","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"グー","kobayashi":"不参加","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"不参加","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-07","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"loserId":"yoshimura","streakText":"吉村2連敗","pitches":[{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-07","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"グー"},"loserId":"yoshimura","streakText":"吉村3連敗","pitches":[{"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-09","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"チョキ","kobayashi":"不参加","yoshimura":"パー"},"loserId":"yoshimura","streakText":"吉村4連敗","pitches":[{"hands":{"ueda":"チョキ","kobayashi":"不参加","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-09","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"チョキ","yoshimura":"グー"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"result":"最終決着"},{"hands":{"ueda":"グー","kobayashi":"チョキ","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-10","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"},{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-10","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-13","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"チョキ","yoshimura":"パー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"チョキ","yoshimura":"パー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー","kobayashi":"チョキ(勝)","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-14","mode":"通常モード","participantIds":["kobayashi","yoshimura"],"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"チョキ","yoshimura":"グー"},"result":"最終決着"},{"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-15","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-20","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"パー"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"グー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"パー(勝)","kobayashi":"パー","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"パー(勝)","kobayashi":"チョキ","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"パー(勝)","kobayashi":"グー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-21","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-04-23","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"チョキ"},"loserId":"ueda","streakText":"上田2連敗","pitches":[{"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ(勝)"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"チョキ(勝)"},"result":"最終決着"}]},{"dateISO":"2026-04-24","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"チョキ","yoshimura":"グー"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"グー"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"グー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"パー(勝)","kobayashi":"チョキ","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-04-27","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"チョキ","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー","kobayashi":"グー(勝)","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-04-28","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"チョキ"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"不参加","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"チョキ","kobayashi":"不参加","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-01","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-07","mode":"男気モード","participantIds":["kobayashi","yoshimura"],"hands":{"ueda":"不参加","kobayashi":"グー","yoshimura":"パー"},"loserId":"yoshimura","streakText":"吉村2連敗","pitches":[{"hands":{"ueda":"不参加","kobayashi":"チョキ","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"不参加","kobayashi":"グー","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-05-08","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"チョキ","yoshimura":"パー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー(勝)"},"result":"最終決着"}]},{"dateISO":"2026-05-11","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー"},"loserId":"kobayashi","streakText":"小林2連敗","pitches":[{"hands":{"ueda":"チョキ","kobayashi":"チョキ","yoshimura":"パー"},"result":"勝ち抜け発生"},{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"パー(勝)"},"result":"最終決着"}]},{"dateISO":"2026-05-12","mode":"男気モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"不参加","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-13","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"グー"},"loserId":"kobayashi","streakText":"小林3連敗","pitches":[{"hands":{"ueda":"グー","kobayashi":"グー","yoshimura":"グー"},"result":"あいこ"},{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-14","mode":"男気モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"グー","kobayashi":"不参加","yoshimura":"パー"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"不参加","yoshimura":"パー"},"result":"最終決着"}]},{"dateISO":"2026-05-18","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"グー"},"loserId":"kobayashi","streakText":"小林4連敗","pitches":[{"hands":{"ueda":"グー","kobayashi":"パー","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-20","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-22","mode":"男気モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"パー","kobayashi":"不参加","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-05-25","mode":"男気モード","participantIds":["kobayashi","yoshimura"],"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":null,"pitches":[{"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"パー"},"result":"あいこ"},{"hands":{"ueda":"不参加","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-29","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":"吉村2連敗","pitches":[{"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"チョキ"},"result":"あいこ"},{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-05-29","mode":"男気モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"yoshimura","streakText":"吉村3連敗","pitches":[{"hands":{"ueda":"パー","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-06-01","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"パー","kobayashi":"グー","yoshimura":"グー"},"loserId":"yoshimura","streakText":"吉村4連敗","pitches":[{"hands":{"ueda":"チョキ","kobayashi":"グー","yoshimura":"チョキ"},"result":"勝ち抜け発生"},{"hands":{"ueda":"パー","kobayashi":"グー(勝)","yoshimura":"グー"},"result":"最終決着"}]},{"dateISO":"2026-06-05","mode":"通常モード","participantIds":["ueda","kobayashi","yoshimura"],"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ"},"loserId":"kobayashi","streakText":null,"pitches":[{"hands":{"ueda":"チョキ","kobayashi":"パー","yoshimura":"チョキ"},"result":"最終決着"}]},{"dateISO":"2026-06-10","mode":"通常モード","participantIds":["ueda","yoshimura"],"hands":{"ueda":"グー","kobayashi":"不参加","yoshimura":"パー"},"loserId":"ueda","streakText":null,"pitches":[{"hands":{"ueda":"グー","kobayashi":"不参加","yoshimura":"パー"},"result":"最終決着"}]}]};

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

function genCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
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
    renderGate();
    renderAll();
  });
  onSnapshot(recordsCol, (snap) => {
    records = [];
    snap.forEach((d) => records.push({ id: d.id, ...d.data() }));
    records.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
    renderAll();
  });
  onSnapshot(sessionRef, (snap) => {
    session = snap.exists() ? snap.data() : null;
    maybeResolve();
    renderRound();
  });
}

function colorVar(id) {
  const i = memberOrder.indexOf(id);
  return `var(${PLAYER_COLORS[i >= 0 ? i % PLAYER_COLORS.length : 0]})`;
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
  if (!members[code]) { err.textContent = "そのIDは見つかりません"; return; }
  err.textContent = "";
  myId = code;
  localStorage.setItem("jankenMemberId", code);
  viewOnly = false;
  renderGate();
  renderAll();
};

document.getElementById("btnJoin").onclick = async () => {
  const name = document.getElementById("joinName").value.trim();
  const err = document.getElementById("joinErr");
  if (!name) { err.textContent = "表示名を入力してください"; return; }
  err.textContent = "";
  let code = genCode();
  let tries = 0;
  while (members[code] && tries < 5) { code = genCode(); tries++; }
  await setDoc(doc(membersCol, code), {
    name, active: true, points: 0, games: 0, losses: 0, createdAt: serverTimestamp(),
  });
  myId = code;
  localStorage.setItem("jankenMemberId", code);
  viewOnly = false;
  document.getElementById("codeReveal").style.display = "block";
  document.getElementById("codeRevealVal").textContent = code;
};

document.getElementById("btnViewOnly").onclick = () => {
  viewOnly = true;
  document.getElementById("gate").style.display = "none";
};

function renderGate() {
  const gate = document.getElementById("gate");
  if (myId && members[myId]) {
    gate.style.display = "none";
  } else if (!viewOnly) {
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
  } else {
    el.innerHTML = `<span>閲覧のみで見ています</span><button class="switch" id="btnSwitch">ログインする</button>`;
    document.getElementById("btnSwitch").onclick = () => {
      viewOnly = false;
      renderGate();
    };
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- members section ----------
function renderMembers() {
  const el = document.getElementById("members");
  let html = "";
  memberOrder.forEach((id) => {
    const m = members[id];
    html += `<div class="member-row ${m.active ? "" : "inactive"}">
      <span class="dot" style="background:${colorVar(id)}"></span>
      <span class="name">${esc(m.name)}</span>
      <span class="code">${id}</span>
      ${myId ? `<button class="btn ghost small" data-toggle="${id}">${m.active ? "脱退" : "復帰"}</button>` : ""}
    </div>`;
  });
  if (memberOrder.length === 0) html = '<div class="empty">まだメンバーがいません</div>';
  html += `<div class="add-member">
    <input class="field" id="newMemberName" placeholder="新しいメンバーの表示名">
    <button class="btn" id="btnAddMember">追加</button>
  </div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.toggle;
      await updateDoc(doc(membersCol, id), { active: !members[id].active });
    };
  });
  document.getElementById("btnAddMember").onclick = async () => {
    const input = document.getElementById("newMemberName");
    const name = input.value.trim();
    if (!name) return;
    let code = genCode();
    let tries = 0;
    while (members[code] && tries < 5) { code = genCode(); tries++; }
    await setDoc(doc(membersCol, code), {
      name, active: true, points: 0, games: 0, losses: 0, createdAt: serverTimestamp(),
    });
    input.value = "";
    alert(`「${name}」さんのIDは ${code} です。本人に伝えてください。`);
  };
}

// ---------- round ----------
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
    if (activeIds.length < 2) {
      el.innerHTML = '<div class="status-msg">対戦には2人以上のメンバーが必要です。</div>';
      return;
    }
    el.innerHTML = `
      <div class="participant-pick" id="pPick">
        ${activeIds.map((id) => `<label class="chk"><input type="checkbox" value="${id}" checked> ${esc(members[id].name)}</label>`).join("")}
      </div>
      <div class="mode-pick">
        <button class="btn ghost on" data-mode="通常モード" id="modeA">通常モード</button>
        <button class="btn ghost" data-mode="男気モード" id="modeB">男気モード</button>
      </div>
      <button class="btn" id="btnStart" style="width:100%">対戦を始める</button>`;
    let mode = "通常モード";
    document.getElementById("modeA").onclick = () => { mode = "通常モード"; document.getElementById("modeA").classList.add("on"); document.getElementById("modeB").classList.remove("on"); };
    document.getElementById("modeB").onclick = () => { mode = "男気モード"; document.getElementById("modeB").classList.add("on"); document.getElementById("modeA").classList.remove("on"); };
    document.getElementById("btnStart").onclick = async () => {
      const picked = [...document.querySelectorAll('#pPick input:checked')].map((i) => i.value);
      if (picked.length < 2) { alert("2人以上選んでください"); return; }
      await setDoc(sessionRef, {
        status: "collecting", participantIds: picked, pool: picked, hands: {},
        pitchIndex: 0, pitches: [], mode, startedAt: serverTimestamp(),
      });
    };
    return;
  }

  // session in progress
  note.textContent = `${session.mode} ・ ${session.pitchIndex + 1}投目`;
  const inPool = myId && session.pool.includes(myId);
  const alreadyThrown = myId && session.hands && session.hands[myId];
  const safe = myId && session.participantIds.includes(myId) && !session.pool.includes(myId);

  const chips = session.pool.map((id) => {
    const done = session.hands && session.hands[id];
    return `<span class="pool-chip ${done ? "done" : ""}"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id]?.name ?? id)}${done ? " ✓" : ""}</span>`;
  }).join("");

  let actionHtml = "";
  if (inPool && !alreadyThrown) {
    actionHtml = `<div class="hand-picker">
      ${HAND_ORDER.map((h) => `<button class="btn ghost" data-hand="${h}">${h}</button>`).join("")}
    </div>`;
  } else if (safe) {
    actionHtml = '<div class="status-msg">勝ち抜けました！結果を待っています。</div>';
  } else if (inPool && alreadyThrown) {
    actionHtml = '<div class="status-msg">送信済みです。他の人を待っています。</div>';
  } else if (!myId) {
    actionHtml = '<div class="status-msg">対戦を見学中です。</div>';
  } else {
    actionHtml = '<div class="status-msg">この対戦には参加していません。</div>';
  }

  const cancelHtml = myId && session.participantIds.includes(myId)
    ? '<button class="btn ghost small" id="btnCancel" style="margin-top:12px">この対戦を中止する</button>' : "";

  const logHtml = session.pitches && session.pitches.length
    ? `<div class="pitch-log">${session.pitches.map((p) =>
        `<div>${Object.entries(p.hands).map(([id, h]) => `${(members[id]?.name ?? id)[0]}:${h}`).join(" ")} <span class="res">→ ${p.result}</span></div>`
      ).join("")}</div>` : "";

  el.innerHTML = `<div class="pool-chips">${chips}</div>${actionHtml}${logHtml}${cancelHtml}`;

  if (inPool && !alreadyThrown) {
    el.querySelectorAll("[data-hand]").forEach((b) => {
      b.onclick = async () => {
        await updateDoc(sessionRef, { [`hands.${myId}`]: b.dataset.hand });
      };
    });
  }
  const cancelBtn = document.getElementById("btnCancel");
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (confirm("この対戦を中止しますか？")) await deleteDoc(sessionRef);
  };
}

let resolving = false;
async function maybeResolve() {
  if (!session || session.status !== "collecting" || resolving) return;
  const gotAll = session.pool.every((id) => session.hands && session.hands[id]);
  if (!gotAll || session.pool.length === 0) return;
  resolving = true;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(sessionRef);
      if (!snap.exists()) return;
      const s = snap.data();
      if (s.status !== "collecting") return;
      if (!s.pool.every((id) => s.hands && s.hands[id])) return;

      const types = new Set(s.pool.map((id) => s.hands[id]));
      const newPitch = { hands: { ...s.hands }, result: "" };

      if (types.size === 1 || types.size === 3) {
        newPitch.result = "あいこ";
        tx.update(sessionRef, {
          hands: {}, pitchIndex: s.pitchIndex + 1, pitches: arrayUnion(newPitch),
        });
        return;
      }
      const [t1, t2] = [...types];
      const winType = BEATS[t1] === t2 ? t1 : t2;
      const loseType = winType === t1 ? t2 : t1;
      const losers = s.pool.filter((id) => s.hands[id] === loseType);

      if (losers.length > 1) {
        newPitch.result = "勝ち抜け発生";
        tx.update(sessionRef, {
          pool: losers, hands: {}, pitchIndex: s.pitchIndex + 1, pitches: arrayUnion(newPitch),
        });
        return;
      }

      newPitch.result = "最終決着";
      const loserId = losers[0];
      const allPitches = [...(s.pitches || []), newPitch];
      const finalHands = {};
      for (const id of s.participantIds) {
        for (let i = allPitches.length - 1; i >= 0; i--) {
          if (allPitches[i].hands[id]) { finalHands[id] = allPitches[i].hands[id]; break; }
        }
      }
      const n = s.participantIds.length;
      const streakText = computeStreakText(loserId);

      const newRecRef = doc(recordsCol);
      tx.set(newRecRef, {
        dateISO: new Date().toISOString().slice(0, 10),
        mode: s.mode, participantIds: s.participantIds, hands: finalHands,
        loserId, streakText, pitches: allPitches, createdAt: serverTimestamp(),
      });
      for (const id of s.participantIds) {
        tx.update(doc(membersCol, id), {
          games: increment(1),
          points: increment(id === loserId ? -(n - 1) : 1),
          losses: increment(id === loserId ? 1 : 0),
        });
      }
      tx.delete(sessionRef);
    });
  } catch (e) {
    console.error(e);
  } finally {
    resolving = false;
  }
}

function computeStreakText(loserId) {
  let streak = 1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].loserId === loserId) streak++;
    else break;
  }
  if (streak < 2) return null;
  return `${members[loserId]?.name ?? loserId}${streak}連敗`;
}

// ---------- stats rendering (standings / habits / heatmap / monthly / records) ----------
function renderAll() {
  renderMembers();
  renderRound();
  renderStandings();
  renderHabits();
  renderHeatmap();
  renderMonthly();
  renderRecords();
}

function renderStandings() {
  const el = document.getElementById("standings");
  const ids = memberOrder.filter((id) => members[id]);
  if (!ids.length) { el.innerHTML = '<div class="empty">対戦記録がありません</div>'; return; }
  const ranked = ids.slice().sort((a, b) => (members[b].points || 0) - (members[a].points || 0));
  el.innerHTML = ranked.map((id, i) => {
    const m = members[id];
    const good = (m.points || 0) >= 0;
    const rate = m.games ? ((m.losses / m.games) * 100).toFixed(1) : "0.0";
    return `<div class="card stand-card">
      <div class="rank">${i + 1}位</div>
      <div>
        <div class="stand-name-row"><span class="dot" style="background:${colorVar(id)}"></span><span class="stand-name">${esc(m.name)}</span></div>
        <div class="stand-meta">参加 ${m.games || 0}・負け ${m.losses || 0}・敗率 ${rate}%</div>
      </div>
      <div class="stand-points">
        <div class="pts-val" style="color:${good ? "var(--good)" : "var(--bad)"}">${(m.points || 0) > 0 ? "+" : ""}${m.points || 0}<span style="font-size:12px;font-weight:500;">pt</span></div>
        <div class="pill ${good ? "good" : "bad"}">${good ? "貯金" : "借金"}</div>
      </div>
    </div>`;
  }).join("");
}

function allThrows() {
  // {memberId: {グー,チョキ,パー}} across every pitch of every record
  const out = {};
  for (const r of records) {
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

function renderHabits() {
  const el = document.getElementById("habits");
  const throws = allThrows();
  const ids = memberOrder.filter((id) => members[id] && throws[id]);
  if (!ids.length) { el.innerHTML = '<div class="empty">まだ投球データがありません</div>'; return; }
  let html = `<div class="habit-legend">
    <span><i style="background:var(--accent-strong)"></i>グー</span>
    <span><i style="background:var(--accent)"></i>チョキ</span>
    <span><i style="background:var(--accent-soft);border:1px solid var(--line-strong)"></i>パー</span>
  </div>`;
  ids.forEach((id) => {
    const h = throws[id];
    const total = h["グー"] + h["チョキ"] + h["パー"];
    const segs = HAND_ORDER.map((k) => {
      const pct = (h[k] / total) * 100;
      const bg = k === "グー" ? "var(--accent-strong)" : k === "チョキ" ? "var(--accent)" : "var(--accent-soft)";
      const fg = k === "パー" ? "var(--accent-strong)" : "var(--accent-ink)";
      return `<div class="habit-seg" style="width:${pct}%;background:${bg};color:${fg}">${pct >= 12 ? h[k] : ""}</div>`;
    }).join("");
    html += `<div class="habit-row">
      <div class="habit-row-top"><span class="name"><span class="dot" style="background:${colorVar(id)}"></span>${esc(members[id].name)}</span><span class="total">計 ${total}回</span></div>
      <div class="habit-bar">${segs}</div>
    </div>`;
  });
  el.innerHTML = html;
}

function renderHeatmap() {
  const el = document.getElementById("heat");
  const days = ["月", "火", "水", "木", "金", "土", "日"];
  const counts = {};
  for (const r of records) {
    if (!r.loserId) continue;
    const wd = days[new Date(r.dateISO + "T00:00:00").getDay() === 0 ? 6 : new Date(r.dateISO + "T00:00:00").getDay() - 1];
    counts[r.loserId] = counts[r.loserId] || {};
    counts[r.loserId][wd] = (counts[r.loserId][wd] || 0) + 1;
  }
  const ids = memberOrder.filter((id) => members[id] && counts[id]);
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
  for (const r of records) {
    if (!r.loserId) continue;
    const key = r.dateISO.slice(0, 7);
    byMonth[key] = byMonth[key] || {};
    byMonth[key][r.loserId] = (byMonth[key][r.loserId] || 0) + 1;
  }
  const months = Object.keys(byMonth).sort();
  const ids = memberOrder.filter((id) => members[id]);
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

function renderRecords() {
  document.getElementById("rec-count").textContent = records.length ? `全${records.length}戦` : "";
  const el = document.getElementById("records");
  if (!records.length) { el.innerHTML = '<div class="empty">まだ対戦記録がありません。上の「対戦」から始めましょう。</div>'; return; }
  const weekdayJ = ["日", "月", "火", "水", "木", "金", "土"];
  el.innerHTML = records.slice().reverse().map((r) => {
    const d = new Date(r.dateISO + "T00:00:00");
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const wd = weekdayJ[d.getDay()];
    const hands = r.participantIds.map((id) => {
      const isLose = id === r.loserId;
      const h = (r.hands[id] || "").replace("(勝)", "");
      return `<div class="hand-chip ${isLose ? "lose" : ""}">
        <span class="who"><span class="dot" style="width:6px;height:6px;background:${colorVar(id)}"></span>${esc(members[id]?.name ?? id)}</span>
        <span class="hand">${h}</span>
        <span class="tag">${isLose ? "敗" : ""}</span>
      </div>`;
    }).join("");
    const pitches = (r.pitches || []).map((p) => {
      const hs = Object.entries(p.hands).map(([id, h]) => `${(members[id]?.name ?? id)[0]}:${h.replace("(勝)", "")}`).join(" ");
      const cls = p.result === "最終決着" ? "decide" : p.result === "勝ち抜け発生" ? "advance" : "draw";
      return `<div class="pitch"><span class="hs">${hs}</span><span class="res ${cls}">${p.result}</span></div>`;
    }).join("");
    return `<div class="card rec">
      <div class="rec-top">
        <div class="rec-date"><span class="d">${label}</span><span class="sec-note">(${wd})</span></div>
        <span class="badge ${r.mode === "男気モード" ? "otoko" : ""}">${r.mode}</span>
      </div>
      <div class="rec-hands">${hands}</div>
      ${r.streakText ? `<div class="streak">🔥 ${esc(r.streakText)}</div>` : ""}
      ${pitches ? `<details><summary>投球の詳細（${(r.pitches || []).length}球）</summary><div class="pitch-list">${pitches}</div></details>` : ""}
    </div>`;
  }).join("");
}
