import type { PlayerState } from "../core/GameState";

export const EXP_POTION_DURATION_SEC = 10 * 60; // 10분

export function stepBuffs(player: PlayerState, dt: number) {
  if (player.expBuffRemainingSec > 0) {
    player.expBuffRemainingSec = Math.max(0, player.expBuffRemainingSec - dt);
  }
}

/** 경험치 2배 포션 사용 — 이미 켜져 있으면 남은 시간에 더해집니다. */
export function activateExpBuff(player: PlayerState) {
  player.expBuffRemainingSec += EXP_POTION_DURATION_SEC;
}

export function formatBuffTime(seconds: number) {
  const total = Math.ceil(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
