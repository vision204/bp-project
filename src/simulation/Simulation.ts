import type RAPIER from "@dimforge/rapier3d-compat";
import {
  createInitialGameState,
  type FruitAbilityId,
  type GameState,
  type ItemId,
  type BoatTierId,
  type StatBlock,
} from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { PlayerController } from "./PlayerController";
import { createInitialEnemies, stepEnemies } from "./EnemyManager";
import { stepEnemyAI } from "./EnemyAI";
import { stepCombat, stepEnemyStatuses } from "./CombatSystem";
import { acceptQuest, createNpcs, createQuests, stepInteraction, applyKillsToQuests } from "./QuestSystem";
import { stepMana } from "./ManaSystem";
import { allocateStatPoint, recomputeDerivedStats } from "./StatSystem";
import { buyFruit, buyItem } from "./ShopSystem";
import { useItem } from "./InventorySystem";
import { stepBuffs } from "./BuffSystem";
import { isInWater, stepWater } from "./WaterSystem";
import { boatDeckPosition, leaveBoat, stepBoat } from "./BoatSystem";
import { learnHaki, stepHaki, toggleHaki } from "./HakiSystem";
import { rollGacha } from "./GachaSystem";
import { learnJump } from "./TrainerSystem";
import { travelSea, canTravelSea } from "./SeaSystem";
import { setGuideTarget, stepGuide } from "./GuideSystem";
import { toggleDrawn, weaponFor } from "./WeaponSystem";
import { buyBoatTier } from "./BoatSystem";
import { SWIM_SURFACE_Y, islandAt, islandArrivalPosition, getIsland, startIslandFor } from "../world/islands";
import type { Faction } from "../world/islands";

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

    // 이전 프레임 위치를 기준으로 물에 잠겼는지 판단해 부력을 켜고 끕니다.
    // (배를 타고 있으면 물에 빠진 게 아니므로 부력도 익사도 적용하지 않습니다)
    this.playerController.setSwimSurface(
      !this.state.boat.riding && isInWater(player) ? SWIM_SURFACE_Y : null,
    );

    if (input.toggleHakiPressed) toggleHaki(player, player.events);

    // 개발자 모드: F로 비행을 켜고 끕니다 (일반 모드에서는 무시)
    if (player.devMode && input.toggleFlyPressed) {
      player.flying = !player.flying;
    }

    // 숫자키로 단축바 장비를 실제로 뽑거나 집어넣습니다 (로블록스 방식)
    if (input.hotbarPressed !== null) {
      const result = toggleDrawn(player, input.hotbarPressed);
      const weapon = weaponFor(player.hotbar[input.hotbarPressed]);
      if (result && weapon) {
        player.events.push(
          result === "drawn"
            ? { type: "weapon_drawn", weaponName: weapon.name }
            : { type: "weapon_sheathed", weaponName: weapon.name },
        );
      }
    }

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
      this.playerController.step(dt, input, player);
    }
    stepCombat(dt, input, player, this.state.enemies);

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
    applyKillsToQuests(this.state.quests, kills);

    stepEnemyAI(this.state.enemies, player, dt, player.events);
    stepInteraction(this.state, input);
    stepMana(player, dt);
    stepBuffs(player, dt);
    stepHaki(player, dt, player.events);
    if (!this.state.boat.riding) stepWater(player, dt);
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

  buyItem(itemId: ItemId) {
    return buyItem(this.state.player, itemId, this.state.player.events, this.state.currentIslandId);
  }

  buyBoat(tierId: BoatTierId) {
    return buyBoatTier(this.state.player, tierId, this.state.player.events);
  }

  useItem(itemId: ItemId) {
    return useItem(this.state.player, itemId, this.state.player.events);
  }

  learnHaki() {
    return learnHaki(this.state.player, this.state.player.events);
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
    this.state.boat.riding = false;
    player.position = { ...arrival };
    this.playerController.teleport(arrival);
    this.state.currentIslandId = islandId;
    player.events.push({ type: "player_respawned" });
  }
}
