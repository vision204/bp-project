import type { PlayerState } from "../core/GameState";

const BASE_REGEN_PER_SEC = 4;
const REGEN_PER_MANA_POINT = 0.4;

/**
 * 마나 자연 회복.
 *
 * 무장색을 발동 중일 때는 회복이 멈춥니다. 그렇지 않으면 기본 회복량(4/초)이
 * 무장색 소모량(2.5/초)보다 커서 마나가 가득 찬 상태에서는 무장색을 공짜로
 * 무한 유지할 수 있게 됩니다 — 공격 스텟(마나 역할 겸용)을 올릴수록 더 심해지고요.
 * 회복을 멈춰야 "유지에 자원이 든다"는 규칙이 스텟과 무관하게 항상 성립합니다.
 */
export function stepMana(player: PlayerState, dt: number) {
  if (player.hakiActive) return;

  const regenPerSec = BASE_REGEN_PER_SEC + player.stats.attack * REGEN_PER_MANA_POINT;
  player.mana = Math.min(player.maxMana, player.mana + regenPerSec * dt);
}
