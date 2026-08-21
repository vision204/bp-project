import type { GameEvent, PlayerState } from "../core/GameState";
import { currentExpMultiplier } from "./Leveling";

/** 열매 레벨 상한 (V 스킬 해금이 100이라 여유를 둠) */
export const MAX_FRUIT_LEVEL = 150;

/** 처치한 몬스터 경험치의 이 비율만큼 열매 경험치로 들어옵니다. */
const FRUIT_EXP_RATIO = 0.6;

/**
 * 열매 레벨업에 필요한 경험치. 캐릭터 레벨(지수 아님, level^1.6)보다 완만한
 * level^1.5 곡선이라 100레벨(V 해금)까지 현실적으로 도달할 수 있습니다.
 */
export function fruitExpRequiredForLevel(level: number): number {
  return Math.round(30 + Math.pow(level, 1.5) * 4);
}

/** 열매 레벨이 오를수록 모든 열매 스킬 데미지가 증가합니다 (레벨당 +2%). */
export function fruitLevelDamageMultiplier(fruitLevel: number) {
  return 1 + (fruitLevel - 1) * 0.02;
}

/** 몬스터 경험치로부터 실제로 들어올 열매 경험치를 계산합니다. */
export function fruitExpFromEnemy(enemyExpReward: number) {
  return Math.max(1, Math.round(enemyExpReward * FRUIT_EXP_RATIO));
}

/**
 * 열매 경험치 지급.
 *
 * ⚠️ 중요: 이 함수는 **마지막 타격(막타)을 열매 스킬로 넣었을 때만** 호출되어야
 * 합니다. 근접 공격으로 마무리하면 열매 경험치는 한 톨도 들어오지 않습니다.
 * 호출 조건은 CombatSystem이 판단하고, 여기서는 지급만 담당합니다.
 */
export function grantFruitExp(player: PlayerState, amount: number, events: GameEvent[]) {
  if (player.fruitLevel >= MAX_FRUIT_LEVEL) return;

  player.fruitExp += Math.round(amount * currentExpMultiplier(player));

  while (player.fruitExp >= player.fruitExpToNext && player.fruitLevel < MAX_FRUIT_LEVEL) {
    player.fruitExp -= player.fruitExpToNext;
    player.fruitLevel += 1;
    player.fruitExpToNext = fruitExpRequiredForLevel(player.fruitLevel);
    events.push({ type: "fruit_leveled_up", newFruitLevel: player.fruitLevel });
  }

  if (player.fruitLevel >= MAX_FRUIT_LEVEL) {
    player.fruitExp = 0;
  }
}
