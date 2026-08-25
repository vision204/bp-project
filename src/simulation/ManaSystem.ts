import type { PlayerState } from "../core/GameState";

const BASE_REGEN_PER_SEC = 4;
const REGEN_PER_MANA_POINT = 0.4;

/**
 * 마나를 소모한 뒤 자연회복이 다시 시작되기까지 대기하는 시간(초).
 * 대쉬·스킬 등 "마지막으로 마나를 쓴 시점"으로부터 이 시간이 지나야
 * 아래 stepMana의 회복이 다시 붙습니다 (밸런스 패치).
 */
export const MANA_REGEN_DELAY_SEC = 6;

/**
 * 마나 자연 회복.
 *
 * 무장색을 발동 중일 때는 회복이 멈춥니다. 그렇지 않으면 기본 회복량(4/초)이
 * 무장색 소모량(2.5/초)보다 커서 마나가 가득 찬 상태에서는 무장색을 공짜로
 * 무한 유지할 수 있게 됩니다 — 공격 스텟(마나 역할 겸용)을 올릴수록 더 심해지고요.
 * 회복을 멈춰야 "유지에 자원이 든다"는 규칙이 스텟과 무관하게 항상 성립합니다.
 *
 * 추가로, 마나를 실제로 소모한 시점(player.lastManaSpentAtMs, 대쉬·스킬 사용 시
 * CombatSystem/PlayerController가 갱신)으로부터 MANA_REGEN_DELAY_SEC가 지나기
 * 전까지는 회복 자체가 시작되지 않습니다 — "깎이면 바로 회복되지 않는다"는
 * 요청에 따른 지연 회복입니다.
 *
 * @param nowMs 실제 시각(epoch ms) — GameState.nowMs를 그대로 넘깁니다.
 */
export function stepMana(player: PlayerState, dt: number, nowMs: number) {
  if (player.hakiActive) return;
  if (player.lastManaSpentAtMs !== null && nowMs - player.lastManaSpentAtMs < MANA_REGEN_DELAY_SEC * 1000) return;

  const regenPerSec = BASE_REGEN_PER_SEC + player.stats.attack * REGEN_PER_MANA_POINT;
  player.mana = Math.min(player.maxMana, player.mana + regenPerSec * dt);
}
