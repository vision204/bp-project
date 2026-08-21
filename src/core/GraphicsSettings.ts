// ---------------------------------------------------------------------------
// 그래픽 품질 프리셋.
//
// 접속할 때마다 "빠른 모드 / 그냥 모드"를 고르게 하고, 그 선택에 따라
// 렌더러·지형·바다·컬링 설정을 한꺼번에 바꿉니다.
//
// 프레임을 가장 많이 잡아먹는 것부터 끕니다:
//   1) 그림자 (섬 11개 + 몬스터 94마리에 전부 그림자가 들어감)
//   2) 안티앨리어싱 + 고DPI 렌더링 (픽셀 수가 최대 4배까지 차이)
//   3) 멀리 있는 섬/몬스터 그리기
//   4) 바다 파도 셰이더의 정점 수와 반짝임 계산
// ---------------------------------------------------------------------------

export type QualityId = "fast" | "normal" | "dev";

export interface QualitySettings {
  id: QualityId;
  label: string;
  /** 렌더러 생성 시점에만 반영되는 값이라, 모드를 고른 뒤에 렌더러를 만듭니다 */
  antialias: boolean;
  shadows: boolean;
  /** devicePixelRatio 상한 — 1이면 고해상도 화면에서도 1배로만 그림 */
  maxPixelRatio: number;
  /** 섬 소품(나무·바위) 개수 배율 */
  propDensity: number;
  /** 섬 원기둥의 분할 수 (낮을수록 각져 보이지만 가벼움) */
  islandSegments: number;
  /** 바다 격자 분할 수 */
  oceanSegments: number;
  /** 바다 반짝임 계산 여부 */
  oceanSparkle: boolean;
  /** 이 거리 밖의 몬스터·NPC는 그리지 않음 */
  visibleDistance: number;
  /** 이 거리 밖의 섬은 통째로 숨김 (null이면 항상 그림) */
  islandCullDistance: number | null;
  /** 그림자 맵 해상도 */
  shadowMapSize: number;
  /**
   * 개발자 모드인지 — 켜지면 하늘을 날아다니며 섬들을 둘러볼 수 있고,
   * 피해를 받지 않으며, P키로 섬 순간이동 패널을 엽니다.
   */
  devMode: boolean;
}

export const QUALITY_PRESETS: Record<QualityId, QualitySettings> = {
  fast: {
    id: "fast",
    label: "빠른 모드",
    antialias: false,
    shadows: false,
    maxPixelRatio: 1,
    propDensity: 0.45,
    islandSegments: 14,
    oceanSegments: 16,
    oceanSparkle: false,
    visibleDistance: 85,
    islandCullDistance: 420,
    shadowMapSize: 512,
    devMode: false,
  },
  normal: {
    id: "normal",
    label: "그냥 모드",
    antialias: true,
    shadows: true,
    maxPixelRatio: 2,
    propDensity: 1,
    islandSegments: 32,
    oceanSegments: 72,
    oceanSparkle: true,
    visibleDistance: 130,
    islandCullDistance: null,
    shadowMapSize: 2048,
    devMode: false,
  },
  // 개발자 모드: 날아다니며 섬을 확인하는 게 목적이라 시야를 크게 넓히고,
  // 대신 프레임을 잡아먹는 그림자·안티앨리어싱은 끕니다.
  dev: {
    id: "dev",
    label: "개발자 모드",
    antialias: false,
    shadows: false,
    maxPixelRatio: 1,
    propDensity: 1,
    islandSegments: 24,
    oceanSegments: 24,
    oceanSparkle: false,
    visibleDistance: 240,
    islandCullDistance: null,
    shadowMapSize: 512,
    devMode: true,
  },
};

export function qualityFor(id: QualityId): QualitySettings {
  return QUALITY_PRESETS[id] ?? QUALITY_PRESETS.normal;
}
