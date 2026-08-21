// ---------------------------------------------------------------------------
// 이 브라우저에만 남는 저장소 (localStorage).
//
// 로그인하지 않고 플레이할 때의 세이브이자, 로그인했을 때도 **오프라인 백업**으로
// 함께 씁니다 (인터넷이 잠깐 끊겨도 진행상황이 날아가지 않도록).
//
// localStorage가 막혀 있는 환경(사생활 보호 모드 등)에서도 게임이 죽지 않도록
// 전부 try/catch로 감쌌습니다 — 저장이 안 되면 그냥 이번 세션에만 적용됩니다.
// ---------------------------------------------------------------------------

import type { SaveData } from "./SaveData";

const KEY = "bloxfruits-web/save-v1";

/** 이 브라우저에 저장된 세이브 (없거나 깨졌으면 null) */
export function loadLocalSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (!parsed || typeof parsed !== "object") return null;
    // 예전 버전은 { lastGachaAtMs } 만 들어 있었습니다. 그 값만 살려서 넘깁니다.
    if (typeof parsed.version !== "number") {
      return typeof parsed.lastGachaAtMs === "number"
        ? ({ version: 0, lastGachaAtMs: parsed.lastGachaAtMs } as SaveData)
        : null;
    }
    return parsed as SaveData;
  } catch {
    return null;
  }
}

export function saveLocalSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장 불가 환경 — 이번 세션 동안만 진행상황이 유지됩니다.
  }
}

export function clearLocalSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 무시
  }
}
