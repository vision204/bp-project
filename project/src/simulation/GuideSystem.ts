// ---------------------------------------------------------------------------
// 섬 가이드 — "내 레벨에 맞는 섬"을 추천하고, 고른 섬까지 방향을 안내합니다.
//
// 순수 계산만 있습니다 (DOM·THREE 참조 없음). HUD는 여기서 나온 방위각과
// 거리를 받아 화살표를 돌리기만 합니다.
// ---------------------------------------------------------------------------

import type { GameState, PlayerState } from "../core/GameState";
import { getIsland, islandsInSea, type IslandDef, type Sea } from "../world/islands";

/** 목적지에 이 거리 안으로 들어오면 "도착"으로 보고 안내를 끝냅니다 */
export const GUIDE_ARRIVE_MARGIN = 20;

/**
 * 지금 사냥하기 적당한 섬 = 내 레벨로 의뢰를 받을 수 있는 섬 중 가장 높은 곳.
 * (레벨 제한은 퀘스트에만 걸리므로, "갈 수 있는 곳"이 아니라 "의뢰를 받을 수 있는 곳" 기준)
 */
export function recommendedIsland(player: PlayerState, sea: Sea = 1): IslandDef {
  const pool = islandsInSea(sea);
  const eligible = pool
    .filter((i) => i.kind !== "hub" && i.requiredLevel <= player.level)
    .sort((a, b) => a.requiredLevel - b.requiredLevel);
  // 두 번째 바다에 갓 도착했다면(레벨이 그 바다 첫 섬에도 못 미치면) 그 바다의
  // 가장 낮은 섬을 추천합니다 — 추천할 게 없다고 비워두면 안내가 먹통이 되니까요.
  if (eligible.length === 0) {
    return [...pool].filter((i) => i.kind !== "hub").sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
  }
  // 시작 섬 두 개는 요구 레벨이 같으므로, 내 진영 섬을 고릅니다.
  const top = eligible[eligible.length - 1];
  if (top.kind === "start") {
    return pool.find((i) => i.kind === "start" && i.faction === player.faction) ?? top;
  }
  return top;
}

/** 아직 못 가는 섬 중 가장 가까운 다음 목표 (전부 열었으면 null) */
export function nextGoalIsland(player: PlayerState, sea: Sea = 1): IslandDef | null {
  const locked = islandsInSea(sea)
    .filter((i) => i.kind !== "hub" && i.requiredLevel > player.level)
    .sort((a, b) => a.requiredLevel - b.requiredLevel);
  return locked[0] ?? null;
}

export interface GuideInfo {
  island: IslandDef;
  /** 남은 수평 거리(m) */
  distance: number;
  /**
   * 목적지 방위각(라디안). 이동/조준과 같은 규약을 씁니다:
   * forward = (sin(yaw), cos(yaw)) 이므로 atan2(dx, dz).
   */
  bearing: number;
  /** 카메라가 보는 방향 기준 상대 각도 (0이면 정면, 화살표를 이만큼 돌리면 됨) */
  relativeBearing: number;
  arrived: boolean;
}

export function guideInfo(state: GameState, islandId: string): GuideInfo {
  const island = getIsland(islandId);
  const dx = island.center.x - state.player.position.x;
  const dz = island.center.z - state.player.position.z;
  const distance = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, dz);

  // 화면 기준 각도로 바꿉니다. 카메라가 목적지를 정면으로 보고 있으면 0.
  let relative = bearing - state.player.aimYaw;
  while (relative > Math.PI) relative -= Math.PI * 2;
  while (relative < -Math.PI) relative += Math.PI * 2;

  return {
    island,
    distance,
    bearing,
    relativeBearing: relative,
    arrived: distance <= island.radius + GUIDE_ARRIVE_MARGIN,
  };
}

/** 목적지 지정 (같은 섬을 다시 고르면 안내 해제) */
export function setGuideTarget(state: GameState, islandId: string | null) {
  const player = state.player;
  if (islandId === null || player.guideTargetIslandId === islandId) {
    player.guideTargetIslandId = null;
    return;
  }
  const island = getIsland(islandId);
  // 다른 바다의 섬은 걸어서도 배로도 갈 수 없습니다 (해적왕이 유일한 통로).
  // 화살표가 6km 떨어진 곳을 가리키며 영영 도착하지 않는 일이 없도록 막습니다.
  if (island.sea !== state.sea) {
    player.guideTargetIslandId = null;
    return;
  }
  player.guideTargetIslandId = island.id;
  player.events.push({ type: "guide_started", islandName: island.name });
}

/** 매 프레임 호출 — 목적지에 도착했으면 안내를 자동으로 끝냅니다. */
export function stepGuide(state: GameState) {
  const target = state.player.guideTargetIslandId;
  if (!target) return;
  const info = guideInfo(state, target);
  if (info.arrived) {
    state.player.guideTargetIslandId = null;
    state.player.events.push({ type: "guide_arrived", islandName: info.island.name });
  }
}
