import type { PlayerState } from "../core/GameState";
import { WATER_ENTER_Y } from "../world/islands";
import { markDamagedNow } from "./HpSystem";

/** 바다에 빠져 있는 동안 초당 깎이는 체력 */
const DROWN_DPS = 6;

export function isInWater(player: PlayerState) {
  return player.position.y < WATER_ENTER_Y;
}

/**
 * 바다에 빠져 있으면 체력을 서서히 깎습니다. 섬 가장자리에는 계단형 해변이 있어서
 * 헤엄쳐 돌아오면 걸어 올라올 수 있고, 늦으면 체력이 0이 되어 시작 섬에서 부활합니다.
 *
 * HUD는 player.inWater 플래그를 직접 읽어서 경고를 표시하므로 여기서 이벤트를
 * 따로 쏘지 않습니다 (매 프레임 이벤트가 쌓이는 것을 피하기 위함).
 *
 * @param nowMs 실제 시각(epoch ms) — 익사 피해도 "마지막으로 맞은 시각"을 갱신해
 *              체력 자연회복 지연에 반영됩니다.
 */
export function stepWater(player: PlayerState, dt: number, nowMs: number) {
  player.inWater = isInWater(player);
  if (!player.inWater) return;
  player.hp = Math.max(0, player.hp - DROWN_DPS * dt);
  markDamagedNow(player, nowMs);
}
