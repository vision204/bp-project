import type { GameState, NpcState, QuestState } from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { addItem } from "./InventorySystem";
import { grantExp } from "./Leveling";
import { BOAT_PRICE, canBoardBoat, boardBoat, summonBoat } from "./BoatSystem";
import { HAKI_TEACHER_ISLAND_ID } from "./HakiSystem";
import { TRAINER_ISLAND_ID } from "./TrainerSystem";
import { SEA_LABELS, SECOND_SEA_LEVEL, levelsUntilSecondSea, otherSea } from "./SeaSystem";
import {
  ISLANDS,
  dockNpcPosition,
  getIsland,
  getSpecies,
  hasEnemies,
  hubIsland,
  type IslandDef,
} from "../world/islands";

const INTERACT_RANGE = 3.5;

/**
 * 열매 뽑기 NPC가 있는 섬 — 항해 순서상 "두 번째 섬"인 정글 섬입니다.
 * (첫 번째는 진영별 시작 섬)
 */
export const GACHA_ISLAND_ID = "jungle";

/** 해적 사단 접수처가 있는 섬 — 요청대로 "중앙섬"(첫 번째 바다의 중앙 교역섬)입니다. */
export const CENTRAL_ISLAND_ID = "central";

/** 각 섬 퀘스트의 처치 목표 수 */
export const QUEST_KILL_TARGET = 7;
/**
 * 퀘스트 완료 시 "현재 레벨에 필요한 경험치의 90%"를 즉시 지급합니다.
 * 고정값이 아니라 비율이라서 레벨이 올라가도 보상이 계속 의미 있게 유지됩니다.
 */
export const QUEST_REWARD_PERCENT_OF_LEVEL = 0.9;

/** 섬 위의 특정 각도/거리에 NPC를 배치하기 위한 헬퍼 */
function placeOnIsland(island: IslandDef, angleOffset: number, distRatio: number) {
  const angle = island.dockAngle + angleOffset;
  return {
    x: island.center.x + Math.cos(angle) * island.radius * distRatio,
    y: 1,
    z: island.center.z + Math.sin(angle) * island.radius * distRatio,
  };
}

export function createNpcs(): NpcState[] {
  const npcs: NpcState[] = [];

  for (const island of ISLANDS) {
    // 몬스터가 사는 섬에만 퀘스트 NPC 1명 (부두에서 옆으로 비껴난 위치).
    // 중앙 교역섬은 중립 지대라 토벌 의뢰가 없습니다.
    if (hasEnemies(island)) {
      npcs.push({
        id: `npc_quest_${island.id}`,
        name: `${island.name} 토벌대장`,
        position: placeOnIsland(island, Math.PI * 0.5, 0.45),
        kind: "quest",
        islandId: island.id,
        questId: `quest_${island.id}`,
      });
    }

    // 섬마다 뱃사공 1명 — 어느 섬에서든 배를 사서 떠날 수 있도록
    npcs.push({
      id: `npc_dock_${island.id}`,
      name: "뱃사공",
      position: dockNpcPosition(island),
      kind: "dock",
      islandId: island.id,
    });
  }

  // 화면 우측 버튼의 상점은 "현금 결제 프리미엄 상점"이 됐고,
  // 코인으로 열매를 사는 곳은 각 바다 허브 섬(중앙 교역섬 / 분수 도시)의 상인뿐입니다.
  for (const sea of [1, 2] as const) {
    const hub = hubIsland(sea);
    npcs.push({
      id: `npc_fruit_dealer_${sea}`,
      name: "열매 상인",
      position: placeOnIsland(hub, 0, 0.35),
      kind: "fruit_dealer",
      islandId: hub.id,
    });

    // 해적왕 — 두 바다를 오가는 유일한 통로. 양쪽 허브에 한 명씩 있어서,
    // 두 번째 바다에서 다시 말을 걸면 첫 번째 바다로 돌아옵니다.
    npcs.push({
      id: `npc_pirate_king_${sea}`,
      name: "해적왕",
      position: placeOnIsland(hub, Math.PI, 0.4),
      kind: "pirate_king",
      islandId: hub.id,
    });
  }

  // 열매 도박사는 두 번째 섬(정글 섬)에 — 전 재산의 30%를 걸고 4시간에 한 번 뽑습니다.
  const gachaIsland = getIsland(GACHA_ISLAND_ID);
  npcs.push({
    id: "npc_gacha",
    name: "열매 도박사",
    position: placeOnIsland(gachaIsland, -Math.PI * 0.45, 0.4),
    kind: "gacha",
    islandId: gachaIsland.id,
  });

  // 설인은 얼음 섬(Lv.125)에 — 삼도류 판매 + 무장색 전수 + 다단 점프 훈련
  const trainerIsland = getIsland(TRAINER_ISLAND_ID);
  npcs.push({
    id: "npc_trainer",
    name: "설인",
    position: placeOnIsland(trainerIsland, Math.PI * 0.95, 0.42),
    kind: "trainer",
    islandId: trainerIsland.id,
  });

  // 무장색 사범은 3번째 섬(사막 섬)에만
  const hakiIsland = getIsland(HAKI_TEACHER_ISLAND_ID);
  npcs.push({
    id: "npc_haki_master",
    name: "무장색 사범",
    position: placeOnIsland(hakiIsland, -Math.PI * 0.5, 0.45),
    kind: "haki",
    islandId: hakiIsland.id,
  });

  // 해적 사단 접수처 — 요청대로 "중앙섬"(첫 번째 바다의 중앙 교역섬)에만 있습니다.
  // 해적 진영 전용이지만, 설인·해적왕처럼 자격이 안 될 때도 창은 열어서
  // 왜 안 되는지 보여줍니다 (숨기지 않는 게 이 프로젝트의 일관된 원칙입니다).
  const crewIsland = getIsland(CENTRAL_ISLAND_ID);
  npcs.push({
    id: "npc_pirate_crew",
    name: "해적 사단 접수처",
    position: placeOnIsland(crewIsland, Math.PI * 0.65, 0.4),
    kind: "pirate_crew",
    islandId: crewIsland.id,
  });

  return npcs;
}

/** 몬스터가 있는 섬마다 하나씩, 그 섬의 몬스터를 잡는 반복 퀘스트를 만듭니다. */
export function createQuests(): QuestState[] {
  return ISLANDS.filter(hasEnemies).map((island) => ({
    id: `quest_${island.id}`,
    npcId: `npc_quest_${island.id}`,
    islandId: island.id,
    targetSpeciesId: null,
    targetSpeciesName: null,
    title: `${island.name} 토벌 의뢰`,
    description: `${island.name}의 몬스터를 ${QUEST_KILL_TARGET}마리 처치하세요.`,
    killTarget: QUEST_KILL_TARGET,
    killProgress: 0,
    rewardPercentOfLevel: QUEST_REWARD_PERCENT_OF_LEVEL,
    rewardMoney: Math.round(island.species[0].money * 3),
    status: "available",
    completions: 0,
  }));
}

/**
 * 특정 몬스터 종류를 지정해 퀘스트를 수락합니다.
 * 몬스터가 여러 종류인 섬에서는 UI 목록에서 고른 종류가 여기로 들어옵니다.
 */
export function acceptQuest(
  state: GameState,
  islandId: string,
  speciesId: string,
): boolean {
  const quest = state.quests.find((q) => q.islandId === islandId);
  if (!quest) return false;
  if (quest.status === "active") return false;
  if (!canAcceptQuest(quest, state.player.level)) return false;

  const species = getSpecies(islandId, speciesId);
  if (!species) return false;

  const island = getIsland(islandId);
  quest.status = "active";
  quest.killProgress = 0;
  quest.targetSpeciesId = species.id;
  quest.targetSpeciesName = species.name;
  quest.title = `${island.name} 토벌 의뢰 — ${species.name}`;
  quest.description = `${species.name}을(를) ${QUEST_KILL_TARGET}마리 처치하세요. (권장 Lv.${species.tierLevel})`;
  quest.rewardMoney = Math.round(species.money * 3);
  state.player.events.push({ type: "quest_accepted", questTitle: quest.title });
  return true;
}

function dist2D(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * 처치한 몬스터가 속한 섬 + **퀘스트에서 고른 종류**일 때만 카운트를 올립니다.
 * (같은 섬이라도 다른 종류를 잡으면 진행되지 않습니다)
 */
export function applyKillsToQuests(
  quests: QuestState[],
  kills: { islandId: string; speciesId: string }[],
) {
  if (kills.length === 0) return;
  for (const quest of quests) {
    if (quest.status !== "active") continue;
    const matching = kills.filter(
      (k) =>
        k.islandId === quest.islandId &&
        (quest.targetSpeciesId === null || k.speciesId === quest.targetSpeciesId),
    ).length;
    if (matching > 0) {
      quest.killProgress = Math.min(quest.killTarget, quest.killProgress + matching);
    }
  }
}

/** 이 퀘스트를 받을 수 있는 레벨인지 */
export function canAcceptQuest(quest: QuestState, playerLevel: number) {
  return playerLevel >= getIsland(quest.islandId).requiredLevel;
}

/** 완료 시점의 레벨 기준으로 보상 경험치를 계산합니다. */
export function questRewardExp(quest: QuestState, expToNextLevel: number) {
  return Math.floor(expToNextLevel * quest.rewardPercentOfLevel);
}

function handleQuestNpc(state: GameState, npc: NpcState, input: InputSnapshot) {
  const player = state.player;
  const quest = state.quests.find((q) => q.id === npc.questId);
  if (!quest) return;

  // 섬 자체는 배를 타고 자유롭게 갈 수 있지만, 레벨이 모자라면 의뢰를 받을 수 없습니다.
  const island = getIsland(quest.islandId);
  const underLeveled = player.level < island.requiredLevel;
  if (underLeveled && quest.status !== "active") {
    state.interactionPrompt =
      `${npc.name}: 아직 자네에겐 무리야. Lv.${island.requiredLevel} 이상이어야 의뢰를 줄 수 있네 ` +
      `(현재 Lv.${player.level})`;
    if (input.interactPressed) {
      player.events.push({
        type: "quest_denied",
        questTitle: quest.title,
        requiredLevel: island.requiredLevel,
      });
    }
    return;
  }

  // 반복 수행 가능 — 완료했던 퀘스트는 다시 받을 수 있습니다.
  if (quest.status === "available" || quest.status === "completed") {
    const repeat = quest.completions > 0 ? " (반복)" : "";
    const multi = island.species.length > 1;
    state.interactionPrompt = multi
      ? `[E] ${npc.name} — 사냥할 몬스터 고르기${repeat} (${island.species.length}종류)`
      : `[E] ${npc.name} — 퀘스트 받기${repeat}: ${island.name} 토벌 의뢰`;
    if (input.interactPressed) {
      if (multi) {
        // 종류가 여럿이면 UI에서 직접 고르게 합니다 (패널을 여는 건 UI 레이어의 일)
        state.uiRequest = "quest";
        state.questNpcIslandId = island.id;
      } else {
        acceptQuest(state, island.id, island.species[0].id);
      }
    }
    return;
  }

  if (quest.killProgress < quest.killTarget) {
    state.interactionPrompt = `${npc.name}: ${quest.title} (${quest.killProgress}/${quest.killTarget})`;
    return;
  }

  const rewardExp = questRewardExp(quest, player.expToNextLevel);
  state.interactionPrompt = `[E] ${npc.name} — 퀘스트 완료 (경험치 ${rewardExp.toLocaleString()} · 코인 ${quest.rewardMoney})`;
  if (!input.interactPressed) return;

  quest.status = "completed";
  quest.completions += 1;
  quest.killProgress = 0;

  grantExp(player, rewardExp, player.events);
  player.money += quest.rewardMoney;
  addItem(player, {
    id: "potion_small",
    name: "회복 포션",
    description: "체력을 50 회복합니다. 인벤토리(I)에서 클릭해 사용하세요.",
    icon: "🧪",
    usable: true,
  });
  player.events.push({
    type: "quest_completed",
    questTitle: quest.title,
    expAwarded: rewardExp,
    moneyAwarded: quest.rewardMoney,
  });
}

/**
 * E키 상호작용을 처리합니다.
 * - 퀘스트 NPC: 수락 / 진행 안내 / 완료 보상까지 시뮬레이션이 직접 처리
 * - 상점 · 무장색 사범 · 정박한 배: 패널을 여는 건 UI 레이어의 일이라 uiRequest만 세움
 * - 뱃사공 NPC: 배 구매를 직접 처리
 */
export function stepInteraction(state: GameState, input: InputSnapshot) {
  const player = state.player;
  state.uiRequest = null;
  state.questNpcIslandId = null;
  state.interactionPrompt = null;

  // 1) 근처에 배가 있으면 "배 타기"가 최우선
  if (canBoardBoat(state)) {
    state.interactionPrompt = "[E] 배 타기 — WASD로 직접 항해";
    if (input.interactPressed) boardBoat(state, player.events);
    return;
  }

  // 2) 가장 가까운 NPC 찾기
  let nearestNpc: NpcState | null = null;
  let nearestDist = Infinity;
  for (const npc of state.npcs) {
    const d = dist2D(player.position.x, player.position.z, npc.position.x, npc.position.z);
    if (d <= INTERACT_RANGE && d < nearestDist) {
      nearestDist = d;
      nearestNpc = npc;
    }
  }
  if (!nearestNpc) return;

  switch (nearestNpc.kind) {
    case "trainer":
      state.interactionPrompt = `[E] ${nearestNpc.name} — 삼도류 · 무장색 · 점프 훈련`;
      if (input.interactPressed) state.uiRequest = "trainer";
      return;

    case "gacha":
      // 실제 뽑기는 확인창(UI)에서 — 전 재산의 30%가 걸린 일이라 바로 실행하지 않습니다.
      state.interactionPrompt = `[E] ${nearestNpc.name} — 열매 뽑기 (4시간에 1회)`;
      if (input.interactPressed) state.uiRequest = "gacha";
      return;

    case "fruit_dealer":
      // 코인으로 열매를 파는 유일한 창구입니다 (화면 상점의 열매는 현금 결제).
      state.interactionPrompt = `[E] ${nearestNpc.name} — 악마의 열매 (코인으로 구매)`;
      if (input.interactPressed) state.uiRequest = "fruit_dealer";
      return;

    case "pirate_king": {
      // 두 바다를 오가는 유일한 통로. 조건이 모자라도 창은 열어서
      // "무엇이 얼마나 남았는지"를 보여줍니다 (설인과 같은 원칙).
      const target = otherSea(state.sea);
      const need = levelsUntilSecondSea(player);
      state.interactionPrompt =
        target === 2 && need > 0
          ? `${nearestNpc.name}: 아직 이르다. ${SEA_LABELS[2]}는 Lv.${SECOND_SEA_LEVEL}부터다 (${need}레벨 남음)`
          : `[E] ${nearestNpc.name} — ${SEA_LABELS[target]}로 건너가기`;
      if (input.interactPressed) state.uiRequest = "sea";
      return;
    }

    case "haki":
      state.interactionPrompt = player.hakiLearned
        ? `${nearestNpc.name}: 이미 무장색을 익혔군. (H키로 발동)`
        : `[E] ${nearestNpc.name} — 무장색 배우기`;
      if (input.interactPressed && !player.hakiLearned) state.uiRequest = "haki";
      return;

    case "pirate_crew":
      // 해적 진영 전용 — 다른 진영이어도 창은 열어서 이유를 보여줍니다(설인과 같은 원칙).
      state.interactionPrompt =
        player.faction === "pirate"
          ? `[E] ${nearestNpc.name} — 해적 사단 만들기 · 가입`
          : `${nearestNpc.name}: 해적 사단은 해적만 만들거나 가입할 수 있다.`;
      if (input.interactPressed) state.uiRequest = "crew";
      return;

    case "dock": {
      // 배가 이미 있어도 멀리 두고 왔을 수 있으므로, 언제든 이 부두로 다시 부를 수 있습니다.
      const label = state.boat.spawned ? "배 다시 부르기" : "배 구매";
      state.interactionPrompt = `[E] ${nearestNpc.name} — ${label} (🪙${BOAT_PRICE})`;
      if (input.interactPressed) {
        summonBoat(state, nearestNpc.islandId, player.events);
      }
      return;
    }

    case "quest":
      handleQuestNpc(state, nearestNpc, input);
      return;
  }
}
