// ---------------------------------------------------------------------------
// Firebase 연동 한 곳 모음 — 로그인 · 클라우드 세이브 · 랭킹.
//
// 게임 코드(시뮬레이션·렌더러)는 이 파일을 직접 부르지 않습니다. main.ts만
// 이 얇은 층을 통해 Firebase와 이야기하고, 나머지는 전부 순수 로직 그대로입니다.
//
// **중요: Firebase SDK는 로그인할 때 처음 불러옵니다 (동적 import).**
// 설정을 안 한 사람의 첫 로딩에 1MB 가까운 SDK를 받게 하지 않기 위해서입니다.
// ---------------------------------------------------------------------------

import type { SaveData } from "../core/SaveData";
import { firebaseConfig, isFirebaseConfigured } from "./config";

export interface CloudUser {
  uid: string;
  name: string;
  photoUrl: string | null;
  /**
   * 구글 계정 이메일. 개발자 모드 허용 목록을 확인하는 데만 씁니다.
   * 화면에 표시하거나 다른 곳으로 보내지 않습니다.
   */
  email: string | null;
}

export interface LeaderboardEntry {
  uid: string;
  name: string;
  faction: string;
  level: number;
  money: number;
  fruitLevel: number;
}

/** 랭킹에 올릴 요약 정보 */
export interface ScoreSummary {
  name: string;
  faction: string;
  level: number;
  money: number;
  fruitLevel: number;
}

type FirestoreModule = typeof import("firebase/firestore");
type AuthModule = typeof import("firebase/auth");

interface Loaded {
  auth: import("firebase/auth").Auth;
  db: import("firebase/firestore").Firestore;
  authApi: AuthModule;
  dbApi: FirestoreModule;
}

let loading: Promise<Loaded | null> | null = null;

/** SDK를 실제로 불러옵니다 (처음 한 번만). 설정이 없으면 null. */
async function load(): Promise<Loaded | null> {
  if (!isFirebaseConfigured()) return null;
  if (!loading) {
    loading = (async () => {
      try {
        const [{ initializeApp, getApps }, authApi, dbApi] = await Promise.all([
          import("firebase/app"),
          import("firebase/auth"),
          import("firebase/firestore"),
        ]);
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig()!);
        return {
          app,
          auth: authApi.getAuth(app),
          db: dbApi.getFirestore(app),
          authApi,
          dbApi,
        } as Loaded;
      } catch (err) {
        console.error("[firebase] SDK 로드 실패 — 오프라인으로 계속합니다", err);
        return null;
      }
    })();
  }
  return loading;
}

/** 클라우드 기능을 쓸 수 있는지 (설정 존재 여부만 봅니다 — SDK는 아직 안 불러옴) */
export function cloudAvailable(): boolean {
  return isFirebaseConfigured();
}

/**
 * 구글 계정으로 로그인. 팝업이 막힌 환경에서는 리다이렉트로 넘어갑니다.
 * 실패하면 null을 돌려주고, 게임은 오프라인으로 계속 진행됩니다.
 */
export async function signInWithGoogle(): Promise<CloudUser | null> {
  const loaded = await load();
  if (!loaded) return null;
  const { authApi, auth } = loaded;
  try {
    const provider = new authApi.GoogleAuthProvider();
    const result = await authApi.signInWithPopup(auth, provider);
    return toCloudUser(result.user);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try {
        const provider = new authApi.GoogleAuthProvider();
        await authApi.signInWithRedirect(auth, provider);
        return null; // 리다이렉트되면 페이지가 다시 로드됩니다
      } catch (redirectErr) {
        console.error("[firebase] 리다이렉트 로그인 실패", redirectErr);
        return null;
      }
    }
    if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      console.error("[firebase] 로그인 실패", err);
    }
    return null;
  }
}

function toCloudUser(user: {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email?: string | null;
}): CloudUser {
  return {
    uid: user.uid,
    name: user.displayName?.trim() || "이름 없는 해적",
    photoUrl: user.photoURL,
    email: user.email ?? null,
  };
}

/**
 * 이미 로그인된 상태인지 확인합니다 (새로고침·리다이렉트 복귀 대응).
 * 로그인 정보가 확정될 때까지 기다렸다가 돌려줍니다.
 */
export async function currentUser(): Promise<CloudUser | null> {
  const loaded = await load();
  if (!loaded) return null;
  const { authApi, auth } = loaded;
  try {
    await authApi.getRedirectResult(auth).catch(() => null);
    return await new Promise<CloudUser | null>((resolve) => {
      const unsubscribe = authApi.onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user ? toCloudUser(user) : null);
      });
    });
  } catch (err) {
    console.error("[firebase] 로그인 상태 확인 실패", err);
    return null;
  }
}

export async function signOut(): Promise<void> {
  const loaded = await load();
  if (!loaded) return;
  try {
    await loaded.authApi.signOut(loaded.auth);
  } catch (err) {
    console.error("[firebase] 로그아웃 실패", err);
  }
}

// ── 세이브 ──────────────────────────────────────────────────────────────────

/** 이 계정의 세이브를 불러옵니다. 없으면 null (새 캐릭터). */
export async function loadCloudSave(uid: string): Promise<SaveData | null> {
  const loaded = await load();
  if (!loaded) return null;
  const { dbApi, db } = loaded;
  try {
    const snap = await dbApi.getDoc(dbApi.doc(db, "saves", uid));
    if (!snap.exists()) return null;
    const data = snap.data() as SaveData & { lastGachaAt?: { toMillis?: () => number } };
    // 뽑기 시각은 서버 타임스탬프로 저장하므로 밀리초로 바꿔줍니다.
    if (data.lastGachaAt && typeof data.lastGachaAt.toMillis === "function") {
      data.lastGachaAtMs = data.lastGachaAt.toMillis();
    }
    return data;
  } catch (err) {
    console.error("[firebase] 세이브 불러오기 실패 — 이 브라우저 저장본으로 진행합니다", err);
    return null;
  }
}

/**
 * 세이브 저장.
 * 뽑기 시각만 **서버 시각**으로 덮어씁니다. 클라이언트 시계를 과거로 돌려도
 * 4시간 제한을 우회할 수 없게 하기 위해서입니다.
 */
export async function saveCloudSave(uid: string, data: SaveData, touchGacha: boolean): Promise<boolean> {
  const loaded = await load();
  if (!loaded) return false;
  const { dbApi, db } = loaded;
  try {
    const payload: Record<string, unknown> = { ...data, updatedAt: dbApi.serverTimestamp() };
    if (touchGacha) payload.lastGachaAt = dbApi.serverTimestamp();
    await dbApi.setDoc(dbApi.doc(db, "saves", uid), payload, { merge: true });
    return true;
  } catch (err) {
    console.error("[firebase] 세이브 저장 실패", err);
    return false;
  }
}

// ── 랭킹 ────────────────────────────────────────────────────────────────────

/** 내 기록을 랭킹에 올립니다 (레벨이 오르거나 코인이 크게 바뀔 때만 호출) */
export async function submitScore(uid: string, score: ScoreSummary): Promise<boolean> {
  const loaded = await load();
  if (!loaded) return false;
  const { dbApi, db } = loaded;
  try {
    await dbApi.setDoc(
      dbApi.doc(db, "leaderboard", uid),
      { ...score, uid, updatedAt: dbApi.serverTimestamp() },
      { merge: true },
    );
    return true;
  } catch (err) {
    console.error("[firebase] 랭킹 등록 실패", err);
    return false;
  }
}

/** 레벨 높은 순 상위 목록 */
export async function fetchLeaderboard(max = 20): Promise<LeaderboardEntry[] | null> {
  const loaded = await load();
  if (!loaded) return null;
  const { dbApi, db } = loaded;
  try {
    const q = dbApi.query(
      dbApi.collection(db, "leaderboard"),
      dbApi.orderBy("level", "desc"),
      dbApi.orderBy("money", "desc"),
      dbApi.limit(max),
    );
    const snap = await dbApi.getDocs(q);
    return snap.docs.map((d) => {
      const v = d.data() as Partial<LeaderboardEntry>;
      return {
        uid: d.id,
        name: typeof v.name === "string" ? v.name : "이름 없음",
        faction: v.faction === "marine" ? "marine" : "pirate",
        level: typeof v.level === "number" ? v.level : 1,
        money: typeof v.money === "number" ? v.money : 0,
        fruitLevel: typeof v.fruitLevel === "number" ? v.fruitLevel : 1,
      };
    });
  } catch (err) {
    console.error("[firebase] 랭킹 불러오기 실패", err);
    return null;
  }
}
