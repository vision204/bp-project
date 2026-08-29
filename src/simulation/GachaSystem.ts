// ---------------------------------------------------------------------------
// 열매 뽑기 (정글 섬 "열매 도박사")
//
// 규칙
//   · 가격 = 현재 가진 코인의 30%  (전 재산 기준이라 부자일수록 비쌉니다)
//   · 4시간에 한 번만 뽑을 수 있음 (실제 시각 기준, 새로고침해도 유지)
//   · 비싼 열매일수록 잘 안 나옴 (가격에 반비례하는 가중치)
//
// 시간은 이 모듈이 직접 읽지 않고 항상 nowMs를 인자로 받습니다.
// 나중에 서버 권위 방식으로 옮길 때 서버 시계를 그대로 넘기면 되고,
// 테스트에서도 시간을 마음대로 조작할 수 있습니다.
// ---------------------------------------------------------------------------

import type { FruitAbilityId, GameEvent, PlayerState } from "../core/GameState";
import { FRUIT_CATALOG } from "./ShopSystem";
import { addFruitToInventory } from "./FruitInventorySystem";

/** 뽑기 쿨다운 — 4시간 */
export const GACHA_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** 전 재산에서 가져가는 비율 */
export const GACHA_COST_RATIO = 0.3;

/**
 * 최소 참가비. 이게 없으면 코인 0인 상태에서 가격도 0이 되어
 * "공짜 뽑기"가 되어버립니다.
 */
export const GACHA_MIN_COST = 20;

/** 뽑기에 필요한 최소 보유 코인 (이 금액의 30%가 최소 참가비가 되도록) */
export const GACHA_MIN_MONEY = Math.ceil(GACHA_MIN_COST / GACHA_COST_RATIO);

/** 지금 뽑는다면 얼마를 내야 하는지 (전 재산의 30%, 최소 20) */
export function gachaCost(player: PlayerState): number {
  return Math.max(GACHA_MIN_COST, Math.floor(player.money * GACHA_COST_RATIO));
}

/** 다음 뽑기까지 남은 밀리초 (0이면 지금 가능) */
export function gachaRemainingMs(player: PlayerState, nowMs: number): number {
  if (player.lastGachaAtMs === null) return 0;
  const elapsed = nowMs - player.lastGachaAtMs;
  // 시스템 시계를 과거로 돌려놓은 경우(elapsed < 0)에도 쿨다운이 무한정
  // 늘어나지 않도록 최대 쿨다운 길이로 자릅니다.
  if (elapsed < 0) return GACHA_COOLDOWN_MS;
  return Math.max(0, GACHA_COOLDOWN_MS - elapsed);
}

export type GachaBlockReason = "cooldown" | "poor" | null;

/** 못 뽑는 이유 (뽑을 수 있으면 null) */
export function gachaBlockReason(player: PlayerState, nowMs: number): GachaBlockReason {
  if (gachaRemainingMs(player, nowMs) > 0) return "cooldown";
  if (player.money < GACHA_MIN_MONEY) return "poor";
  return null;
}

export function canRollGacha(player: PlayerState, nowMs: number): boolean {
  return gachaBlockReason(player, nowMs) === null;
}

/** "3시간 12분" 같은 사람이 읽는 남은 시간 */
export function formatGachaRemaining(ms: number): string {
  if (ms <= 0) return "지금 가능";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

/**
 * 뽑기 확률 — 비싼 열매일수록 잘 안 나옵니다.
 * 가중치 = (가장 비싼 열매 가격 / 이 열매 가격)^1.5 로 두어,
 * 어둠 열매(150)와 모래 열매(70)의 확률이 약 3배 차이 나게 했습니다.
 */
export function gachaWeights(): { id: FruitAbilityId; weight: number }[] {
  const maxPrice = Math.max(...FRUIT_CATALOG.map((f) => f.price));
  return FRUIT_CATALOG.map((f) => ({
    id: f.id,
    weight: Math.pow(maxPrice / f.price, 1.5),
  }));
}

/** 각 열매가 나올 확률(합 = 1) — UI에 그대로 보여줍니다 */
export function gachaOdds(): { id: FruitAbilityId; chance: number }[] {
  const weights = gachaWeights();
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  return weights.map((w) => ({ id: w.id, chance: w.weight / total }));
}

/** 0~1 난수를 받아 가중치대로 열매 하나를 고릅니다 (테스트에서 난수 고정 가능) */
export function pickFruit(roll: number): FruitAbilityId {
  const weights = gachaWeights();
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const w of weights) {
    cursor -= w.weight;
    if (cursor < 0) return w.id;
  }
  return weights[weights.length - 1].id;
}

export interface GachaResult {
  ok: boolean;
  fruitId?: FruitAbilityId;
  fruitName?: string;
  paid?: number;
}

/**
 * 실제로 뽑습니다. 성공하면 코인을 내고 뽑힌 열매가 인벤토리에 들어갑니다.
 * 더 이상 즉시 장착되지 않습니다 — 인벤토리에서 직접 장착해야 합니다.
 */
export function rollGacha(
  player: PlayerState,
  nowMs: number,
  events: GameEvent[],
  roll: number = Math.random(),
): GachaResult {
  const reason = gachaBlockReason(player, nowMs);
  if (reason === "cooldown") {
    events.push({
      type: "purchase_failed",
      reason: `아직 뽑을 수 없습니다 (${formatGachaRemaining(gachaRemainingMs(player, nowMs))} 남음)`,
    });
    return { ok: false };
  }
  if (reason === "poor") {
    events.push({
      type: "purchase_failed",
      reason: `코인이 너무 적습니다 (최소 🪙${GACHA_MIN_MONEY} 필요)`,
    });
    return { ok: false };
  }

  const paid = gachaCost(player);
  player.money -= paid;
  player.lastGachaAtMs = nowMs;

  const fruitId = pickFruit(roll);
  const entry = FRUIT_CATALOG.find((f) => f.id === fruitId)!;
  addFruitToInventory(player, fruitId);

  events.push({ type: "gacha_rolled", fruitName: entry.name, paid });
  return { ok: true, fruitId, fruitName: entry.name, paid };
}
