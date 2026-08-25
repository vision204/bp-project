// ---------------------------------------------------------------------------
// GameState는 "무엇이 참인가"만 담는 순수 데이터입니다. Three.js 오브젝트나
// DOM을 참조하지 않습니다. 이렇게 분리해두면 나중에 이 시뮬레이션 로직을
// 그대로 Node.js 서버로 옮겨서 멀티플레이 권위 서버(authoritative server)를
// 만들 때 렌더러/UI 코드를 뜯어낼 필요가 없습니다.
// (지금은 싱글플레이어로만 실행되지만, 구조는 이 분리를 지키도록 짰습니다.)
// ---------------------------------------------------------------------------

import { expRequiredForLevel } from "./ExpCurve";
import { islandArrivalPosition, startIslandFor, type Faction, type Sea } from "../world/islands";

export type { Faction };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type FruitAbilityId =
  | "magma_fist"
  | "ice_lance"
  | "thunder_strike"
  | "dark_wave"
  | "rubber_barrage"
  | "sand_storm";

/** 몬스터에게 걸린 상태이상 (열매 스킬로 부여) */
export interface EnemyStatus {
  /** 이동속도 배율 (1 = 정상). 둔화가 끝나면 1로 복귀 */
  slowFactor: number;
  slowRemainingSec: number;
  /** 초당 지속 피해 */
  burnDps: number;
  burnRemainingSec: number;
}

/**
 * 레벨업으로 얻는 포인트를 배분하는 5가지 스텟.
 *   · attack — 근접(맨손) 공격력 + 최대 마나 (예전의 "마나"와 "공격력"을 하나로 합쳤습니다)
 *   · defense — 최대 체력 (예전의 "체력" 스텟과 완전히 같은 역할, 이름만 바뀌었습니다)
 *   · sword — 도검류(요루·삼도류·엔마) 데미지 배율
 *   · gun — 새총 등 원거리 무기 데미지 배율
 *   · fruit — 악마의 열매 능력 데미지 배율
 */
export interface StatBlock {
  attack: number;
  defense: number;
  sword: number;
  gun: number;
  fruit: number;
}

export type ItemId =
  | "potion_small"
  | "potion_exp"
  | "sword_yoru"
  | "sword_santoryu"
  | "sword_enma"
  | "gun_slingshot";

/** 배 등급 — 비쌀수록 빠르고 잘 돕니다 */
export type BoatTierId = "dinghy" | "clipper" | "galewind";

export interface InventoryItem {
  id: ItemId;
  name: string;
  description: string;
  icon: string; // 이모지 1글자 (아트 에셋 도입 전 플레이스홀더 아이콘)
  quantity: number;
  /** true면 인벤토리에서 클릭해 즉시 사용(소모)할 수 있음 */
  usable: boolean;
  /** true면 인벤토리에서 클릭해 단축바(하단 중앙)에 장착할 수 있음 */
  equippable?: boolean;
}

export type QuestStatus = "available" | "active" | "completed";

export interface QuestState {
  id: string;
  npcId: string;
  /** 이 섬의 몬스터를 잡아야만 카운트됩니다 */
  islandId: string;
  /**
   * 잡아야 할 몬스터 종류. 몬스터가 두 종류 이상인 섬에서는 E를 눌렀을 때
   * 목록에서 직접 고르며, 고른 종류만 카운트됩니다. (수락 전에는 null)
   */
  targetSpeciesId: string | null;
  targetSpeciesName: string | null;
  title: string;
  description: string;
  killTarget: number;
  killProgress: number;
  /**
   * 보상 경험치는 고정값이 아니라 "완료 시점의 현재 레벨 요구 경험치 × 이 비율"로
   * 계산합니다. 0.9면 그 레벨의 90%를 한 번에 받습니다. 레벨이 오를수록 보상도
   * 같이 커지므로 후반 섬에서도 의미 있는 보상이 됩니다.
   */
  rewardPercentOfLevel: number;
  rewardMoney: number;
  status: QuestStatus;
  /** 몇 번 완료했는지 (반복 수행 가능) */
  completions: number;
}

/**
 * quest = 퀘스트 제공, shop = 상점, dock = 뱃사공(배 판매), haki = 무장색 사범,
 * fruit_dealer = 중앙 교역섬에서 **코인으로** 악마의 열매를 파는 상인,
 * gacha = 두 번째 섬(정글)에서 코인을 걸고 랜덤 열매를 뽑아주는 도박사,
 * trainer = 얼음 섬의 설인 — 삼도류 판매 + 무장색 전수 + 다단 점프 훈련
 */
export type NpcKind =
  | "quest"
  | "shop"
  | "dock"
  | "haki"
  | "fruit_dealer"
  | "gacha"
  | "trainer"
  /** 해적왕 — 두 바다를 오가게 해주는 유일한 통로 */
  | "pirate_king";

export interface NpcState {
  id: string;
  name: string;
  position: Vec3;
  kind: NpcKind;
  islandId: string;
  questId?: string; // kind === "quest" 일 때만 사용
}

/**
 * 배는 직접 조종하는 탈것입니다. 뱃사공에게 사면 그 섬 부두에 소환되고,
 * 타면 WASD로 바다를 자유롭게 항해할 수 있습니다. 레벨 제한이나 목적지 선택
 * 없이 어느 섬이든 직접 배를 몰고 가서 상륙하면 됩니다.
 */
export interface BoatState {
  /** 현재 소환된 배의 등급 */
  tier: BoatTierId;
  /** 배가 월드에 소환되어 있는지 */
  spawned: boolean;
  position: Vec3;
  /** 뱃머리가 향한 방향(라디안) */
  yaw: number;
  /** 현재 전진 속도 (m/s, 음수면 후진) */
  speed: number;
  /** 플레이어가 탑승 중인지 */
  riding: boolean;
}

export interface PlayerState {
  /**
   * 시작할 때 고른 진영. 시작 섬(해적 마을 / 해군 기지)과 부활 지점만 갈리고,
   * 그 다음 항로(정글 섬 Lv.25부터)는 양쪽이 완전히 같습니다.
   */
  faction: Faction;
  position: Vec3;
  velocity: Vec3;
  yaw: number; // 캐릭터가 바라보는 방향(라디안)
  grounded: boolean;

  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  money: number;

  level: number;
  exp: number;
  expToNextLevel: number;

  stats: StatBlock;
  unspentStatPoints: number;
  abilityDamageMultiplier: number; // stats.fruit로부터 파생
  /** 도검류(요루·삼도류·엔마)에만 곱해지는 배율 — stats.sword로부터 파생 */
  swordDamageMultiplier: number;
  /** 새총 등 원거리 무기에만 곱해지는 배율 — stats.gun으로부터 파생 */
  gunDamageMultiplier: number;

  meleeCooldownSec: number;
  meleeRemainingCooldownSec: number;
  meleeDamage: number; // stats.attack으로부터 파생 (마나와 합쳐진 스텟입니다)
  meleeRange: number;

  /**
   * 악마의 열매는 한 번에 하나만 먹을 수 있습니다.
   * 새 열매를 먹으면 이 값이 교체되고, 스킬 4개도 통째로 바뀝니다.
   */
  equippedFruit: FruitAbilityId;
  /** Z/X/C/V 4개 슬롯의 남은 쿨다운(초) */
  skillCooldowns: number[];

  /**
   * 열매 레벨은 캐릭터 레벨과 완전히 별개입니다.
   * **막타를 열매 스킬로 넣었을 때만** 열매 경험치가 오릅니다.
   * 스킬 해금: Z=1, X=25, C=50, V=100
   */
  fruitLevel: number;
  fruitExp: number;
  fruitExpToNext: number;

  /** 자기 강화 스킬(기어 세컨드 등)로 얻는 열매 데미지 배율 */
  fruitBuffMultiplier: number;
  fruitBuffRemainingSec: number;

  /** 질주(Shift 한 번으로 토글) 중인지 — HUD 표시용 */
  sprinting: boolean;

  /** 카메라가 바라보는 방향 — 부채꼴/직선 스킬의 조준 기준 */
  aimYaw: number;
  /** 돌진 스킬이 요청한 이동량. Simulation이 물리 바디에 적용한 뒤 비웁니다 */
  pendingDash: { x: number; z: number } | null;

  inventory: InventoryItem[];

  /** 구매해서 보유 중인 배 등급들 (소환 시 가장 좋은 배가 나옵니다) */
  ownedBoats: BoatTierId[];

  /**
   * 하단 중앙 단축바. 인벤토리에서 장비를 클릭하면 여기에 "1차 장착"되고,
   * 숫자키(1~3)를 눌러야 실제로 손에 듭니다 (로블록스 방식).
   */
  hotbar: (ItemId | null)[];
  /** 실제로 손에 들고 있는 단축바 칸 (null이면 맨손) */
  activeHotbarSlot: number | null;

  /**
   * 열매를 실제로 "뽑아 든" 상태인지 (숫자키 4번). 무기와 마찬가지로, 열매도
   * 그냥 먹었다고 바로 스킬(Z/X/C/V)을 쓸 수 있는 게 아니라 숫자키로 꺼내야
   * 합니다. 무기를 뽑으면(activeHotbarSlot이 null이 아니게 되면) 이 값은
   * 자동으로 꺼지고, 반대로 열매를 뽑으면 무기는 자동으로 집어넣어집니다 —
   * "지금 손에 든 것"은 열매든 무기든 하나뿐입니다.
   */
  fruitDrawn: boolean;

  /**
   * 무기별 숙련도(레벨). 열매 레벨과 완전히 같은 방식으로 오르지만, 열매는
   * 하나뿐이라 단일 값인 반면 무기는 여러 자루를 오가며 쓸 수 있어 무기 id별로
   * 따로 관리합니다. 처음 손에 들기 전까지는 항목이 없다가, 그 무기로 첫
   * 경험치를 얻는 순간 Lv.1로 생성됩니다.
   */
  weaponMastery: Partial<Record<ItemId, { level: number; exp: number; expToNext: number }>>;

  /** 무장색(무장색 패기)을 배웠는지 */
  hakiLearned: boolean;
  /** 무장색을 현재 발동 중인지 — 켜면 전신이 검게 변하고 근접 데미지가 올라갑니다 */
  hakiActive: boolean;

  /** 경험치 2배 버프 남은 시간(초). 0이면 버프 없음 */
  expBuffRemainingSec: number;
  /** 물에 빠져 헤엄치는 중인지 (HUD 경고 표시용) */
  inWater: boolean;

  /**
   * 개발자 모드 — 시작 화면에서 "개발자 모드"를 고르면 켜집니다.
   * 날아다니면서 섬들을 빠르게 둘러보며 피드백하기 위한 모드라,
   * 지형을 통과해 자유 비행하고 피해를 받지 않습니다.
   */
  devMode: boolean;
  /** 비행 중인지 (개발자 모드에서 F키로 토글, 기본 켜짐) */
  flying: boolean;

  /**
   * 마지막으로 열매를 뽑은 실제 시각(epoch ms). null이면 아직 안 뽑음.
   * 새로고침해도 제한이 유지되도록 브라우저에 저장됩니다(Persistence.ts).
   */
  lastGachaAtMs: number | null;

  /** 섬 가이드에서 고른 목적지 (없으면 null) */
  guideTargetIslandId: string | null;

  /**
   * 멀티플레이 PvP를 허용할지. 기본은 꺼짐이고, 저장되지 않습니다(매 접속마다
   * 다시 켜야 함) — 개발자 모드처럼 "실수로 계속 켜진 채 있는" 사고를 막기
   * 위해서입니다. 서버는 공격자·대상 양쪽이 이 값을 켰고 서로 다른 진영일
   * 때만 피해를 인정합니다 (자세한 내용은 src/network/protocol.ts 참고).
   */
  pvpEnabled: boolean;

  /**
   * 공중에서 몇 번까지 점프할 수 있는지 (1 = 보통 점프만).
   * 얼음 섬 설인에게 Lv.125부터 2단을 배우고, 이후 100레벨마다 한 단씩 늘립니다.
   */
  maxJumps: number;

  /** R키 순간이동을 배웠는지 — 얼음 섬 설인에게 Lv.125부터 배울 수 있습니다 */
  teleportLearned: boolean;
  /** 순간이동 남은 쿨다운(초) — 0이면 바로 다시 쓸 수 있음 */
  teleportCooldownSec: number;

  /**
   * 두 번째 바다를 한 번이라도 연 적이 있는지.
   * 첫 항해에만 Lv.1100이 필요하고, 그 뒤로는 레벨과 상관없이 왕복할 수 있게
   * 하려고 따로 들고 있습니다 (돌아왔다가 갇히는 일이 없도록).
   */
  unlockedSecondSea: boolean;

  // 최근 발생한 이벤트(HUD 이펙트/사운드/토스트 트리거용, 매 프레임 소비 후 비움)
  events: GameEvent[];
}

export type GameEvent =
  | { type: "player_hit_landed"; targetId: string; damage: number }
  | { type: "player_leveled_up"; newLevel: number; statPointsAwarded: number }
  | { type: "enemy_died"; enemyId: string; islandId: string; speciesId: string; expAwarded: number }
  | { type: "quest_completed"; questTitle: string; expAwarded: number; moneyAwarded: number }
  | { type: "quest_accepted"; questTitle: string }
  | { type: "quest_denied"; questTitle: string; requiredLevel: number }
  | { type: "fruit_leveled_up"; newFruitLevel: number }
  | { type: "skill_locked"; skillName: string; requiredFruitLevel: number }
  | { type: "haki_learned" }
  | { type: "haki_toggled"; active: boolean }
  | { type: "player_damaged"; amount: number }
  | { type: "player_drowning" }
  | { type: "player_respawned" }
  | { type: "fruit_purchased"; fruitName: string }
  | { type: "item_purchased"; itemName: string }
  | { type: "item_used"; itemName: string }
  | { type: "purchase_failed"; reason: string }
  | { type: "boat_summoned"; boatName: string }
  | { type: "boat_bought"; boatName: string }
  | { type: "item_hotbarred"; itemName: string; slot: number }
  | { type: "weapon_drawn"; weaponName: string }
  | { type: "weapon_sheathed"; weaponName: string }
  | { type: "fruit_drawn"; fruitName: string }
  | { type: "fruit_sheathed"; fruitName: string }
  | { type: "weapon_leveled_up"; weaponId: ItemId; weaponName: string; newLevel: number }
  | { type: "weapon_skill_locked"; skillName: string; requiredWeaponLevel: number }
  | { type: "gacha_rolled"; fruitName: string; paid: number }
  | { type: "jump_learned"; jumps: number }
  | { type: "teleport_learned" }
  | { type: "teleport_failed" }
  | { type: "sea_changed"; sea: Sea; seaName: string; islandName: string }
  | { type: "guide_started"; islandName: string }
  | { type: "guide_arrived"; islandName: string }
  | { type: "boat_boarded" }
  | { type: "boat_left"; landed: boolean }
  | { type: "island_entered"; islandName: string; recommendedLevel: number }
  /** Q 대쉬가 실제로 나갔을 때 — 렌더러가 이동 방향으로 바람 이펙트를 띄웁니다 */
  | { type: "player_dashed"; dx: number; dz: number }
  // --- 멀티플레이 / PvP ---------------------------------------------------
  // CombatSystem은 다른 플레이어의 존재를 전혀 모릅니다(싱글플레이 로직은
  // 그대로 유지). 이 이벤트들은 근접/스킬 공격이 "나갔다"는 사실만 알리고,
  // 실제로 다른 플레이어를 맞혔는지는 src/network/PvpCombat.ts가 이 이벤트를
  // 보고 별도로 판정합니다.
  | { type: "melee_attack_fired" }
  | { type: "skill_fired"; slot: number }
  | { type: "pvp_connected" }
  | { type: "pvp_disconnected"; reason: string }
  | { type: "pvp_hit_landed"; targetName: string; damage: number }
  | { type: "pvp_damage_taken"; attackerName: string; damage: number }
  | { type: "pvp_defeated"; byName: string }
  | { type: "pvp_rejected"; reason: string }
  // --- 거래 / 선물 ---------------------------------------------------------
  | { type: "trade_started"; partnerName: string }
  | { type: "trade_completed"; partnerName: string }
  | { type: "trade_closed"; reason: string }
  | { type: "gift_received"; fromName: string; itemName: string }
  | { type: "gift_sent"; delivered: boolean };

export interface EnemyState {
  id: string;
  islandId: string;
  /** 어떤 종류의 몬스터인지 (퀘스트 대상 판정에 사용) */
  speciesId: string;
  speciesName: string;
  /** 3D 표시용 — 종류마다 색과 크기가 다릅니다 */
  color: number;
  scale: number;
  position: Vec3;
  spawnPosition: Vec3;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimerSec: number;
  expReward: number;
  moneyReward: number;
  status: EnemyStatus;

  // 추적 AI 파라미터
  aggroRange: number;
  chaseSpeed: number;
  contactRange: number;
  contactDamage: number;
  contactCooldownSec: number;
  remainingContactCooldownSec: number;
}

/** 시뮬레이션이 UI 레이어에 "이 패널을 열어달라"고 요청하는 신호 (해당 프레임에만 유효) */
export type UiRequest =
  | "shop"
  | "haki"
  | "quest"
  | "fruit_dealer"
  | "gacha"
  | "trainer"
  | "sea"
  | null;

export interface GameState {
  player: PlayerState;
  enemies: EnemyState[];
  npcs: NpcState[];
  quests: QuestState[];
  boat: BoatState;
  /** 플레이어가 현재 서 있는 섬의 id (바다 위면 null) */
  currentIslandId: string | null;
  /** 이번 프레임의 실제 시각(epoch ms) — 뽑기 쿨다운처럼 실시간이 필요한 곳에서 씁니다 */
  nowMs: number;
  /** NPC 상호작용 가능 범위 안에 있을 때 HUD에 표시할 안내 문구 (없으면 null) */
  interactionPrompt: string | null;
  uiRequest: UiRequest;
  /** 퀘스트 패널을 열 때, 어느 섬 토벌대장 앞인지 (몬스터 종류 선택 목록에 사용) */
  questNpcIslandId: string | null;
  /**
   * 지금 있는 바다(세계). 좌표만 봐도 알 수 있지만, 바다 위에 떠 있는 순간에도
   * 흔들리지 않는 값이 필요해서 상태로 들고 있습니다 (안개 색·섬 가이드 목록 등).
   */
  sea: Sea;
  elapsedSec: number;
}

// 레벨 곡선은 섬 정의와 공유하기 위해 별도 모듈에 있습니다 (순환 참조 방지).
// 기존 import 경로(`from "../core/GameState"`)를 그대로 쓸 수 있도록 다시 내보냅니다.
export { expRequiredForLevel } from "./ExpCurve";
export type { Sea } from "../world/islands";

export function createInitialGameState(
  faction: Faction = "pirate",
  devMode = false,
): GameState {
  // 고른 진영의 시작 섬에서 출발합니다 (부활 지점도 이 섬).
  const start = startIslandFor(faction);
  const spawn = islandArrivalPosition(start);

  return {
    elapsedSec: 0,
    nowMs: 0,
    interactionPrompt: null,
    uiRequest: null,
    questNpcIslandId: null,
    currentIslandId: start.id,
    sea: start.sea,
    boat: { tier: "dinghy", spawned: false, position: { x: 0, y: -0.35, z: 0 }, yaw: 0, speed: 0, riding: false },
    player: {
      faction,
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      grounded: false,

      hp: 100,
      maxHp: 100,
      mana: 50,
      maxMana: 50,
      money: 50,

      level: 1,
      exp: 0,
      expToNextLevel: expRequiredForLevel(1),

      stats: { attack: 0, defense: 0, sword: 0, gun: 0, fruit: 0 },
      unspentStatPoints: 0,
      abilityDamageMultiplier: 1,
      swordDamageMultiplier: 1,
      gunDamageMultiplier: 1,

      meleeCooldownSec: 0.5,
      meleeRemainingCooldownSec: 0,
      meleeDamage: 8,
      meleeRange: 2.2,

      equippedFruit: "magma_fist",
      skillCooldowns: [0, 0, 0, 0],

      fruitLevel: 1,
      fruitExp: 0,
      fruitExpToNext: 34, // fruitExpRequiredForLevel(1)
      fruitBuffMultiplier: 1,
      fruitBuffRemainingSec: 0,

      sprinting: false,

      aimYaw: 0,
      pendingDash: null,

      inventory: [],
      ownedBoats: ["dinghy"],
      hotbar: [null, null, null],
      activeHotbarSlot: null,
      fruitDrawn: false,
      weaponMastery: {},
      hakiLearned: false,
      hakiActive: false,
      expBuffRemainingSec: 0,
      inWater: false,
      devMode,
      flying: devMode, // 개발자 모드로 들어오면 바로 날 수 있게
      lastGachaAtMs: null,
      guideTargetIslandId: null,
      pvpEnabled: true,
      maxJumps: 1,
      teleportLearned: false,
      teleportCooldownSec: 0,
      unlockedSecondSea: false,
      events: [],
    },
    enemies: [],
    npcs: [],
    quests: [],
  };
}
