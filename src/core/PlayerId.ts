// ---------------------------------------------------------------------------
// 이 브라우저(캐릭터)를 식별하는, 재접속해도 바뀌지 않는 영구 id.
//
// 멀티플레이 서버의 Connection.id는 접속할 때마다 새로 생성되는 임시 값이라
// (server/state.ts의 makeId 참고) 해적 사단(길드) 가입 여부처럼 "여러 접속에
// 걸쳐 계속 기억해야 하는" 정보를 거기 묶어둘 수 없습니다. 이 id를 hello
// 메시지에 실어 보내면, 서버가 그걸로 사단 가입 여부를 파일에서 찾아줍니다.
//
// 로그인 계정과는 별개입니다 — 구글 로그인이 없어도(게스트 접속) 이 브라우저에서는
// 항상 같은 사단원으로 인식되도록, 세이브와 마찬가지로 localStorage에 저장합니다.
// ---------------------------------------------------------------------------

const KEY = "bloxfruits-web/player-uid-v1";

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* 아래 폴백으로 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** 이 브라우저의 영구 플레이어 id를 돌려줍니다 (없으면 새로 만들어 저장). */
export function getOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // localStorage가 막힌 환경 — 이번 세션에서만 쓰는 임시 id (사단 가입은 새로고침 시 유지되지 않습니다)
    return randomId();
  }
}
