import { expRequiredForLevel, type GameEvent, type PlayerState } from "../core/GameState";
import { MAX_LEVEL } from "../core/ExpCurve";
import { recomputeDerivedStats } from "./StatSystem";

const STAT_POINTS_PER_LEVEL = 3;
export const EXP_BUFF_MULTIPLIER = 2;

/** 경험치 2배 포션이 켜져 있으면 적용되는 배율 */
export function currentExpMultiplier(player: PlayerState) {
  return player.expBuffRemainingSec > 0 ? EXP_BUFF_MULTIPLIER : 1;
}

/**
 * 경험치를 지급합니다. **만렙(MAX_LEVEL)에 도달하면 완전히 멈춥니다** — 레벨도
 * 더 오르지 않고, 그에 따른 스탯 포인트도 더 이상 들어오지 않습니다. 경험치
 * 자체도 쌓이지 않게 해서(만렙에서는 함수 맨 앞에서 그냥 돌아감) exp 바가
 * 꽉 찬 채로 조용히 멈춰 있습니다.
 */
export function grantExp(player: PlayerState, amount: number, events: GameEvent[]) {
  if (player.level >= MAX_LEVEL) return;

  player.exp += Math.round(amount * currentExpMultiplier(player));

  while (player.level < MAX_LEVEL && player.exp >= player.expToNextLevel) {
    player.exp -= player.expToNextLevel;
    player.level += 1;
    player.expToNextLevel = expRequiredForLevel(player.level);
    player.unspentStatPoints += STAT_POINTS_PER_LEVEL;
    recomputeDerivedStats(player);
    player.hp = player.maxHp; // 레벨업 시 체력/마나 완전 회복
    player.mana = player.maxMana;
    events.push({ type: "player_leveled_up", newLevel: player.level, statPointsAwarded: STAT_POINTS_PER_LEVEL });
  }

  // 만렙을 찍는 순간 남는 초과 경험치는 버려서, exp 바가 애매하게 걸쳐 있지 않고
  // 꽉 찬 채로 깔끔하게 멈추게 합니다.
  if (player.level >= MAX_LEVEL) player.exp = 0;
}
