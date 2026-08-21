import { expRequiredForLevel, type GameEvent, type PlayerState } from "../core/GameState";
import { recomputeDerivedStats } from "./StatSystem";

const STAT_POINTS_PER_LEVEL = 3;
export const EXP_BUFF_MULTIPLIER = 2;

/** 경험치 2배 포션이 켜져 있으면 적용되는 배율 */
export function currentExpMultiplier(player: PlayerState) {
  return player.expBuffRemainingSec > 0 ? EXP_BUFF_MULTIPLIER : 1;
}

export function grantExp(player: PlayerState, amount: number, events: GameEvent[]) {
  player.exp += Math.round(amount * currentExpMultiplier(player));

  while (player.exp >= player.expToNextLevel) {
    player.exp -= player.expToNextLevel;
    player.level += 1;
    player.expToNextLevel = expRequiredForLevel(player.level);
    player.unspentStatPoints += STAT_POINTS_PER_LEVEL;
    recomputeDerivedStats(player);
    player.hp = player.maxHp; // 레벨업 시 체력/마나 완전 회복
    player.mana = player.maxMana;
    events.push({ type: "player_leveled_up", newLevel: player.level, statPointsAwarded: STAT_POINTS_PER_LEVEL });
  }
}
