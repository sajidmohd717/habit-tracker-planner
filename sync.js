/* Cloud sync via Firebase (Google sign-in + Firestore).
   Local-first: localStorage stays the source of truth on this device;
   this module mirrors it to users/{uid} in Firestore and adopts newer
   remote copies pushed by other devices. If window.FIREBASE_CONFIG is
   null, the app simply runs local-only and this module does nothing. */

const authArea = document.getElementById("auth-area");

if (!window.FIREBASE_CONFIG) {
  authArea.classList.add("hidden");
} else {
  initSync();
}

async function initSync() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const { getFirestore, doc, getDoc, setDoc, onSnapshot } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const app = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // stable id for this browser, to ignore our own echoes from onSnapshot
  let clientId = localStorage.getItem("opb-client-id");
  if (!clientId) {
    clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("opb-client-id", clientId);
  }

  let user = null;
  let unsubscribe = null;
  let pushTimer = null;
  let suppressPush = false;

  const signInBtn = document.getElementById("sign-in-btn");
  const signOutBtn = document.getElementById("sign-out-btn");
  const userInfo = document.getElementById("user-info");

  signInBtn.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        alert("Sign-in failed: " + (e.message || e));
      }
    }
  });
  signOutBtn.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async (u) => {
    user = u;
    signInBtn.classList.toggle("hidden", !!u);
    signOutBtn.classList.toggle("hidden", !u);
    userInfo.classList.toggle("hidden", !u);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!u) return;
    userInfo.textContent = u.displayName || u.email || "Signed in";

    const ref = doc(db, "users", u.uid);
    const lastUid = localStorage.getItem("opb-last-uid");
    try {
      const snap = await getDoc(ref);
      const remote = snap.exists() && snap.data().state ? JSON.parse(snap.data().state) : null;
      if (lastUid && lastUid !== u.uid) {
        // different account than last time: the local data belongs to the
        // previous account — adopt this account's cloud copy wholesale
        // instead of merging, so data never bleeds between accounts
        adoptState(remote || { habits: [], tasksByDate: {}, entries: [], resetAt: 0 });
      } else if (remote) {
        // same account (or this device's first sign-in): merge so no side loses progress
        adoptState(mergeStates(state, remote));
      }
      localStorage.setItem("opb-last-uid", u.uid);
    } catch (e) {
      console.error("Initial sync failed:", e);
    }
    pushNow();

    // live updates from other devices
    unsubscribe = onSnapshot(ref, (snap) => {
      const d = snap.data();
      if (!d || d.clientId === clientId || !d.state) return;
      adoptState(mergeStates(state, JSON.parse(d.state)));
    });
  });

  function adoptState(next) {
    suppressPush = true;
    state = next;
    normalizeRunning(state); // never let two "running" entries survive an adopt
    save();
    suppressPush = false;
    renderHabits();
    renderTimeline();
    renderTracker();
  }

  function pushNow() {
    if (!user) return;
    setDoc(doc(db, "users", user.uid), {
      state: JSON.stringify(state),
      clientId,
      updatedAt: Date.now(),
    }).catch(e => console.error("Sync push failed:", e));
  }

  // app.js dispatches this on every save()
  window.addEventListener("state-saved", () => {
    if (!user || suppressPush) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  });
}

/* Merge two app states without losing progress on either side.
   Exception: if one side was reset more recently, it wins wholesale —
   a reset must not be "out-merged" by older data from the cloud. */
function mergeStates(a, b) {
  const ra = a.resetAt || 0, rb = b.resetAt || 0;
  if (ra !== rb) {
    const winner = ra > rb ? a : b;
    return { habits: [], tasksByDate: {}, entries: [], ...winner };
  }

  const merged = { habits: [], tasksByDate: {}, entries: [], resetAt: ra };

  // habits: union by id; on conflict keep the copy with more progress
  const habitMap = new Map();
  for (const h of [...(a.habits || []), ...(b.habits || [])]) {
    const prev = habitMap.get(h.id);
    if (!prev) { habitMap.set(h.id, h); continue; }
    const newer =
      (h.lastCheckin || "") > (prev.lastCheckin || "") ? h :
      (prev.lastCheckin || "") > (h.lastCheckin || "") ? prev :
      h.streak >= prev.streak ? h : prev;
    const older = newer === h ? prev : h;
    habitMap.set(h.id, {
      ...older, ...newer,
      bestStreak: Math.max(h.bestStreak || 0, prev.bestStreak || 0),
    });
  }
  merged.habits = [...habitMap.values()];

  // tracker entries: union by id; a finished copy beats a still-running one
  const entryMap = new Map();
  for (const e of [...(a.entries || []), ...(b.entries || [])]) {
    const prev = entryMap.get(e.id);
    if (!prev || (prev.end === null && e.end !== null)) entryMap.set(e.id, e);
  }
  merged.entries = [...entryMap.values()].sort((x, y) => x.start - y.start);
  // continuous tracking: keep only the newest running entry, end the rest at
  // the point the newer one started
  const running = merged.entries.filter(e => e.end === null);
  if (running.length > 1) {
    running.sort((x, y) => x.start - y.start);
    for (let i = 0; i < running.length - 1; i++) {
      running[i].end = Math.max(running[i].start + 1000, running[i + 1].start);
    }
  }

  // planner: union days; within a day union blocks by id
  for (const key of new Set([...Object.keys(a.tasksByDate || {}), ...Object.keys(b.tasksByDate || {})])) {
    const seen = new Map();
    for (const t of [...((a.tasksByDate || {})[key] || []), ...((b.tasksByDate || {})[key] || [])]) {
      const prev = seen.get(t.id);
      if (!prev || (t.done && !prev.done)) seen.set(t.id, t);
    }
    merged.tasksByDate[key] = [...seen.values()];
  }

  return merged;
}

window.__mergeStates = mergeStates; // exposed for testing in the console
