// ---------------------------------------------------------------------------
// 멀티플레이 서버 ↔ 클라이언트 메시지 프로토콜.
//
// 이 파일은 순수 타입/상수만 담고 있고 DOM이나 Three.js, Rapier를 모르므로
// 클라이언트(src/network/MultiplayerClient.ts)와 서버(server/*.ts) 양쪽에서
// 그대로 import해서 씁니다. 한쪽만 고치고 다른 쪽을 안 고쳐서 메시지 모양이
// 어긋나는 사고를 줄이기 위해 "진실은 하나"로 두었습니다 — 이 프로젝트가
// GameState.ts를 렌더러와 공유하는 것과 같은 이유입니다.
// ---------------------------------------------------------------------------

import type { Faction } from "../world/islands";

/** 서버 프로세스 하나 = 여러 방(room). 방 하나가 이 인원으로 꽉 차면 다음 방을 만듭니다. */
export const DEFAULT_MULTIPLAYER_PORT = 8787;
export const ROOM_CAPACITY = 14;

/** 위치·전투 동기화 메시지를 보내는 목표 주기 (초당 횟수) */
export const STATE_SYNC_HZ = 12;
/** 무기/스텟처럼 자주 안 바뀌는 값은 훨씬 느리게 보냅니다 */
export const COMBAT_STATS_SYNC_HZ = 2;
/** 내가 지금 어그로 끌고 있는 몬스터 위치를 다른 사람에게 보내는 주기 */
export const ENEMY_SYNC_HZ = 8;
/** 이 시간 동안 갱신이 없으면(추적을 그만뒀거나 상대가 나감) 그 몬스터의 "유령"을 지웁니다 */
export const ENEMY_GHOST_TTL_MS = 2500;
/** 한 번에 보고하는 몬스터 수 상한 — 어그로 범위가 좁아 실제로는 몇 마리 안 되지만, 안전장치로 잘라둠 */
export const MAX_ENEMY_SYNC_ENTRIES = 24;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 원거리 판정(부채꼴·직선)에 필요한, 서버가 재계산할 때 참고하는 여유 거리(m)·각도(도). 지연시간 보정용. */
export const RANGE_LATENCY_BUFFER_M = 2.5;
export const CONE_LATENCY_BUFFER_DEG = 12;

/**
 * 서버가 데미지를 "다시 계산"하는 데 필요한 최소한의 전투 스텟.
 * 공격자가 보낸 숫자(데미지)를 그대로 믿지 않고, 이 값들로 CombatSystem.ts의
 * totalMeleeDamage/skillDamage를 서버에서 직접 호출해 데미지를 새로 구합니다.
 * (자세한 이유는 README "멀티플레이 · PvP" 절 참고 — 그래도 클라이언트가
 * 이 숫자 자체를 조작해서 보낼 수는 있으므로, 서버는 다시 한번 상식적인
 * 상한선으로 잘라냅니다. 완벽한 부정행위 방지는 아니라는 걸 숨기지 않습니다.)
 */
export interface CombatStatsSnapshot {
  meleeDamage: number;
  meleeRange: number;
  meleeCooldownSec: number;
  hakiActive: boolean;
  activeHotbarSlot: number | null;
  hotbar: (string | null)[];
  abilityDamageMultiplier: number;
  fruitLevel: number;
  fruitBuffMultiplier: number;
  equippedFruit: string;
}

export type AnimState = "idle" | "move" | "swim" | "boat";

/** 서버가 다른 클라이언트들에게 뿌리는, 한 플레이어의 스냅샷 */
export interface RemotePlayerSnapshot {
  id: string;
  name: string;
  faction: Faction;
  position: Vec3Like;
  yaw: number;
  aimYaw: number;
  hp: number;
  maxHp: number;
  level: number;
  sea: 1 | 2;
  animState: AnimState;
  hakiActive: boolean;
  drawnWeaponId: string | null;
  pvpEnabled: boolean;
}

/**
 * "지금 이 몬스터가 나를 쫓아오고 있다"는 걸 다른 사람에게 보여주기 위한 최소 정보.
 * 몬스터 id(`${speciesId}_enemy_${i}`)는 섬 배치가 결정론적이라 모든 클라이언트에서
 * 항상 똑같습니다 — 그래서 서버가 새로 뭘 계산할 필요 없이 그대로 중계만 해도
 * "같은 몬스터"를 가리킨다는 게 보장됩니다.
 */
export interface EnemySyncEntry {
  id: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

// ---------------------------------------------------------------------------
// 클라이언트 → 서버
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "hello"; name: string; faction: Faction }
  | {
      type: "state";
      position: Vec3Like;
      yaw: number;
      aimYaw: number;
      hp: number;
      maxHp: number;
      level: number;
      sea: 1 | 2;
      animState: AnimState;
      hakiActive: boolean;
      drawnWeaponId: string | null;
    }
  | { type: "combat_stats"; stats: CombatStatsSnapshot }
  | { type: "pvp_toggle"; enabled: boolean }
  | { type: "melee_attack"; targetId: string }
  | { type: "skill_attack"; targetId: string; slot: number }
  | { type: "enemy_states"; enemies: EnemySyncEntry[] }
  | { type: "ping" };

// ---------------------------------------------------------------------------
// 서버 → 클라이언트
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "welcome"; id: string; players: RemotePlayerSnapshot[]; roomId: string; roomSize: number }
  | { type: "player_state"; player: RemotePlayerSnapshot }
  | { type: "player_left"; id: string }
  /** 같은 방의 다른 사람이 지금 쫓기고 있는 몬스터들의 위치 — 순수 중계, 그대로 뿌립니다. */
  | { type: "enemy_states"; fromId: string; enemies: EnemySyncEntry[] }
  /** 내가 맞았을 때 — 이 메시지를 받은 클라이언트가 자기 hp를 직접 깎습니다. */
  | { type: "pvp_damage"; attackerId: string; attackerName: string; damage: number; kind: "melee" | "skill" }
  /** 내가 때렸을 때 — 서버가 실제로 적용한 데미지를 알려줘서 즉시 화면 피드백을 줍니다. */
  | { type: "pvp_hit_ack"; targetId: string; targetName: string; damage: number }
  /** 공격이 거부됐을 때 (사거리 밖, 쿨다운 중, PvP 꺼짐, 다른 진영 아님 등) */
  | { type: "pvp_rejected"; reason: string }
  | { type: "error"; message: string }
  | { type: "pong" };

/** 서버가 거부 사유를 사람이 읽을 문장으로 바꿀 때 씁니다 (클라이언트 토스트용) */
export const PVP_REJECT_MESSAGES: Record<string, string> = {
  not_connected: "대상을 찾을 수 없습니다.",
  pvp_off: "상대가 PvP를 꺼두었습니다.",
  self_pvp_off: "PvP를 먼저 켜야 합니다.",
  same_faction: "같은 진영은 공격할 수 없습니다.",
  different_sea: "서로 다른 바다에 있습니다.",
  different_room: "서로 다른 방에 있습니다.",
  target_down: "이미 쓰러진 상대입니다.",
  out_of_range: "사거리 밖입니다.",
  on_cooldown: "아직 쿨다운 중입니다.",
  unknown_skill: "알 수 없는 스킬입니다.",
  locked_skill: "아직 배우지 않은 스킬입니다.",
  rate_limited: "너무 빠른 요청입니다.",
};
