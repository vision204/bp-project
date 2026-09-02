// ---------------------------------------------------------------------------
// 멀티플레이 서버의 방(room) 상태 — 프로세스 하나 안에 방이 여러 개 있습니다.
//
// 방은 접속하는 순서대로 채워집니다: room1이 ROOM_CAPACITY(기본 14)명으로
// 꽉 차면 room2가 자동으로 생기고, 그다음 접속자부터는 room2로 들어갑니다.
// 같은 방 사람들끼리만 서로 보이고(presence) PvP도 같은 방 안에서만 됩니다 —
// 방을 나누는 이유가 그거예요, 한 화면에 너무 많은 사람이 몰리지 않게.
//
// 여기서 하는 일은 세 가지입니다.
//   1) 누가 어디에 있는지 같은 방끼리 모아서 뿌리기 (presence)
//   2) PvP 공격이 들어오면 "진짜로 맞았는지"를 서버가 다시 계산해서 판정하기
//   3) 누군가 몬스터한테 쫓기고 있으면, 그 몬스터 위치를 같은 방 사람들에게 그대로 중계하기
//      (몬스터 id가 모든 클라이언트에서 결정론적으로 같으므로, 서버는 계산 없이 순수
//      중계만 합니다 — 전투 판정과 달리 "누가 이기냐"에 영향이 없는 시각 정보라서요.)
//
// 2번이 핵심입니다. 공격자가 보낸 "데미지 12"라는 숫자를 그대로 믿지 않고,
// src/simulation/CombatSystem.ts의 totalMeleeDamage/skillDamage를 서버에서
// **그대로 다시 호출**해서 데미지를 새로 구합니다. README에서 설명한 대로
// simulation/ 아래 모듈들은 원래부터 DOM·Three.js를 모르는 순수 로직이라
// 렌더러 없이 Node에서도 그대로 돌아갑니다 (verify-logic.mjs가 검증하는 것과
// 정확히 같은 성질입니다).
//
// ⚠️ 솔직히 말하면: 이건 "클라이언트가 스텟을 보고한 값"을 믿고 계산하는
// 구조라 완전한 서버 권위(authoritative) 시뮬레이션은 아닙니다. 클라이언트가
// combat_stats로 거짓 스텟(예: 공격력을 부풀린 값)을 보내면 그 값 기준으로
// 데미지가 계산됩니다. 그래서 마지막 방어선으로 상식적인 상한선을 한 번 더
// 잘라냅니다(clampStats). 완전히 막을 수 있는 건 아니라는 걸 README에도 그대로
//적어뒀습니다 — 이 프로젝트가 개발자 모드·랭킹에서 이미 지켜온 태도와 같습니다.
// ---------------------------------------------------------------------------

import type { WebSocket } from "ws";
import type { BoatTierId, ItemId, PlayerState } from "../src/core/GameState";
import type { Faction } from "../src/world/islands";
import {
  totalMeleeCooldown,
  totalMeleeDamage,
  totalMeleeRange,
  skillDamage,
  weaponSkillDamage,
} from "../src/simulation/CombatSystem";
import { DRAGON_FORM_RANGE_MULTIPLIER, isSlotUnlocked, skillsForFruit, withRangeMultiplier } from "../src/simulation/skills";
import { isWeaponSlotUnlocked, skillsForWeapon } from "../src/simulation/weaponSkills";
import { fruitLevelDamageMultiplier } from "../src/simulation/FruitLeveling";
import { dist2D, pointInShape, skillOrigin } from "../src/simulation/ShapeMath";
import { isInSafeZone } from "../src/world/SafeZones";
import {
  addCrewBounty,
  crewBonusForKill,
  crewOf,
  createCrew,
  joinCrew,
  leaveCrew,
  listCrews,
  summarize as summarizeCrew,
} from "./crews";
import {
  CONE_LATENCY_BUFFER_DEG,
  LIGHTNING_CONTACT_INTERVAL_MS,
  MAX_ENEMY_SYNC_ENTRIES,
  MAX_TRADE_SLOTS,
  RANGE_LATENCY_BUFFER_M,
  ROOM_CAPACITY,
  TRADE_CONFIRM_DELAY_MS,
  type AnimState,
  type BountyEntry,
  type ClientMessage,
  type CombatStatsSnapshot,
  type EnemySyncEntry,
  type RemotePlayerSnapshot,
  type ServerMessage,
  type TradeCloseReason,
  type TradeItem,
} from "../src/network/protocol";

/** 뇌광 질주(번개 열매 X)의 변신 수치 — src/simulation/skills.ts가 유일한 출처입니다. */
const LIGHTNING_FORM_SKILL = skillsForFruit("thunder_strike")[1];

/** 데미지 상한선 — 정상적인 만렙 캐릭터의 최고 한 방(대략 수백~수천 단위)보다
 *  넉넉히 위지만, 무한대나 1e9 같은 조작값은 확실히 걸러냅니다. */
const MAX_DAMAGE_PER_HIT = 20000;
const MAX_MELEE_DAMAGE = 20000;
/** skill_fx 중계로 실려 오는 rangeMult(순수 연출용 크기 정보)의 상한 — 조작값 방지. */
const MAX_RANGE_MULT_RELAY = 20;
const MAX_ABILITY_MULTIPLIER = 50;
/**
 * sword/gunDamageMultiplier는 더 이상 "1+stat*0.06" 같은 배율(대략 1~수십)이
 * 아니라 statAttackPower(stat) = 10 + stat*0.5 로 계산되는 절대 공격력입니다
 * (StatSystem.ts 참고). 만렙(2056)에 스텟 하나에 전부 몰아도(6165포인트)
 * 약 3,093에 그치므로, 정상적인 최고 수준 플레이를 잘못 잘라내지 않을 만큼
 * 여유 있게(그러면서도 조작값은 확실히 걸러지게) 넉넉히 잡았습니다.
 */
const MAX_ATTACK_POWER = 5000;
const MAX_FRUIT_BUFF_MULTIPLIER = 2; // 카탈로그 최댓값(기어 세컨드 1.8배)보다 여유
const MAX_MELEE_RANGE = 30;
const MAX_WEAPON_MASTERY_LEVEL = 150;
const MIN_MELEE_COOLDOWN_SEC = 0.05;
const MELEE_COOLDOWN_GRACE = 0.7; // 지연시간 보정 — 서버가 요구하는 최소 대기 비율
const SKILL_COOLDOWN_GRACE = 0.7;
const STALE_TIMEOUT_MS = 25_000;
const MAX_MESSAGES_PER_SEC = 40;

/**
 * 현상금(랭킹 점수) — 실제 플레이어를 서버에서 죽일 때마다, 레벨 차이가
 * 클수록(=상대가 훨씬 약하거나 훨씬 강할수록) 적게 쌓입니다. "비슷한 레벨끼리
 * 붙어야 현상금이 많이 오른다"는 규칙이라, 압도적으로 낮은 레벨을 사냥해서
 * 랭킹을 올리는 게 별 의미가 없게 됩니다. 정렬 순서가 중요합니다 — maxDiff가
 * 작은 것부터 순서대로 검사해서 처음 맞는 구간의 점수를 씁니다.
 */
const BOUNTY_TIERS: { maxDiff: number; points: number }[] = [
  { maxDiff: 100, points: 10 },
  { maxDiff: 500, points: 5 },
  { maxDiff: 1000, points: 3 },
  { maxDiff: Infinity, points: 1 },
];

function bountyForKill(attackerLevel: number, targetLevel: number): number {
  const diff = Math.abs(attackerLevel - targetLevel);
  for (const tier of BOUNTY_TIERS) {
    if (diff <= tier.maxDiff) return tier.points;
  }
  return 1;
}

function clampFinite(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, v));
}

/** 클라이언트가 보낸 스텟을 상식적인 범위로 잘라 "다시 계산"에 씁니다. */
function clampStats(raw: CombatStatsSnapshot): CombatStatsSnapshot {
  return {
    meleeDamage: clampFinite(raw.meleeDamage, 0, MAX_MELEE_DAMAGE, 0),
    meleeRange: clampFinite(raw.meleeRange, 0, MAX_MELEE_RANGE, 2.2),
    meleeCooldownSec: clampFinite(raw.meleeCooldownSec, MIN_MELEE_COOLDOWN_SEC, 10, 0.5),
    hakiActive: raw.hakiActive === true,
    activeHotbarSlot:
      typeof raw.activeHotbarSlot === "number" && raw.activeHotbarSlot >= 0 && raw.activeHotbarSlot < 8
        ? Math.floor(raw.activeHotbarSlot)
        : null,
    hotbar: Array.isArray(raw.hotbar) ? raw.hotbar.slice(0, 8).map((x) => (typeof x === "string" ? x : null)) : [],
    abilityDamageMultiplier: clampFinite(raw.abilityDamageMultiplier, 0, MAX_ABILITY_MULTIPLIER, 1),
    swordDamageMultiplier: clampFinite(raw.swordDamageMultiplier, 0, MAX_ATTACK_POWER, 10),
    gunDamageMultiplier: clampFinite(raw.gunDamageMultiplier, 0, MAX_ATTACK_POWER, 10),
    fruitLevel: clampFinite(raw.fruitLevel, 1, 150, 1),
    fruitBuffMultiplier: clampFinite(raw.fruitBuffMultiplier, 1, MAX_FRUIT_BUFF_MULTIPLIER, 1),
    equippedFruit: typeof raw.equippedFruit === "string" ? raw.equippedFruit : "magma_fist",
    fruitDrawn: raw.fruitDrawn === true,
    weaponMasteryLevel: clampFinite(raw.weaponMasteryLevel, 1, MAX_WEAPON_MASTERY_LEVEL, 1),
    dragonFormActive: raw.dragonFormActive === true,
  };
}

/** 지금 activeHotbarSlot/hotbar로부터 실제로 손에 든 무기 id (없으면 null). */
function drawnWeaponIdFromStats(stats: CombatStatsSnapshot): ItemId | null {
  if (stats.activeHotbarSlot === null) return null;
  const id = stats.hotbar[stats.activeHotbarSlot];
  return typeof id === "string" ? (id as ItemId) : null;
}

/**
 * CombatSystem.ts의 함수들은 PlayerState 전체를 받지만, 실제로 읽는 필드는
 * 스텟 몇 개뿐입니다(README "구조" 절대로 GameState는 렌더러 참조가 없는
 * 순수 데이터입니다). 서버가 아는 만큼만 채운 "가짜" PlayerState를 만들어
 * 그대로 넘깁니다 — 클라이언트가 쓰는 것과 완전히 같은 함수, 같은 공식입니다.
 */
function asPlayerStateForCombat(stats: CombatStatsSnapshot, aimYaw: number): PlayerState {
  const weaponId = drawnWeaponIdFromStats(stats);
  return {
    meleeDamage: stats.meleeDamage,
    meleeRange: stats.meleeRange,
    meleeCooldownSec: stats.meleeCooldownSec,
    hakiActive: stats.hakiActive,
    activeHotbarSlot: stats.activeHotbarSlot,
    hotbar: stats.hotbar as PlayerState["hotbar"],
    abilityDamageMultiplier: stats.abilityDamageMultiplier,
    swordDamageMultiplier: stats.swordDamageMultiplier,
    gunDamageMultiplier: stats.gunDamageMultiplier,
    fruitLevel: stats.fruitLevel,
    fruitBuffMultiplier: stats.fruitBuffMultiplier,
    equippedFruit: stats.equippedFruit as PlayerState["equippedFruit"],
    fruitDrawn: stats.fruitDrawn,
    dragonFormActive: stats.dragonFormActive,
    // weaponSkillDamage/weaponMasteryLevel이 이 무기 id로 찾아 읽습니다.
    weaponMastery: weaponId ? { [weaponId]: { level: stats.weaponMasteryLevel, exp: 0, expToNext: 0 } } : {},
    aimYaw,
    position: { x: 0, y: 0, z: 0 },
    // 아래는 이 계산에서 안 쓰이는 필드들 — 타입을 맞추기 위한 자리 채우기.
  } as unknown as PlayerState;
}

/** 거래·선물 아이템 검증 — "정말 가지고 있는지"는 서버가 확인할 방법이
 *  없으므로(신뢰 경계, TradeSystem.ts 주석 참고), 모양만 정상적인 값으로
 *  잘라내고 그대로 중계합니다. */
function clampTradeItems(raw: unknown): TradeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TRADE_SLOTS).flatMap((it): TradeItem[] => {
    if (!it || typeof it !== "object") return [];
    const item = it as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || item.id.length > 64) return [];
    if (typeof item.name !== "string" || item.name.length > 64) return [];
    return [
      {
        id: item.id,
        name: item.name,
        description: typeof item.description === "string" ? item.description.slice(0, 200) : "",
        icon: typeof item.icon === "string" ? item.icon.slice(0, 16) : "❔",
        usable: item.usable === true,
        equippable: item.equippable === true ? true : undefined,
        quantity: clampFinite(item.quantity, 1, 9999, 1),
      },
    ];
  });
}

/** 몬스터 동기화는 전투 판정에 안 쓰이는 순수 시각 정보라, 서버는 상식적인
 *  범위로만 잘라내고 그대로 중계합니다 (누가 이겼는지에는 영향이 없습니다). */
function clampEnemySyncEntries(raw: unknown): EnemySyncEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ENEMY_SYNC_ENTRIES).flatMap((e): EnemySyncEntry[] => {
    if (!e || typeof e !== "object") return [];
    const entry = e as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id || entry.id.length > 64) return [];
    return [
      {
        id: entry.id,
        x: clampFinite(entry.x, -20000, 20000, 0),
        z: clampFinite(entry.z, -20000, 20000, 0),
        hp: clampFinite(entry.hp, 0, 10_000_000, 0),
        maxHp: clampFinite(entry.maxHp, 1, 10_000_000, 1),
        alive: entry.alive === true,
      },
    ];
  });
}

export interface Connection {
  id: string;
  ws: WebSocket;
  roomId: string;
  name: string;
  /** 이 브라우저의 영구 id(hello의 uid) — 해적 사단 가입 여부를 여기로 찾습니다. hello 전에는 빈 문자열. */
  uid: string;
  faction: Faction;
  position: { x: number; y: number; z: number };
  yaw: number;
  aimYaw: number;
  hp: number;
  maxHp: number;
  level: number;
  sea: 1 | 2;
  animState: AnimState;
  /** animState === "boat"일 때만 탄 배의 등급, 아니면 null */
  boatTier: BoatTierId | null;
  hakiActive: boolean;
  drawnWeaponId: string | null;
  dragonFormActive: boolean;
  dragonFlightActive: boolean;
  pvpEnabled: boolean;
  alive: boolean;
  /** 현상금 — 같은 방 사람들끼리만 겨루는 점수(방을 나가면 사라집니다). 서버가
   *  실제 킬을 확인했을 때만 올라갑니다(클라이언트가 스스로 올릴 방법 없음). */
  bounty: number;
  stats: CombatStatsSnapshot;
  lastMeleeAtMs: number;
  lastSkillAtMs: Record<number, number>;
  /** 뇌광 질주(번개 열매 X) 접촉 피해 요청의 마지막 처리 시각 — 도배 방지용. */
  lastLightningAtMs: number;
  lastSeenMs: number;
  msgTimestamps: number[];
  /** 지금 진행 중인 거래(있으면). 거래 중이 아니면 null.
   *  confirmDeadlineMs는 양쪽 다 승낙해서 자동 성사 카운트다운이 도는 중이면
   *  그 마감 시각(epoch ms), 아니면 null. */
  trade: { partnerId: string; myOffer: TradeItem[]; myAccepted: boolean; confirmDeadlineMs: number | null } | null;
  /** 내가 상대에게 거래를 신청해서 아직 상대의 수락/거절을 기다리는 중이면 그 상대 id. */
  pendingTradeInviteTo: string | null;
  /** 상대가 나에게 거래를 신청해서 내가 아직 응답하지 않은 상태면 그 상대 정보. */
  pendingTradeInviteFrom: { id: string; name: string } | null;
}

function snapshotOf(conn: Connection): RemotePlayerSnapshot {
  return {
    id: conn.id,
    name: conn.name,
    faction: conn.faction,
    position: conn.position,
    yaw: conn.yaw,
    aimYaw: conn.aimYaw,
    hp: conn.hp,
    maxHp: conn.maxHp,
    level: conn.level,
    sea: conn.sea,
    animState: conn.animState,
    boatTier: conn.boatTier,
    hakiActive: conn.hakiActive,
    drawnWeaponId: conn.drawnWeaponId,
    dragonFormActive: conn.dragonFormActive,
    dragonFlightActive: conn.dragonFlightActive,
    pvpEnabled: conn.pvpEnabled,
  };
}

let nextId = 1;
function makeId() {
  return `p${nextId++}_${Math.random().toString(36).slice(2, 8)}`;
}

export class World {
  private connections = new Map<string, Connection>();

  private send(conn: Connection, msg: ServerMessage) {
    if (conn.ws.readyState !== conn.ws.OPEN) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch {
      // 소켓이 막 닫히는 타이밍이면 조용히 무시합니다 — close 핸들러가 정리합니다.
    }
  }

  /** 같은 방(room) 안에만 뿌립니다 — 방마다 최대 ROOM_CAPACITY명, 다른 방 사람들은 서로 안 보여야 합니다. */
  private broadcastRoom(roomId: string, msg: ServerMessage, exceptId?: string) {
    for (const conn of this.connections.values()) {
      if (conn.id === exceptId) continue;
      if (conn.roomId !== roomId) continue;
      this.send(conn, msg);
    }
  }

  private roomSize(roomId: string): number {
    let n = 0;
    for (const conn of this.connections.values()) if (conn.roomId === roomId) n++;
    return n;
  }

  /** 자리가 있는(=ROOM_CAPACITY 미만) 가장 앞 번호 방을 찾고, 없으면 새 번호로 만듭니다. */
  private assignRoom(): string {
    for (let n = 1; ; n++) {
      const roomId = `room${n}`;
      if (this.roomSize(roomId) < ROOM_CAPACITY) return roomId;
    }
  }

  /** 같은 방 사람들만 모아 현상금 내림차순으로 정렬 — 랭킹 패널이 그대로 그립니다. */
  private bountyEntries(roomId: string): BountyEntry[] {
    return [...this.connections.values()]
      .filter((c) => c.roomId === roomId)
      .map((c): BountyEntry => ({ id: c.id, name: c.name, faction: c.faction, bounty: c.bounty }))
      .sort((a, b) => b.bounty - a.bounty || a.name.localeCompare(b.name));
  }

  /** 초당 메시지 수 제한 — 도배로 서버를 괴롭히는 걸 막는 최소한의 안전장치. */
  private rateLimited(conn: Connection, nowMs: number): boolean {
    conn.msgTimestamps.push(nowMs);
    const cutoff = nowMs - 1000;
    while (conn.msgTimestamps.length && conn.msgTimestamps[0] < cutoff) conn.msgTimestamps.shift();
    return conn.msgTimestamps.length > MAX_MESSAGES_PER_SEC;
  }

  join(ws: WebSocket, name: string, faction: Faction): Connection {
    const roomId = this.assignRoom();
    const conn: Connection = {
      id: makeId(),
      ws,
      roomId,
      name: name.slice(0, 24) || "이름없음",
      uid: "",
      faction,
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      aimYaw: 0,
      hp: 100,
      maxHp: 100,
      level: 1,
      sea: 1,
      animState: "idle",
      boatTier: null,
      hakiActive: false,
      drawnWeaponId: null,
      dragonFormActive: false,
      dragonFlightActive: false,
      pvpEnabled: true,
      alive: true,
      bounty: 0,
      stats: clampStats({
        meleeDamage: 8,
        meleeRange: 2.2,
        meleeCooldownSec: 0.5,
        hakiActive: false,
        activeHotbarSlot: null,
        hotbar: [],
        abilityDamageMultiplier: 1,
        swordDamageMultiplier: 10, // BASE_ATTACK_POWER(StatSystem.ts)와 같은 값 — 접속 직후(스텟 0)의 기준 공격력
        gunDamageMultiplier: 10,
        fruitLevel: 1,
        fruitBuffMultiplier: 1,
        equippedFruit: "magma_fist",
        fruitDrawn: false,
        weaponMasteryLevel: 1,
        dragonFormActive: false,
      }),
      lastMeleeAtMs: 0,
      lastSkillAtMs: {},
      lastLightningAtMs: 0,
      lastSeenMs: Date.now(),
      msgTimestamps: [],
      trade: null,
      pendingTradeInviteTo: null,
      pendingTradeInviteFrom: null,
    };
    this.connections.set(conn.id, conn);

    this.send(conn, {
      type: "welcome",
      id: conn.id,
      players: [...this.connections.values()].filter((c) => c.id !== conn.id && c.roomId === roomId).map(snapshotOf),
      roomId,
      roomSize: this.roomSize(roomId),
    });
    this.broadcastRoom(roomId, { type: "player_state", player: snapshotOf(conn) }, conn.id);
    // 방에 들어오자마자 지금까지의 현상금 순위를 보여줍니다 (다들 0이라도, "같은 방에
    // 누가 있는지"는 바로 보여야 랭킹 패널이 빈 화면으로 보이지 않습니다).
    this.send(conn, { type: "bounty_update", entries: this.bountyEntries(roomId) });
    return conn;
  }

  leave(id: string) {
    const conn = this.connections.get(id);
    if (!conn) return;
    this.connections.delete(id);
    if (conn.trade) {
      const partner = this.connections.get(conn.trade.partnerId);
      this.clearTradeConfirm(conn.id, conn.trade.partnerId);
      if (partner?.trade?.partnerId === conn.id) {
        this.send(partner, { type: "trade_closed", reason: "partner_left" });
        partner.trade = null;
      }
    }
    // 내가 보낸 초대가 아직 응답 대기 중이었다면, 상대가 들고 있는 "받은 초대" 상태를 지우고
    // 알려줍니다 — 그러지 않으면 상대 화면에 이미 사라진 사람의 수락/거절 팝업이 그대로 남습니다.
    if (conn.pendingTradeInviteTo) {
      const target = this.connections.get(conn.pendingTradeInviteTo);
      if (target?.pendingTradeInviteFrom?.id === conn.id) {
        target.pendingTradeInviteFrom = null;
        this.send(target, { type: "trade_closed", reason: "partner_left" });
      }
    }
    // 내가 아직 응답하지 않은 초대를 받아둔 상태였다면, 보낸 사람에게 알려서 "응답 대기" 화면이 안 남게 합니다.
    if (conn.pendingTradeInviteFrom) {
      const requester = this.connections.get(conn.pendingTradeInviteFrom.id);
      if (requester?.pendingTradeInviteTo === conn.id) {
        requester.pendingTradeInviteTo = null;
        this.send(requester, { type: "trade_closed", reason: "partner_left" });
      }
    }
    this.broadcastRoom(conn.roomId, { type: "player_left", id });
    // 나간 사람은 랭킹 패널에서도 빠져야 하므로 남은 사람들에게 갱신된 목록을 다시 뿌립니다.
    this.broadcastRoom(conn.roomId, { type: "bounty_update", entries: this.bountyEntries(conn.roomId) });
  }

  /** 거래창에 서로의 최신 제안·승낙 상태를 보여줍니다 — 양쪽 다에게 각자 "상대방" 기준으로 보냅니다. */
  private sendTradeUpdate(a: Connection, b: Connection) {
    this.send(a, {
      type: "trade_update",
      partnerOffer: b.trade?.myOffer ?? [],
      partnerAccepted: b.trade?.myAccepted ?? false,
      confirmDeadlineMs: a.trade?.confirmDeadlineMs ?? null,
    });
    this.send(b, {
      type: "trade_update",
      partnerOffer: a.trade?.myOffer ?? [],
      partnerAccepted: a.trade?.myAccepted ?? false,
      confirmDeadlineMs: b.trade?.confirmDeadlineMs ?? null,
    });
  }

  /** a·b 쌍을 순서 상관없이 하나의 키로 — 양쪽 Connection 객체에 타이머를 중복 보관하지
   *  않고 World 하나가 대표로 들고 있기 위해서입니다(정리를 한 번만 하면 되도록). */
  private static confirmKey(aId: string, bId: string): string {
    return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
  }

  private pendingTradeConfirms = new Map<string, ReturnType<typeof setTimeout>>();

  /** 예약된 자동 성사 타이머가 있으면 취소합니다 — 취소·재협상·연결 끊김 등 "더는
   *  자동으로 성사되면 안 되는" 모든 경우에 호출합니다. */
  private clearTradeConfirm(aId: string, bId: string) {
    const key = World.confirmKey(aId, bId);
    const timer = this.pendingTradeConfirms.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingTradeConfirms.delete(key);
    }
  }

  /** TRADE_CONFIRM_DELAY_MS가 지나서 실제로 아이템을 교환합니다. 그 사이 한쪽이
   *  나갔거나, 취소했거나, 제안을 바꿔서 세션이 더 이상 그때 그 모양이 아니면
   *  아무 일도 하지 않습니다(안전하게 조용히 무시) — trade_accept/trade_cancel/
   *  trade_offer/leave가 이런 경우 이미 clearTradeConfirm으로 타이머 자체를
   *  지우려 하지만, 타이밍이 겹쳐 이미 큐에 들어간 콜백에 대비한 이중 안전장치입니다. */
  private finalizeTrade(aId: string, bId: string) {
    this.pendingTradeConfirms.delete(World.confirmKey(aId, bId));
    const a = this.connections.get(aId);
    const b = this.connections.get(bId);
    if (!a || !b) return;
    const aSession = a.trade;
    const bSession = b.trade;
    if (!aSession || !bSession || aSession.partnerId !== bId || bSession.partnerId !== aId) return;
    if (!aSession.myAccepted || !bSession.myAccepted) return;
    this.send(a, { type: "trade_complete", receivedItems: bSession.myOffer });
    this.send(b, { type: "trade_complete", receivedItems: aSession.myOffer });
    a.trade = null;
    b.trade = null;
  }

  count() {
    return this.connections.size;
  }

  /** 헬스체크·로그용 — 방마다 몇 명 있는지 (예: {room1: 14, room2: 3}). */
  roomSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const conn of this.connections.values()) {
      summary[conn.roomId] = (summary[conn.roomId] ?? 0) + 1;
    }
    return summary;
  }

  /** 25초 넘게 조용한 연결은 죽은 것으로 보고 정리합니다 (탭 강제 종료 등 close 이벤트가 안 오는 경우 대비). */
  reapStale(nowMs: number) {
    for (const conn of [...this.connections.values()]) {
      if (nowMs - conn.lastSeenMs > STALE_TIMEOUT_MS) {
        try {
          conn.ws.close();
        } catch {
          /* noop */
        }
        this.leave(conn.id);
      }
    }
  }

  handleMessage(conn: Connection, raw: string) {
    const nowMs = Date.now();
    conn.lastSeenMs = nowMs;
    if (this.rateLimited(conn, nowMs)) {
      this.send(conn, { type: "pvp_rejected", reason: "rate_limited" });
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "hello": {
        // 접속 직후 이름/진영을 다시 보낼 수 있게 허용 (재연결 등)
        if (typeof msg.name === "string") conn.name = msg.name.slice(0, 24) || conn.name;
        if (msg.faction === "pirate" || msg.faction === "marine") conn.faction = msg.faction;
        // uid로 이 브라우저가 어느 해적 사단 소속인지 찾아서 바로 알려줍니다.
        if (typeof msg.uid === "string" && msg.uid) {
          conn.uid = msg.uid.slice(0, 128);
          const crew = crewOf(conn.uid);
          this.send(conn, { type: "crew_status", crew: crew ? summarizeCrew(crew) : null });
        }
        break;
      }

      case "state": {
        conn.position = {
          x: clampFinite(msg.position?.x, -20000, 20000, conn.position.x),
          y: clampFinite(msg.position?.y, -500, 2000, conn.position.y),
          z: clampFinite(msg.position?.z, -20000, 20000, conn.position.z),
        };
        conn.yaw = clampFinite(msg.yaw, -1000, 1000, conn.yaw);
        conn.aimYaw = clampFinite(msg.aimYaw, -1000, 1000, conn.aimYaw);
        conn.maxHp = clampFinite(msg.maxHp, 1, 1_000_000, conn.maxHp);
        conn.hp = clampFinite(msg.hp, 0, conn.maxHp, conn.hp);
        conn.level = clampFinite(msg.level, 1, 3000, conn.level);
        conn.sea = msg.sea === 2 ? 2 : 1;
        conn.animState = (["idle", "move", "swim", "boat"] as const).includes(msg.animState as AnimState)
          ? (msg.animState as AnimState)
          : "idle";
        conn.boatTier =
          conn.animState === "boat" &&
          (["dinghy", "clipper", "galewind"] as const).includes(msg.boatTier as BoatTierId)
            ? (msg.boatTier as BoatTierId)
            : null;
        conn.hakiActive = msg.hakiActive === true;
        conn.drawnWeaponId = typeof msg.drawnWeaponId === "string" ? msg.drawnWeaponId : null;
        conn.dragonFormActive = msg.dragonFormActive === true;
        conn.dragonFlightActive = msg.dragonFlightActive === true;
        conn.alive = conn.hp > 0;
        this.broadcastRoom(conn.roomId, { type: "player_state", player: snapshotOf(conn) }, conn.id);
        break;
      }

      case "combat_stats":
        conn.stats = clampStats(msg.stats ?? ({} as CombatStatsSnapshot));
        break;

      case "pvp_toggle":
        conn.pvpEnabled = msg.enabled === true;
        break;

      case "melee_attack":
        this.resolveMeleeAttack(conn, msg.targetId, nowMs);
        break;

      case "skill_attack":
        this.resolveSkillAttack(conn, msg.targetId, msg.slot, nowMs);
        break;

      case "skill_fx": {
        // 순수 연출 중계입니다 — 데미지 판정이 아니므로 검증 없이 그대로(위치만
        // 상식적인 범위로 잘라서) 같은 방 사람들에게 뿌립니다.
        const slot = Number.isFinite(msg.slot) ? Math.trunc(msg.slot) : 0;
        const weaponId = typeof msg.weaponId === "string" ? msg.weaponId.slice(0, 64) : null;
        const position = {
          x: clampFinite(msg.position?.x, -20000, 20000, conn.position.x),
          y: clampFinite(msg.position?.y, -500, 2000, conn.position.y),
          z: clampFinite(msg.position?.z, -20000, 20000, conn.position.z),
        };
        const aimYaw = clampFinite(msg.aimYaw, -1000, 1000, conn.aimYaw);
        const chargeFrac =
          typeof msg.chargeFrac === "number" && Number.isFinite(msg.chargeFrac)
            ? Math.max(0, Math.min(1, msg.chargeFrac))
            : undefined;
        const rangeMult =
          typeof msg.rangeMult === "number" && Number.isFinite(msg.rangeMult) && msg.rangeMult > 0
            ? Math.min(msg.rangeMult, MAX_RANGE_MULT_RELAY)
            : undefined;
        this.broadcastRoom(
          conn.roomId,
          { type: "player_skill_fx", fromId: conn.id, slot, weaponId, position, aimYaw, chargeFrac, rangeMult },
          conn.id,
        );
        break;
      }

      case "special_ability_fx": {
        // skill_fx와 같은 이유로 순수 연출 중계입니다 — 검증 없이 그대로(위치만
        // 상식적인 범위로 잘라서) 같은 방 사람들에게 뿌립니다.
        const abilityId = msg.abilityId === "light_f" || msg.abilityId === "dragon_f" ? msg.abilityId : null;
        if (!abilityId) break;
        const position = {
          x: clampFinite(msg.position?.x, -20000, 20000, conn.position.x),
          y: clampFinite(msg.position?.y, -500, 2000, conn.position.y),
          z: clampFinite(msg.position?.z, -20000, 20000, conn.position.z),
        };
        const aimYaw = clampFinite(msg.aimYaw, -1000, 1000, conn.aimYaw);
        this.broadcastRoom(
          conn.roomId,
          { type: "player_special_ability_fx", fromId: conn.id, abilityId, position, aimYaw },
          conn.id,
        );
        break;
      }

      case "melee_fx":
        // 순수 연출 중계 — 데미지 판정이 아니므로 검증 없이 그대로 뿌립니다.
        this.broadcastRoom(conn.roomId, { type: "player_melee_fx", fromId: conn.id }, conn.id);
        break;

      case "dash_fx": {
        const dx = clampFinite(msg.dx, -1, 1, 0);
        const dz = clampFinite(msg.dz, -1, 1, 0);
        this.broadcastRoom(conn.roomId, { type: "player_dash_fx", fromId: conn.id, dx, dz }, conn.id);
        break;
      }

      case "teleport_fx": {
        const position = {
          x: clampFinite(msg.position?.x, -20000, 20000, conn.position.x),
          y: clampFinite(msg.position?.y, -500, 2000, conn.position.y),
          z: clampFinite(msg.position?.z, -20000, 20000, conn.position.z),
        };
        this.broadcastRoom(conn.roomId, { type: "player_teleport_fx", fromId: conn.id, position }, conn.id);
        break;
      }

      case "enemy_states": {
        const enemies = clampEnemySyncEntries(msg.enemies);
        if (enemies.length > 0) {
          this.broadcastRoom(conn.roomId, { type: "enemy_states", fromId: conn.id, enemies }, conn.id);
        }
        break;
      }

      case "trade_request": {
        const target = this.connections.get(msg.targetId);
        if (!target) {
          this.send(conn, { type: "trade_closed", reason: "not_connected" });
          break;
        }
        if (target.id === conn.id) {
          this.send(conn, { type: "trade_closed", reason: "self" });
          break;
        }
        if (conn.roomId !== target.roomId) {
          this.send(conn, { type: "trade_closed", reason: "different_room" });
          break;
        }
        // "거래 중" 또는 "이미 초대를 보냈거나 받은 채로 응답 대기 중"이면 둘 다 busy로 거부합니다 —
        // 신청자가 중복으로 여러 명에게 걸거나, 이미 바쁜 상대에게 걸어서 초대가 덮어써지는 걸 막습니다.
        if (conn.trade || conn.pendingTradeInviteTo || conn.pendingTradeInviteFrom) {
          this.send(conn, { type: "trade_closed", reason: "busy" });
          break;
        }
        if (target.trade || target.pendingTradeInviteTo || target.pendingTradeInviteFrom) {
          this.send(conn, { type: "trade_closed", reason: "busy" });
          break;
        }
        conn.pendingTradeInviteTo = target.id;
        target.pendingTradeInviteFrom = { id: conn.id, name: conn.name };
        this.send(target, { type: "trade_invite", fromId: conn.id, fromName: conn.name });
        this.send(conn, { type: "trade_invite_sent", toId: target.id, toName: target.name });
        break;
      }

      case "trade_invite_respond": {
        const pending = conn.pendingTradeInviteFrom;
        if (!pending) break; // 대기 중인 초대가 없으면(이미 취소됐거나 만료) 조용히 무시
        conn.pendingTradeInviteFrom = null;
        const requester = this.connections.get(pending.id);
        if (requester?.pendingTradeInviteTo === conn.id) requester.pendingTradeInviteTo = null;
        if (msg.accept !== true) {
          if (requester) this.send(requester, { type: "trade_closed", reason: "declined" });
          break;
        }
        if (!requester || requester.roomId !== conn.roomId) {
          this.send(conn, { type: "trade_closed", reason: "not_connected" });
          break;
        }
        // 응답을 기다리는 사이 둘 중 하나가 이미 다른 거래를 시작했으면(동시에 여러 초대에
        // 응답하는 등의 경합) 안전하게 거부합니다.
        if (conn.trade || requester.trade) {
          this.send(conn, { type: "trade_closed", reason: "busy" });
          this.send(requester, { type: "trade_closed", reason: "busy" });
          break;
        }
        conn.trade = { partnerId: requester.id, myOffer: [], myAccepted: false, confirmDeadlineMs: null };
        requester.trade = { partnerId: conn.id, myOffer: [], myAccepted: false, confirmDeadlineMs: null };
        this.send(conn, { type: "trade_started", partnerId: requester.id, partnerName: requester.name });
        this.send(requester, { type: "trade_started", partnerId: conn.id, partnerName: conn.name });
        break;
      }

      case "trade_offer": {
        const session = conn.trade;
        if (!session) break;
        session.myOffer = clampTradeItems(msg.items);
        session.myAccepted = false;
        session.confirmDeadlineMs = null;
        const partner = this.connections.get(session.partnerId);
        const partnerSession = partner?.trade;
        if (partner && partnerSession && partnerSession.partnerId === conn.id) {
          partnerSession.myAccepted = false;
          partnerSession.confirmDeadlineMs = null;
          this.clearTradeConfirm(conn.id, partner.id);
          this.sendTradeUpdate(conn, partner);
        }
        break;
      }

      case "trade_accept": {
        const session = conn.trade;
        if (!session) break;
        const partner = this.connections.get(session.partnerId);
        const partnerSession = partner?.trade;
        if (!partner || !partnerSession || partnerSession.partnerId !== conn.id) {
          this.send(conn, { type: "trade_closed", reason: "partner_left" });
          conn.trade = null;
          break;
        }
        session.myAccepted = msg.accepted === true;
        // 승낙 상태가 바뀔 때마다(승낙이든 취소든) 예약돼 있던 자동 성사 타이머는 일단 지웁니다 —
        // 아래에서 "둘 다 승낙"이면 새로 하나 겁니다.
        this.clearTradeConfirm(conn.id, partner.id);
        if (session.myAccepted && partnerSession.myAccepted) {
          const deadline = Date.now() + TRADE_CONFIRM_DELAY_MS;
          session.confirmDeadlineMs = deadline;
          partnerSession.confirmDeadlineMs = deadline;
          const timer = setTimeout(() => this.finalizeTrade(conn.id, partner.id), TRADE_CONFIRM_DELAY_MS);
          this.pendingTradeConfirms.set(World.confirmKey(conn.id, partner.id), timer);
        } else {
          session.confirmDeadlineMs = null;
          partnerSession.confirmDeadlineMs = null;
        }
        this.sendTradeUpdate(conn, partner);
        break;
      }

      case "trade_cancel": {
        const session = conn.trade;
        if (!session) break;
        const partner = this.connections.get(session.partnerId);
        this.clearTradeConfirm(conn.id, session.partnerId);
        this.send(conn, { type: "trade_closed", reason: "cancelled" });
        const partnerSession = partner?.trade;
        if (partner && partnerSession && partnerSession.partnerId === conn.id) {
          this.send(partner, { type: "trade_closed", reason: "cancelled" });
          partner.trade = null;
        }
        conn.trade = null;
        break;
      }

      case "gift_send": {
        const target = this.connections.get(msg.targetId);
        if (!target) {
          this.send(conn, { type: "gift_ack", delivered: false, reason: "not_connected" });
          break;
        }
        if (target.id === conn.id) {
          this.send(conn, { type: "gift_ack", delivered: false, reason: "self" });
          break;
        }
        if (conn.roomId !== target.roomId) {
          this.send(conn, { type: "gift_ack", delivered: false, reason: "different_room" });
          break;
        }
        const item = clampTradeItems([msg.item])[0];
        if (!item) {
          this.send(conn, { type: "gift_ack", delivered: false, reason: "cancelled" });
          break;
        }
        this.send(target, { type: "gift_received", fromId: conn.id, fromName: conn.name, item });
        this.send(conn, { type: "gift_ack", delivered: true });
        break;
      }

      case "lightning_contact":
        this.resolveLightningContact(conn, msg.targetId, nowMs);
        break;

      // --- 해적 사단(길드) ---------------------------------------------------
      case "crew_create": {
        const result = createCrew(conn.uid, typeof msg.name === "string" ? msg.name : "", nowMs);
        if ("error" in result) {
          this.send(conn, { type: "crew_error", reason: result.error });
          break;
        }
        this.send(conn, { type: "crew_status", crew: summarizeCrew(result) });
        break;
      }

      case "crew_join": {
        const result = joinCrew(conn.uid, typeof msg.crewId === "string" ? msg.crewId : "");
        if ("error" in result) {
          this.send(conn, { type: "crew_error", reason: result.error });
          break;
        }
        this.send(conn, { type: "crew_status", crew: summarizeCrew(result) });
        break;
      }

      case "crew_leave":
        leaveCrew(conn.uid);
        this.send(conn, { type: "crew_status", crew: null });
        break;

      case "crew_list_request":
        this.send(conn, { type: "crew_list", crews: listCrews() });
        break;

      case "ping":
        this.send(conn, { type: "pong" });
        break;
    }
  }

  /**
   * 공격 가능 여부의 공통 조건 (진영·PvP 켜짐·같은 바다·생존·안전지역).
   *
   * 같은 진영끼리는 원래 전부 막혀 있었지만, 해적은 자기들끼리도 싸울 수 있게
   * 열어달라는 요청에 따라 "해적 vs 해적"만 예외로 허용합니다. 해군은 여전히
   * 해군끼리 공격할 수 없습니다 — 명시적으로 "해적만" 열기로 확인받은 부분입니다.
   *
   * 본부(HQ) 건물 안(PvP 안전지역)은 공격자·대상 둘 중 누구든 들어가 있으면
   * 막습니다 — 클라이언트(src/network/PvpCombat.ts)도 같은 isInSafeZone으로
   * 먼저 걸러서 애초에 요청을 안 보내지만, 최종 판정은 항상 서버 쪽 좌표
   * (attacker.position / target.position)를 기준으로 다시 합니다.
   */
  private basicPvpCheck(attacker: Connection, target: Connection | undefined): string | null {
    if (!target) return "not_connected";
    if (attacker.roomId !== target.roomId) return "different_room";
    if (!attacker.pvpEnabled) return "self_pvp_off";
    if (!target.pvpEnabled) return "pvp_off";
    if (attacker.faction === target.faction && attacker.faction !== "pirate") return "same_faction";
    if (attacker.sea !== target.sea) return "different_sea";
    if (!target.alive || target.hp <= 0) return "target_down";
    if (isInSafeZone(attacker.position.x, attacker.position.z)) return "safe_zone";
    if (isInSafeZone(target.position.x, target.position.z)) return "safe_zone";
    return null;
  }

  private applyDamage(attacker: Connection, target: Connection, rawDamage: number, kind: "melee" | "skill") {
    const damage = Math.round(clampFinite(rawDamage, 0, MAX_DAMAGE_PER_HIT, 0));
    if (damage <= 0) return;
    const wasAlive = target.hp > 0;
    target.hp = Math.max(0, target.hp - damage);
    target.alive = target.hp > 0;

    this.send(target, { type: "pvp_damage", attackerId: attacker.id, attackerName: attacker.name, damage, kind });
    this.send(attacker, { type: "pvp_hit_ack", targetId: target.id, targetName: target.name, damage });
    // 같은 방의 다른 사람들도 체력 변화를 볼 수 있도록 갱신된 스냅샷을 뿌립니다.
    this.broadcastRoom(target.roomId, { type: "player_state", player: snapshotOf(target) });

    // 이 한 방으로 실제로 죽었으면(생존 → 사망 전환) 현상금을 적립합니다 — 서버가
    // 직접 확인한 킬만 인정하므로 클라이언트가 스스로 점수를 조작할 방법이 없습니다.
    if (wasAlive && !target.alive) {
      let bonus = 0;
      const crew = crewOf(attacker.uid);
      if (crew) {
        // 사단 소속이면 킬마다 추가 보너스 — 사단의 누적 점수가 커질수록 보너스도 커집니다.
        bonus = crewBonusForKill(crew);
        addCrewBounty(crew, bonus);
      }
      attacker.bounty += bountyForKill(attacker.level, target.level) + bonus;
      this.broadcastRoom(attacker.roomId, { type: "bounty_update", entries: this.bountyEntries(attacker.roomId) });
    }
  }

  /**
   * 뇌광 질주(번개 열매 X) 변신 중 접촉 피해 — 근접 공격과 비슷하지만 훨씬 짧은
   * 간격으로 반복 요청됩니다. 서버가 자체적으로 최소 간격(LIGHTNING_CONTACT_INTERVAL_MS)을
   * 두어 도배를 막고, 판정에 실패하면 조용히 무시합니다(매번 pvp_rejected를 보내면
   * 그 자체가 스팸이 되므로).
   */
  private resolveLightningContact(attacker: Connection, targetId: string, nowMs: number) {
    const target = this.connections.get(targetId);
    if (this.basicPvpCheck(attacker, target) || !target) return;
    if (nowMs - attacker.lastLightningAtMs < LIGHTNING_CONTACT_INTERVAL_MS) return;

    const radius = (LIGHTNING_FORM_SKILL?.lightningFormContactRadius ?? 0) + RANGE_LATENCY_BUFFER_M;
    const dps = LIGHTNING_FORM_SKILL?.lightningFormDps ?? 0;
    if (radius <= 0 || dps <= 0) return;
    const d = dist2D(attacker.position.x, attacker.position.z, target.position.x, target.position.z);
    if (d > radius) return;

    attacker.lastLightningAtMs = nowMs;
    const fakePlayer = asPlayerStateForCombat(attacker.stats, attacker.aimYaw);
    const tickDamage =
      dps *
      (LIGHTNING_CONTACT_INTERVAL_MS / 1000) *
      fakePlayer.abilityDamageMultiplier *
      fruitLevelDamageMultiplier(fakePlayer.fruitLevel) *
      fakePlayer.fruitBuffMultiplier;
    this.applyDamage(attacker, target, tickDamage, "skill");
  }

  private resolveMeleeAttack(attacker: Connection, targetId: string, nowMs: number) {
    const target = this.connections.get(targetId);
    const reason = this.basicPvpCheck(attacker, target);
    if (reason || !target) {
      this.send(attacker, { type: "pvp_rejected", reason: reason ?? "not_connected" });
      return;
    }

    // 참고: 맨주먹 공격 제거(사용자 요청)는 클라이언트 CombatSystem.ts의
    // canMeleeAttack이 막습니다 — 정상적인 클라이언트는 무기가 없으면 애초에
    // melee_attack 메시지 자체를 보내지 않습니다. 서버는 기존과 같이 사거리·
    // 쿨다운만 검증하고(PvP 프로토콜에 무기 보유 여부를 별도로 검증하는 필드가
    // 없어 이번 턴에는 프로토콜 확장을 하지 않았습니다), 무기 유무 자체는
    // 신뢰합니다 — 다른 스탯(데미지·사거리 등)도 이미 클라이언트가 보낸
    // 값을 clampStats로 상한만 씌워 신뢰하는 것과 같은 수준입니다.
    const stats = attacker.stats;
    const fakePlayer = asPlayerStateForCombat(stats, attacker.aimYaw);
    const cooldown = totalMeleeCooldown(fakePlayer);
    if (nowMs - attacker.lastMeleeAtMs < cooldown * 1000 * MELEE_COOLDOWN_GRACE) {
      this.send(attacker, { type: "pvp_rejected", reason: "on_cooldown" });
      return;
    }

    const range = totalMeleeRange(fakePlayer) + RANGE_LATENCY_BUFFER_M;
    const d = dist2D(attacker.position.x, attacker.position.z, target.position.x, target.position.z);
    if (d > range) {
      this.send(attacker, { type: "pvp_rejected", reason: "out_of_range" });
      return;
    }

    attacker.lastMeleeAtMs = nowMs;
    const damage = totalMeleeDamage(fakePlayer);
    this.applyDamage(attacker, target, damage, "melee");
  }

  private resolveSkillAttack(attacker: Connection, targetId: string, slot: number, nowMs: number) {
    const target = this.connections.get(targetId);
    const reason = this.basicPvpCheck(attacker, target);
    if (reason || !target) {
      this.send(attacker, { type: "pvp_rejected", reason: reason ?? "not_connected" });
      return;
    }
    if (typeof slot !== "number" || slot < 0 || slot > 3) {
      this.send(attacker, { type: "pvp_rejected", reason: "unknown_skill" });
      return;
    }

    const stats = attacker.stats;
    // 클라이언트와 같은 규칙: 열매를 뽑았으면 열매 스킬, 아니면(무기를 뽑았으면) 무기 스킬.
    const weaponId = drawnWeaponIdFromStats(stats);
    const skill = stats.fruitDrawn
      ? skillsForFruit(stats.equippedFruit as Parameters<typeof skillsForFruit>[0])?.[slot]
      : weaponId
        ? skillsForWeapon(weaponId)[slot]
        : undefined;
    if (!skill) {
      this.send(attacker, { type: "pvp_rejected", reason: "unknown_skill" });
      return;
    }
    const unlocked = stats.fruitDrawn
      ? isSlotUnlocked(slot, stats.fruitLevel)
      : isWeaponSlotUnlocked(slot, stats.weaponMasteryLevel);
    if (!unlocked) {
      this.send(attacker, { type: "pvp_rejected", reason: "locked_skill" });
      return;
    }

    const lastAt = attacker.lastSkillAtMs[slot] ?? 0;
    if (nowMs - lastAt < skill.cooldownSec * 1000 * SKILL_COOLDOWN_GRACE) {
      this.send(attacker, { type: "pvp_rejected", reason: "on_cooldown" });
      return;
    }

    // 용으로 변신(dragonFormActive) 중이면 CombatSystem.ts(PvE 판정)와 똑같이
    // 용용 열매(dragon_dragon)의 공격 스킬 사거리를 5배로 넓혀서 검증합니다 —
    // 안 그러면 변신 중 실제로 더 멀리서 맞힌 공격이 여기서 "사거리 밖"으로
    // 부당하게 거부됩니다(withRangeMultiplier는 damage는 건드리지 않으므로
    // 아래 damage 계산은 원본 skill을 그대로 씁니다).
    const dragonFormBoosted =
      stats.dragonFormActive && stats.equippedFruit === "dragon_dragon" && skill.shape.kind !== "self";
    const effectiveSkill = dragonFormBoosted ? withRangeMultiplier(skill, DRAGON_FORM_RANGE_MULTIPLIER) : skill;
    const shape = effectiveSkill.shape;
    // originAtAim 스킬(낙뢰·빙결 감옥·절대 영도·중력정)은 PvE(CombatSystem.ts)와
    // 똑같이 조준 지점을 원점으로 판정해야 합니다 — ShapeMath.ts의 skillOrigin이
    // 그 계산을 공유합니다(클라/서버 판정이 어긋나지 않도록).
    const origin = skillOrigin({ x: attacker.position.x, z: attacker.position.z }, attacker.aimYaw, effectiveSkill);
    const inRange =
      shape.kind === "self"
        ? false
        : pointInShape(origin, target.position.x, target.position.z, widenShapeForLatency(shape));
    if (!inRange) {
      this.send(attacker, { type: "pvp_rejected", reason: "out_of_range" });
      return;
    }

    attacker.lastSkillAtMs[slot] = nowMs;
    const fakePlayer = asPlayerStateForCombat(stats, attacker.aimYaw);
    const damage = stats.fruitDrawn
      ? skillDamage(fakePlayer, skill)
      : weaponId
        ? weaponSkillDamage(fakePlayer, skill, weaponId)
        : 0;
    this.applyDamage(attacker, target, damage, "skill");

    // 빙결 감옥·절대 영도 등 — 실제 이동을 멈추는 건 대상 클라이언트 자신만 할 수
    // 있으므로(다른 사람의 상태를 대신 바꿀 수 없음) 여기서 알리기만 합니다.
    if (skill.freezeDurationSec && target.alive) {
      this.send(target, { type: "pvp_freeze", durationSec: skill.freezeDurationSec });
    }
  }
}

/** 지연시간 보정 — 판정 모양을 살짝 넉넉하게 키워서 검사합니다. */
function widenShapeForLatency<T extends { kind: string }>(shape: T): T {
  const s = shape as unknown as Record<string, number> & { kind: string };
  switch (s.kind) {
    case "radial":
      return { ...s, radius: s.radius + RANGE_LATENCY_BUFFER_M } as unknown as T;
    case "cone":
      return { ...s, range: s.range + RANGE_LATENCY_BUFFER_M, halfAngleDeg: s.halfAngleDeg + CONE_LATENCY_BUFFER_DEG } as unknown as T;
    case "line":
      return { ...s, range: s.range + RANGE_LATENCY_BUFFER_M, width: s.width + RANGE_LATENCY_BUFFER_M } as unknown as T;
    default:
      return shape;
  }
}
