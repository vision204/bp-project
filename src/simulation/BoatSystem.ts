import type { BoatTierId, GameEvent, GameState, Vec3 } from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { ISLANDS, boatPosition, dockDirection, getIsland, type IslandDef } from "../world/islands";

/** 배를 부두로 부르는 비용 — 아주 저렴하게 (배 자체의 구매가와는 별개) */
export const BOAT_PRICE = 5;

export interface BoatTierDef {
  id: BoatTierId;
  name: string;
  icon: string;
  /** 상점 구매가. 기본 돛단배는 처음부터 가지고 있어서 0 */
  price: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  acceleration: number;
  /** 초당 회전 속도(라디안). 클수록 민첩합니다 */
  turnRate: number;
  hullColor: number;
  sailColor: number;
  description: string;
}

/** 위로 갈수록 비싸고 빠릅니다. 소환하면 보유 중인 가장 좋은 배가 나옵니다. */
export const BOAT_TIERS: BoatTierDef[] = [
  {
    id: "dinghy",
    name: "낡은 돛단배",
    icon: "⛵",
    price: 0,
    maxForwardSpeed: 18,
    maxReverseSpeed: 7,
    acceleration: 12,
    turnRate: 1.5,
    hullColor: 0x8d5524,
    sailColor: 0xf5f0e1,
    description: "처음부터 가지고 있는 기본 배. 느리지만 어디든 갈 수는 있습니다.",
  },
  {
    id: "clipper",
    name: "쾌속정",
    icon: "🚤",
    price: 450,
    maxForwardSpeed: 32,
    maxReverseSpeed: 12,
    acceleration: 22,
    turnRate: 2.1,
    hullColor: 0x37474f,
    sailColor: 0x80d8ff,
    description: "날렵한 선체. 기본 배보다 약 1.8배 빠르고 선회도 민첩합니다.",
  },
  {
    id: "galewind",
    name: "질풍호",
    icon: "🛥️",
    price: 1600,
    maxForwardSpeed: 48,
    maxReverseSpeed: 18,
    acceleration: 34,
    turnRate: 2.7,
    hullColor: 0x4a148c,
    sailColor: 0xffd54f,
    description: "바람을 가르는 최고급 쾌속선. 기본 배의 2.7배 속도로 대양을 단숨에 건넙니다.",
  },
];

export function boatTier(id: BoatTierId): BoatTierDef {
  return BOAT_TIERS.find((t) => t.id === id) ?? BOAT_TIERS[0];
}

/** 보유 중인 배 가운데 가장 좋은 등급 */
export function bestOwnedBoat(owned: BoatTierId[]): BoatTierDef {
  let best = BOAT_TIERS[0];
  for (const tier of BOAT_TIERS) {
    if (owned.includes(tier.id) && tier.price >= best.price) best = tier;
  }
  return best;
}

export function buyBoatTier(player: { money: number; ownedBoats: BoatTierId[] }, tierId: BoatTierId, events: GameEvent[]) {
  const tier = boatTier(tierId);
  if (player.ownedBoats.includes(tierId)) {
    events.push({ type: "purchase_failed", reason: "이미 보유한 배입니다" });
    return false;
  }
  if (player.money < tier.price) {
    events.push({ type: "purchase_failed", reason: "코인이 부족합니다" });
    return false;
  }
  player.money -= tier.price;
  player.ownedBoats.push(tierId);
  events.push({ type: "boat_bought", boatName: tier.name });
  return true;
}

const DRAG = 3.5;

/** 배가 섬에 얼마나 가까이 접근할 수 있는지 (해변 바깥쪽에서 멈춤) */
const ISLAND_CLEARANCE = 7;
/** 이 거리 안이면 배에 탈 수 있음 */
export const BOARD_RANGE = 5;
/** 내릴 때 이 거리 안에 섬이 있으면 뭍으로 올려줍니다 */
const LANDING_RANGE = 22;

export const BOAT_DECK_Y = 0.9;

function dist2D(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

/** 배 위에서 플레이어가 서 있는 위치 (갑판 위) */
export function boatDeckPosition(boat: { position: Vec3 }): Vec3 {
  return { x: boat.position.x, y: boat.position.y + BOAT_DECK_Y, z: boat.position.z };
}

/** 뱃사공에게 배를 구매/재소환 — 그 섬 부두 끝에 나타납니다. */
export function summonBoat(state: GameState, islandId: string, events: GameEvent[]): boolean {
  const player = state.player;
  if (player.money < BOAT_PRICE) {
    events.push({ type: "purchase_failed", reason: `코인이 부족합니다 (🪙${BOAT_PRICE} 필요)` });
    return false;
  }

  const spot = boatPosition(getIsland(islandId));
  const tier = bestOwnedBoat(player.ownedBoats);
  player.money -= BOAT_PRICE;
  state.boat.tier = tier.id;
  state.boat.spawned = true;
  state.boat.riding = false;
  state.boat.speed = 0;
  state.boat.position = { ...spot };
  // 부두 바깥쪽(바다 방향)을 향하도록
  const dir = dockDirection(getIsland(islandId));
  state.boat.yaw = Math.atan2(dir.x, dir.z);
  events.push({ type: "boat_summoned", boatName: tier.name });
  return true;
}

export function boardBoat(state: GameState, events: GameEvent[]) {
  state.boat.riding = true;
  state.boat.speed = 0;
  events.push({ type: "boat_boarded" });
}

/** 가장 가까운 섬을 찾습니다 (거리 포함) */
function nearestIsland(x: number, z: number): { island: IslandDef; dist: number } {
  let best = { island: ISLANDS[0], dist: Infinity };
  for (const island of ISLANDS) {
    const d = dist2D(x, z, island.center.x, island.center.z);
    if (d < best.dist) best = { island, dist: d };
  }
  return best;
}

/**
 * 배에서 내립니다. 가까이에 섬이 있으면 그 섬 해안으로 올라가고,
 * 먼 바다 한가운데면 그대로 물에 빠집니다(익사 데미지 시작).
 */
export function leaveBoat(
  state: GameState,
  events: GameEvent[],
  teleport: (pos: Vec3) => void,
): void {
  const boat = state.boat;
  const { island, dist } = nearestIsland(boat.position.x, boat.position.z);

  boat.riding = false;
  boat.speed = 0;

  if (dist <= island.radius + LANDING_RANGE) {
    // 섬 중심 방향으로 살짝 안쪽에 내려놓아 해변 위에 서게 함
    const dx = island.center.x - boat.position.x;
    const dz = island.center.z - boat.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const landing = {
      x: island.center.x - (dx / len) * (island.radius - 3),
      y: 2,
      z: island.center.z - (dz / len) * (island.radius - 3),
    };
    state.player.position = { ...landing };
    teleport(landing);
    events.push({ type: "boat_left", landed: true });
  } else {
    const drop = { x: boat.position.x + 3, y: 0, z: boat.position.z };
    state.player.position = { ...drop };
    teleport(drop);
    events.push({ type: "boat_left", landed: false });
  }
}

/**
 * 탑승 중일 때 WASD로 배를 조종합니다.
 * W/S = 전진·후진, A/D = 좌우 선회. 배는 섬(해변)에 부딪히면 멈춥니다.
 */
export function stepBoat(state: GameState, dt: number, input: InputSnapshot) {
  const boat = state.boat;
  if (!boat.spawned || !boat.riding) return;

  const tier = boatTier(boat.tier);

  // 선회
  if (input.moveLeft) boat.yaw += tier.turnRate * dt;
  if (input.moveRight) boat.yaw -= tier.turnRate * dt;

  // 가감속
  if (input.moveForward) {
    boat.speed += tier.acceleration * dt;
  } else if (input.moveBackward) {
    boat.speed -= tier.acceleration * dt;
  } else {
    // 입력이 없으면 물의 저항으로 서서히 감속
    const drag = DRAG * dt;
    boat.speed = Math.abs(boat.speed) <= drag ? 0 : boat.speed - Math.sign(boat.speed) * drag;
  }
  boat.speed = Math.max(-tier.maxReverseSpeed, Math.min(tier.maxForwardSpeed, boat.speed));

  const fx = Math.sin(boat.yaw);
  const fz = Math.cos(boat.yaw);
  const nextX = boat.position.x + fx * boat.speed * dt;
  const nextZ = boat.position.z + fz * boat.speed * dt;

  // 섬에 부딪히면 그 앞에서 멈춤
  const { island, dist } = nearestIsland(nextX, nextZ);
  const minDist = island.radius + ISLAND_CLEARANCE;
  if (dist < minDist) {
    const dx = nextX - island.center.x;
    const dz = nextZ - island.center.z;
    const len = Math.hypot(dx, dz) || 1;
    boat.position.x = island.center.x + (dx / len) * minDist;
    boat.position.z = island.center.z + (dz / len) * minDist;
    boat.speed = 0;
  } else {
    boat.position.x = nextX;
    boat.position.z = nextZ;
  }

  // 파도에 따라 살짝 위아래로 흔들림
  boat.position.y = -0.35 + Math.sin(state.elapsedSec * 1.2) * 0.08;
}

/** 배에 탈 수 있는 거리인지 */
export function canBoardBoat(state: GameState) {
  if (!state.boat.spawned || state.boat.riding) return false;
  const p = state.player.position;
  return dist2D(p.x, p.z, state.boat.position.x, state.boat.position.z) <= BOARD_RANGE;
}
