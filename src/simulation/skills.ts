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

  /**
   * true면 이 스킬 키(Z 등)는 "누르는 순간 즉발"이 아니라 "누르고 있는 동안
   * 차지, 떼면 발동"으로 동작합니다(고무 피스톨). 누르고 있던 시간(최대
   * maxChargeSec)에 비례해 사거리가 chargeMinRangeMultiplier→
   * chargeMaxRangeMultiplier 사이로 늘어납니다. 마나·쿨다운은 차지를
   * 시작할 때가 아니라 실제로 발동되는(손을 떼는) 순간에 소모됩니다.
   */
  chargeable?: boolean;
  /** 이 시간(초) 이상 누르고 있으면 완전히 다 찬 것으로 치고 자동 발동됩니다. */
  maxChargeSec?: number;
  /** 차지 0%일 때(그냥 탭) 사거리 배율 — 보통 1(기본 사거리 그대로). */
  chargeMinRangeMultiplier?: number;
  /** 차지 100%(최대로 눌렀을 때) 사거리 배율. */
  chargeMaxRangeMultiplier?: number;
  /**
   * 차지 100%일 때 데미지 배율(0%일 땐 항상 1배, 그 사이는 선형 보간).
   * 미지정 시 1(데미지는 안 늘어나고 사거리만 늘어남).
   */
  chargeMaxDamageMultiplier?: number;

  /**
   * true면 이 스킬의 판정 원점이 플레이어 자신이 아니라 "조준 방향으로 조금
   * 앞선 지점"이 됩니다(반경 × 0.6만큼 앞으로). 낙뢰·빙결 감옥·절대 영도·
   * 중력정처럼 "내 발밑이 아니라 내가 보는 곳을 때리는" 스킬 전용 —
   * 사용자 요청으로 판정과 이펙트 위치를 둘 다 조준 지점 기준으로 옮겼습니다.
   * (CombatSystem.ts의 isInShape이 실제 원점 계산을 합니다)
   */
  originAtAim?: boolean;

  /**
   * true면 이 스킬의 판정 원점(및 이펙트 위치)이 "마우스 커서가 가리키는 지형
   * 위 3D 지점"이 됩니다 — originAtAim(조준 방향으로 살짝 앞선 지점)보다 더
   * 정확한, 실제 마우스 위치 타게팅입니다. line/cone처럼 방향이 있는 스킬은
   * 그 지점을 "바라보는 방향"으로 재조준됩니다. 마우스 지점이 없거나(레이캐스트
   * 실패) MAX_MOUSE_TARGET_DISTANCE보다 멀면 CombatSystem.ts의 stepCombat이
   * 스킬 발동 자체를 막고 skill_target_too_far 이벤트를 띄웁니다.
   * (ShapeMath.ts의 skillOrigin이 실제 원점 계산을 합니다)
   */
  originAtMouse?: boolean;

  /**
   * (용암 지대·대분화 전용) true면 마우스 지점이 없거나 MAX_MOUSE_TARGET_DISTANCE
   * 보다 멀 때 스킬 발동 자체를 막습니다(사용자 요청: "너무 마우스가 물리적으로
   * 먼 거리에 있으면 스킬을 사용하지 못하게"). originAtMouse가 있는 다른 스킬들
   * (낙뢰·천벌·중력정 등)은 마우스 지점이 없으면 조용히 originAtAim/발밑 기준으로
   * 폴백할 뿐 발동을 막지는 않습니다 — 사용자가 명시적으로 이 제약을 요청한
   * 건 용암 지대·대분화 두 개뿐이었습니다.
   */
  requireMouseInRange?: boolean;

  /**
   * (사막의 대검 전용) 장착돼 있는 동안(toggle — sandBladeActive) 손에 거대한
   * 대검이 들려 있는 것처럼, 기본 공격(좌클릭)이 무기 없이도 "무기를 든 것처럼"
   * 이 배율만큼 강해집니다. totalMeleeDamage(CombatSystem.ts)가 실제 적용 —
   * 무장색·검 스텟과도 실제 무기처럼 함께 곱해집니다.
   */
  meleeFormMultiplier?: number;

  /**
   * (빛의 비행 전용) 순간 돌진 직후 잠깐 손에 든 변신 모습(light_f.glb)을
   * 보여줄 시간(초) — 판정과 무관한 순수 시각 타이머. player.lightFormRemainingSec가
   * 이 값으로 세팅됩니다(CombatSystem.ts의 stepFruitSpecialAbility).
   */
  transformDurationSec?: number;

  /**
   * (용의 비행 전용) 비행 중 매초 소모되는 마나. 활성화 자체의 manaCost와는
   * 별개로, 날고 있는 동안 계속 깎이다가 0이 되면 자동으로 착지합니다.
   */
  flightManaDrainPerSec?: number;

  /**
   * (용으로 변신 전용) 변신 중 열매 데미지에 곱해지는 추가 배율(0.2 = +20%).
   * 사막의 대검(sandBladeActive)과 같은 "누를 때까지 무제한 지속" 토글이며,
   * 켜져 있는 동안은 player.fruitBuffMultiplier에 1+이 값을 직접 세팅합니다 —
   * 기어 세컨드(rubber_v)가 쓰는 것과 같은 필드지만, 그쪽은 selfBuffDurationSec
   * 타이머로 자동 만료되는 반면 이건 시간제한 없이 V로 다시 끌 때까지
   * 유지됩니다(CombatSystem.ts의 isToggleActive/setToggleActive 참고).
   */
  dragonFormDamageMultiplierBonus?: number;

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
      chargeable: true,
      maxChargeSec: 1,
      chargeMaxRangeMultiplier: 1.5,
      chargeMaxDamageMultiplier: 1.4,
      description: "Z를 꾹 눌러 용암을 끌어모았다가 놓으면, 모은 만큼 더 넓고 세게 후려칩니다.",
    },
    {
      id: "magma_x",
      name: "화염 방사",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 6,
      manaCost: 22,
      damage: 32,
      // 사용자 요청: 사정거리를 더 늘려달라고 해서 7→12로 확장했습니다.
      shape: { kind: "cone", range: 12, halfAngleDeg: 35 },
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      burnDps: 6,
      burnDurationSec: 4,
      chargeable: true,
      maxChargeSec: 1.1,
      chargeMaxRangeMultiplier: 1.7,
      chargeMaxDamageMultiplier: 1.35,
      description: "누른 시간만큼 불길을 더 멀리, 더 뜨겁게 뿜어 화상을 입힙니다.",
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
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      requireMouseInRange: true, // 사용자 요청: 마우스가 너무 멀면 사용 불가
      burnDps: 10,
      burnDurationSec: 6,
      chargeable: true,
      maxChargeSec: 1.3,
      chargeMaxRangeMultiplier: 1.4,
      chargeMaxDamageMultiplier: 1.4,
      description: "마우스가 가리키는 지점을 용암으로 바꿔 오래 타오르게 합니다. 오래 모을수록 지대가 넓어집니다.",
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
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      requireMouseInRange: true, // 사용자 요청: 마우스가 너무 멀면 사용 불가
      burnDps: 18,
      burnDurationSec: 6,
      chargeable: true,
      maxChargeSec: 1.8,
      chargeMaxRangeMultiplier: 1.3,
      chargeMaxDamageMultiplier: 1.3,
      description: "마우스가 가리키는 지점에서 화산을 터뜨려 광범위를 불바다로 만듭니다. 오래 모을수록 더 크게 터집니다.",
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
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      slowFactor: 0.5,
      slowDurationSec: 2,
      chargeable: true,
      maxChargeSec: 1,
      chargeMaxRangeMultiplier: 1.8,
      chargeMaxDamageMultiplier: 1.4,
      description: "Z를 꾹 눌러 냉기를 모았다가 놓으면, 더 멀리 뻗는 날카로운 얼음창. 맞으면 둔화됩니다.",
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
      originAtAim: true, // 발밑이 아니라 조준한 곳에 감옥이 생김 (마우스 정보 없을 때 폴백)
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      freezeDurationSec: 3,
      chargeable: true,
      maxChargeSec: 1.3,
      chargeMaxRangeMultiplier: 1.4,
      chargeMaxDamageMultiplier: 1.35,
      description: "얼음 감옥을 씌워 맞은 대상(플레이어·몬스터 모두)을 3초간 완전히 얼립니다. 오래 모을수록 범위가 넓어집니다.",
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
      originAtAim: true, // 발밑이 아니라 조준한 곳을 중심으로 퍼짐 (마우스 정보 없을 때 폴백)
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      freezeDurationSec: 5,
      chargeable: true,
      maxChargeSec: 1.8,
      chargeMaxRangeMultiplier: 1.3,
      chargeMaxDamageMultiplier: 1.3,
      description: "일대의 온도를 절대영도까지 떨어뜨려, 범위 안 모두를 5초간 완전히 얼립니다. 오래 모을수록 더 넓게 퍼집니다.",
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
      // 사용자 요청: "마우스 위치로 이동하는 게 아니라 마우스 위치에 번개가
      // 치게" — 돌진(dashDistance)을 완전히 없애고, 낙뢰(thunder_c)처럼
      // 제자리에서 마우스가 가리키는 지점에 번개를 내리꽂는 radial 스킬로
      // 바꿨습니다. 플레이어는 더 이상 이동하지 않습니다.
      shape: { kind: "radial", radius: 4 },
      originAtMouse: true,
      originAtAim: true, // 마우스 지점을 못 구했을 때(레이캐스트 실패) 조준 방향 기준으로 폴백
      chargeable: true,
      maxChargeSec: 1,
      chargeMaxRangeMultiplier: 1.8,
      chargeMaxDamageMultiplier: 1.4,
      description: "Z를 꾹 눌러 전격을 모았다가 놓으면, 마우스가 가리키는 지점에 더 크고 강한 번개를 내리꽂습니다.",
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
      originAtAim: true, // 발밑이 아니라 조준한 곳에 번개가 떨어짐 (마우스 정보 없을 때 폴백)
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      autoTargetNearest: true,
      chargeable: true,
      maxChargeSec: 1.3,
      chargeMaxRangeMultiplier: 1.3,
      chargeMaxDamageMultiplier: 1.4,
      description: "조준 없이, 근처에서 가장 가까운 적이나 플레이어에게 정확히 벼락을 내리꽂습니다. 오래 모을수록 더 세게 꽂힙니다.",
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
      originAtMouse: true, // 사용자 요청: 마우스 위치로 재조준되어 그 방향으로 발사
      chargeable: true,
      maxChargeSec: 1.8,
      chargeMaxRangeMultiplier: 1.2,
      chargeMaxDamageMultiplier: 1.3,
      description: "하늘을 가르는 거대한 번개 한 줄기를 전방으로 발사합니다. 오래 모을수록 더 길고 강해집니다.",
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
      // 사용자 요청: 사정거리를 더 늘려달라고 해서 5→9로 확장했습니다.
      shape: { kind: "cone", range: 9, halfAngleDeg: 40 },
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      slowFactor: 0.6,
      slowDurationSec: 1.2,
      chargeable: true,
      maxChargeSec: 1,
      chargeMaxRangeMultiplier: 1.8,
      chargeMaxDamageMultiplier: 1.4,
      description: "Z를 꾹 눌러 그림자를 모았다가 놓으면, 더 멀리 베며 잠시 발목을 붙잡습니다.",
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
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      healPercentOfMaxHp: 0.08,
      slowFactor: 0.5,
      slowDurationSec: 2,
      chargeable: true,
      maxChargeSec: 1.1,
      chargeMaxRangeMultiplier: 1.5,
      chargeMaxDamageMultiplier: 1.35,
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
      originAtAim: true, // 발밑이 아니라 조준한 곳에 중력정이 생김 (마우스 정보 없을 때 폴백)
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      freezeDurationSec: 1.5,
      burnDps: 8,
      burnDurationSec: 3,
      chargeable: true,
      maxChargeSec: 1.3,
      chargeMaxRangeMultiplier: 1.4,
      chargeMaxDamageMultiplier: 1.4,
      description: "작은 어둠의 구멍을 만들어 짓눌러, 잠시 완전히 움직임을 멈추고 서서히 짓이겨집니다. 오래 모을수록 더 크게 벌어집니다.",
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
      originAtMouse: true, // 사용자 요청: 마우스 위치에서 발생
      healPercentOfMaxHp: 0.2,
      freezeDurationSec: 2,
      chargeable: true,
      maxChargeSec: 1.8,
      chargeMaxRangeMultiplier: 1.3,
      chargeMaxDamageMultiplier: 1.3,
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
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      // Z를 꾹 눌러 팔을 뒤로 당겼다가(차지) 놓으면 튕겨나가듯 발동 — 오래
      // 누를수록 최대 1.4초까지 차서 사거리가 기본의 최대 2.2배(약 15.4m)로
      // 늘어납니다.
      chargeable: true,
      maxChargeSec: 1.4,
      chargeMinRangeMultiplier: 1,
      chargeMaxRangeMultiplier: 2.2,
      chargeMaxDamageMultiplier: 1.4,
      description: "Z를 꾹 눌러 팔을 당겼다가 놓으면, 누른 시간만큼 더 멀리·더 세게 뻗는 강타.",
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
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사(돌진 방향도 함께 재조준)
      dashDistance: 14,
      description: "팔을 걸고 튕겨나가듯 마우스가 가리키는 방향으로 크게 돌진합니다.",
    },
    {
      id: "rubber_c",
      name: "고무 개틀링",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 9,
      manaCost: 26,
      damage: 42,
      shape: { kind: "cone", range: 8, halfAngleDeg: 70 },
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      slowFactor: 0.4,
      slowDurationSec: 1.5,
      description: "수십 발의 주먹을 넓게 퍼부어 상대를 그 자리에 붙잡아 둡니다.",
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
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      chargeable: true,
      maxChargeSec: 1,
      chargeMaxRangeMultiplier: 1.8,
      chargeMaxDamageMultiplier: 1.4,
      description: "Z를 꾹 눌러 모래를 모았다가 놓으면, 더 멀리 뻗는 모래 칼날을 흩뿌립니다.",
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
      originAtMouse: true, // 사용자 요청: 앞으로 나가는 스킬도 마우스 방향으로 발사
      burnDps: 8,
      burnDurationSec: 3,
      chargeable: true,
      maxChargeSec: 1.1,
      chargeMaxRangeMultiplier: 1.6,
      chargeMaxDamageMultiplier: 1.35,
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
      chargeable: true,
      maxChargeSec: 1.3,
      chargeMaxRangeMultiplier: 1.4,
      chargeMaxDamageMultiplier: 1.4,
      description: "거대한 모래 회오리를 일으켜 시야와 발을 묶고 살갗을 벗겨냅니다. 오래 모을수록 회오리가 커집니다.",
    },
    {
      id: "sand_v",
      name: "사막의 대검",
      slot: 3,
      unlockFruitLevel: 100,
      // 사용자 추가 요청: 쿨다운 없이 그냥 V로 장착/해제하는 토글로 바꿨습니다
      // (서리 발판·뇌광 질주와 같은 toggle 패턴 — CombatSystem.ts의
      // isToggleActive/setToggleActive가 sandBladeActive를 켜고 끕니다).
      // 끌 때는 마나도 들지 않고, 켤 때만 manaCost가 듭니다.
      cooldownSec: 0,
      toggle: true,
      manaCost: 58,
      damage: 95,
      shape: { kind: "radial", radius: 13 },
      burnDps: 14,
      burnDurationSec: 5,
      chargeable: true,
      maxChargeSec: 1.8,
      chargeMaxRangeMultiplier: 1.3,
      chargeMaxDamageMultiplier: 1.3,
      // 사용자 요청: 모래모래 열매만의 고유 검 — V를 누르면 손에 사막의 대검이
      // 소환되고(그 순간 일대를 갈아버리는 건 그대로), 장착돼 있는 동안은 그
      // 대검으로 기본 공격을 하는 것처럼 요루(2.6배)보다 살짝 낮은 배율로
      // 근접 데미지가 강해집니다 — YORU_DAMAGE_MULTIPLIER보다 낮게 잡았습니다.
      // (다시 V를 누르기 전까지 무제한 지속 — meleeFormDurationSec은 더 이상
      // 쓰지 않습니다.)
      meleeFormMultiplier: 2.4,
      description:
        "사막의 정수를 응축해 손에 거대한 사막의 대검을 소환합니다. 소환과 동시에 일대를 갈아버리고, 장착돼 있는 동안은 그 대검으로 기본 공격이 요루에 살짝 못 미치는 위력을 냅니다. 쿨다운 없이 V를 다시 누르면 언제든 손에서 내려놓을 수 있습니다. 오래 모을수록 소환 일격이 더 넓게 갈아버립니다.",
    },
  ],

  // ── 빛: 빠른 직선 견제 + 하늘에서 쏟아지는 광역 마무리 ─────────────────────
  light_light: [
    {
      id: "light_z",
      name: "빛의 탄환",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.3,
      manaCost: 7,
      damage: 17,
      // 사용자 요청: 사정거리를 두 배로 늘려달라고 해서 12→24로 확장했습니다.
      shape: { kind: "line", range: 24, width: 1.4 },
      originAtMouse: true,
      description: "빛을 압축해 쏘아내는 빠른 탄환. 짧은 쿨다운으로 자주 견제할 수 있습니다.",
    },
    {
      id: "light_x",
      name: "빛의 검",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 3.5,
      manaCost: 15,
      damage: 26,
      // 사용자 요청: 사정거리를 두 배로 늘려달라고 해서 9→18로 확장했습니다.
      shape: { kind: "line", range: 18, width: 1.8 },
      originAtMouse: true,
      description: "빛으로 벼려낸 검을 던져 전방을 꿰뚫습니다.",
    },
    {
      id: "light_c",
      name: "빛의 포격",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 9,
      manaCost: 27,
      damage: 44,
      shape: { kind: "radial", radius: 5 },
      originAtMouse: true,
      originAtAim: true,
      description: "마우스가 가리키는 지점으로 하늘 높이 빛의 포격이 쏟아져 내립니다.",
    },
    {
      id: "light_v",
      name: "광속 일격",
      slot: 3,
      unlockFruitLevel: 75,
      cooldownSec: 16,
      manaCost: 34,
      damage: 62,
      shape: { kind: "radial", radius: 6 },
      originAtMouse: true,
      originAtAim: true,
      description: "마우스가 가리키는 지점에 빛의 속도로 내리꽂히는 결정타. 오래 모으지 않아도 묵직하게 터집니다.",
    },
  ],

  // ── 용: 넓은 브레스 공격 + 지속 비행 기동 ──────────────────────────────
  dragon_dragon: [
    {
      id: "dragon_z",
      name: "용의 발톱",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.5,
      manaCost: 8,
      damage: 18,
      // 사용자 요청: 사정거리를 두 배로 늘려달라고 해서 8→16으로 확장했습니다.
      shape: { kind: "line", range: 16, width: 1.6 },
      originAtMouse: true,
      description: "용의 발톱으로 전방을 할퀴어 베어냅니다.",
    },
    {
      id: "dragon_x",
      name: "용의 포효",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 6,
      manaCost: 20,
      damage: 30,
      // 사용자 요청: 사정거리를 두 배로 늘려달라고 해서 10→20으로 확장했습니다
      // (halfAngleDeg는 요청 범위 밖이라 그대로 뒀습니다).
      shape: { kind: "cone", range: 20, halfAngleDeg: 35 },
      originAtMouse: true,
      description: "용의 포효로 충격파를 일으켜 넓은 전방을 밀어붙입니다.",
    },
    {
      id: "dragon_c",
      name: "용의 화염",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 9,
      manaCost: 28,
      damage: 46,
      // 사용자 요청: 사정거리를 두 배로 늘려달라고 해서 11→22로 확장했습니다
      // (halfAngleDeg는 요청 범위 밖이라 그대로 뒀습니다).
      shape: { kind: "cone", range: 22, halfAngleDeg: 20 },
      originAtMouse: true,
      description: "용의 브레스로 좁고 강한 화염을 길게 내뿜습니다.",
    },
    {
      id: "dragon_v",
      name: "용으로 변신",
      slot: 3,
      // light_v와 같은 예외적 조기 해금(다른 열매 슬롯3은 100) — 사용자 확인
      // 요청("V를 지금 정식 구현")에 따라 light_v와 같은 수준으로 맞췄습니다.
      unlockFruitLevel: 75,
      // 사막의 대검(sand_v)과 같은 패턴 — 쿨다운 없이 V로 장착/해제하는
      // 무제한 지속 토글입니다. 끌 때는 마나도 쿨다운도 소모하지 않고,
      // 켤 때만 manaCost가 듭니다(CombatSystem.ts의 setToggleActive 참고).
      cooldownSec: 0,
      toggle: true,
      manaCost: 30,
      // 직접 데미지를 주는 스킬이 아니라 순수 자기 강화형 변신입니다(사막의
      // 대검처럼 damage:0 + shape:self — thunder_x도 같은 패턴).
      damage: 0,
      shape: { kind: "self" },
      // 사용자 요청("전 스킬 딜이 3배는 더 강력해지게")에 따라 0.2(+20%)에서
      // 2.0(총 3배)으로 상향 — CombatSystem.ts가 이 값을 유일한 출처로 삼아
      // fruitBuffMultiplier = 1 + dragonFormDamageMultiplierBonus로 적용합니다.
      dragonFormDamageMultiplierBonus: 2,
      description:
        "용의 본모습으로 변신해, 몸집이 5배 커지고 하늘을 자유로이 날아다닐 수 있습니다. 변신해 있는 동안 열매 데미지가 3배 강해집니다. 쿨다운 없이 V를 다시 누르면 언제든 원래 모습으로 돌아올 수 있습니다.",
    },
  ],
};

// ---------------------------------------------------------------------------
// F 전용 특수 능력 — 빛빛(빛의 비행)·용용(용의 비행).
//
// 사용자 요청으로 이 두 열매에만 존재하는 예외이며, **일반 Z/X/C/V 4슬롯
// 시스템에는 절대 속하지 않습니다** — FRUIT_SKILLS 배열에 넣지 않고 여기서
// 독립적으로 export합니다. slot: -1은 "0~3 슬롯 시스템 밖"이라는 표시일 뿐,
// 실제로 어디서도 인덱스로 쓰이지 않습니다. CombatSystem.ts의
// stepFruitSpecialAbility가 이 SkillDef를 유일한 출처로 삼아 쿨다운·마나·
// 돌진거리 등을 읽습니다(뇌광 질주가 LIGHTNING_FORM_SKILL을 참조하는 것과
// 같은 패턴).
// ---------------------------------------------------------------------------

export const LIGHT_FLIGHT_SKILL: SkillDef = {
  id: "light_f",
  name: "빛의 비행",
  slot: -1,
  unlockFruitLevel: 40,
  cooldownSec: 12,
  manaCost: 28,
  damage: 0,
  // shape는 실제 판정에는 쓰이지 않습니다(순수 기동기, damage: 0) — originAtMouse
  // 방향 재조준 계산(skillOrigin)에 "line"이 필요해서 형태만 갖춰뒀습니다.
  shape: { kind: "line", range: 1, width: 1 },
  originAtMouse: true,
  // 방향은 선택할 수 없고, F를 처음 누른 그 순간의 조준 방향으로 딱 한 번만
  // 정해집니다(사용자 요청) — 기존 dashDistance/pendingDash 메커니즘을 그대로
  // 재사용하되 다른 대쉬들보다 훨씬 긴 거리를 씁니다.
  dashDistance: 50,
  transformDurationSec: 0.5,
  description: "F를 누른 순간 조준한 방향으로 빛으로 변해 아주 빠르게 돌진합니다. 날아가는 동안은 방향을 바꿀 수 없습니다.",
};

export const DRAGON_FLIGHT_SKILL: SkillDef = {
  id: "dragon_f",
  name: "용의 비행",
  slot: -1,
  unlockFruitLevel: 40,
  cooldownSec: 20,
  manaCost: 15,
  damage: 0,
  shape: { kind: "self" },
  // 비행 중 매초 추가로 소모되는 마나 — 0이 되면 자동 착지합니다.
  flightManaDrainPerSec: 8,
  description:
    "F를 누르면 용으로 변해 하늘로 날아오릅니다. 나는 동안은 멈추거나 제자리에 뜰 수 없고 방향만 조종할 수 있으며, F를 다시 누르면 착지합니다.",
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

/**
 * 차지 스킬(고무 피스톨 등)이 눌린 비율(chargeFrac, 0~1)만큼 사거리·돌진거리·
 * 데미지가 늘어난 스킬 사본을 돌려줍니다. CombatSystem(실제 판정)과
 * SceneRenderer(이펙트 모양)가 똑같은 이 함수를 써서, "보이는 범위 = 맞는
 * 범위 = 실제로 들어가는 데미지"가 항상 일치하게 합니다.
 * chargeable이 아니면 원본을 그대로 돌려줍니다(불필요한 복사 방지).
 */
export function withCharge(skill: SkillDef, chargeFrac: number): SkillDef {
  if (!skill.chargeable) return skill;
  const clamped = Math.max(0, Math.min(1, chargeFrac));
  const rangeMin = skill.chargeMinRangeMultiplier ?? 1;
  const rangeMax = skill.chargeMaxRangeMultiplier ?? 1;
  const rangeMult = rangeMin + (rangeMax - rangeMin) * clamped;
  const dmgMult = 1 + ((skill.chargeMaxDamageMultiplier ?? 1) - 1) * clamped;

  let next: SkillDef = skill;
  if (rangeMult !== 1) {
    const shape = skill.shape;
    if (shape.kind === "line" || shape.kind === "cone") {
      next = { ...next, shape: { ...shape, range: shape.range * rangeMult } };
    } else if (shape.kind === "radial") {
      next = { ...next, shape: { ...shape, radius: shape.radius * rangeMult } };
    }
    // 돌진형 스킬(고무 로켓·번개 순간이동 등)은 사거리와 함께 돌진 거리도 늘어나야
    // "더 멀리 늘어나 튕겨나간다"는 느낌이 그대로 이어집니다.
    if (skill.dashDistance) {
      next = { ...next, dashDistance: skill.dashDistance * rangeMult };
    }
  }
  if (dmgMult !== 1) {
    next = { ...next, damage: skill.damage * dmgMult };
  }
  return next;
}
