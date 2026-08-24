import type { GameEvent, ItemId, PlayerState } from "../core/GameState";
import { currentExpMultiplier } from "./Leveling";
import { weaponFor } from "./WeaponSystem";

// ---------------------------------------------------------------------------
// 무기 숙련도(레벨) — FruitLeveling.ts와 완전히 같은 방식입니다.
//
// 열매는 한 번에 하나뿐이라 레벨이 PlayerState에 단일 값(fruitLevel)으로
// 들어가지만, 무기는 여러 자루를 갈아 끼울 수 있으므로 player.weaponMastery에
// 무기 id별로 따로 저장합니다. 곡선·배율 공식은 열매와 완전히 동일하게
// 맞췄습니다(사용자 요청: "열매랑 똑같이").
// ---------------------------------------------------------------------------

/** 무기 숙련도 상한 (V 스킬 해금이 100이라 여유를 둠) — 열매와 동일 */
export const MAX_WEAPON_LEVEL = 150;

/** 처치한 몬스터 경험치의 이 비율만큼 무기 경험치로 들어옵니다. */
const WEAPON_EXP_RATIO = 0.6;

/** 무기 레벨업에 필요한 경험치 — 열매와 같은 곡선. */
export function weaponExpRequiredForLevel(level: number): number {
  return Math.round(30 + Math.pow(level, 1.5) * 4);
}

/** 무기 레벨이 오를수록 무기 스킬 데미지가 증가합니다 (레벨당 +2%, 열매와 동일). */
export function weaponLevelDamageMultiplier(weaponLevel: number) {
  return 1 + (weaponLevel - 1) * 0.02;
}

/** 몬스터 경험치로부터 실제로 들어올 무기 경험치를 계산합니다. */
export function weaponExpFromEnemy(enemyExpReward: number) {
  return Math.max(1, Math.round(enemyExpReward * WEAPON_EXP_RATIO));
}

/** 이 무기의 현재 숙련 레벨 (아직 한 번도 안 썼으면 1). */
export function weaponMasteryLevel(player: PlayerState, weaponId: ItemId): number {
  return player.weaponMastery[weaponId]?.level ?? 1;
}

function ensureMastery(player: PlayerState, weaponId: ItemId) {
  let entry = player.weaponMastery[weaponId];
  if (!entry) {
    entry = { level: 1, exp: 0, expToNext: weaponExpRequiredForLevel(1) };
    player.weaponMastery[weaponId] = entry;
  }
  return entry;
}

/**
 * 무기 경험치 지급.
 *
 * 열매와의 차이: 열매는 "막타를 열매 스킬로 넣었을 때만" 경험치가 들어오지만,
 * 무기는 그 무기를 손에 들고 있는 동안의 근접 공격 막타 + 무기 스킬 막타
 * **모두**에서 들어옵니다 (무기는 평소 근접 공격 자체를 강화하는 물건이라,
 * 검을 들고 몬스터를 베는 것 자체가 숙련의 과정이라고 보는 게 자연스럽습니다).
 * 호출 조건은 CombatSystem이 판단하고, 여기서는 지급만 담당합니다.
 */
export function grantWeaponExp(
  player: PlayerState,
  weaponId: ItemId,
  amount: number,
  events: GameEvent[],
) {
  const entry = ensureMastery(player, weaponId);
  if (entry.level >= MAX_WEAPON_LEVEL) return;

  entry.exp += Math.round(amount * currentExpMultiplier(player));

  while (entry.exp >= entry.expToNext && entry.level < MAX_WEAPON_LEVEL) {
    entry.exp -= entry.expToNext;
    entry.level += 1;
    entry.expToNext = weaponExpRequiredForLevel(entry.level);
    events.push({
      type: "weapon_leveled_up",
      weaponId,
      weaponName: weaponFor(weaponId)?.name ?? weaponId,
      newLevel: entry.level,
    });
  }

  if (entry.level >= MAX_WEAPON_LEVEL) {
    entry.exp = 0;
  }
}
