// ---------------------------------------------------------------------------
// R키 순간이동 — 마우스가 가리키는 지점(화면 레이캐스트)으로 즉시 이동합니다.
//
// 얼음 섬(Lv.125) 설인에게 배웁니다 — 다단 점프·삼도류·무장색과 같은 자리입니다.
// 실제 "어디로 이동할지" 계산(레이캐스트)은 렌더러(카메라)가 있어야 하므로
// 이 파일은 순수 게임 로직(배울 수 있는지 / 쿨다운)만 다루고, 실행은
// main.ts가 SceneRenderer의 레이캐스트 결과를 받아 처리합니다.
// ---------------------------------------------------------------------------

import type { GameEvent, PlayerState } from "../core/GameState";
import { getIsland } from "../world/islands";

/** 설인이 있는 섬 (다단 점프·무장색과 같은 위치) */
export const TELEPORT_TEACHER_ISLAND_ID = "ice";

/** 배울 수 있는 최소 레벨 = 얼음 섬 요구 레벨 */
export const TELEPORT_REQUIRED_LEVEL = getIsland(TELEPORT_TEACHER_ISLAND_ID).requiredLevel; // 125

/** 배우는 값 */
export const TELEPORT_PRICE = 2000;

/** 한 번 쓰고 나서 다시 쓸 수 있을 때까지의 시간(초) */
export const TELEPORT_COOLDOWN_SEC = 4;

/**
 * 한 번에 이동할 수 있는 최대 거리(m, 3D 직선 거리). 마우스로 이보다 먼
 * 지점을 가리키면 그 방향으로 이 거리만큼만 이동합니다(전혀 이동하지 않는
 * "실패" 처리가 아니라, 방향은 존중하되 거리만 잘라내는 "클램프" 방식) —
 * 실제 클램프 지점 계산(마우스 방향 + 지형 높이 재탐색)은 main.ts가
 * SceneRenderer의 레이캐스트로 처리합니다.
 */
export const TELEPORT_MAX_DISTANCE_M = 30;

/** 순간이동을 배울 수 없는 이유 (배울 수 있으면 null) */
export type TeleportBlockReason = "already" | "level" | "money" | null;

export function teleportBlockReason(player: PlayerState): TeleportBlockReason {
  if (player.teleportLearned) return "already";
  if (player.level < TELEPORT_REQUIRED_LEVEL) return "level";
  if (player.money < TELEPORT_PRICE) return "money";
  return null;
}

export function canLearnTeleport(player: PlayerState): boolean {
  return teleportBlockReason(player) === null;
}

export function learnTeleport(player: PlayerState, events: GameEvent[]): boolean {
  const reason = teleportBlockReason(player);
  if (reason === "already") {
    events.push({ type: "purchase_failed", reason: "이미 순간이동을 익혔습니다" });
    return false;
  }
  if (reason === "level") {
    events.push({
      type: "purchase_failed",
      reason: `순간이동은 Lv.${TELEPORT_REQUIRED_LEVEL}부터 배울 수 있습니다`,
    });
    return false;
  }
  if (reason === "money") {
    events.push({ type: "purchase_failed", reason: `코인이 부족합니다 (🪙${TELEPORT_PRICE} 필요)` });
    return false;
  }

  player.money -= TELEPORT_PRICE;
  player.teleportLearned = true;
  events.push({ type: "teleport_learned" });
  return true;
}

/** 지금 R키 순간이동을 쓸 수 있는지 (배웠고, 쿨다운이 다 돌았는지) */
export function canUseTeleport(player: PlayerState): boolean {
  return player.teleportLearned && player.teleportCooldownSec <= 0;
}

/** 실제로 순간이동을 쓴 뒤 쿨다운을 겁니다 (이동 자체는 main.ts가 처리) */
export function beginTeleportCooldown(player: PlayerState) {
  player.teleportCooldownSec = TELEPORT_COOLDOWN_SEC;
}

/** 매 프레임 쿨다운을 줄입니다 (Simulation.step에서 호출) */
export function stepTeleportCooldown(player: PlayerState, dt: number) {
  if (player.teleportCooldownSec > 0) {
    player.teleportCooldownSec = Math.max(0, player.teleportCooldownSec - dt);
  }
}
