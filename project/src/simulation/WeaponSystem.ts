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
  /** 근접 공격 데미지 배율 */
  damageMultiplier: number;
  /** 근접 사거리 추가치(m) — 큰 검일수록 멀리 닿습니다 */
  bonusRange: number;
  /**
   * 근접 공격 쿨다운 배율 (1 = 그대로, 0.7 = 30% 빨라짐).
   * 큰 검은 한 방이 무겁고 느리게, 여러 자루는 가볍고 빠르게 만들기 위한 값입니다.
   */
  attackSpeedMultiplier: number;
  price: number;
  description: string;
}

export const WEAPONS: Partial<Record<ItemId, WeaponDef>> = {
  sword_yoru: {
    id: "sword_yoru",
    name: "요루 (흑도)",
    icon: "🗡️",
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
    damageMultiplier: 2.9,
    bonusRange: 1.2,
    attackSpeedMultiplier: 0.65, // 공격 속도 35% 빠름
    price: 2500,
    description:
      "칼 세 자루를 양손과 입에 무는 검술. 사거리는 요루보다 짧지만 공격이 훨씬 빠릅니다.",
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

export function weaponDamageMultiplier(player: PlayerState) {
  return drawnWeapon(player)?.damageMultiplier ?? 1;
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
 * 숫자키로 실제 장착/해제를 토글합니다.
 * 같은 칸을 다시 누르면 무기를 도로 집어넣습니다.
 */
export function toggleDrawn(player: PlayerState, slot: number): "drawn" | "sheathed" | null {
  if (slot < 0 || slot >= player.hotbar.length) return null;
  if (!player.hotbar[slot]) return null;

  if (player.activeHotbarSlot === slot) {
    player.activeHotbarSlot = null;
    return "sheathed";
  }
  player.activeHotbarSlot = slot;
  return "drawn";
}
