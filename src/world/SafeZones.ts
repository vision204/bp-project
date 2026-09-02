// ---------------------------------------------------------------------------
// PvP 안전지역 — 지금은 두 번째 바다 본부(HQ) 건물 내부 하나뿐입니다.
//
// 이 파일은 순수 데이터/함수만 있습니다 (THREE·Rapier 의존성 없음). 그래야
// 클라이언트(src/network/PvpCombat.ts)와 서버(server/state.ts) 양쪽이 같은
// 판정을 씁니다 — ShapeMath.ts와 같은 이유로, 클라이언트 예측과 서버 판정이
// 어긋나면 "화면에선 안전지역인데 서버는 때렸다"는 불일치가 생기기 때문입니다.
//
// HQ_BUILDING 치수는 createIslands.ts의 buildHqBuilding()이 실제 건물(벽/문)을
// 지을 때도 그대로 가져다 씁니다 — 눈에 보이는 벽과 안전지역 판정이 어긋나지
// 않도록 치수의 출처를 하나로 유지합니다.
// ---------------------------------------------------------------------------

import { SEA_ORIGINS } from "./islands";

/** 본부 건물 치수. 두 번째 바다 원점 기준 로컬 좌표입니다. */
export const HQ_BUILDING = {
  /** 건물 중심 (본부 섬의 localCenter와 같습니다 — islands.ts의 "hq" 항목 참고) */
  localCenter: { x: 0, z: 0 },
  /** 바깥 치수(m) — x축 46m, z축 30m인 큰 창고 한 채 */
  width: 46,
  depth: 30,
  /** 벽 높이(m) */
  wallHeight: 14,
  /** 벽 두께(m) — 안전지역은 "내벽 안쪽" 기준이라 두께의 절반만큼 안쪽으로 뺍니다 */
  wallThickness: 1.2,
  /** 동쪽 벽에 뚫린 문의 폭(m) */
  doorWidth: 5,
} as const;

const origin = SEA_ORIGINS[2];
const halfInnerW = HQ_BUILDING.width / 2 - HQ_BUILDING.wallThickness;
const halfInnerD = HQ_BUILDING.depth / 2 - HQ_BUILDING.wallThickness;
const centerX = origin.x + HQ_BUILDING.localCenter.x;
const centerZ = origin.z + HQ_BUILDING.localCenter.z;

/** 본부 건물 내부의 절대 월드 좌표 경계 (x·z만 — 높이는 안전지역 판정에 안 씁니다) */
export const HQ_SAFE_ZONE_BOUNDS = {
  minX: centerX - halfInnerW,
  maxX: centerX + halfInnerW,
  minZ: centerZ - halfInnerD,
  maxZ: centerZ + halfInnerD,
};

/** 이 좌표가 PvP 금지 구역(본부 건물 내부) 안인지. */
export function isInSafeZone(x: number, z: number): boolean {
  return (
    x >= HQ_SAFE_ZONE_BOUNDS.minX &&
    x <= HQ_SAFE_ZONE_BOUNDS.maxX &&
    z >= HQ_SAFE_ZONE_BOUNDS.minZ &&
    z <= HQ_SAFE_ZONE_BOUNDS.maxZ
  );
}
