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

  /**
   * 맞은 대상(몬스터·PvP 플레이어 모두)을 이 시간(초) 동안 완전히 얼립니다 —
   * slowFactor(둔화)와 달리 이동 자체가 멈춥니다. PvP는 server/state.ts가
   * pvp_freeze 메시지로 대상 클라이언트에게 직접 알립니다.
   */
  freezeDurationSec?: number;

  /**
   * X키로 다시 누르면 켜짐/꺼짐이 토글되는 스킬. 켜져 있는 동안의 실제 동작은
   * 스킬 id로 분기해서 처리합니다(서리 발판=바다 위 얼음판, 뇌광 질주=번개 변신).
   * 끌 때는 마나·쿨다운을 소모하지 않습니다.
   */
  toggle?: boolean;

  /** (뇌광 질주 전용) 번개 변신 지속시간(초) */
  lightningFormDurationSec?: number;
  /** (뇌광 질주 전용) 변신 중 스쳐 지나가는 대상에게 주는 초당 피해 */
  lightningFormDps?: number;
  /** (뇌광 질주 전용) 변신 중 접촉 판정 반경(m) */
  lightningFormContactRadius?: number;

  /**
   * true면 shape 범위 안의 "가장 가까운 대상 하나"에게만 효과가 적용됩니다
   * (낙뢰처럼 조준 없이 근처 아무나를 저격하는 스킬용). 기본은 범위 안 전원.
   */
  autoTargetNearest?: boolean;

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

  // ── 얼음: 짧은 견제 + 진짜 "빙결"(완전 이동불가) + 바다를 얼리는 이동기 ──────
  ice_lance: [
    {
      id: "ice_z",
      name: "아이스 랜스",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2,
      manaCost: 9,
      damage: 20,
      shape: { kind: "line", range: 6, width: 1.8 },
      slowFactor: 0.5,
      slowDurationSec: 2,
      description: "얼음을 짧고 날카롭게 쏘아내는 견제기. 맞으면 둔화됩니다.",
    },
    {
      id: "ice_x",
      name: "서리 발판",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 4,
      manaCost: 14,
      damage: 0,
      shape: { kind: "radial", radius: 5 },
      toggle: true,
      slowFactor: 0.4,
      slowDurationSec: 1.5,
      description:
        "발밑 바다를 실시간으로 얼려 반경 안을 걸어서 건널 수 있게 합니다. X로 다시 누르면 끕니다.",
    },
    {
      id: "ice_c",
      name: "빙결 감옥",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 13,
      manaCost: 30,
      damage: 22,
      shape: { kind: "radial", radius: 6 },
      freezeDurationSec: 3,
      description: "얼음 감옥을 씌워 맞은 대상(플레이어·몬스터 모두)을 3초간 완전히 얼립니다.",
    },
    {
      id: "ice_v",
      name: "절대 영도",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 24,
      manaCost: 58,
      damage: 60,
      shape: { kind: "radial", radius: 12 },
      freezeDurationSec: 5,
      description: "일대의 온도를 절대영도까지 떨어뜨려, 범위 안 모두를 5초간 완전히 얼립니다.",
    },
  ],

  // ── 번개: 짧은 순간이동 돌진 + 번개 변신 + 저격형 낙뢰 + 거대 일격 ─────────
  thunder_strike: [
    {
      id: "thunder_z",
      name: "선더 스트라이크",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.4,
      manaCost: 7,
      damage: 16,
      shape: { kind: "line", range: 6, width: 2 },
      dashDistance: 6,
      description: "짧게 번개로 화해 앞으로 순간이동하며, 지나친 자리에 있던 대상에게 피해를 줍니다.",
    },
    {
      id: "thunder_x",
      name: "뇌광 질주",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 16,
      manaCost: 26,
      damage: 0,
      shape: { kind: "self" },
      toggle: true,
      lightningFormDurationSec: 5,
      lightningFormDps: 26,
      lightningFormContactRadius: 2.6,
      description:
        "5초간 번개 그 자체로 변신해, 스쳐 지나가는 모든 적·플레이어에게 지속 피해를 입힙니다. X로 껐다 켤 수 있습니다.",
    },
    {
      id: "thunder_c",
      name: "낙뢰",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 10,
      manaCost: 26,
      damage: 42,
      shape: { kind: "radial", radius: 16 },
      autoTargetNearest: true,
      description: "조준 없이, 근처에서 가장 가까운 적이나 플레이어에게 정확히 벼락을 내리꽂습니다.",
    },
    {
      id: "thunder_v",
      name: "천벌",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 22,
      manaCost: 56,
      damage: 130,
      shape: { kind: "line", range: 24, width: 3.2 },
      description: "하늘을 가르는 거대한 번개 한 줄기를 전방으로 발사합니다.",
    },
  ],

  // ── 어둠: 붙잡고 짓누르는 중력 + 흡혈 (짧은 빙결도 살짝 섞음) ───────────
  dark_wave: [
    {
      id: "dark_z",
      name: "섀도우 슬래시",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2.6,
      manaCost: 10,
      damage: 24,
      shape: { kind: "cone", range: 5, halfAngleDeg: 40 },
      slowFactor: 0.6,
      slowDurationSec: 1.2,
      description: "그림자를 실체화한 칼날로 베어, 잠시 발목을 붙잡습니다.",
    },
    {
      id: "dark_x",
      name: "섀도우 드레인",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 8,
      manaCost: 22,
      damage: 28,
      shape: { kind: "radial", radius: 5 },
      healPercentOfMaxHp: 0.08,
      slowFactor: 0.5,
      slowDurationSec: 2,
      description: "그림자 촉수로 생명력을 빨아들이며 대상을 붙잡아 둡니다. 최대 체력의 8%를 회복합니다.",
    },
    {
      id: "dark_c",
      name: "중력정",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 14,
      manaCost: 35,
      damage: 45,
      shape: { kind: "radial", radius: 7 },
      freezeDurationSec: 1.5,
      burnDps: 8,
      burnDurationSec: 3,
      description: "작은 어둠의 구멍을 만들어 짓눌러, 잠시 완전히 움직임을 멈추고 서서히 짓이겨집니다.",
    },
    {
      id: "dark_v",
      name: "황혼의 종언",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 26,
      manaCost: 65,
      damage: 110,
      shape: { kind: "radial", radius: 12 },
      healPercentOfMaxHp: 0.2,
      freezeDurationSec: 2,
      description: "모든 빛을 집어삼키는 어둠을 일으켜, 범위 안 전원을 잠시 얼려붙이고 생명력을 흡수합니다.",
    },
  ],

  // ── 고무: 늘어나는 팔로 기동 + 연타, 궁극기는 자기 강화 ────────────────
  rubber_barrage: [
    {
      id: "rubber_z",
      name: "고무 피스톨",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.8,
      manaCost: 8,
      damage: 18,
      shape: { kind: "line", range: 7, width: 1.6 },
      description: "팔을 고무처럼 늘려 직선으로 뻗는 강타.",
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
      description: "팔을 걸고 튕겨나가듯 전방으로 크게 돌진합니다.",
    },
    {
      id: "rubber_c",
      name: "고무 개틀링",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 9,
      manaCost: 26,
      damage: 42,
      shape: { kind: "cone", range: 6, halfAngleDeg: 55 },
      slowFactor: 0.4,
      slowDurationSec: 1.5,
      description: "수십 발의 주먹을 퍼부어 상대를 그 자리에 붙잡아 둡니다.",
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

  // ── 모래: 넓은 범위 + 출혈(지속 피해) 특화 ──────────────────────────────
  sand_storm: [
    {
      id: "sand_z",
      name: "모래 칼날",
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
      name: "사구검",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 6,
      manaCost: 18,
      damage: 26,
      shape: { kind: "line", range: 10, width: 2 },
      burnDps: 8,
      burnDurationSec: 3,
      description: "수분을 빼앗는 모래 칼날이 직선으로 관통하며 살갗을 태웁니다.",
    },
    {
      id: "sand_c",
      name: "사이클론",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 11,
      manaCost: 30,
      damage: 30,
      shape: { kind: "radial", radius: 8 },
      slowFactor: 0.5,
      slowDurationSec: 3,
      burnDps: 5,
      burnDurationSec: 3,
      description: "거대한 모래 회오리를 일으켜 시야와 발을 묶고 살갗을 벗겨냅니다.",
    },
    {
      id: "sand_v",
      name: "그랜드 사바스",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 23,
      manaCost: 58,
      damage: 95,
      shape: { kind: "radial", radius: 13 },
      burnDps: 14,
      burnDurationSec: 5,
      description: "사막 전체를 끌어모은 거대한 모래 칼날로 일대를 갈아버립니다.",
    },
  ],
};

export function skillsForFruit(fruitId: FruitAbilityId): SkillDef[] {
  // fruitId가 실제로는 무기 id인 채로 들어오는 경우가 있습니다(예: 렌더러가
  // "무기 스킬인지 열매 스킬인지" 확실치 않을 때 양쪽을 순서대로 시도).
  // FRUIT_SKILLS에 없는 키라도 undefined를 그대로 돌려주면 호출부에서
  // `[...][slot]`이 터지므로, 여기서 빈 배열로 안전하게 막아둡니다.
  return FRUIT_SKILLS[fruitId] ?? [];
}

export function allSkills(): SkillDef[] {
  return Object.values(FRUIT_SKILLS).flat();
}

export function isSlotUnlocked(slot: number, fruitLevel: number) {
  return fruitLevel >= SLOT_UNLOCK_LEVELS[slot];
}
