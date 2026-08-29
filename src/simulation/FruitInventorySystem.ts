// ---------------------------------------------------------------------------
// 열매 인벤토리 — 상점/열매 상인/뽑기로 얻은 열매를 곧바로 장착하지 않고
// 일단 인벤토리에 보관했다가, 실제로 "먹어서"(확정) equippedFruit이 되기까지
// 두 단계를 거치도록 하는 시스템입니다.
//
// 규칙 (사용자 요청 그대로):
//   · 열매를 얻으면 fruitInventory에 쌓입니다 (자동 장착 X).
//   · 인벤토리에서 "손에 들기"를 누르면 그 열매가 heldFruitCandidate가 되어
//     오른손에 들립니다(렌더러가 처리) — 이 시점엔 아직 능력이 바뀌지
//     않습니다. 손에 들고 있는 동안은 (기존에 먹은 열매 것이든 뭐든)
//     Z/X/C/V 스킬이 전혀 발동하지 않습니다.
//   · 그 상태에서 좌클릭하면(main.ts가 가로챕니다) "정말 열매를 교체
//     하시겠습니까? 기존의 열매는 삭제되지만 숙련도 레벨은 저장됩니다"
//     확인창이 뜹니다. 예를 누르면 confirmHeldFruitEquip이 실행되어 —
//       - 기존에 먹은 열매는 "삭제"됩니다(인벤토리로 돌아가지 않음). 다만
//         그 열매의 숙련도(fruitMastery)는 그대로 남아서, 나중에 같은
//         열매를 다시 얻어 먹으면 이전 레벨부터 이어집니다.
//       - 손에 든 열매는 손에서 사라지고(먹음) equippedFruit이 되어
//         "항상 적용된" 상태로 바뀝니다.
//     아니오를 누르거나 그냥 무시하면 계속 손에 든 채로 남고, 스킬은
//     여전히 안 써집니다 — 다른 열매로 바꿔 들거나(다시 "손에 들기") 4번
//     키로 도로 인벤토리에 넣을 수 있습니다(cancelHeldFruitCandidate).
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

/** 이미 장착 중이거나, 인벤토리 또는 손(미확정)에 갖고 있는 열매인지 (중복 구매 방지용) */
export function ownsFruit(player: PlayerState, fruitId: FruitAbilityId): boolean {
  return (
    player.equippedFruit === fruitId ||
    player.heldFruitCandidate === fruitId ||
    player.fruitInventory.includes(fruitId)
  );
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

/**
 * 인벤토리의 열매를 오른손에 "들기"만 합니다 — 아직 먹는(확정) 게 아니라서
 * equippedFruit은 그대로고, 스킬도 안 써집니다. 손에 이미 다른(확정 안 된)
 * 열매를 들고 있었다면 그건 인벤토리로 돌아가고 이번 열매로 바뀝니다.
 */
export function holdFruitCandidate(player: PlayerState, fruitId: FruitAbilityId): boolean {
  const idx = player.fruitInventory.indexOf(fruitId);
  if (idx === -1) return false;
  if (player.heldFruitCandidate === fruitId) return true; // 이미 이 열매를 들고 있음

  if (player.heldFruitCandidate) {
    player.fruitInventory.push(player.heldFruitCandidate); // 들고 있던 걸 다시 인벤토리로
  }
  player.fruitInventory.splice(idx, 1);
  player.heldFruitCandidate = fruitId;

  // 손이 이 열매로 찼으니, 무기든 먹은 열매든 뽑혀 있던 건 집어넣습니다
  // (무기/열매/후보 열매는 항상 셋 중 하나만 손에 들 수 있습니다).
  player.fruitDrawn = false;
  player.activeHotbarSlot = null;
  player.chargingSkillSlot = null;
  return true;
}

/** 손에 든(아직 안 먹은) 열매를 도로 인벤토리에 넣습니다. */
export function cancelHeldFruitCandidate(player: PlayerState): boolean {
  if (!player.heldFruitCandidate) return false;
  player.fruitInventory.push(player.heldFruitCandidate);
  player.heldFruitCandidate = null;
  return true;
}

/**
 * 손에 든 열매를 실제로 "먹습니다" — 확인 다이얼로그에서 예를 눌렀을 때만
 * 호출해야 합니다. 이미 먹은 열매가 있었다면 그건 삭제되고(숙련도만 저장),
 * 손에 든 열매가 새 equippedFruit이 되며 손에서 사라집니다.
 */
export function confirmHeldFruitEquip(player: PlayerState, events: GameEvent[]): boolean {
  const fruitId = player.heldFruitCandidate;
  if (!fruitId) return false;

  const replacedFruitId = player.equippedFruit;
  syncFruitMasteryCache(player); // 옛 열매 숙련도 저장 (열매 아이템 자체는 버려짐)

  player.heldFruitCandidate = null;
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
