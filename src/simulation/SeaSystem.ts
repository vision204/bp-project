// ---------------------------------------------------------------------------
// 바다(세계) 이동 — 해적왕에게 부탁해 두 번째 바다로 건너가고 돌아옵니다.
//
// 이 파일에는 **조건과 규칙만** 있습니다. 실제 순간이동(물리 바디 옮기기)은
// Simulation이 처리합니다. 그래야 브라우저 없이도 "언제 갈 수 있는가"를
// 그대로 검증할 수 있습니다.
//
// 설계 메모
//   · 왕복은 완전히 자유입니다. 레벨·돈·열매·퀘스트 진행은 전부 그대로 이어집니다.
//     세이브에는 "지금 어느 바다인가" 한 줄만 더 저장합니다.
//   · 한 번 두 번째 바다에 발을 들이면, 첫 바다로 돌아왔다가 다시 갈 때는
//     레벨 조건을 다시 보지 않습니다 — 돌아왔다는 이유로 갇히면 곤란하니까요.
//     (첫 항해에만 Lv.1100이 필요합니다)
// ---------------------------------------------------------------------------

import type { GameState, PlayerState } from "../core/GameState";
import { SECOND_SEA_LEVEL, SEA_LABELS, hubIsland, type Sea } from "../world/islands";

export { SECOND_SEA_LEVEL, SEA_LABELS };

/** 해적왕에게 말을 걸었을 때 건너갈 목적지 (지금이 1이면 2, 2면 1) */
export function otherSea(sea: Sea): Sea {
  return sea === 1 ? 2 : 1;
}

export type SeaBlockReason = "level" | null;

/**
 * 지금 건너갈 수 없는 이유. null이면 갈 수 있습니다.
 * 두 번째 바다 → 첫 번째 바다로 돌아오는 것은 언제나 자유입니다.
 */
export function seaBlockReason(state: GameState): SeaBlockReason {
  const target = otherSea(state.sea);
  if (target === 1) return null;
  if (state.player.unlockedSecondSea) return null;
  return state.player.level >= SECOND_SEA_LEVEL ? null : "level";
}

export function canTravelSea(state: GameState): boolean {
  return seaBlockReason(state) === null;
}

/** 두 번째 바다를 처음 여는 데 남은 레벨 (이미 열렸으면 0) */
export function levelsUntilSecondSea(player: PlayerState): number {
  if (player.unlockedSecondSea) return 0;
  return Math.max(0, SECOND_SEA_LEVEL - player.level);
}

/**
 * 실제로 바다를 옮깁니다. 도착지는 그 바다의 허브 섬(중앙 교역섬 / 본부)입니다.
 * 물리 바디를 옮기는 일은 호출한 쪽(Simulation)이 teleport 콜백으로 처리합니다.
 *
 * @returns 옮겼으면 도착한 허브 섬, 조건이 안 되면 null
 */
export function travelSea(
  state: GameState,
  teleport: (pos: { x: number; y: number; z: number }) => void,
): { sea: Sea; islandId: string } | null {
  if (!canTravelSea(state)) return null;

  const target = otherSea(state.sea);
  const hub = hubIsland(target);

  // 허브 섬 한가운데 광장에 내려섭니다 (부두 쪽이 아니라 중앙 — 해적왕 배로 온 거니까).
  const arrival = { x: hub.center.x, y: 3, z: hub.center.z };

  state.sea = target;
  state.currentIslandId = hub.id;
  state.player.position = { ...arrival };
  // 배를 탄 채로 건너갈 수는 없습니다 (배는 그 바다에 두고 옵니다).
  state.boat.riding = false;
  state.boat.spawned = false;
  // 길안내는 바다가 바뀌면 의미가 없어지므로 끕니다.
  state.player.guideTargetIslandId = null;
  if (target === 2) state.player.unlockedSecondSea = true;

  teleport(arrival);

  state.player.events.push({
    type: "sea_changed",
    sea: target,
    seaName: SEA_LABELS[target],
    islandName: hub.name,
  });

  return { sea: target, islandId: hub.id };
}
