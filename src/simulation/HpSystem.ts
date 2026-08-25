import type { PlayerState } from "../core/GameState";

/** 마지막으로 피해를 받은 뒤, 체력 자연회복이 시작되기까지 기다리는 시간(초). */
export const HP_REGEN_DELAY_SEC = 5;
/** 체력 자연회복 속도 — 최대체력의 이 비율만큼을 초당 회복합니다. */
export const HP_REGEN_PERCENT_PER_SEC = 0.02;

/**
 * 체력 자연 회복 (밸런스 패치로 새로 추가).
 *
 * 피해를 받으면(player.lastDamagedAtMs가 CombatSystem/EnemyAI/WaterSystem 등에서
 * 갱신됨) 그 시점으로부터 HP_REGEN_DELAY_SEC초 동안은 회복이 시작되지 않고,
 * 그 시간이 지나야 최대체력의 HP_REGEN_PERCENT_PER_SEC%만큼씩 서서히 차오릅니다.
 * 죽어 있거나(체력 0) 개발자 모드(항상 풀피 고정)에서는 굳이 계산할 필요가 없습니다.
 *
 * @param nowMs 실제 시각(epoch ms) — GameState.nowMs를 그대로 넘깁니다.
 */
export function stepHp(player: PlayerState, dt: number, nowMs: number) {
  if (player.hp <= 0 || player.hp >= player.maxHp) return;
  if (player.lastDamagedAtMs !== null && nowMs - player.lastDamagedAtMs < HP_REGEN_DELAY_SEC * 1000) return;

  const regenPerSec = player.maxHp * HP_REGEN_PERCENT_PER_SEC;
  player.hp = Math.min(player.maxHp, player.hp + regenPerSec * dt);
}

/** 피해를 받았을 때 호출 — "마지막으로 맞은 시각"을 갱신해 회복 지연을 다시 걸어줍니다. */
export function markDamagedNow(player: PlayerState, nowMs: number) {
  player.lastDamagedAtMs = nowMs;
}
