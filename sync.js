/* Google sign-in and transactional Firestore sync.
   Local state remains usable offline. Each cloud write first merges with the
   latest server copy inside a transaction, so simultaneous device switches
   converge instead of silently overwriting one another. */

const authArea = document.getElementById("auth-area");
const syncStatus = document.getElementById("sync-status");

function setSyncStatus(label, state = "local") {
  if (!syncStatus) return;
  syncStatus.textContent = label;
  syncStatus.dataset.state = state;
}

if (!window.FIREBASE_CONFIG) {
  authArea.classList.add("hidden");
} else {
  setSyncStatus("Connecting…", "syncing");
  initSync().catch(error => {
    console.error("Cloud sync could not start:", error);
    setSyncStatus("Sync unavailable", "error");
    const button = document.getElementById("sign-in-btn");
    button.disabled = true;
    button.textContent = "Cloud sync unavailable";
  });
}

async function initSync() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const { getFirestore, doc, onSnapshot, runTransaction, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const app = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  // A fresh id per page means two tabs in one browser no longer ignore each other.
  const clientId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  let user = null;
  let unsubscribe = null;
  let pushTimer = null;
  let suppressPush = false;
  let authEpoch = 0;
  let pushQueue = Promise.resolve();

  const signInBtn = document.getElementById("sign-in-btn");
  const signOutBtn = document.getElementById("sign-out-btn");
  const userInfo = document.getElementById("user-info");

  signInBtn.addEventListener("click", async () => {
    signInBtn.disabled = true;
    setSyncStatus("Signing in…", "syncing");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      if (error.code !== "auth/popup-closed-by-user" && error.code !== "auth/cancelled-popup-request") {
        alert("Sign-in failed: " + (error.message || error));
      }
    } finally {
      signInBtn.disabled = false;
      if (!auth.currentUser) setSyncStatus("Local only", "local");
    }
  });

  signOutBtn.addEventListener("click", async () => {
    signOutBtn.disabled = true;
    clearTimeout(pushTimer);
    let flushed = true;
    try {
      await pushNow(); // best effort: flush the latest switch before leaving
    } catch (error) {
      flushed = false;
      console.error("Final sync before sign-out failed:", error);
    }
    try {
      await signOut(auth);
      if (flushed) {
        // Clear private account data from every open tab without emitting a
        // cloud save that could accidentally erase the account itself.
        localStorage.setItem("opb-signed-out", String(Date.now()));
        window.__clearLocalStateAfterSignOut();
      } else {
        alert("You are signed out, but this browser kept the latest local data because it could not finish syncing. Sign in again when online to upload it safely.");
      }
    } catch (error) {
      alert("Sign-out failed: " + (error.message || error));
    } finally {
      signOutBtn.disabled = false;
    }
  });

  onAuthStateChanged(auth, async nextUser => {
    const epoch = ++authEpoch;
    user = nextUser;
    signInBtn.classList.toggle("hidden", !!nextUser);
    signOutBtn.classList.toggle("hidden", !nextUser);
    userInfo.classList.toggle("hidden", !nextUser);
    clearTimeout(pushTimer);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!nextUser) {
      setSyncStatus("Local only", "local");
      return;
    }

    setSyncStatus(navigator.onLine ? "Syncing…" : "Offline", navigator.onLine ? "syncing" : "offline");

    userInfo.textContent = nextUser.displayName || nextUser.email || "Signed in";
    const uid = nextUser.uid;
    const lastUid = localStorage.getItem("opb-last-uid");
    const switchingAccounts = !!lastUid && lastUid !== uid;

    try {
      const synced = await syncTransaction(uid, switchingAccounts ? "remote-only" : "merge");
      if (epoch !== authEpoch || user?.uid !== uid) return;
      // A previous account's local data must never be merged into this account.
      adoptState(switchingAccounts ? synced : window.__mergeStates(state, synced));
      localStorage.setItem("opb-last-uid", uid);
      setSyncStatus("Synced", "synced");
    } catch (error) {
      console.error("Initial sync failed:", error);
      setSyncStatus(navigator.onLine ? "Sync issue" : "Offline", navigator.onLine ? "error" : "offline");
    }
    if (epoch !== authEpoch || user?.uid !== uid) return;

    const ref = doc(db, "users", uid);
    unsubscribe = onSnapshot(ref, snapshot => {
      const data = snapshot.data();
      if (!data || data.clientId === clientId || !data.state) return;
      try {
        adoptState(window.__mergeStates(state, JSON.parse(data.state)));
        setSyncStatus("Synced", "synced");
      } catch (error) {
        console.error("Ignored an invalid cloud update:", error);
      }
    }, error => {
      console.error("Live sync stopped:", error);
      setSyncStatus(navigator.onLine ? "Sync issue" : "Offline", navigator.onLine ? "error" : "offline");
    });
  });

  function adoptState(next) {
    suppressPush = true;
    try {
      window.__adoptExternalState(next, true);
    } finally {
      suppressPush = false;
    }
  }

  function syncTransaction(uid, mode) {
    const ref = doc(db, "users", uid);
    const localSnapshot = JSON.parse(JSON.stringify(state));
    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      let remote = null;
      if (snapshot.exists() && snapshot.data().state) remote = JSON.parse(snapshot.data().state);
      const next = mode === "remote-only"
        ? (remote || window.__emptyState())
        : window.__mergeStates(localSnapshot, remote || window.__emptyState());
      transaction.set(ref, {
        state: JSON.stringify(next),
        clientId,
        updatedAt: serverTimestamp(),
      });
      return next;
    });
  }

  function pushNow() {
    if (!user) return Promise.resolve();
    const uid = user.uid;
    setSyncStatus(navigator.onLine ? "Syncing…" : "Offline", navigator.onLine ? "syncing" : "offline");
    pushQueue = pushQueue.catch(() => {}).then(async () => {
      const synced = await syncTransaction(uid, "merge");
      if (user?.uid === uid) {
        adoptState(window.__mergeStates(state, synced));
        setSyncStatus("Synced", "synced");
      }
    });
    return pushQueue;
  }

  // app.js emits this after one complete local state transition.
  window.addEventListener("state-saved", () => {
    if (!user || suppressPush) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushNow().catch(error => {
        console.error("Sync push failed:", error);
        setSyncStatus(navigator.onLine ? "Sync issue" : "Offline", navigator.onLine ? "error" : "offline");
      });
    }, 500);
  });

  window.addEventListener("online", () => {
    if (user) pushNow().catch(error => console.error("Reconnect sync failed:", error));
  });
  window.addEventListener("offline", () => {
    if (user) setSyncStatus("Offline", "offline");
  });
}
