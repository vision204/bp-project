// ---------------------------------------------------------------------------
// Firebase 설정.
//
// **값이 코드에 그대로 들어 있습니다.** 일부러 그렇게 했습니다.
//
// 파이어베이스 웹 설정값(apiKey 등)은 비밀이 아닙니다 — 어떤 방식으로 넣든
// 빌드하면 브라우저 번들에 그대로 실려서 누구나 개발자 도구로 볼 수 있습니다.
// 파이어베이스 설계 자체가 "이건 공개 식별자, 실제 보안은 규칙이 담당"입니다.
// 그래서 .env로 감추는 건 안전을 더해주지 않으면서, 로컬·Netlify·다른 컴퓨터마다
// 설정을 다시 해야 하는 번거로움만 만듭니다. 그래서 기본값으로 박아뒀습니다.
//
// 실제 방어선은 이 두 가지입니다:
//   1. firestore.rules — 세이브는 본인만, 랭킹은 자기 줄만 (이미 적용)
//   2. (나중에) App Check — 남이 이 키로 내 프로젝트 할당량을 축내는 것 방지
//
// 다른 파이어베이스 프로젝트를 쓰고 싶으면 .env로 덮어쓸 수 있습니다
// (npm run firebase:setup). .env 값이 있으면 그게 우선입니다.
// ---------------------------------------------------------------------------

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** 이 프로젝트가 기본으로 쓰는 파이어베이스 (bp-project-f52a7) */
export const DEFAULT_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyDhdgF_yNBFSY43986Fd2hLWlbnF3rp1To",
  authDomain: "bp-project-f52a7.firebaseapp.com",
  projectId: "bp-project-f52a7",
  storageBucket: "bp-project-f52a7.firebasestorage.app",
  messagingSenderId: "972301335058",
  appId: "1:972301335058:web:d85542e568fb7d59fb76cb",
};

const REQUIRED_KEYS: (keyof FirebaseConfig)[] = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

/**
 * .env 값이 있으면 그걸로 덮어쓰고, 없으면 기본값을 씁니다.
 * (env를 인자로 받는 순수 함수라 브라우저 없이도 검증할 수 있습니다)
 */
export function resolveConfig(env: Record<string, string | undefined> = {}): FirebaseConfig {
  const fromEnv: Partial<FirebaseConfig> = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };

  const merged = { ...DEFAULT_CONFIG };
  for (const key of REQUIRED_KEYS) {
    const value = fromEnv[key];
    // 비었거나 .env.example의 자리표시자면 무시하고 기본값을 씁니다.
    if (typeof value === "string" && value.trim() !== "" && !value.startsWith("여기에")) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

/** 설정값이 다 채워져 있는지 (기본값이 있으므로 보통 항상 true) */
export function isConfigComplete(config: FirebaseConfig): boolean {
  return REQUIRED_KEYS.every((key) => typeof config[key] === "string" && config[key].trim() !== "");
}

let cached: FirebaseConfig | null | undefined;

export function firebaseConfig(): FirebaseConfig | null {
  if (cached !== undefined) return cached;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const resolved = resolveConfig(env);
  cached = isConfigComplete(resolved) ? resolved : null;
  return cached;
}

/** 클라우드 기능(로그인·세이브·랭킹)을 쓸 수 있는 상태인지 */
export function isFirebaseConfigured(): boolean {
  return firebaseConfig() !== null;
}
