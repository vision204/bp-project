import type { ItemId, PlayerState } from "../core/GameState";

// ---------------------------------------------------------------------------
// 무기(검) 시스템.
//
// 로블록스식 2단 장착입니다.
//   1) 인벤토리에서 클릭 → 하단 중앙 단축바에 올림 ("1차 장착")
//   2) 숫자키(1~3)를 누름 → 실제로 손에 뽑아 듦 / 다시 넣음
// ---------------------------------------------------------------------------

export interface WeaponDef {
  id: ItemId;
  name: string;
  icon: string;
  /** 도검류(sword)인지 새총 등 원거리(gun)인지 — 스텟 배율(검/총)이 갈립니다 */
  weaponType: "sword" | "gun";
  /** 근접 공격 데미지 배율 */
  damageMultiplier: number;
  /** 근접 사거리 추가치(m) — 큰 검일수록 멀리 닿습니다. 원거리 무기는 rangedAttack을 대신 씁니다 */
  bonusRange: number;
  /**
   * 근접 공격 쿨다운 배율 (1 = 그대로, 0.7 = 30% 빨라짐).
   * 큰 검은 한 방이 무겁고 느리게, 여러 자루는 가볍고 빠르게 만들기 위한 값입니다.
   */
  attackSpeedMultiplier: number;
  price: number;
  description: string;
  /** 이 무기를 살 수 있는 섬 id — 정해져 있으면 화면 상점에서 그 섬에 있을 때만 구매 버튼이 열립니다. */
  islandLock?: string;
  /**
   * 설정되어 있으면 좌클릭 공격이 원형 근접 판정 대신, 조준 방향(카메라 기준)으로
   * 길게 뻗는 직선 판정을 씁니다 — "마우스가 가리키는 방향으로 쏘는" 원거리 무기용.
   */
  rangedAttack?: { range: number; width: number };
}

export const WEAPONS: Partial<Record<ItemId, WeaponDef>> = {
  sword_yoru: {
    id: "sword_yoru",
    name: "요루 (흑도)",
    icon: "🗡️",
    weaponType: "sword",
    // 사용자 요청: 세 자루 중 가장 강하게 — 요루(1위) > 엔마(2위) > 삼도류(3위, 가장 약함).
    damageMultiplier: 2.6,
    bonusRange: 1.6,
    attackSpeedMultiplier: 1,
    price: 800,
    description: "세계 최강의 대검. 칠흑빛 칼날이 근접 공격력을 2.6배로 올리고 사거리도 늘려줍니다.",
  },
  // 얼음 섬(Lv.125)의 설인에게서만 삽니다.
  // 요루가 "느리고 묵직한 한 방"이라면, 삼도류는 "짧지만 빠른 연타"입니다.
  sword_santoryu: {
    id: "sword_santoryu",
    name: "삼도류",
    icon: "⚔️",
    weaponType: "sword",
    // 사용자 요청: 세 검 중 가장 약하게. 한 방 배율은 요루(2.6)·엔마(2.3)보다
    // 낮지만, 공격 속도가 35% 빠른(attackSpeedMultiplier 0.65) 정체성은 그대로
    // 남겨둬서 "가장 약하지만 그나마 빠르게 연타"하는 포지션을 유지합니다.
    damageMultiplier: 2.15,
    bonusRange: 1.2,
    attackSpeedMultiplier: 0.65, // 공격 속도 35% 빠름
    price: 2500,
    description:
      "칼 세 자루를 양손과 입에 무는 검술. 세 검 중 한 방 위력은 가장 약하지만, 사거리는 짧은 대신 공격이 훨씬 빠릅니다.",
  },
  // 화산 섬(Lv.200) 전용 — 요루보다 얇고 훨씬 긴 붉은 칼날. 가볍게 만들어서
  // 공격 속도는 요루보다 살짝 빠르지만, 배율은 그보다 낮게 잡아 요루의
  // "한 방" 포지션을 뺏지 않게 균형을 맞췄습니다.
  sword_enma: {
    id: "sword_enma",
    name: "엔마",
    icon: "🗡️",
    weaponType: "sword",
    // 사용자 요청: 세 검 중 중간 — 삼도류보다는 세고 요루보다는 약함.
    damageMultiplier: 2.3,
    bonusRange: 2.0,
    attackSpeedMultiplier: 0.9,
    price: 700,
    description: "화산 섬에서만 파는 붉은 장검. 얇고 긴 칼날 덕에 사거리가 가장 길고 다루기도 가볍습니다.",
    islandLock: "volcano",
  },
  // 첫 원거리 무기. 검류보다 데미지는 약하지만, 좌클릭하면 몬스터에게 다가가지
  // 않고도 카메라(마우스)가 가리키는 방향으로 길게 뻗는 사격 판정을 씁니다.
  gun_slingshot: {
    id: "gun_slingshot",
    name: "새총",
    icon: "🔫",
    weaponType: "gun",
    // 사용자 요청: 기존(1.5)이 너무 강하다고 해서 최소 7분의 1 수준(1.5÷7≈0.214)
    // 이하로 낮췄습니다 — 검류(2.15~2.6)와는 비교가 안 될 만큼 약한, 진짜
    // "가벼운 견제용" 원거리 무기가 되도록 잡았습니다.
    damageMultiplier: 0.21,
    bonusRange: 0, // 원거리 판정은 rangedAttack을 씁니다 — 이 값은 쓰이지 않습니다
    attackSpeedMultiplier: 1,
    price: 300,
    description: "가볍고 값싼 원거리 무기. 검보다 데미지가 훨씬 약하지만, 마우스가 가리키는 방향으로 멀리서 쏠 수 있습니다.",
    rangedAttack: { range: 22, width: 2.4 },
  },
  // 해군/해적 시작 섬 모두 접속하자마자 이걸 손에 쥐고 시작합니다(사용자 요청) —
  // 그래야 평타를 쳐도 맨주먹이 아니라 진짜 검을 휘두르는 것처럼 보이고, 처음부터
  // 사냥이 가능합니다. 위력은 무기가 아예 없을 때(맨손)와 완전히 같도록
  // 일부러 배율을 전부 1/0으로 잡았습니다 — 밸런스에는 영향이 없는 순수 QoL용
  // 기본 지급 무기입니다. 상점에서는 팔지 않습니다(ShopSystem.ts에서 제외).
  sword_wood: {
    id: "sword_wood",
    name: "나무 검",
    icon: "🪵",
    weaponType: "sword",
    damageMultiplier: 1,
    bonusRange: 0,
    attackSpeedMultiplier: 1,
    price: 0,
    description: "이제 막 항해를 시작한 초보자에게 쥐어주는 기본 목검. 위력은 맨손과 같지만, 진짜 검을 든 채로 싸울 수 있습니다.",
  },
};

export function weaponFor(itemId: ItemId | null | undefined): WeaponDef | null {
  if (!itemId) return null;
  return WEAPONS[itemId] ?? null;
}

export function isWeapon(itemId: ItemId) {
  return WEAPONS[itemId] !== undefined;
}

/** 지금 실제로 손에 들고 있는 무기 (숫자키로 뽑은 상태) */
export function drawnWeapon(player: PlayerState): WeaponDef | null {
  if (player.activeHotbarSlot === null) return null;
  return weaponFor(player.hotbar[player.activeHotbarSlot]);
}

/**
 * 손에 든 무기의 최종 데미지 = 무기 자체 배율 × 스텟에서 파생된 기준 공격력.
 * 도검류는 검(sword) 스텟, 새총 같은 원거리 무기는 총(gun) 스텟을 봅니다.
 * player.swordDamageMultiplier/gunDamageMultiplier는 이제 "1+stat*0.06" 같은
 * 배율이 아니라 statAttackPower(stat)로 계산된 절대 공격력(기본 10, 스텟
 * 1당 +0.5)입니다 — 이름은 그대로지만 실제로는 무기 배율에 곱해지는 "기준
 * 데미지"라고 보는 게 맞습니다 (StatSystem.ts 참고).
 */
export function weaponDamageMultiplier(player: PlayerState) {
  const weapon = drawnWeapon(player);
  if (!weapon) return 1;
  const statAttackPower = weapon.weaponType === "gun" ? player.gunDamageMultiplier : player.swordDamageMultiplier;
  return weapon.damageMultiplier * statAttackPower;
}

export function weaponBonusRange(player: PlayerState) {
  return drawnWeapon(player)?.bonusRange ?? 0;
}

/** 손에 든 무기가 공격 속도에 주는 배율 (작을수록 빠름) */
export function weaponAttackSpeedMultiplier(player: PlayerState) {
  return drawnWeapon(player)?.attackSpeedMultiplier ?? 1;
}

/**
 * 초당 실제 근접 데미지 — 무기끼리 비교할 때 씁니다.
 * (요루는 한 방이 세고, 삼도류는 빠르게 여러 번 때립니다)
 */
export function weaponDps(weapon: WeaponDef, baseDamage: number, baseCooldownSec: number) {
  return (baseDamage * weapon.damageMultiplier) / (baseCooldownSec * weapon.attackSpeedMultiplier);
}

/** 인벤토리의 장비를 단축바에 올립니다 (1차 장착). 이미 올라가 있으면 내립니다. */
export function toggleHotbar(player: PlayerState, itemId: ItemId): number | null {
  const existing = player.hotbar.indexOf(itemId);
  if (existing !== -1) {
    player.hotbar[existing] = null;
    if (player.activeHotbarSlot === existing) player.activeHotbarSlot = null;
    return null;
  }

  const free = player.hotbar.indexOf(null);
  const slot = free === -1 ? 0 : free;
  player.hotbar[slot] = itemId;
  return slot;
}

/**
 * 숫자키(1~3)로 실제 장착/해제를 토글합니다.
 * 같은 칸을 다시 누르면 무기를 도로 집어넣습니다.
 *
 * 무기를 뽑으면(drawn) 열매는 자동으로 집어넣어집니다 — 손에는 열매든
 * 무기든 하나만 들 수 있기 때문입니다 (FruitSystem의 toggleFruitDrawn 참고).
 */
export function toggleDrawn(player: PlayerState, slot: number): "drawn" | "sheathed" | null {
  if (slot < 0 || slot >= player.hotbar.length) return null;
  if (!player.hotbar[slot]) return null;

  if (player.activeHotbarSlot === slot) {
    player.activeHotbarSlot = null;
    return "sheathed";
  }
  player.activeHotbarSlot = slot;
  player.fruitDrawn = false;
  return "drawn";
}

/**
 * 숫자키 4번으로 먹은 열매를 실제로 뽑아 듭니다/집어넣습니다.
 * 무기와 마찬가지로 열매도 "뽑아야만" Z/X/C/V 스킬을 쓸 수 있습니다.
 *
 * 열매를 뽑으면 손에 들고 있던 무기는 자동으로 집어넣어집니다(상호 배타).
 */
export function toggleFruitDrawn(player: PlayerState): "drawn" | "sheathed" {
  if (player.fruitDrawn) {
    player.fruitDrawn = false;
    return "sheathed";
  }
  player.fruitDrawn = true;
  player.activeHotbarSlot = null;
  return "drawn";
}
