import type { FruitAbilityId, GameEvent, ItemId, PlayerState } from "../core/GameState";
import { addItem } from "./InventorySystem";
import { WEAPONS, weaponFor } from "./WeaponSystem";
import { getIsland } from "../world/islands";

export interface FruitCatalogEntry {
  id: FruitAbilityId;
  name: string;
  description: string;
  icon: string;
  /** 중앙 교역섬 열매 상인이 받는 게임 화폐(코인) 가격 */
  price: number;
  /**
   * 화면 상점(프리미엄 코너)에 표시할 **원화 가격**.
   * 결제 기능은 아직 없습니다 — PG사 연동 전이라 UI 표시와 안내만 합니다.
   */
  cashPrice: number;
  /** 이 열매의 성향 한 줄 소개 (구체적인 스킬 수치는 skills.ts가 담당) */
  style: string;
}

/**
 * 프리미엄(현금) 상점은 **표시 전용**입니다.
 * 실제 결제는 PG사 연동이 끝난 뒤에 붙일 예정이라, 지금은 결제창을 띄우거나
 * 아이템을 지급하는 코드가 아예 없습니다. 눌러도 안내만 나갑니다.
 */
export const CASH_PAYMENT_ENABLED = false;
export const CASH_PAYMENT_NOTICE =
  "결제 시스템 준비 중입니다 (PG사 연동 예정) — 중앙 교역섬의 열매 상인에게 코인으로 살 수 있어요";

/**
 * 상점에서 판매하는 악마의 열매 5종.
 * 블록스피스와 마찬가지로 **악마의 열매는 한 번에 하나만** 먹을 수 있습니다.
 * 새 열매를 사면 기존에 먹은 열매 능력이 사라지고 새 것으로 교체됩니다.
 */
export const FRUIT_CATALOG: FruitCatalogEntry[] = [
  {
    id: "ice_lance",
    name: "얼음 열매",
    description: "아이스 랜스 — 사거리가 길어 견제에 좋은 냉기 창을 날립니다.",
    icon: "❄️",
    price: 80,
    cashPrice: 3900,
    style: "직선 관통 + 둔화 특화. 거리를 두고 싸우기 좋습니다.",
  },
  {
    id: "thunder_strike",
    name: "번개 열매",
    description: "선더 스트라이크 — 쿨다운이 짧아 자주 쓸 수 있는 전격 공격.",
    icon: "⚡",
    price: 100,
    cashPrice: 4900,
    style: "짧은 쿨다운과 돌진 기동. 치고 빠지는 전투에 강합니다.",
  },
  {
    id: "dark_wave",
    name: "어둠 열매",
    description: "다크니스 웨이브 — 코스트가 크지만 강력한 광역 어둠 파동.",
    icon: "🌑",
    price: 150,
    cashPrice: 7900,
    style: "높은 피해량과 흡혈. 코스트가 크지만 한 방이 묵직합니다.",
  },
  {
    id: "rubber_barrage",
    name: "고무 열매",
    description: "고무 콤보 — 균형 잡힌 성능의 연속 타격형 능력.",
    icon: "🥊",
    price: 90,
    cashPrice: 4400,
    style: "돌진과 연타, 궁극기는 자기 강화(기어 세컨드).",
  },
  {
    id: "sand_storm",
    name: "모래 열매",
    description: "샌드 스톰 — 넓은 범위를 휩쓰는 모래 폭풍.",
    icon: "🏜️",
    price: 70,
    cashPrice: 3400,
    style: "넓은 범위와 지속 피해. 다수 상대에 유리합니다.",
  },
];

export interface ItemCatalogEntry {
  id: ItemId;
  name: string;
  description: string;
  icon: string;
  price: number;
  usable: boolean;
  equippable?: boolean;
}

/** 상점의 소모품 코너 */
export const ITEM_CATALOG: ItemCatalogEntry[] = [
  {
    id: "potion_exp",
    name: "경험치 2배 포션",
    description: "10분 동안 획득 경험치가 2배가 됩니다. 인벤토리(I)에서 클릭해 사용하세요.",
    icon: "🍯",
    price: 20,
    usable: true,
  },
  {
    id: "potion_small",
    name: "회복 포션",
    description: "체력을 50 회복합니다. 인벤토리(I)에서 클릭해 사용하세요.",
    icon: "🧪",
    price: 15,
    usable: true,
  },
];

/**
 * 무기 코너 — 사면 인벤토리에 들어가고, 거기서 단축바에 올린 뒤 숫자키로 뽑습니다.
 *
 * 삼도류는 화면 상점에서 팔지 않습니다 (얼음 섬 설인에게만 삽니다).
 * 그래서 상점 목록에서는 걸러냅니다.
 */
export const TRAINER_ONLY_WEAPONS = new Set(["sword_santoryu"]);

export const WEAPON_CATALOG: ItemCatalogEntry[] = Object.values(WEAPONS)
  .filter((w): w is NonNullable<typeof w> => !!w)
  .filter((w) => !TRAINER_ONLY_WEAPONS.has(w.id))
  .map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    icon: w.icon,
    price: w.price,
    usable: false,
    equippable: true,
  }));

/** 악마의 열매 구매 — 성공하면 기존 열매를 교체합니다 (한 번에 하나만 보유 가능). */
export function buyFruit(player: PlayerState, fruitId: FruitAbilityId, events: GameEvent[]): boolean {
  const entry = FRUIT_CATALOG.find((f) => f.id === fruitId);
  if (!entry) return false;
  if (player.equippedFruit === entry.id) {
    events.push({ type: "purchase_failed", reason: "이미 먹은 열매입니다" });
    return false;
  }
  if (player.money < entry.price) {
    events.push({ type: "purchase_failed", reason: "코인이 부족합니다" });
    return false;
  }

  player.money -= entry.price;
  // 장착 열매 교체 = 스킬 4개가 통째로 바뀝니다. 쿨다운은 초기화.
  // 열매 레벨(숙련도)은 캐릭터의 것이라 열매를 바꿔도 유지됩니다.
  player.equippedFruit = entry.id;
  player.skillCooldowns = [0, 0, 0, 0];
  events.push({ type: "fruit_purchased", fruitName: entry.name });
  return true;
}

/** 살 수 있는 모든 물건 (상점 + 설인 전용 무기) */
export const ALL_PURCHASABLE: ItemCatalogEntry[] = [
  ...ITEM_CATALOG,
  ...Object.values(WEAPONS)
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      icon: w.icon,
      price: w.price,
      usable: false,
      equippable: true,
    })),
];

/**
 * @param currentIslandId 지금 있는 섬 id. 섬 전용 무기(예: 화산 섬의 엔마)는
 *   화면 상점 목록에는 그대로 나오지만, 그 섬에 있을 때만 실제로 구매됩니다 —
 *   UI에서 버튼을 막아도, 여기서 한 번 더 막아야 진짜 방어선이 됩니다.
 */
export function buyItem(
  player: PlayerState,
  itemId: ItemId,
  events: GameEvent[],
  currentIslandId: string | null = null,
): boolean {
  const entry = ALL_PURCHASABLE.find((i) => i.id === itemId);
  if (!entry) return false;
  const lockedIsland = weaponFor(itemId)?.islandLock;
  if (lockedIsland && currentIslandId !== lockedIsland) {
    events.push({ type: "purchase_failed", reason: `${getIsland(lockedIsland).name}에서만 구매할 수 있습니다` });
    return false;
  }
  if (entry.equippable && player.inventory.some((i) => i.id === itemId)) {
    events.push({ type: "purchase_failed", reason: "이미 보유한 장비입니다" });
    return false;
  }
  if (player.money < entry.price) {
    events.push({ type: "purchase_failed", reason: "코인이 부족합니다" });
    return false;
  }

  player.money -= entry.price;
  addItem(player, {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    usable: entry.usable,
    equippable: entry.equippable,
  });
  events.push({ type: "item_purchased", itemName: entry.name });
  return true;
}
