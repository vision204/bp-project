// ---------------------------------------------------------------------------
// 멀티플레이 서버와의 WebSocket 연결을 담당합니다.
//
// 이 파일은 완전히 선택 사항입니다 — 접속 버튼을 누르지 않으면 인스턴스만
// 만들어질 뿐 소켓을 열지 않고, 싱글플레이 동작에는 아무 영향도 주지 않습니다
// (검증 스위트가 멀티플레이 버튼을 누르지 않는 모든 시나리오는 이 파일이
// 존재하지 않는 것과 동일하게 동작해야 합니다).
//
// 다른 플레이어 위치는 "받는 즉시 순간이동"이 아니라 지수 보간으로 부드럽게
// 따라가도록 RemotePlayerView가 처리합니다. 서버가 보내는 주기(STATE_SYNC_HZ)가
// 화면 프레임보다 훨씬 느리기 때문입니다.
// ---------------------------------------------------------------------------

import type { GameState, InventoryItem, ItemId } from "../core/GameState";
import type { SkillShape } from "../simulation/skills";
import { dist2D, pointInShape } from "../simulation/ShapeMath";
import { applyReceivedItems, removeFromInventory } from "../simulation/TradeSystem";
import { markDamagedNow } from "../simulation/HpSystem";
import { getOrCreatePlayerId } from "../core/PlayerId";
import type { Faction } from "../world/islands";
import {
  COMBAT_STATS_SYNC_HZ,
  ENEMY_GHOST_TTL_MS,
  ENEMY_SYNC_HZ,
  MAX_ENEMY_SYNC_ENTRIES,
  PVP_REJECT_MESSAGES,
  STATE_SYNC_HZ,
  TRADE_CLOSE_MESSAGES,
  type AnimState,
  type BountyEntry,
  type ClientMessage,
  type CombatStatsSnapshot,
  type CrewSummary,
  type EnemySyncEntry,
  type RemotePlayerSnapshot,
  type ServerMessage,
  type TradeItem,
  type Vec3Like,
} from "./protocol";

/**
 * 다른 플레이어가 스킬을 썼다고 서버가 알려준 것 — 순수 연출용입니다.
 * SceneRenderer.sync()가 이 목록을 받아 그 자리에서 이펙트를 한 번 스폰합니다.
 */
export interface RemoteSkillFx {
  fromId: string;
  slot: number;
  weaponId: string | null;
  position: Vec3Like;
  aimYaw: number;
}

/** 지금 진행 중인 거래창 상태 — TradeUI가 그대로 읽어서 그립니다. */
export interface TradeSession {
  partnerId: string;
  partnerName: string;
  myOffer: TradeItem[];
  myAccepted: boolean;
  partnerOffer: TradeItem[];
  partnerAccepted: boolean;
  /** 양쪽 다 승낙해서 자동 성사 카운트다운이 도는 중이면 그 마감 시각(epoch ms), 아니면 null. */
  confirmDeadlineMs: number | null;
}

/** 상대가 나에게 보낸, 아직 응답하지 않은 거래 신청. */
export interface IncomingTradeInvite {
  fromId: string;
  fromName: string;
}

/** 내가 상대에게 보내서 응답을 기다리는 중인 거래 신청. */
export interface OutgoingTradeInvite {
  toId: string;
  toName: string;
}

/** 다른 사람이 지금 쫓기고 있는 몬스터 하나를 화면에 그리기 위한 최소 정보. */
export interface RemoteEnemyGhost {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 이 몬스터가 지금 쫓고 있는 상대(다른 플레이어)의 id — 그 방향을 바라보게 그릴 때 씁니다. */
  fromId: string;
  updatedAtMs: number;
}

const SMOOTHING_PER_SEC = 10;

/**
 * 진영이 같아도 PvP 후보로 볼지 — server/state.ts의 basicPvpCheck와 규칙을
 * 맞춥니다. 해적끼리만 예외로 허용하고(명시적으로 확정한 설계), 해군끼리는
 * 여전히 후보에서 빠집니다. 여기서 걸러도 서버가 다시 같은 규칙으로 최종
 * 판정하므로, 이건 "굳이 물어볼 필요도 없는 요청"을 줄이는 최적화일 뿐입니다.
 */
function canFactionPvp(mine: Faction, theirs: Faction): boolean {
  return mine !== theirs || mine === "pirate";
}

/** 서버에서 온 스냅샷 + 화면에 그릴 부드러운 보간 좌표. */
export class RemotePlayerView {
  snapshot: RemotePlayerSnapshot;
  renderX: number;
  renderY: number;
  renderZ: number;
  renderYaw: number;

  constructor(snap: RemotePlayerSnapshot) {
    this.snapshot = snap;
    this.renderX = snap.position.x;
    this.renderY = snap.position.y;
    this.renderZ = snap.position.z;
    this.renderYaw = snap.yaw;
  }

  setSnapshot(snap: RemotePlayerSnapshot) {
    this.snapshot = snap;
  }

  step(dt: number) {
    const t = Math.min(1, dt * SMOOTHING_PER_SEC);
    this.renderX += (this.snapshot.position.x - this.renderX) * t;
    this.renderY += (this.snapshot.position.y - this.renderY) * t;
    this.renderZ += (this.snapshot.position.z - this.renderZ) * t;
    // 각도는 최단 경로로 보간 (179도 → -179도처럼 확 튀지 않게)
    let dy = this.snapshot.yaw - this.renderYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.renderYaw += dy * t;
  }
}

export type MultiplayerStatus = "disconnected" | "connecting" | "connected";

function animStateFor(state: GameState): AnimState {
  if (state.boat.riding) return "boat";
  if (state.player.inWater) return "swim";
  const speed = Math.hypot(state.player.velocity.x, state.player.velocity.z);
  return speed > 0.5 ? "move" : "idle";
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private readonly state: GameState;
  private myId: string | null = null;
  private readonly remotePlayers = new Map<string, RemotePlayerView>();
  private readonly remoteEnemyGhosts = new Map<string, RemoteEnemyGhost>();
  private lastStateSentAtMs = 0;
  private lastStatsSentAtMs = 0;
  private lastStatsSig = "";
  private lastEnemySyncAtMs = 0;
  private _tradeSession: TradeSession | null = null;
  private _incomingTradeInvite: IncomingTradeInvite | null = null;
  private _outgoingTradeInvite: OutgoingTradeInvite | null = null;
  /** 아직 렌더러가 소비하지 않은, 다른 사람의 스킬 이펙트 알림 — 매 프레임 drainSkillFx()로 비웁니다. */
  private _pendingSkillFx: RemoteSkillFx[] = [];
  /** 같은 방 현상금 랭킹 — 서버가 보내주는 대로 그대로 들고 있다가 랭킹 패널이 읽습니다. */
  private _bountyEntries: BountyEntry[] = [];
  /** 이 브라우저(캐릭터)의 영구 id — 재접속해도 같은 사단원으로 인식되도록 hello에 실어 보냅니다. */
  private readonly playerId = getOrCreatePlayerId();
  /** 내가 지금 속한 해적 사단(없으면 null) — 서버가 hello 직후와 생성/가입/탈퇴마다 알려줍니다. */
  private _myCrew: CrewSummary | null = null;
  /** 존재하는 모든 사단 목록 — 사단 패널을 열 때 요청합니다. */
  private _crewList: CrewSummary[] = [];

  status: MultiplayerStatus = "disconnected";
  serverUrl = "";
  /** 서버가 배정해준 방 — 같은 방 사람들끼리만 서로 보이고 PvP도 됩니다 (방마다 최대 인원 있음). */
  roomId: string | null = null;
  roomSize = 0;

  constructor(state: GameState) {
    this.state = state;
  }

  get connected() {
    return this.status === "connected";
  }

  get id() {
    return this.myId;
  }

  get players(): RemotePlayerView[] {
    return [...this.remotePlayers.values()];
  }

  /** 렌더러가 몬스터를 그릴 때 참고하는, 다른 사람이 보고한 "지금 쫓기는 몬스터" 목록. */
  get enemyGhosts(): ReadonlyMap<string, RemoteEnemyGhost> {
    return this.remoteEnemyGhosts;
  }

  /** 지금 열려 있는 거래창 상태 — 없으면 null. TradeUI가 그대로 읽어서 그립니다. */
  get tradeSession(): TradeSession | null {
    return this._tradeSession;
  }

  /** 상대가 나에게 보낸, 아직 응답하지 않은 거래 신청 — 없으면 null. */
  get incomingTradeInvite(): IncomingTradeInvite | null {
    return this._incomingTradeInvite;
  }

  /** 내가 상대에게 보내서 응답을 기다리는 중인 거래 신청 — 없으면 null. */
  get outgoingTradeInvite(): OutgoingTradeInvite | null {
    return this._outgoingTradeInvite;
  }

  /** 같은 방 현상금 랭킹(내림차순 정렬은 서버가 이미 해서 보냄) — 랭킹 패널이 그대로 그립니다. */
  get bountyEntries(): BountyEntry[] {
    return this._bountyEntries;
  }

  /** 내가 지금 속한 해적 사단 — 없으면 null. */
  get myCrew(): CrewSummary | null {
    return this._myCrew;
  }

  /** 존재하는 모든 사단 목록 — requestCrewList()로 최신 정보를 받아옵니다. */
  get crewList(): CrewSummary[] {
    return this._crewList;
  }

  connect(url: string, name: string) {
    this.disconnect();
    this.serverUrl = url;
    this.status = "connecting";

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.status = "disconnected";
      this.state.player.events.push({ type: "pvp_disconnected", reason: "서버 주소가 올바르지 않습니다" });
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.status = "connected";
      this.send({ type: "hello", name, faction: this.state.player.faction, uid: this.playerId });
      this.state.player.events.push({ type: "pvp_connected" });
    });
    ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data)));
    ws.addEventListener("close", () => {
      const wasConnected = this.status === "connected";
      this.status = "disconnected";
      this.myId = null;
      this.remotePlayers.clear();
      this._tradeSession = null;
      this._incomingTradeInvite = null;
      this._outgoingTradeInvite = null;
      this._pendingSkillFx = [];
      this._bountyEntries = [];
      this._myCrew = null;
      this._crewList = [];
      if (wasConnected) {
        this.state.player.events.push({ type: "pvp_disconnected", reason: "연결이 끊어졌습니다" });
      }
    });
    ws.addEventListener("error", () => {
      // close 이벤트가 뒤따라오며 정리합니다 — 여기서는 조용히 넘깁니다.
    });
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
    }
    this.ws = null;
    this.status = "disconnected";
    this.myId = null;
    this.roomId = null;
    this.roomSize = 0;
    this.remotePlayers.clear();
    this.remoteEnemyGhosts.clear();
    this._tradeSession = null;
    this._incomingTradeInvite = null;
    this._outgoingTradeInvite = null;
    this._pendingSkillFx = [];
    this._bountyEntries = [];
    this._myCrew = null;
    this._crewList = [];
    // 기본값이 켜짐이므로 연결 해제 후에도 켜짐으로 되돌립니다 (꺼진 채로 남지 않도록).
    this.state.player.pvpEnabled = true;
  }

  private send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* noop */
    }
  }

  private upsert(snap: RemotePlayerSnapshot) {
    const existing = this.remotePlayers.get(snap.id);
    if (existing) existing.setSnapshot(snap);
    else this.remotePlayers.set(snap.id, new RemotePlayerView(snap));
  }

  private handleMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "welcome":
        this.myId = msg.id;
        this.roomId = msg.roomId;
        this.roomSize = msg.roomSize;
        this.remotePlayers.clear();
        for (const p of msg.players) this.upsert(p);
        break;

      case "player_state":
        if (msg.player.id === this.myId) break;
        this.upsert(msg.player);
        break;

      case "player_left":
        this.remotePlayers.delete(msg.id);
        break;

      case "pvp_damage": {
        // 내가 맞았다는 서버의 판정입니다 — 내 hp는 내 클라이언트만 바꿀 수 있으므로
        // (다른 사람이 내 상태를 대신 바꿀 방법이 없습니다) 여기서 직접 적용합니다.
        const p = this.state.player;
        const wasAlive = p.hp > 0;
        p.hp = Math.max(0, p.hp - msg.damage);
        markDamagedNow(p, Date.now());
        p.events.push({ type: "pvp_damage_taken", attackerName: msg.attackerName, damage: msg.damage });
        if (wasAlive && p.hp <= 0) p.events.push({ type: "pvp_defeated", byName: msg.attackerName });
        break;
      }

      // 얼음 계열 스킬(빙결 감옥·절대 영도 등)에 맞았을 때 — 서버가 판정하고
      // 알려주면, 이동 입력을 무시하는 건 내 클라이언트(PlayerController)의 몫입니다.
      case "pvp_freeze":
        this.state.player.frozenRemainingSec = Math.max(this.state.player.frozenRemainingSec, msg.durationSec);
        break;

      case "pvp_hit_ack":
        this.state.player.events.push({ type: "pvp_hit_landed", targetName: msg.targetName, damage: msg.damage });
        break;

      case "pvp_rejected":
        this.state.player.events.push({
          type: "pvp_rejected",
          reason: PVP_REJECT_MESSAGES[msg.reason] ?? msg.reason,
        });
        break;

      case "player_skill_fx":
        if (msg.fromId !== this.myId) {
          this._pendingSkillFx.push({
            fromId: msg.fromId,
            slot: msg.slot,
            weaponId: msg.weaponId,
            position: msg.position,
            aimYaw: msg.aimYaw,
          });
        }
        break;

      case "enemy_states": {
        const now = Date.now();
        for (const e of msg.enemies) {
          this.remoteEnemyGhosts.set(e.id, {
            x: e.x,
            z: e.z,
            hp: e.hp,
            maxHp: e.maxHp,
            alive: e.alive,
            fromId: msg.fromId,
            updatedAtMs: now,
          });
        }
        break;
      }

      case "trade_invite":
        this._incomingTradeInvite = { fromId: msg.fromId, fromName: msg.fromName };
        break;

      case "trade_invite_sent":
        this._outgoingTradeInvite = { toId: msg.toId, toName: msg.toName };
        break;

      case "trade_started":
        // 초대가 수락돼서 실제로 시작된 것이므로, 대기 중이던 초대 상태는 이제 의미가 없습니다.
        this._incomingTradeInvite = null;
        this._outgoingTradeInvite = null;
        this._tradeSession = {
          partnerId: msg.partnerId,
          partnerName: msg.partnerName,
          myOffer: [],
          myAccepted: false,
          partnerOffer: [],
          partnerAccepted: false,
          confirmDeadlineMs: null,
        };
        this.state.player.events.push({ type: "trade_started", partnerName: msg.partnerName });
        break;

      case "trade_update":
        if (this._tradeSession) {
          this._tradeSession.partnerOffer = msg.partnerOffer;
          this._tradeSession.partnerAccepted = msg.partnerAccepted;
          this._tradeSession.confirmDeadlineMs = msg.confirmDeadlineMs ?? null;
        }
        break;

      case "trade_complete": {
        const partnerName = this._tradeSession?.partnerName ?? "상대";
        // 내가 제안했던 아이템들을 실제로 내 인벤토리에서 뺍니다 — 협상 중에는
        // 아직 손에 남아 있다가, 거래가 "성사"된 이 순간에만 실제로 이동합니다.
        if (this._tradeSession) {
          for (const item of this._tradeSession.myOffer) {
            removeFromInventory(this.state.player, item.id as ItemId, item.quantity);
          }
        }
        const received: InventoryItem[] = msg.receivedItems.map((it) => ({
          id: it.id as ItemId,
          name: it.name,
          description: it.description,
          icon: it.icon,
          usable: it.usable,
          equippable: it.equippable,
          quantity: it.quantity,
        }));
        applyReceivedItems(this.state.player, received);
        this._tradeSession = null;
        this.state.player.events.push({ type: "trade_completed", partnerName });
        break;
      }

      case "trade_closed":
        this._tradeSession = null;
        this._incomingTradeInvite = null;
        this._outgoingTradeInvite = null;
        this.state.player.events.push({ type: "trade_closed", reason: TRADE_CLOSE_MESSAGES[msg.reason] ?? msg.reason });
        break;

      case "gift_received": {
        const items: InventoryItem[] = [
          {
            id: msg.item.id as ItemId,
            name: msg.item.name,
            description: msg.item.description,
            icon: msg.item.icon,
            usable: msg.item.usable,
            equippable: msg.item.equippable,
            quantity: msg.item.quantity,
          },
        ];
        applyReceivedItems(this.state.player, items);
        this.state.player.events.push({ type: "gift_received", fromName: msg.fromName, itemName: msg.item.name });
        break;
      }

      case "gift_ack":
        this.state.player.events.push({ type: "gift_sent", delivered: msg.delivered === true });
        break;

      case "bounty_update":
        this._bountyEntries = msg.entries;
        break;

      case "crew_status":
        this._myCrew = msg.crew;
        break;

      case "crew_list":
        this._crewList = msg.crews;
        break;

      case "crew_error":
        this.state.player.events.push({ type: "purchase_failed", reason: msg.reason });
        break;
    }
  }

  /** 몬스터 유령이 이 시간 넘게 갱신이 없으면 지웁니다 (추적을 그만뒀거나 상대가 나감). */
  private pruneEnemyGhosts(nowMs: number) {
    for (const [id, ghost] of this.remoteEnemyGhosts) {
      if (nowMs - ghost.updatedAtMs > ENEMY_GHOST_TTL_MS) this.remoteEnemyGhosts.delete(id);
    }
  }

  /** 지금 내 어그로 범위 안에 있는(=나를 쫓고 있는) 몬스터들만 골라 보고합니다. */
  private buildEnemySyncSnapshot(): EnemySyncEntry[] {
    const p = this.state.player;
    const out: EnemySyncEntry[] = [];
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      if (dist2D(enemy.position.x, enemy.position.z, p.position.x, p.position.z) > enemy.aggroRange) continue;
      out.push({ id: enemy.id, x: enemy.position.x, z: enemy.position.z, hp: enemy.hp, maxHp: enemy.maxHp, alive: enemy.alive });
      if (out.length >= MAX_ENEMY_SYNC_ENTRIES) break;
    }
    return out;
  }

  /** 매 프레임 호출: 보간 갱신 + (연결 중이면) 주기적으로 상태를 서버에 보냅니다. */
  tick(dt: number, nowMs: number, drawnWeaponId: string | null, combatStats: CombatStatsSnapshot) {
    for (const view of this.remotePlayers.values()) view.step(dt);
    this.pruneEnemyGhosts(nowMs);
    if (!this.connected) return;

    const p = this.state.player;
    if (nowMs - this.lastStateSentAtMs >= 1000 / STATE_SYNC_HZ) {
      this.lastStateSentAtMs = nowMs;
      this.send({
        type: "state",
        position: p.position,
        yaw: p.yaw,
        aimYaw: p.aimYaw,
        hp: p.hp,
        maxHp: p.maxHp,
        level: p.level,
        sea: this.state.sea,
        animState: animStateFor(this.state),
        hakiActive: p.hakiActive,
        drawnWeaponId,
      });
    }

    const sig = JSON.stringify(combatStats);
    if (sig !== this.lastStatsSig && nowMs - this.lastStatsSentAtMs >= 1000 / COMBAT_STATS_SYNC_HZ) {
      this.lastStatsSentAtMs = nowMs;
      this.lastStatsSig = sig;
      this.send({ type: "combat_stats", stats: combatStats });
    }

    if (nowMs - this.lastEnemySyncAtMs >= 1000 / ENEMY_SYNC_HZ) {
      this.lastEnemySyncAtMs = nowMs;
      const enemies = this.buildEnemySyncSnapshot();
      if (enemies.length > 0) this.send({ type: "enemy_states", enemies });
    }
  }

  // --- 거래 / 선물 -----------------------------------------------------------

  /** 다른 플레이어에게 거래를 겁니다 — 곧바로 거래창이 열리지 않고, 상대가 수락해야 양쪽 다 열립니다. */
  sendTradeRequest(targetId: string) {
    this.send({ type: "trade_request", targetId });
  }

  /** 받은 거래 신청에 응답합니다 — accept가 true여야 양쪽 다 거래창이 열립니다. */
  respondTradeInvite(accept: boolean) {
    if (!this._incomingTradeInvite) return;
    this._incomingTradeInvite = null; // 응답 즉시 팝업을 닫습니다 (서버 응답을 기다리지 않음)
    this.send({ type: "trade_invite_respond", accept });
  }

  /** 내 거래창에 담긴 아이템을 통째로 다시 보냅니다 (드래그로 넣거나 뺄 때마다). */
  sendTradeOffer(items: TradeItem[]) {
    if (!this._tradeSession) return;
    this._tradeSession.myOffer = items;
    this._tradeSession.myAccepted = false;
    this.send({ type: "trade_offer", items });
  }

  sendTradeAccept(accepted: boolean) {
    if (!this._tradeSession) return;
    this._tradeSession.myAccepted = accepted;
    this.send({ type: "trade_accept", accepted });
  }

  sendTradeCancel() {
    if (!this._tradeSession) return;
    this._tradeSession = null;
    this.send({ type: "trade_cancel" });
  }

  /** 거래창 없이 아이템 하나를 바로 선물합니다. */
  sendGift(targetId: string, item: TradeItem) {
    this.send({ type: "gift_send", targetId, item });
  }

  // --- 해적 사단(길드) ---------------------------------------------------

  /** 사단 패널을 열 때 호출 — 서버가 crew_list로 최신 목록을 돌려줍니다. */
  requestCrewList() {
    this.send({ type: "crew_list_request" });
  }

  /** 코인 차감은 호출부(Simulation.payCrewCreationFee)가 먼저 처리한 뒤 이걸 부릅니다. */
  sendCrewCreate(name: string) {
    this.send({ type: "crew_create", name });
  }

  sendCrewJoin(crewId: string) {
    this.send({ type: "crew_join", crewId });
  }

  sendCrewLeave() {
    this.send({ type: "crew_leave" });
  }

  // --- 뇌광 질주 접촉 피해 -------------------------------------------------

  /** 번개 형태로 변신 중 스쳐 지나가는 상대에게 지속 피해를 요청합니다 (짧은 간격으로 반복 호출됨). */
  sendLightningContact(targetId: string) {
    this.send({ type: "lightning_contact", targetId });
  }

  setPvpEnabled(enabled: boolean) {
    this.state.player.pvpEnabled = enabled;
    this.send({ type: "pvp_toggle", enabled });
  }

  sendMeleeAttack(targetId: string) {
    this.send({ type: "melee_attack", targetId });
  }

  sendSkillAttack(targetId: string, slot: number) {
    this.send({ type: "skill_attack", targetId, slot });
  }

  /** 스킬을 쓸 때마다(전투 후보 유무·PvP 여부와 무관하게) 순수 연출용으로 알립니다. */
  sendSkillFx(slot: number, weaponId: string | null, position: Vec3Like, aimYaw: number) {
    this.send({ type: "skill_fx", slot, weaponId, position, aimYaw });
  }

  /** 아직 화면에 반영하지 않은 다른 사람의 스킬 이펙트 알림을 꺼내고 비웁니다 — 매 프레임 한 번씩. */
  drainSkillFx(): RemoteSkillFx[] {
    if (this._pendingSkillFx.length === 0) return this._pendingSkillFx;
    const out = this._pendingSkillFx;
    this._pendingSkillFx = [];
    return out;
  }

  /** 근접 사거리 안에 있는, 공격 후보가 될 만한 플레이어들 (다른 진영 + 해적끼리). */
  meleeCandidates(range: number): RemotePlayerView[] {
    const p = this.state.player;
    return this.players.filter(
      (r) =>
        canFactionPvp(p.faction, r.snapshot.faction) &&
        r.snapshot.pvpEnabled &&
        dist2D(p.position.x, p.position.z, r.renderX, r.renderZ) <= range,
    );
  }

  /** 스킬 판정 모양 안에 있는 후보들. */
  shapeCandidates(shape: SkillShape): RemotePlayerView[] {
    const p = this.state.player;
    return this.players.filter(
      (r) =>
        canFactionPvp(p.faction, r.snapshot.faction) &&
        r.snapshot.pvpEnabled &&
        pointInShape({ x: p.position.x, z: p.position.z, aimYaw: p.aimYaw }, r.renderX, r.renderZ, shape),
    );
  }
}
