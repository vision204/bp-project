import type { GameEvent, InventoryItem, ItemId, PlayerState } from "../core/GameState";
import { activateExpBuff } from "./BuffSystem";
import { isWeapon, toggleHotbar, weaponFor } from "./WeaponSystem";

const HEAL_AMOUNT = 50;

export function addItem(player: PlayerState, item: Omit<InventoryItem, "quantity">, quantity = 1) {
  const existing = player.inventory.find((i) => i.id === item.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    player.inventory.push({ ...item, quantity });
  }
}

function consumeOne(player: PlayerState, itemId: ItemId) {
  const idx = player.inventory.findIndex((i) => i.id === itemId);
  if (idx === -1) return false;
  const item = player.inventory[idx];
  item.quantity -= 1;
  if (item.quantity <= 0) player.inventory.splice(idx, 1);
  return true;
}

/** 인벤토리에서 아이템 사용. 사용 가능한 아이템만 처리하고, 쓰면 1개 소모합니다. */
export function useItem(player: PlayerState, itemId: ItemId, events: GameEvent[]): boolean {
  const item = player.inventory.find((i) => i.id === itemId);
  if (!item) return false;

  // 장비(검 등)는 소모되지 않고 단축바에 올라갑니다 — 실제 장착은 숫자키로.
  if (isWeapon(itemId)) {
    const slot = toggleHotbar(player, itemId);
    const weapon = weaponFor(itemId)!;
    if (slot === null) {
      events.push({ type: "item_hotbarred", itemName: weapon.name, slot: -1 });
    } else {
      events.push({ type: "item_hotbarred", itemName: weapon.name, slot });
    }
    return true;
  }

  if (!item.usable) return false;

  switch (itemId) {
    case "potion_exp": {
      if (!consumeOne(player, itemId)) return false;
      activateExpBuff(player);
      events.push({ type: "item_used", itemName: item.name });
      return true;
    }
    case "potion_small": {
      if (player.hp >= player.maxHp) {
        events.push({ type: "purchase_failed", reason: "체력이 이미 가득 찼습니다" });
        return false;
      }
      if (!consumeOne(player, itemId)) return false;
      player.hp = Math.min(player.maxHp, player.hp + HEAL_AMOUNT);
      events.push({ type: "item_used", itemName: item.name });
      return true;
    }
    default:
      return false;
  }
}
