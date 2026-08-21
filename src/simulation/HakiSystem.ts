import type { GameEvent, PlayerState } from "../core/GameState";

/** 무장색을 배우는 데 드는 비용 */
export const HAKI_PRICE = 300;
/** 무장색 발동 중 근접 공격 데미지 배율 */
export const HAKI_DAMAGE_MULTIPLIER = 1.4;
/** 무장색 발동 중 초당 소모되는 마나 */
export const HAKI_MANA_DRAIN_PER_SEC = 2.5;
/** 발동에 필요한 최소 마나 */
export const HAKI_ACTIVATION_MANA = 5;

/** 3번째 섬(사막 섬)의 사범에게 배웁니다. */
export const HAKI_TEACHER_ISLAND_ID = "desert";

export function learnHaki(player: PlayerState, events: GameEvent[]): boolean {
  if (player.hakiLearned) {
    events.push({ type: "purchase_failed", reason: "이미 무장색을 익혔습니다" });
    return false;
  }
  if (player.money < HAKI_PRICE) {
    events.push({ type: "purchase_failed", reason: `코인이 부족합니다 (🪙${HAKI_PRICE} 필요)` });
    return false;
  }

  player.money -= HAKI_PRICE;
  player.hakiLearned = true;
  events.push({ type: "haki_learned" });
  return true;
}

/** H키로 무장색을 켜고 끕니다. 배우지 않았거나 마나가 없으면 켜지지 않습니다. */
export function toggleHaki(player: PlayerState, events: GameEvent[]): boolean {
  if (!player.hakiLearned) return false;

  if (player.hakiActive) {
    player.hakiActive = false;
    events.push({ type: "haki_toggled", active: false });
    return true;
  }

  if (player.mana < HAKI_ACTIVATION_MANA) {
    events.push({ type: "purchase_failed", reason: "마나가 부족합니다" });
    return false;
  }

  player.hakiActive = true;
  events.push({ type: "haki_toggled", active: true });
  return true;
}

/** 발동 중에는 마나가 지속적으로 소모되고, 바닥나면 자동으로 해제됩니다. */
export function stepHaki(player: PlayerState, dt: number, events: GameEvent[]) {
  if (!player.hakiActive) return;

  player.mana = Math.max(0, player.mana - HAKI_MANA_DRAIN_PER_SEC * dt);
  if (player.mana <= 0) {
    player.hakiActive = false;
    events.push({ type: "haki_toggled", active: false });
  }
}

/** 무장색 발동 여부를 반영한 근접 공격 데미지 */
export function effectiveMeleeDamage(player: PlayerState) {
  return player.hakiActive ? player.meleeDamage * HAKI_DAMAGE_MULTIPLIER : player.meleeDamage;
}
