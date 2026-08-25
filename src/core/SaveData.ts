// ---------------------------------------------------------------------------
// 세이브 데이터 — GameState ↔ 저장용 평평한 JSON 변환.
//
// **Firebase를 전혀 모릅니다.** 순수 변환 함수만 있어서 브라우저 없이 왕복 검증이
// 가능하고, 나중에 저장소를 Firestore가 아닌 다른 것으로 바꿔도 이 파일은 그대로입니다.
//
// 설계 원칙
//   · 파생 가능한 값(최대체력, 요구 경험치 등)은 저장하지 않고 불러올 때 다시 계산합니다.
//     저장 용량도 줄고, 밸런스 상수를 고쳤을 때 옛 세이브가 새 밸런스를 따라옵니다.
//   · 남이 고쳐 넣은 값이 들어와도 게임이 깨지지 않도록 전부 검사하고 자릅니다
//     (레벨 999999, 존재하지 않는 열매 id 같은 것들).
//   · version을 붙여서, 나중에 구조가 바뀌어도 옛 세이브를 이전할 수 있게 했습니다.
// ---------------------------------------------------------------------------

import {
  createInitialGameState,
  expRequiredForLevel,
  type BoatTierId,
  type Faction,
  type FruitAbilityId,
  type GameState,
  type ItemId,
  type Sea,
} from "./GameState";
import { MAX_LEVEL } from "./ExpCurve";
import { ISLANDS, getIsland, startIslandFor } from "../world/islands";
import { recomputeDerivedStats } from "../simulation/StatSystem";
import { fruitExpRequiredForLevel, MAX_FRUIT_LEVEL } from "../simulation/FruitLeveling";
import { MAX_WEAPON_LEVEL, weaponExpRequiredForLevel } from "../simulation/WeaponLeveling";
import { ALL_PURCHASABLE, FRUIT_CATALOG } from "../simulation/ShopSystem";
import { isWeapon } from "../simulation/WeaponSystem";
import { BOAT_TIERS } from "../simulation/BoatSystem";
import { MAX_JUMPS } from "../simulation/TrainerSystem";

export const SAVE_VERSION = 1;

// 캐릭터 레벨 상한(MAX_LEVEL)은 core/ExpCurve.ts에 있습니다 — 실제 만렙 게임플레이
// 캡(grantExp가 거기서 멈춤)과 "조작된 세이브 값을 자르는 선"이 서로 다른 숫자면
// 만렙을 넘겨 조작한 세이브가 통과할 수 있으므로, 두 군데서 같은 값을 하나만 씁니다.

export interface SavedQuest {
  islandId: string;
  completions: number;
}

export interface SaveData {
  version: number;
  faction: Faction;

  level: number;
  exp: number;
  money: number;
  stats: { attack: number; defense: number; sword: number; gun: number; fruit: number };
  unspentStatPoints: number;

  equippedFruit: FruitAbilityId;
  fruitLevel: number;
  fruitExp: number;

  /** 무기별 숙련도 — 손에 들어본 적 있는 무기만 들어 있습니다. */
  weaponMastery: { id: ItemId; level: number; exp: number }[];

  hakiLearned: boolean;
  /** 배운 점프 단수 (1 = 기본) */
  maxJumps: number;
  /** R키 순간이동을 배웠는지 */
  teleportLearned: boolean;
  /** 두 번째 바다를 연 적이 있는지 (첫 항해에만 Lv.1100이 필요) */
  unlockedSecondSea: boolean;

  inventory: { id: ItemId; quantity: number }[];
  hotbar: (ItemId | null)[];
  ownedBoats: BoatTierId[];

  quests: SavedQuest[];

  /**
   * 마지막으로 열매를 뽑은 시각(epoch ms).
   * 클라우드에 저장할 때는 **서버 시각**으로 덮어써서, 클라이언트 시계를 조작해도
   * 4시간 제한을 우회할 수 없게 합니다.
   */
  lastGachaAtMs: number | null;

  /** 마지막으로 있던 섬 — 다시 접속하면 여기서 시작합니다 */
  currentIslandId: string;

  /** 마지막으로 있던 바다 (1 또는 2) */
  sea: Sea;

  /** 저장 시각 (표시용) */
  savedAtMs: number;
}

const FRUIT_IDS = new Set(FRUIT_CATALOG.map((f) => f.id));
// 상점 목록(WEAPON_CATALOG)만 쓰면 설인 전용 무기(삼도류)가 불러오기에서 사라집니다.
// 그래서 "살 수 있는 모든 물건" 기준으로 복원합니다.
const ITEM_IDS = new Set(ALL_PURCHASABLE.map((i) => i.id));
const BOAT_IDS = new Set(BOAT_TIERS.map((b) => b.id));
const ISLAND_IDS = new Set(ISLANDS.map((i) => i.id));

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && isFinite(value) ? Math.floor(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** 현재 게임 상태 → 저장용 데이터 */
export function toSaveData(state: GameState, savedAtMs: number): SaveData {
  const p = state.player;
  return {
    version: SAVE_VERSION,
    faction: p.faction,
    level: p.level,
    exp: p.exp,
    money: p.money,
    stats: { ...p.stats },
    unspentStatPoints: p.unspentStatPoints,
    equippedFruit: p.equippedFruit,
    fruitLevel: p.fruitLevel,
    fruitExp: p.fruitExp,
    weaponMastery: (Object.entries(p.weaponMastery) as [ItemId, { level: number; exp: number }][])
      .map(([id, m]) => ({ id, level: m.level, exp: m.exp })),
    hakiLearned: p.hakiLearned,
    maxJumps: p.maxJumps,
    teleportLearned: p.teleportLearned,
    unlockedSecondSea: p.unlockedSecondSea,
    // 아이템은 id와 개수만 — 이름·설명은 카탈로그에서 다시 붙입니다.
    inventory: p.inventory.map((i) => ({ id: i.id, quantity: i.quantity })),
    hotbar: [...p.hotbar],
    ownedBoats: [...p.ownedBoats],
    quests: state.quests
      .filter((q) => q.completions > 0)
      .map((q) => ({ islandId: q.islandId, completions: q.completions })),
    lastGachaAtMs: p.lastGachaAtMs,
    currentIslandId: state.currentIslandId ?? startIslandFor(p.faction).id,
    sea: state.sea,
    savedAtMs,
  };
}

/**
 * 저장 데이터를 GameState에 덮어씁니다.
 * 값이 이상하면 조용히 기본값으로 되돌리고, 절대 예외를 던지지 않습니다
 * (세이브 하나 때문에 게임이 아예 안 켜지는 게 최악이라서).
 */
export function applySaveData(state: GameState, raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const data = raw as Partial<SaveData>;
  if (typeof data.version !== "number") return false;

  const p = state.player;

  if (data.faction === "pirate" || data.faction === "marine") p.faction = data.faction;

  p.level = clampInt(data.level, 1, MAX_LEVEL, 1);
  p.expToNextLevel = expRequiredForLevel(p.level);
  p.exp = clampInt(data.exp, 0, p.expToNextLevel - 1, 0);
  p.money = clampInt(data.money, 0, Number.MAX_SAFE_INTEGER, 0);

  // 5스탯(공격/방어/검/총/열매) 체계 이전에는 4스탯(마나/공격력/체력/열매)이었습니다.
  // "defense" 키가 없으면서 예전 키(mana/health)가 있는 세이브는 예전 형식으로 보고,
  // 마나+공격력을 공격 하나로 합치고 체력을 방어로 옮겨 마이그레이션합니다.
  // 검/총은 그때 없던 스텟이라 0부터 새로 찍습니다 — 쓴 적 없는 포인트를 잃는 게
  // 아니라(unspentStatPoints는 그대로 복원), 그 두 스텟만 아직 안 찍힌 상태가 됩니다.
  const rawStats = (data.stats ?? {}) as Record<string, unknown>;
  const readStat = (key: string) => clampInt(rawStats[key], 0, MAX_LEVEL * 3, 0);
  const isLegacyStats = rawStats.defense === undefined && (rawStats.mana !== undefined || rawStats.health !== undefined);
  p.stats = isLegacyStats
    ? {
        attack: readStat("mana") + readStat("attack"),
        defense: readStat("health"),
        sword: 0,
        gun: 0,
        fruit: readStat("fruit"),
      }
    : {
        attack: readStat("attack"),
        defense: readStat("defense"),
        sword: readStat("sword"),
        gun: readStat("gun"),
        fruit: readStat("fruit"),
      };
  p.unspentStatPoints = clampInt(data.unspentStatPoints, 0, MAX_LEVEL * 3, 0);

  if (typeof data.equippedFruit === "string" && FRUIT_IDS.has(data.equippedFruit as FruitAbilityId)) {
    p.equippedFruit = data.equippedFruit as FruitAbilityId;
  }
  p.fruitLevel = clampInt(data.fruitLevel, 1, MAX_FRUIT_LEVEL, 1);
  p.fruitExpToNext = fruitExpRequiredForLevel(p.fruitLevel);
  p.fruitExp = clampInt(data.fruitExp, 0, p.fruitExpToNext - 1, 0);

  // 무기 숙련도 — 실제 무기 id만 복원하고, 값은 상식적인 범위로 자릅니다.
  p.weaponMastery = {};
  if (Array.isArray(data.weaponMastery)) {
    for (const entry of data.weaponMastery) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== "string" || !isWeapon(id as ItemId)) continue;
      const level = clampInt((entry as { level?: unknown }).level, 1, MAX_WEAPON_LEVEL, 1);
      const expToNext = weaponExpRequiredForLevel(level);
      const exp = clampInt((entry as { exp?: unknown }).exp, 0, expToNext - 1, 0);
      p.weaponMastery[id as ItemId] = { level, exp, expToNext };
    }
  }

  p.hakiLearned = data.hakiLearned === true;
  p.maxJumps = clampInt(data.maxJumps, 1, MAX_JUMPS, 1);
  p.teleportLearned = data.teleportLearned === true;
  p.teleportCooldownSec = 0; // 접속 직후에는 쿨다운 없이 바로 쓸 수 있게
  p.unlockedSecondSea = data.unlockedSecondSea === true;

  // 인벤토리 — 카탈로그에 있는 아이템만 복원하고 이름·설명은 카탈로그 기준으로 다시 붙입니다.
  p.inventory = [];
  if (Array.isArray(data.inventory)) {
    for (const entry of data.inventory) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== "string" || !ITEM_IDS.has(id as ItemId)) continue;
      const catalog = ALL_PURCHASABLE.find((i) => i.id === id)!;
      p.inventory.push({
        id: catalog.id,
        name: catalog.name,
        description: catalog.description,
        icon: catalog.icon,
        quantity: clampInt((entry as { quantity?: unknown }).quantity, 1, 9999, 1),
        usable: catalog.usable,
        equippable: catalog.equippable,
      });
    }
  }

  // 단축바 — 실제로 인벤토리에 있는 장비만 남깁니다.
  const owned = new Set(p.inventory.map((i) => i.id));
  p.hotbar = [null, null, null];
  if (Array.isArray(data.hotbar)) {
    for (let slot = 0; slot < 3; slot++) {
      const id = data.hotbar[slot];
      if (typeof id === "string" && ITEM_IDS.has(id as ItemId) && owned.has(id as ItemId)) {
        p.hotbar[slot] = id as ItemId;
      }
    }
  }
  p.activeHotbarSlot = null; // 접속하면 항상 맨손으로 시작
  p.fruitDrawn = false; // 열매도 마찬가지 — 접속 직후에는 뽑혀 있지 않음

  p.ownedBoats = ["dinghy"];
  if (Array.isArray(data.ownedBoats)) {
    for (const id of data.ownedBoats) {
      if (typeof id === "string" && BOAT_IDS.has(id as BoatTierId) && !p.ownedBoats.includes(id as BoatTierId)) {
        p.ownedBoats.push(id as BoatTierId);
      }
    }
  }

  if (Array.isArray(data.quests)) {
    for (const saved of data.quests) {
      if (!saved || typeof saved !== "object") continue;
      const quest = state.quests.find((q) => q.islandId === (saved as SavedQuest).islandId);
      if (quest) quest.completions = clampInt((saved as SavedQuest).completions, 0, 999999, 0);
    }
  }

  p.lastGachaAtMs =
    typeof data.lastGachaAtMs === "number" && isFinite(data.lastGachaAtMs) ? data.lastGachaAtMs : null;

  // 파생 능력치를 다시 계산하고 풀피로 시작합니다.
  recomputeDerivedStats(p);
  p.hp = p.maxHp;
  p.mana = p.maxMana;
  p.skillCooldowns = [0, 0, 0, 0];
  p.hakiActive = false;
  p.inWater = false;
  p.guideTargetIslandId = null;

  const islandId =
    typeof data.currentIslandId === "string" && ISLAND_IDS.has(data.currentIslandId)
      ? data.currentIslandId
      : startIslandFor(p.faction).id;
  state.currentIslandId = islandId;
  // 바다는 저장값이 아니라 **섬에서 되짚어** 정합니다. 둘이 어긋난 세이브가
  // 들어와도(손으로 고쳤든 버전이 달랐든) 좌표와 바다가 절대 따로 놀지 않습니다.
  state.sea = getIsland(islandId).sea;

  return true;
}

/** 저장 데이터만으로 새 GameState를 만듭니다 (불러오기 후 시작 위치 계산용) */
export function spawnPositionFor(state: GameState) {
  const island = getIsland(state.currentIslandId ?? startIslandFor(state.player.faction).id);
  return island;
}

/** 새 캐릭터의 기본 세이브 (로그인 직후 세이브가 없을 때) */
export function freshSaveData(faction: Faction, savedAtMs: number): SaveData {
  const state = createInitialGameState(faction);
  return toSaveData(state, savedAtMs);
}
