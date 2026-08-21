// ---------------------------------------------------------------------------
// 설인 (얼음 섬 Lv.125) — 삼도류 · 무장색 · 다단 점프를 가르치는 NPC의 규칙.
//
// 다단 점프
//   · 얼음 섬 요구 레벨(125)에서 **2단 점프**를 배웁니다.
//   · 그 뒤로는 **레벨이 100 오를 때마다 한 단씩** 더 배울 수 있습니다.
//       2단 → Lv.125, 3단 → Lv.225, 4단 → Lv.325 …
//   · 값도 단계마다 올라갑니다.
// ---------------------------------------------------------------------------

import type { GameEvent, PlayerState } from "../core/GameState";
import { getIsland } from "../world/islands";

/** 설인이 있는 섬 (항해 순서상 4번째, 요구 레벨 125) */
export const TRAINER_ISLAND_ID = "ice";

/** 첫 점프 강화(2단)를 배울 수 있는 레벨 = 얼음 섬 요구 레벨 */
export const FIRST_JUMP_LEVEL = getIsland(TRAINER_ISLAND_ID).requiredLevel; // 125

/** 그 다음 단계마다 필요한 추가 레벨 */
export const JUMP_LEVEL_STEP = 100;

/** 점프 단수 상한 — 너무 많아지면 조작이 이상해져서 막아둡니다 */
export const MAX_JUMPS = 10;

/** 2단 점프 값 */
export const JUMP_BASE_PRICE = 1200;
/** 단계마다 값이 이 배율로 오릅니다 */
export const JUMP_PRICE_STEP = 1.8;

/**
 * `nextJumps`단을 배우는 데 필요한 레벨.
 *   2단 → 125, 3단 → 225, 4단 → 325 …
 */
export function jumpRequiredLevel(nextJumps: number): number {
  return FIRST_JUMP_LEVEL + JUMP_LEVEL_STEP * (nextJumps - 2);
}

/** `nextJumps`단을 배우는 값 */
export function jumpPrice(nextJumps: number): number {
  return Math.round(JUMP_BASE_PRICE * Math.pow(JUMP_PRICE_STEP, nextJumps - 2));
}

export type JumpBlockReason = "maxed" | "level" | "money" | null;

/** 지금 점프를 한 단 더 배울 수 있는지 (못 하면 이유) */
export function jumpBlockReason(player: PlayerState): JumpBlockReason {
  const next = player.maxJumps + 1;
  if (next > MAX_JUMPS) return "maxed";
  if (player.level < jumpRequiredLevel(next)) return "level";
  if (player.money < jumpPrice(next)) return "money";
  return null;
}

export function canLearnJump(player: PlayerState): boolean {
  return jumpBlockReason(player) === null;
}

/** 점프 단수를 한 단 올립니다 */
export function learnJump(player: PlayerState, events: GameEvent[]): boolean {
  const reason = jumpBlockReason(player);
  const next = player.maxJumps + 1;

  if (reason === "maxed") {
    events.push({ type: "purchase_failed", reason: `점프는 ${MAX_JUMPS}단이 최대입니다` });
    return false;
  }
  if (reason === "level") {
    events.push({
      type: "purchase_failed",
      reason: `${next}단 점프는 Lv.${jumpRequiredLevel(next)}부터 배울 수 있습니다`,
    });
    return false;
  }
  if (reason === "money") {
    events.push({ type: "purchase_failed", reason: `코인이 부족합니다 (🪙${jumpPrice(next)} 필요)` });
    return false;
  }

  player.money -= jumpPrice(next);
  player.maxJumps = next;
  events.push({ type: "jump_learned", jumps: next });
  return true;
}
