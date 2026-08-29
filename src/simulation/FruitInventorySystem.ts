// ---------------------------------------------------------------------------
// 열매 인벤토리 — 상점/열매 상인/뽑기로 얻은 열매를 곧바로 장착하지 않고
// 일단 인벤토리에 보관했다가, 플레이어가 직접 "장착"을 눌러야 실제로
// equippedFruit이 바뀌도록 하는 시스템입니다.
//
// 규칙 (사용자 요청 그대로):
//   · 열매를 얻으면 fruitInventory에 쌓입니다 (자동 장착 X).
//   · 인벤토리의 열매를 장착하면 오른손에 그 열매를 들게 됩니다(렌더러가 처리).
//   · 이미 다른 열매를 장착 중일 때 새 열매를 장착하려 하면, 기존 열매는
//     "삭제"됩니다(인벤토리로 돌아가지 않음) — 다만 그 열매의 숙련도
//     (fruitMastery)는 그대로 남아서, 나중에 같은 열매를 다시 얻어 장착하면
//     이전 레벨부터 이어집니다. 이 확인은 UI가 먼저 사용자에게 묻고("정말
//     열매를 교체 하시겠습니까? 기존의 열매는 삭제되지만 숙련도 레벨은
//     저장됩니다"), "예"를 눌렀을 때만 equipFruitFromInventory를 호출해야
//     합니다 — 이 함수 자체는 확인 없이 즉시 교체를 실행합니다.
// ---------------------------------------------------------------------------

import type { FruitAbilityId, GameEvent, PlayerState } from "../core/GameState";
import { fruitExpRequiredForLevel } from "./FruitLeveling";
import { FRUIT_CATALOG } from "./ShopSystem";

/** 카탈로그(구매 가능 목록)에 없는 기본 시작 열매의 한글 이름 */
const FALLBACK_FRUIT_NAMES: Partial<Record<FruitAbilityId, string>> = {
  magma_fist: "마그마 열매",
};

/** 열매 id → 한글 이름 (UI에서도 씁니다) */
export function fruitDisplayName(fruitId: FruitAbilityId): string {
  return FRUIT_CATALOG.find((f) => f.id === fruitId)?.name ?? FALLBACK_FRUIT_NAMES[fruitId] ?? fruitId;
}

/**
 * 지금 장착 중인 열매의 레벨/경험치를 fruitMastery 캐시에 적어둡니다.
 * 열매를 바꾸기 직전에 반드시 호출해야 숙련도를 잃지 않습니다.
 */
export function syncFruitMasteryCache(player: PlayerState) {
  player.fruitMastery[player.equippedFruit] = {
    level: player.fruitLevel,
    exp: player.fruitExp,
    expToNext: player.fruitExpToNext,
  };
}

/** 저장된 숙련도가 있으면 불러오고, 처음 장착하는 열매라면 1레벨부터 시작합니다. */
function loadFruitMasteryCache(player: PlayerState, fruitId: FruitAbilityId) {
  const saved = player.fruitMastery[fruitId];
  if (saved) {
    player.fruitLevel = saved.level;
    player.fruitExp = saved.exp;
    player.fruitExpToNext = saved.expToNext;
  } else {
    player.fruitLevel = 1;
    player.fruitExp = 0;
    player.fruitExpToNext = fruitExpRequiredForLevel(1);
  }
}

/** 이미 장착 중이거나 인벤토리에 갖고 있는 열매인지 (중복 구매 방지용) */
export function ownsFruit(player: PlayerState, fruitId: FruitAbilityId): boolean {
  return player.equippedFruit === fruitId || player.fruitInventory.includes(fruitId);
}

/** 상점/열매 상인/뽑기에서 얻은 열매를 인벤토리에 넣습니다. 자동 장착하지 않습니다. */
export function addFruitToInventory(player: PlayerState, fruitId: FruitAbilityId) {
  player.fruitInventory.push(fruitId);
}

/**
 * 인벤토리의 열매를 장착합니다. **확인은 이 함수를 부르기 전에 이미
 * 끝났다고 가정합니다** (UI가 "정말 교체하시겠습니까?" 다이얼로그를 먼저
 * 띄우고, 사용자가 동의했을 때만 이 함수를 호출해야 합니다).
 *
 * @returns 실제로 장착이 바뀌었으면 true. 인벤토리에 없거나 이미 장착
 *          중인 열매라면 아무것도 하지 않고 false.
 */
export function equipFruitFromInventory(
  player: PlayerState,
  fruitId: FruitAbilityId,
  events: GameEvent[],
): boolean {
  const idx = player.fruitInventory.indexOf(fruitId);
  if (idx === -1) return false;
  if (player.equippedFruit === fruitId) return false; // 이미 장착 중 — 할 일 없음

  const replacedFruitId = player.equippedFruit;
  syncFruitMasteryCache(player); // 옛 열매 숙련도 저장 (열매 아이템 자체는 버려짐)

  player.fruitInventory.splice(idx, 1);
  player.equippedFruit = fruitId;
  loadFruitMasteryCache(player, fruitId);
  player.skillCooldowns = [0, 0, 0, 0];
  player.chargingSkillSlot = null;

  events.push({
    type: "fruit_equipped",
    fruitName: fruitDisplayName(fruitId),
    replacedFruitName: fruitDisplayName(replacedFruitId),
  });
  return true;
}
