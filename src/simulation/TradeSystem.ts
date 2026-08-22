// ---------------------------------------------------------------------------
// 거래(P2P trade)·선물의 순수 로직 — 내 인벤토리에서 빼고, 상대가 준 걸 더하는
// 두 가지 연산만 합니다. DOM·네트워크를 모르는 순수 함수라 verify-logic.mjs가
// 브라우저 없이 그대로 검증할 수 있습니다 (이 프로젝트의 simulation/ 모듈들과
// 같은 성질입니다).
//
// ⚠️ 신뢰 경계: 서버는 인벤토리를 동기화하지 않으므로(원래부터 각자
// 로컬입니다), "상대가 준 아이템"이 실제로 상대 인벤토리에 있었는지 서버가
// 확인할 방법이 없습니다. 이 파일은 "내가 받은 걸 더하고, 내가 준 걸 뺀다"는
// 각자 클라이언트 쪽 절반만 책임집니다 — README "신뢰 경계" 절 참고.
// ---------------------------------------------------------------------------

import type { InventoryItem, ItemId, PlayerState } from "../core/GameState";
import { addItem } from "./InventorySystem";

export const MAX_TRADE_SLOTS = 9;

/** 거래창 한쪽에 올릴 수 있는 개수로 자릅니다. */
export function clampTradeOffer<T>(items: T[]): T[] {
  return items.slice(0, MAX_TRADE_SLOTS);
}

/**
 * 내 인벤토리에서 itemId를 quantity만큼 뺍니다. 가진 것보다 많이 요청하면
 * 가진 만큼만 빼고(음수가 되지 않게), 실제로 뺀 개수를 돌려줍니다.
 * 다 빠져서 0개가 되면 인벤토리에서 지우고, 단축바에 있었다면 그 칸도 비웁니다
 * (없는 아이템이 손에 들려 있는 채로 남는 걸 막기 위해서).
 */
export function removeFromInventory(player: PlayerState, itemId: ItemId, quantity: number): number {
  if (quantity <= 0) return 0;
  const idx = player.inventory.findIndex((i) => i.id === itemId);
  if (idx === -1) return 0;

  const item = player.inventory[idx];
  const taken = Math.min(item.quantity, Math.floor(quantity));
  item.quantity -= taken;

  if (item.quantity <= 0) {
    player.inventory.splice(idx, 1);
    for (let slot = 0; slot < player.hotbar.length; slot++) {
      if (player.hotbar[slot] !== itemId) continue;
      player.hotbar[slot] = null;
      if (player.activeHotbarSlot === slot) player.activeHotbarSlot = null;
    }
  }
  return taken;
}

/** 상대가 준 아이템들을 내 인벤토리에 더합니다(기존 InventorySystem.addItem 그대로 재사용). */
export function applyReceivedItems(player: PlayerState, items: InventoryItem[]) {
  for (const item of items) {
    if (!item || item.quantity <= 0) continue;
    addItem(
      player,
      {
        id: item.id,
        name: item.name,
        description: item.description,
        icon: item.icon,
        usable: item.usable,
        equippable: item.equippable,
      },
      item.quantity,
    );
  }
}

/** 제안한 만큼 실제로 가지고 있는지 — 거래창을 만들 때 내가 나 자신을 속이지 않도록 하는 확인용. */
export function offerIsAffordable(player: PlayerState, offer: InventoryItem[]): boolean {
  return offer.every((o) => {
    if (o.quantity <= 0) return false;
    const have = player.inventory.find((i) => i.id === o.id)?.quantity ?? 0;
    return have >= o.quantity;
  });
}
