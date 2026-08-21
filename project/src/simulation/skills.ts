import type { FruitAbilityId } from "../core/GameState";

// ---------------------------------------------------------------------------
// 악마의 열매 스킬 카탈로그.
//
// 열매마다 4개씩(Z/X/C/V), 총 24개. 슬롯 순서는 항상 Z → X → C → V 이며
// 열매 레벨로 잠금이 풀립니다: Z=1, X=25, C=50, V=100.
//
// 스킬은 "판정 모양(shape) + 부가 효과" 조합으로 표현합니다. 이렇게 데이터로
// 정의해두면 새 열매를 추가할 때 이 파일에 항목만 늘리면 되고, 전투 로직은
// 건드릴 필요가 없습니다.
// ---------------------------------------------------------------------------

/** 스킬 판정 범위의 모양 */
export type SkillShape =
  /** 플레이어를 중심으로 한 원형 범위 */
  | { kind: "radial"; radius: number }
  /** 바라보는 방향으로 퍼지는 부채꼴 */
  | { kind: "cone"; range: number; halfAngleDeg: number }
  /** 바라보는 방향으로 뻗는 직선(관통) */
  | { kind: "line"; range: number; width: number }
  /** 적을 직접 때리지 않는 자기 강화형 */
  | { kind: "self" };

export interface SkillDef {
  id: string;
  name: string;
  /** 0=Z, 1=X, 2=C, 3=V */
  slot: number;
  /** 이 열매 레벨 이상이어야 사용 가능 */
  unlockFruitLevel: number;
  cooldownSec: number;
  manaCost: number;
  /** 기본 데미지 (0이면 순수 유틸리티) */
  damage: number;
  shape: SkillShape;

  /** 바라보는 방향으로 순간 돌진하는 거리(m) */
  dashDistance?: number;
  /** 맞은 적의 이동속도 배율 (0.3이면 30% 속도로 느려짐) */
  slowFactor?: number;
  slowDurationSec?: number;
  /** 초당 지속 피해 */
  burnDps?: number;
  burnDurationSec?: number;
  /** 자기 강화: 열매 데미지 배율과 지속시간 */
  selfBuffMultiplier?: number;
  selfBuffDurationSec?: number;
  /** 준 피해가 아니라 최대 체력 대비 비율로 회복 */
  healPercentOfMaxHp?: number;

  description: string;
}

export const SLOT_KEYS = ["Z", "X", "C", "V"] as const;
/** 슬롯별 해금에 필요한 열매 레벨 */
export const SLOT_UNLOCK_LEVELS = [1, 25, 50, 100] as const;

const FRUIT_SKILLS: Record<FruitAbilityId, SkillDef[]> = {
  // ── 마그마: 화상 지속 피해 특화 ─────────────────────────────────────────
  magma_fist: [
    {
      id: "magma_z",
      name: "마그마 피스트",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2.5,
      manaCost: 10,
      damage: 25,
      shape: { kind: "radial", radius: 3.5 },
      description: "주먹에 용암을 둘러 주변을 후려칩니다.",
    },
    {
      id: "magma_x",
      name: "화염 방사",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 6,
      manaCost: 22,
      damage: 32,
      shape: { kind: "cone", range: 7, halfAngleDeg: 35 },
      burnDps: 6,
      burnDurationSec: 4,
      description: "전방 부채꼴로 불길을 뿜어 화상을 입힙니다.",
    },
    {
      id: "magma_c",
      name: "용암 지대",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 12,
      manaCost: 35,
      damage: 34,
      shape: { kind: "radial", radius: 6 },
      burnDps: 10,
      burnDurationSec: 6,
      description: "발밑을 용암으로 바꿔 오래 타오르게 합니다.",
    },
    {
      id: "magma_v",
      name: "대분화",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 22,
      manaCost: 60,
      damage: 90,
      shape: { kind: "radial", radius: 11 },
      burnDps: 18,
      burnDurationSec: 6,
      description: "화산을 터뜨려 광범위를 불바다로 만듭니다.",
    },
  ],

  // ── 얼음: 둔화(속박) 특화 ──────────────────────────────────────────────
  ice_lance: [
    {
      id: "ice_z",
      name: "아이스 랜스",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2.5,
      manaCost: 10,
      damage: 20,
      shape: { kind: "line", range: 9, width: 2 },
      slowFactor: 0.5,
      slowDurationSec: 2,
      description: "얼음 창을 직선으로 던져 관통시키고 둔화시킵니다.",
    },
    {
      id: "ice_x",
      name: "서리 발판",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 7,
      manaCost: 20,
      damage: 24,
      shape: { kind: "radial", radius: 5 },
      slowFactor: 0.35,
      slowDurationSec: 4,
      description: "바닥을 얼려 주변 적의 발을 묶습니다.",
    },
    {
      id: "ice_c",
      name: "빙결 감옥",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 13,
      manaCost: 32,
      damage: 30,
      shape: { kind: "radial", radius: 6.5 },
      slowFactor: 0.15,
      slowDurationSec: 3.5,
      description: "얼음 기둥으로 가둬 거의 움직이지 못하게 합니다.",
    },
    {
      id: "ice_v",
      name: "절대 영도",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 24,
      manaCost: 60,
      damage: 80,
      shape: { kind: "radial", radius: 12 },
      slowFactor: 0.2,
      slowDurationSec: 6,
      description: "일대를 통째로 얼려붙입니다.",
    },
  ],

  // ── 번개: 짧은 쿨다운 + 돌진 기동 ──────────────────────────────────────
  thunder_strike: [
    {
      id: "thunder_z",
      name: "선더 스트라이크",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.2,
      manaCost: 6,
      damage: 15,
      shape: { kind: "radial", radius: 3.2 },
      description: "쿨다운이 매우 짧은 전격 타격.",
    },
    {
      id: "thunder_x",
      name: "뇌광 질주",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 5,
      manaCost: 16,
      damage: 22,
      shape: { kind: "line", range: 12, width: 2.5 },
      dashDistance: 12,
      description: "번개가 되어 전방으로 순간 이동하며 경로상의 적을 관통합니다.",
    },
    {
      id: "thunder_c",
      name: "낙뢰",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 10,
      manaCost: 28,
      damage: 38,
      shape: { kind: "radial", radius: 5.5 },
      slowFactor: 0.6,
      slowDurationSec: 2,
      description: "하늘에서 벼락을 내리쳐 감전시킵니다.",
    },
    {
      id: "thunder_v",
      name: "천벌",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 20,
      manaCost: 55,
      damage: 85,
      shape: { kind: "radial", radius: 10 },
      slowFactor: 0.4,
      slowDurationSec: 4,
      description: "수십 발의 벼락을 동시에 떨어뜨립니다.",
    },
  ],

  // ── 어둠: 고위력 + 흡혈 ────────────────────────────────────────────────
  dark_wave: [
    {
      id: "dark_z",
      name: "다크 슬래시",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2.6,
      manaCost: 10,
      damage: 24,
      shape: { kind: "cone", range: 5, halfAngleDeg: 40 },
      description: "어둠의 참격을 부채꼴로 날립니다.",
    },
    {
      id: "dark_x",
      name: "암흑 흡수",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 8,
      manaCost: 22,
      damage: 28,
      shape: { kind: "radial", radius: 5 },
      healPercentOfMaxHp: 0.08,
      description: "주변의 생명력을 빨아들여 최대 체력의 8%를 회복합니다.",
    },
    {
      id: "dark_c",
      name: "블랙홀",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 14,
      manaCost: 35,
      damage: 45,
      shape: { kind: "radial", radius: 7 },
      slowFactor: 0.25,
      slowDurationSec: 3,
      description: "어둠의 구멍이 적을 붙잡아 짓누릅니다.",
    },
    {
      id: "dark_v",
      name: "영원한 어둠",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 26,
      manaCost: 65,
      damage: 110,
      shape: { kind: "radial", radius: 12 },
      healPercentOfMaxHp: 0.2,
      description: "모든 것을 삼키고 최대 체력의 20%를 회복합니다.",
    },
  ],

  // ── 고무: 기동 + 연타, 궁극기는 자기 강화 ──────────────────────────────
  rubber_barrage: [
    {
      id: "rubber_z",
      name: "고무 권총",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.8,
      manaCost: 8,
      damage: 18,
      shape: { kind: "line", range: 7, width: 1.6 },
      description: "팔을 늘려 직선으로 뻗는 펀치.",
    },
    {
      id: "rubber_x",
      name: "고무 로켓",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 5,
      manaCost: 14,
      damage: 20,
      shape: { kind: "line", range: 14, width: 2 },
      dashDistance: 14,
      description: "팔을 걸고 튕겨나가 전방으로 크게 돌진합니다.",
    },
    {
      id: "rubber_c",
      name: "개틀링",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 9,
      manaCost: 26,
      damage: 42,
      shape: { kind: "cone", range: 6, halfAngleDeg: 55 },
      description: "수십 발의 주먹을 한꺼번에 퍼붓습니다.",
    },
    {
      id: "rubber_v",
      name: "기어 세컨드",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 30,
      manaCost: 45,
      damage: 0,
      shape: { kind: "self" },
      selfBuffMultiplier: 1.8,
      selfBuffDurationSec: 12,
      description: "혈류를 가속해 12초간 열매 데미지가 1.8배가 됩니다.",
    },
  ],

  // ── 모래: 넓은 범위 + 출혈 ─────────────────────────────────────────────
  sand_storm: [
    {
      id: "sand_z",
      name: "모래 절단",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2.2,
      manaCost: 9,
      damage: 18,
      shape: { kind: "cone", range: 6, halfAngleDeg: 45 },
      description: "모래 칼날을 부채꼴로 흩뿌립니다.",
    },
    {
      id: "sand_x",
      name: "사막의 검",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 6,
      manaCost: 18,
      damage: 26,
      shape: { kind: "line", range: 10, width: 2 },
      burnDps: 6,
      burnDurationSec: 3,
      description: "수분을 빼앗는 모래 칼날이 직선으로 관통합니다.",
    },
    {
      id: "sand_c",
      name: "모래 폭풍",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 11,
      manaCost: 30,
      damage: 30,
      shape: { kind: "radial", radius: 8 },
      slowFactor: 0.5,
      slowDurationSec: 3,
      description: "회오리를 일으켜 시야와 발을 묶습니다.",
    },
    {
      id: "sand_v",
      name: "사막의 대검",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 23,
      manaCost: 58,
      damage: 95,
      shape: { kind: "radial", radius: 13 },
      burnDps: 12,
      burnDurationSec: 5,
      description: "거대한 모래 칼날로 일대를 갈아버립니다.",
    },
  ],
};

export function skillsForFruit(fruitId: FruitAbilityId): SkillDef[] {
  return FRUIT_SKILLS[fruitId];
}

export function allSkills(): SkillDef[] {
  return Object.values(FRUIT_SKILLS).flat();
}

export function isSlotUnlocked(slot: number, fruitLevel: number) {
  return fruitLevel >= SLOT_UNLOCK_LEVELS[slot];
}
