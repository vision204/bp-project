import type RAPIER from "@dimforge/rapier3d-compat";
import {
  createInitialGameState,
  type FruitAbilityId,
  type GameState,
  type ItemId,
  type BoatTierId,
  type StatBlock,
  type PlayerState,
} from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { PlayerController } from "./PlayerController";
import { createInitialEnemies, stepEnemies } from "./EnemyManager";
import { stepEnemyAI } from "./EnemyAI";
import { stepCombat, stepEnemyStatuses, stepFruitSpecialAbility } from "./CombatSystem";
import { acceptQuest, createNpcs, createQuests, stepInteraction, applyKillsToQuests } from "./QuestSystem";
import { stepMana } from "./ManaSystem";
import { stepHp } from "./HpSystem";
import { allocateStatPoint, recomputeDerivedStats } from "./StatSystem";
import { buyFruit, buyItem, payCrewCreationFee } from "./ShopSystem";
import { cancelHeldFruitCandidate, confirmHeldFruitEquip, equipFruitFromInventory, holdFruitCandidate } from "./FruitInventorySystem";
import { useItem } from "./InventorySystem";
import { stepBuffs } from "./BuffSystem";
import { isInWater, stepWater } from "./WaterSystem";
import { boatDeckPosition, leaveBoat, stepBoat } from "./BoatSystem";
import { learnHaki, stepHaki, toggleHaki } from "./HakiSystem";
import { learnTeleport, stepTeleportCooldown, beginTeleportCooldown } from "./TeleportSystem";
import { rollGacha } from "./GachaSystem";
import { learnJump } from "./TrainerSystem";
import { travelSea, canTravelSea } from "./SeaSystem";
import { setGuideTarget, stepGuide } from "./GuideSystem";
import { toggleDrawn, toggleFruitDrawn, weaponFor } from "./WeaponSystem";
import { FRUIT_CATALOG } from "./ShopSystem";
import { buyBoatTier } from "./BoatSystem";
import { SWIM_SURFACE_Y, islandAt, islandArrivalPosition, getIsland, startIslandFor } from "../world/islands";
import type { Faction } from "../world/islands";

/**
 * 단축바 한 칸을 뽑거나 집어넣습니다 (0~2 = 무기 칸, 3 = 열매).
 * 숫자키(Simulation.step)와 하단 단축바 마우스 클릭(Hud → main.ts) 양쪽에서
 * 똑같이 쓰기 위해 독립 함수로 뺐습니다. 무기/열매는 한 손이라 상호 배타적이라,
 * 하나를 뽑으면 다른 하나는 WeaponSystem.toggleDrawn/toggleFruitDrawn이 자동으로
 * 집어넣습니다.
 */
export function activateHotbarSlot(player: PlayerState, slot: number) {
  // 손에 아직 안 먹은 열매(heldFruitCandidate)를 들고 있는 동안은 무기도
  // "먹은 열매"도 뽑을 수 없습니다 — 손이 이미 그 후보 열매로 차 있습니다.
  // 4번 키만 예외로 "도로 인벤토리에 넣기"로 씁니다 (좌클릭 확정 말고 취소하는 길).
  if (player.heldFruitCandidate !== null) {
    if (slot === 3) cancelHeldFruitCandidate(player);
    return;
  }
  if (slot === 3) {
    const result = toggleFruitDrawn(player);
    const fruitName = FRUIT_CATALOG.find((f) => f.id === player.equippedFruit)?.name ?? "열매";
    player.events.push(
      result === "drawn"
        ? { type: "fruit_drawn", fruitName }
        : { type: "fruit_sheathed", fruitName },
    );
    return;
  }
  const result = toggleDrawn(player, slot);
  const weapon = weaponFor(player.hotbar[slot]);
  if (result && weapon) {
    player.events.push(
      result === "drawn"
        ? { type: "weapon_drawn", weaponName: weapon.name }
        : { type: "weapon_sheathed", weaponName: weapon.name },
    );
  }
}

/**
 * 게임 로직의 최상위 조립부입니다. main.ts(렌더 루프)는 매 프레임
 * simulation.step(dt, input)만 호출하면 되고, 렌더러는 simulation.state를
 * 읽기만 합니다 — 렌더러가 시뮬레이션을 절대 되돌려 수정하지 않는다는
 * 원칙을 지키면 이후 멀티플레이(서버 시뮬레이션 + 클라 렌더링)로 옮기기 쉽습니다.
 */
export class Simulation {
  readonly state: GameState;
  readonly playerController: PlayerController;

  constructor(
    world: RAPIER.World,
    RAPIER_NS: typeof RAPIER,
    faction: Faction = "pirate",
    devMode = false,
  ) {
    this.state = createInitialGameState(faction, devMode);
    this.state.enemies = createInitialEnemies();
    this.state.npcs = createNpcs();
    this.state.quests = createQuests();

    // 스텟(전부 0)으로부터 파생 능력치를 한 번 계산해 초기값을 맞추고 풀피/풀마나로 시작.
    recomputeDerivedStats(this.state.player);
    this.state.player.hp = this.state.player.maxHp;
    this.state.player.mana = this.state.player.maxMana;

    this.playerController = new PlayerController(world, RAPIER_NS, this.state.player.position);
  }

  /**
   * @param nowMs 실제 시각(epoch ms). 뽑기 쿨다운처럼 실시간이 필요한 곳에서 씁니다.
   *              인자로 받는 이유는 나중에 서버 시계를 그대로 넘기기 위해서입니다.
   */
  step(dt: number, input: InputSnapshot, nowMs: number = Date.now()) {
    const player = this.state.player;
    this.state.nowMs = nowMs;

    // 서리 발판(X)이 켜져 있고, 그걸 켠 지점에서 반경(5m) 안이면 "얼어붙은 바다" —
    // 실제로 물에 빠지지 않고 그 위를 걸을 수 있습니다.
    const ON_ICE_RADIUS = 5;
    const onIce =
      player.iceWalkActive &&
      player.iceWalkCenter !== null &&
      Math.hypot(player.position.x - player.iceWalkCenter.x, player.position.z - player.iceWalkCenter.z) <= ON_ICE_RADIUS;

    // 이전 프레임 위치를 기준으로 물에 잠겼는지 판단해 부력을 켜고 끕니다.
    // (배를 타고 있으면 물에 빠진 게 아니므로 부력도 익사도 적용하지 않습니다.
    //  얼어붙은 바다 위에서도 가라앉지 않도록 같은 부력 표면을 씁니다.)
    this.playerController.setSwimSurface(
      !this.state.boat.riding && (isInWater(player) || onIce) ? SWIM_SURFACE_Y : null,
    );

    if (input.toggleHakiPressed) toggleHaki(player, player.events);
    stepTeleportCooldown(player, dt);

    // 개발자 모드: F로 비행을 켜고 끕니다 (일반 모드에서는 무시)
    if (player.devMode && input.toggleFlyPressed) {
      player.flying = !player.flying;
    }

    // 숫자키로(혹은 하단 단축바를 마우스로 클릭해서) 단축바 장비를 실제로
    // 뽑거나 집어넣습니다 — 로직은 activateHotbarSlot()에 모아뒀습니다.
    if (input.hotbarPressed !== null) {
      activateHotbarSlot(player, input.hotbarPressed);
    }

    // 빛빛/용용 F 특수 능력 — 일반 Z/X/C/V 4슬롯 시스템과 완전히 별개입니다
    // (CombatSystem.ts의 stepFruitSpecialAbility 주석 참고). PlayerController.step()보다
    // 먼저 호출해야 F로 용의 비행을 켠 바로 그 프레임부터 비행 이동으로 분기합니다.
    stepFruitSpecialAbility(dt, input, player, nowMs);

    if (this.state.boat.riding) {
      // 배를 타고 있는 동안에는 걷지 않고 배를 조종합니다.
      // 내리기는 E(상호작용)로 처리하며, 여기서는 시점 회전만 반영합니다.
      this.playerController.updateCameraOnly(input, player);
      stepBoat(this.state, dt, input);
      const deck = boatDeckPosition(this.state.boat);
      player.position = { ...deck };
      player.yaw = this.state.boat.yaw;
      this.playerController.teleport(deck);
      if (input.interactPressed) this.leaveBoat();
    } else {
      this.playerController.step(dt, input, player, nowMs);
    }
    stepCombat(dt, input, player, this.state.enemies, nowMs);

    // 돌진 스킬이 요청한 이동을 물리 바디에 반영 (지형에 막히면 그만큼만 이동)
    if (player.pendingDash) {
      this.playerController.dash(player.pendingDash.x, player.pendingDash.z);
      player.pendingDash = null;
    }

    // 화상 도트·둔화 타이머 — 도트로 죽어도 출처가 열매라 열매 경험치가 들어옵니다
    stepEnemyStatuses(player, this.state.enemies, dt, player.events);

    // 처치한 몬스터의 섬 + 종류까지 넘겨서, 퀘스트에서 고른 그 종류만 카운트되게 함
    const kills = player.events
      .filter((e) => e.type === "enemy_died")
      .map((e) => {
        const died = e as Extract<typeof e, { type: "enemy_died" }>;
        return { islandId: died.islandId, speciesId: died.speciesId };
      });
    applyKillsToQuests(this.state, kills);

    stepEnemyAI(this.state.enemies, player, dt, player.events, nowMs);
    stepInteraction(this.state, input);
    stepMana(player, dt, nowMs);
    stepHp(player, dt, nowMs);
    stepBuffs(player, dt);
    stepHaki(player, dt, player.events);
    if (!this.state.boat.riding && !onIce) stepWater(player, dt, nowMs);
    else player.inWater = false;
    stepEnemies(this.state.enemies, dt);
    stepGuide(this.state); // 목적지에 도착하면 길안내 자동 종료

    // 플레이어가 서 있는 섬 갱신 (HUD 표시 + 항해 시 "현재 섬" 판정용)
    const island = islandAt(player.position.x, player.position.z);
    const nextIslandId = island ? island.id : null;
    if (nextIslandId !== this.state.currentIslandId && island) {
      // 레벨 제한 없이 어느 섬이든 갈 수 있고, 권장 레벨만 알려줍니다.
      player.events.push({
        type: "island_entered",
        islandName: island.name,
        recommendedLevel: island.requiredLevel,
      });
    }
    this.state.currentIslandId = nextIslandId;

    // 개발자 모드는 둘러보는 게 목적이라 피해를 받지 않습니다.
    if (player.devMode) {
      player.hp = player.maxHp;
      player.inWater = false;
    }

    // 체력이 0이 되거나(전투·익사), 어떤 이유로든 월드 아래로 떨어지면 부활
    if (player.hp <= 0 || player.position.y < -40) {
      this.respawnPlayer();
    }

    this.state.elapsedSec += dt;
  }

  /**
   * 이번 프레임에 쌓인 이벤트를 비웁니다. **HUD가 다 읽은 뒤에** 호출해야 합니다.
   *
   * 예전에는 step() 맨 앞에서 비웠는데, 그러면 패널 버튼(구매·뽑기·무장색 습득)처럼
   * 프레임 바깥에서 발생한 이벤트가 다음 step()에 곧바로 지워져서
   * **토스트 알림이 아예 뜨지 않았습니다.** 이제는 소비 시점을 명시적으로 잡습니다.
   */
  clearEvents() {
    this.state.player.events = [];
  }

  allocateStat(stat: keyof StatBlock) {
    allocateStatPoint(this.state.player, stat);
  }

  buyFruit(fruitId: FruitAbilityId) {
    return buyFruit(this.state.player, fruitId, this.state.player.events);
  }

  /**
   * 인벤토리의 열매를 확인 없이 즉시 장착합니다 (지금은 UI에서 쓰지 않지만,
   * 순수 로직 차원의 저수준 API로 남겨둡니다 — 테스트 등에서 유용합니다).
   */
  equipFruit(fruitId: FruitAbilityId) {
    return equipFruitFromInventory(this.state.player, fruitId, this.state.player.events);
  }

  /** 인벤토리의 열매를 오른손에 "들기"만 합니다 — 아직 먹지는 않습니다(확정은 좌클릭 확인 후). */
  holdFruit(fruitId: FruitAbilityId) {
    return holdFruitCandidate(this.state.player, fruitId);
  }

  /** 손에 든(아직 안 먹은) 열매를 도로 인벤토리에 넣습니다. */
  cancelHeldFruit() {
    return cancelHeldFruitCandidate(this.state.player);
  }

  /**
   * 손에 든 열매를 실제로 장착(먹음)합니다. **UI가 "정말 교체하시겠습니까?"
   * 확인을 이미 끝냈다고 가정하고 즉시 실행합니다** — 확인 자체는
   * PanelManager가 좌클릭을 가로채서 담당합니다.
   */
  confirmHeldFruit() {
    return confirmHeldFruitEquip(this.state.player, this.state.player.events);
  }

  buyItem(itemId: ItemId) {
    return buyItem(this.state.player, itemId, this.state.player.events, this.state.currentIslandId);
  }

  buyBoat(tierId: BoatTierId) {
    return buyBoatTier(this.state.player, tierId, this.state.player.events);
  }

  /** 해적 사단 생성 비용(🪙1000)을 낼 수 있으면 차감하고 true를 돌려줍니다 — 실제 생성 요청은 호출부가 서버로 보냅니다. */
  payCrewCreationFee() {
    return payCrewCreationFee(this.state.player, this.state.player.events);
  }

  useItem(itemId: ItemId) {
    return useItem(this.state.player, itemId, this.state.player.events);
  }

  learnHaki() {
    return learnHaki(this.state.player, this.state.player.events);
  }

  /** 얼음 섬 설인에게 R키 순간이동 배우기 (Lv.125부터) */
  learnTeleport() {
    return learnTeleport(this.state.player, this.state.player.events);
  }

  /** 단축바 칸을 마우스로 클릭했을 때 — 숫자키를 누른 것과 똑같이 동작합니다 */
  activateHotbarSlot(slot: number) {
    activateHotbarSlot(this.state.player, slot);
  }

  /**
   * R키 순간이동 — 호출부(main.ts)가 레이캐스트로 찾은 지점으로 실제 이동시킵니다.
   * 배웠는지·쿨다운인지는 main.ts가 TeleportSystem.canUseTeleport()로 미리 확인합니다.
   */
  teleportPlayerTo(pos: { x: number; y: number; z: number }) {
    this.playerController.teleport(pos);
    this.state.player.position = { ...pos };
    beginTeleportCooldown(this.state.player);
  }

  /**
   * 개발자 모드 — 그 섬 상공(높이 45m)으로 순간이동합니다.
   * 위에서 내려다보며 섬 전체를 한눈에 확인하기 좋은 높이로 잡았습니다.
   */
  teleportToIsland(islandId: string) {
    const island = getIsland(islandId);
    const pos = { x: island.center.x, y: 45, z: island.center.z };
    this.state.player.position = { ...pos };
    this.playerController.teleport(pos);
    this.state.currentIslandId = island.id;
    // 개발자 순간이동으로 바다를 건너가면 상태도 같이 옮겨야 안개·가이드가 맞습니다.
    this.state.sea = island.sea;
    return island;
  }

  /** 열매 뽑기 (전 재산의 30%, 4시간에 1회) */
  rollGacha(roll?: number) {
    return rollGacha(this.state.player, this.state.nowMs, this.state.player.events, roll);
  }

  /** 설인에게 점프 단계 배우기 */
  learnJump() {
    return learnJump(this.state.player, this.state.player.events);
  }

  /**
   * 해적왕에게 부탁해 다른 바다로 건너갑니다.
   * 도착지는 그 바다의 허브 섬(중앙 교역섬 / 분수 도시) 광장입니다.
   */
  travelSea() {
    return travelSea(this.state, (pos) => this.playerController.teleport(pos));
  }

  canTravelSea() {
    return canTravelSea(this.state);
  }

  /** 섬 가이드 목적지 지정 / 해제 */
  setGuide(islandId: string | null) {
    setGuideTarget(this.state, islandId);
  }

  /** 퀘스트 패널에서 사냥할 몬스터 종류를 골랐을 때 */
  acceptQuest(islandId: string, speciesId: string) {
    return acceptQuest(this.state, islandId, speciesId);
  }

  /** 배에서 내리기 (섬이 가까우면 상륙, 아니면 바다에 빠짐) */
  leaveBoat() {
    leaveBoat(this.state, this.state.player.events, (pos) => this.playerController.teleport(pos));
  }

  /**
   * 사망/익사 시 부활. 마지막으로 있던 섬이 있으면 그 섬 부두 근처에서,
   * 바다 한가운데서 죽었다면 시작 섬에서 되살아납니다.
   */
  private respawnPlayer() {
    const player = this.state.player;
    // 부활은 마지막으로 있던 섬, 바다 한가운데였다면 내 진영의 시작 섬에서.
    const islandId = this.state.currentIslandId ?? startIslandFor(player.faction).id;
    const arrival = islandArrivalPosition(getIsland(islandId));

    player.hp = player.maxHp;
    player.mana = player.maxMana;
    player.inWater = false;
    player.hakiActive = false;
    player.frozenRemainingSec = 0;
    player.iceWalkActive = false;
    player.iceWalkCenter = null;
    player.lightningFormRemainingSec = 0;
    player.sandBladeActive = false;
    player.dragonFlightActive = false;
    player.lightFormRemainingSec = 0;
    this.state.boat.riding = false;
    player.position = { ...arrival };
    this.playerController.teleport(arrival);
    this.state.currentIslandId = islandId;
    player.events.push({ type: "player_respawned" });
  }
}
