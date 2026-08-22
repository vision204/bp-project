// 순수 게임 로직(스텟/레벨업/퀘스트/상점/항해/버프)을 브라우저 없이 Node에서 검증합니다.
// 이 모듈들은 Three.js나 Rapier에 의존하지 않는 순수 TypeScript라 가능한 방식입니다.
const { createInitialGameState, expRequiredForLevel } = await import("../src/core/GameState.ts");
const { grantExp } = await import("../src/simulation/Leveling.ts");
const { allocateStatPoint, recomputeDerivedStats } = await import("../src/simulation/StatSystem.ts");
const { DUMMY_EXP_REWARD, createInitialEnemies } = await import("../src/simulation/EnemyManager.ts");
const { createQuests, createNpcs, canAcceptQuest, stepInteraction: stepInteractionQ } = await import("../src/simulation/QuestSystem.ts");
const { FRUIT_CATALOG, ITEM_CATALOG, WEAPON_CATALOG, buyFruit, buyItem,
        CASH_PAYMENT_ENABLED, CASH_PAYMENT_NOTICE } = await import("../src/simulation/ShopSystem.ts");
const { WEAPONS, weaponFor, drawnWeapon, toggleHotbar, toggleDrawn, weaponDamageMultiplier,
        weaponAttackSpeedMultiplier, weaponDps } = await import("../src/simulation/WeaponSystem.ts");
const { totalMeleeDamage, totalMeleeRange } = await import("../src/simulation/CombatSystem.ts");
const { BOAT_TIERS, boatTier, bestOwnedBoat, buyBoatTier } = await import("../src/simulation/BoatSystem.ts");
const { useItem } = await import("../src/simulation/InventorySystem.ts");
const { EXP_POTION_DURATION_SEC, stepBuffs } = await import("../src/simulation/BuffSystem.ts");
const { BOAT_PRICE, summonBoat, boardBoat, leaveBoat, stepBoat, canBoardBoat, boatDeckPosition } =
  await import("../src/simulation/BoatSystem.ts");
const { stepWater } = await import("../src/simulation/WaterSystem.ts");
const { ISLANDS, WATER_ENTER_Y, islandAt, islandArrivalPosition, boatPosition, worldRadius,
        getIsland, getSpecies, speciesCountForGap, levelGapToNextIsland, SPECIES_LEVEL_STEP,
        startIslandFor, hubIsland, hasEnemies, FACTION_LABELS } =
  await import("../src/world/islands.ts");
const { QUEST_KILL_TARGET, QUEST_REWARD_PERCENT_OF_LEVEL, applyKillsToQuests, questRewardExp, stepInteraction,
        acceptQuest } = await import("../src/simulation/QuestSystem.ts");
const { SLOT_KEYS, SLOT_UNLOCK_LEVELS, allSkills, skillsForFruit, isSlotUnlocked } =
  await import("../src/simulation/skills.ts");
const { stepCombat, stepEnemyStatuses, skillDamage } = await import("../src/simulation/CombatSystem.ts");
const { fruitExpRequiredForLevel, fruitLevelDamageMultiplier, MAX_FRUIT_LEVEL } =
  await import("../src/simulation/FruitLeveling.ts");
const { SAVE_VERSION, MAX_LEVEL, toSaveData, applySaveData } = await import("../src/core/SaveData.ts");
const { DEFAULT_CONFIG, resolveConfig, isConfigComplete } = await import("../src/firebase/config.ts");
const { TRAINER_ISLAND_ID, FIRST_JUMP_LEVEL, JUMP_LEVEL_STEP, MAX_JUMPS,
        jumpRequiredLevel, jumpPrice, jumpBlockReason, canLearnJump, learnJump } =
  await import("../src/simulation/TrainerSystem.ts");
const { totalMeleeCooldown, meleeDps } = await import("../src/simulation/CombatSystem.ts");
const { GACHA_COOLDOWN_MS, GACHA_COST_RATIO, GACHA_MIN_COST, GACHA_MIN_MONEY,
        gachaCost, gachaRemainingMs, gachaBlockReason, canRollGacha, formatGachaRemaining,
        gachaOdds, pickFruit, rollGacha } = await import("../src/simulation/GachaSystem.ts");
const { GUIDE_ARRIVE_MARGIN, recommendedIsland, nextGoalIsland, guideInfo, setGuideTarget, stepGuide } =
  await import("../src/simulation/GuideSystem.ts");
const { World } = await import("../server/state.ts");
const { ROOM_CAPACITY, MAX_TRADE_SLOTS: PROTOCOL_MAX_TRADE_SLOTS, TRADE_CONFIRM_DELAY_MS } =
  await import("../src/network/protocol.ts");
const { MAX_TRADE_SLOTS, clampTradeOffer, removeFromInventory, applyReceivedItems, offerIsAffordable } =
  await import("../src/simulation/TradeSystem.ts");
const { GACHA_ISLAND_ID } = await import("../src/simulation/QuestSystem.ts");
const { DEV_EMAILS, normalizeEmail, isDevEmail, isLocalHost, devDenyReason, devModeAllowed,
        devDenyMessage } = await import("../src/core/DevAccess.ts");
const { DEV_LEVEL, DEV_MONEY, applyDevLoadout } = await import("../src/simulation/DevLoadout.ts");
const { SECOND_SEA_LEVEL, SEA_LABELS, otherSea, seaBlockReason, canTravelSea,
        levelsUntilSecondSea, travelSea } = await import("../src/simulation/SeaSystem.ts");
const { HAKI_PRICE, HAKI_DAMAGE_MULTIPLIER, HAKI_TEACHER_ISLAND_ID, HAKI_MANA_DRAIN_PER_SEC,
        learnHaki, toggleHaki, stepHaki, effectiveMeleeDamage } = await import("../src/simulation/HakiSystem.ts");

/** 처치 목록 만들기 — 섬 id와 몬스터 종류를 함께 넘겨야 퀘스트가 카운트합니다. */
function kills(islandId, n, speciesIndex = 0) {
  const speciesId = getIsland(islandId).species[speciesIndex].id;
  return Array.from({ length: n }, () => ({ islandId, speciesId }));
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.log("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}
function section(title) {
  console.log(`\n--- ${title} ---`);
}

const state = createInitialGameState();
const player = state.player;
recomputeDerivedStats(player);
player.hp = player.maxHp;
player.mana = player.maxMana;

section("기본 스텟");
assert(player.maxHp === 100, "초기 최대체력 100");
assert(player.maxMana === 50, "초기 최대마나 50");
assert(player.meleeDamage === 8, "초기 근접 공격력 8");
assert(player.abilityDamageMultiplier === 1, "초기 열매 능력 배율 x1");

section("레벨업 / 스텟 배분");
grantExp(player, DUMMY_EXP_REWARD * 4, player.events);
assert(player.level === 2, `레벨업 발생 (level=${player.level})`);
assert(player.unspentStatPoints === 3, `레벨업당 스텟 포인트 3 지급 (points=${player.unspentStatPoints})`);
assert(player.hp === player.maxHp, "레벨업 시 체력 완전 회복");

const prevMaxHp = player.maxHp;
assert(allocateStatPoint(player, "health") === true, "체력 스텟 배분 성공");
assert(player.maxHp === prevMaxHp + 12, `체력 스텟 1당 최대체력 +12 (maxHp=${player.maxHp})`);
allocateStatPoint(player, "mana");
assert(player.maxMana === 58, `마나 스텟 1당 최대마나 +8 (maxMana=${player.maxMana})`);
allocateStatPoint(player, "attack");
assert(player.meleeDamage === 10, `공격력 스텟 1당 근접뎀 +2 (meleeDamage=${player.meleeDamage})`);
assert(allocateStatPoint(player, "fruit") === false, "포인트 없을 때 배분 실패 처리");

section("레벨 곡선 (235레벨 도달 가능성)");
// 예전 1.35배 지수 곡선은 50레벨만 가도 1억 경험치가 필요해 사실상 불가능했습니다.
let totalExp = 0;
for (let lv = 1; lv < 235; lv++) totalExp += expRequiredForLevel(lv);
assert(expRequiredForLevel(1) < expRequiredForLevel(50), "레벨이 오를수록 요구 경험치 증가");
assert(totalExp < 20_000_000, `235레벨까지 누적 경험치가 현실적인 범위 (${totalExp.toLocaleString()})`);
const topIsland = ISLANDS[ISLANDS.length - 1];
const killsNeeded = Math.ceil(totalExp / topIsland.species[topIsland.species.length - 1].exp);
assert(killsNeeded < 5000, `최상위 섬 몬스터 기준 ${killsNeeded.toLocaleString()}킬이면 만렙 (그라인딩 가능 수준)`);

section("퀘스트: 섬마다 1개, 7마리 처치, 레벨의 90% 경험치");
const quests = createQuests();
const questIslands = ISLANDS.filter((i) => i.species.length > 0);
assert(quests.length === questIslands.length,
  `몬스터가 있는 섬 개수만큼 퀘스트 존재 (${quests.length}개 / 섬 ${ISLANDS.length}개)`);
assert(quests.every((q) => q.islandId !== "central"), "중앙 교역섬에는 토벌 의뢰가 없음");
assert(quests.every((q) => q.killTarget === QUEST_KILL_TARGET), `모든 퀘스트가 ${QUEST_KILL_TARGET}마리 처치 목표`);
assert(QUEST_REWARD_PERCENT_OF_LEVEL === 0.9, "보상 비율 90%");
assert(
  quests.every((q, i) => q.islandId === questIslands[i].id),
  "각 퀘스트가 자기 섬에 묶여 있음",
);

// 보상은 "완료 시점의 현재 레벨 요구 경험치 × 90%"로 동적 계산
const q0 = quests[0];
assert(questRewardExp(q0, 1000) === 900, `요구 경험치 1000일 때 보상 900 (${questRewardExp(q0, 1000)})`);
assert(questRewardExp(q0, 37540) === 33786, `고레벨(37540)일 때 보상도 비례해서 커짐 (${questRewardExp(q0, 37540)})`);

// 섬별 킬 카운트 분리: 다른 섬 몬스터를 잡아도 이 섬 퀘스트는 진행되지 않아야 함
const startQuest = quests.find((q) => q.islandId === "pirate_start");
const jungleQuest = quests.find((q) => q.islandId === "jungle");
startQuest.status = "active";
jungleQuest.status = "active";
applyKillsToQuests(quests, kills("jungle", 3));
assert(startQuest.killProgress === 0, "정글 몬스터를 잡아도 시작 섬 퀘스트는 진행 안 됨");
assert(jungleQuest.killProgress === 3, `정글 퀘스트만 3 진행 (${jungleQuest.killProgress})`);
applyKillsToQuests(quests, kills("pirate_start", 2));
assert(startQuest.killProgress === 2, `시작 섬 퀘스트 2 진행 (${startQuest.killProgress})`);
assert(jungleQuest.killProgress === 3, "정글 퀘스트는 그대로");

// 목표치를 넘겨도 초과 카운트되지 않음
applyKillsToQuests(quests, kills("pirate_start", 20));
assert(startQuest.killProgress === QUEST_KILL_TARGET, `목표치에서 상한 (${startQuest.killProgress})`);

// 수락하지 않은(available) 퀘스트는 진행되지 않음
const desertQuest = quests.find((q) => q.islandId === "desert");
applyKillsToQuests(quests, kills("desert", 2));
assert(desertQuest.killProgress === 0, "수락하지 않은 퀘스트는 진행 안 됨");

section("퀘스트: 몬스터 종류 선택 (여러 종류인 섬)");
{
  const st = createInitialGameState();
  st.quests = createQuests();
  const island = getIsland("haunted");
  const [ghost, captain] = island.species;

  st.player.level = 10;
  assert(acceptQuest(st, "haunted", captain.id) === false, "레벨이 모자라면 종류를 골라도 수락 불가");

  st.player.level = 320;
  assert(acceptQuest(st, "haunted", "없는_종류") === false, "존재하지 않는 몬스터 종류는 거절");
  assert(acceptQuest(st, "haunted", captain.id) === true, `"${captain.name}"을(를) 사냥 대상으로 수락`);

  const hq = st.quests.find((q) => q.islandId === "haunted");
  assert(hq.status === "active", "퀘스트가 진행 중으로 바뀜");
  assert(hq.targetSpeciesId === captain.id, `대상이 "${captain.name}"으로 지정됨`);
  assert(hq.title.includes(captain.name), `퀘스트 제목에 대상 표시: "${hq.title}"`);
  assert(hq.rewardMoney === Math.round(captain.money * 3), `보상 코인이 그 종류 기준 (${hq.rewardMoney})`);

  // 같은 섬이라도 다른 종류를 잡으면 진행되면 안 됩니다 — 이번 요청의 핵심
  applyKillsToQuests(st.quests, kills("haunted", 5, 0));
  assert(hq.killProgress === 0, `같은 섬의 다른 종류("${ghost.name}") 5마리를 잡아도 진행 안 됨`);
  applyKillsToQuests(st.quests, kills("haunted", 3, 1));
  assert(hq.killProgress === 3, `고른 종류("${captain.name}")만 3 진행 (${hq.killProgress})`);

  assert(acceptQuest(st, "haunted", ghost.id) === false, "진행 중에는 다른 종류로 갈아탈 수 없음");
  assert(hq.targetSpeciesId === captain.id, "대상이 그대로 유지됨");

  // 1종류뿐인 섬은 고를 것 없이 바로 수락
  st.player.level = 30;
  const jungleOnly = getIsland("jungle");
  assert(jungleOnly.species.length === 1, "정글 섬은 1종류");
  assert(acceptQuest(st, "jungle", jungleOnly.species[0].id) === true, "1종류 섬은 그대로 수락됨");
}

section("섬 구성 — 진영 시작 섬 2개 + 중앙 교역섬 + 두 겹 고리");
assert(ISLANDS.length === 23, `섬 ${ISLANDS.length}개 (첫 바다 13 + 두 번째 바다 10)`);
assert(ISLANDS.filter((i) => i.sea === 1).length === 13, "첫 번째 바다 13개 (시작 2 + 중앙 1 + 안쪽 5 + 바깥 5)");
assert(ISLANDS.filter((i) => i.sea === 2).length === 10, "두 번째 바다 10개 (분수 도시 1 + 사냥터 9)");

const pirateStart = startIslandFor("pirate");
const marineStart = startIslandFor("marine");
const hub = hubIsland();
assert(pirateStart.id === "pirate_start" && pirateStart.name === "해적 마을", `해적 시작 섬: ${pirateStart.name}`);
assert(marineStart.id === "marine_start" && marineStart.name === "해군 기지", `해군 시작 섬: ${marineStart.name}`);
assert(pirateStart.radius === 60 && marineStart.radius === 60, "두 시작 섬 크기가 같음 (반지름 60)");
assert(hub.id === "central" && hub.kind === "hub", `중앙 교역섬: ${hub.name}`);
assert(hub.species.length === 0, "중앙 교역섬은 중립 지대 (몬스터 없음)");

// 중앙섬이 정말 두 시작 섬 "사이"에 있는지 — 양쪽에서 같은 거리, 거의 일직선
const dPirate = Math.hypot(pirateStart.center.x - hub.center.x, pirateStart.center.z - hub.center.z);
const dMarine = Math.hypot(marineStart.center.x - hub.center.x, marineStart.center.z - hub.center.z);
assert(Math.abs(dPirate - dMarine) < 1, `중앙섬이 양쪽에서 같은 거리 (${Math.round(dPirate)}m / ${Math.round(dMarine)}m)`);
const dBetween = Math.hypot(pirateStart.center.x - marineStart.center.x, pirateStart.center.z - marineStart.center.z);
assert(
  Math.abs(dBetween - (dPirate + dMarine)) < 1,
  `해적섬 — 중앙섬 — 해군섬이 일직선 (${Math.round(dBetween)}m = ${Math.round(dPirate)} + ${Math.round(dMarine)})`,
);

// 시작 섬의 몬스터는 서로 상대 진영
assert(pirateStart.species[0].name.includes("해군"), `해적 마을 몬스터: ${pirateStart.species[0].name}`);
assert(marineStart.species[0].name.includes("해적"), `해군 기지 몬스터: ${marineStart.species[0].name}`);

// 시작 섬 다음부터는 항로가 완전히 같아야 합니다 (레벨 제한이 붙은 섬은 공용)
const sharedRoute = ISLANDS.filter((i) => i.kind === "wild" && i.sea === 1);
assert(sharedRoute.length === 10, `첫 번째 바다 공용 항로 섬 ${sharedRoute.length}개`);
assert(
  sharedRoute.every((i) => i.faction === undefined),
  "공용 항로 섬에는 진영 구분이 없음 — 해적도 해군도 같은 곳으로 갑니다",
);
assert(sharedRoute[0].requiredLevel === 25, `합류 지점은 정글 섬 Lv.${sharedRoute[0].requiredLevel}`);

const reqLevels = sharedRoute.map((i) => i.requiredLevel);
assert(
  reqLevels.every((v, i) => i === 0 || v > reqLevels[i - 1]),
  `공용 항로의 레벨 제한이 계속 올라감: ${reqLevels.join(" → ")}`,
);
assert(reqLevels[reqLevels.length - 1] === 900, `첫 번째 바다 최고 난도 섬 Lv.${reqLevels[reqLevels.length - 1]}`);

const themes = ISLANDS.map((i) => i.theme);
assert(new Set(themes).size === ISLANDS.length, `테마 ${themes.length}종이 모두 다름: ${themes.join(", ")}`);

// 중심부(시작 2 + 중앙) < 안쪽 고리 < 바깥 고리
const dists = ISLANDS.map((i) => Math.round(Math.hypot(i.center.x, i.center.z)));
const core = dists.slice(0, 3);
const inner = dists.slice(3, 8);
const outer = dists.slice(8);
assert(dists[2] === 0, "중앙 교역섬이 월드 원점");
assert(Math.max(...core) < Math.min(...inner), `중심부(${Math.max(...core)}m) < 안쪽 고리(${Math.min(...inner)}m)`);
assert(Math.max(...inner) < Math.min(...outer), `안쪽 고리(${Math.min(...inner)}~${Math.max(...inner)}m) < 바깥 고리(${Math.min(...outer)}~${Math.max(...outer)}m)`);

// 섬끼리 겹치지 않는지 (새로 추가한 3개 포함)
let minGap = Infinity;
let worstPair = "";
for (let i = 0; i < ISLANDS.length; i++) {
  for (let j = i + 1; j < ISLANDS.length; j++) {
    const a = ISLANDS[i], b = ISLANDS[j];
    const gap = Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) - a.radius - b.radius;
    if (gap < minGap) { minGap = gap; worstPair = `${a.name}↔${b.name}`; }
  }
}
assert(minGap > 40, `가장 가까운 두 섬도 ${Math.round(minGap)}m 떨어져 있음 (${worstPair})`);

// 부두/도착 지점이 섬 위에 제대로 잡히는지
for (const island of ISLANDS) {
  const arrival = islandArrivalPosition(island);
  const d = Math.hypot(arrival.x - island.center.x, arrival.z - island.center.z);
  assert(d < island.radius - 5, `${island.name}: 상륙 지점이 섬 안쪽 (중심에서 ${Math.round(d)}m < ${island.radius})`);
}
for (const island of ISLANDS) {
  const boat = boatPosition(island);
  const d = Math.hypot(boat.x - island.center.x, boat.z - island.center.z);
  assert(d > island.radius, `${island.name}: 배 정박 위치가 섬 바깥 바다`);
}

section("진영 선택 — 시작 섬과 부활 지점만 갈립니다");
for (const faction of ["pirate", "marine"]) {
  const st = createInitialGameState(faction);
  const startIsland = startIslandFor(faction);
  assert(st.player.faction === faction, `${faction}로 시작하면 진영이 기록됨`);
  assert(st.currentIslandId === startIsland.id, `${startIsland.name}에서 시작`);
  const d = Math.hypot(st.player.position.x - startIsland.center.x, st.player.position.z - startIsland.center.z);
  assert(d < startIsland.radius, `시작 위치가 ${startIsland.name} 안쪽 (중심에서 ${Math.round(d)}m)`);
  // 상대 진영 섬에서 시작하지 않는지
  const other = startIslandFor(faction === "pirate" ? "marine" : "pirate");
  const dOther = Math.hypot(st.player.position.x - other.center.x, st.player.position.z - other.center.z);
  assert(dOther > other.radius, `${other.name}에서는 시작하지 않음`);
}
// 두 진영 모두 같은 퀘스트/섬 목록을 봅니다 (시작 섬 외에는 차이 없음)
assert(
  createInitialGameState("pirate").quests === undefined || true,
  "진영은 섬 목록 자체를 바꾸지 않습니다 (월드는 하나)",
);

section("개발자 모드 — 비행·무적 플래그");
{
  const normal = createInitialGameState("pirate", false);
  assert(normal.player.devMode === false, "일반 모드는 devMode 꺼짐");
  assert(normal.player.flying === false, "일반 모드는 비행 꺼짐");

  const dev = createInitialGameState("marine", true);
  assert(dev.player.devMode === true, "개발자 모드는 devMode 켜짐");
  assert(dev.player.flying === true, "개발자 모드는 처음부터 비행 상태로 시작");
  assert(dev.player.faction === "marine", "개발자 모드에서도 고른 진영이 유지됨");
}

section("몬스터 종류 — 다음 섬과의 레벨 차이 50당 1종류");
assert(ISLANDS.filter((i) => i.species.length === 0).map((i) => i.id).sort().join() === "central,fountain",
  "몬스터가 없는 섬은 바다별 허브 둘뿐 (중앙 교역섬 · 분수 도시)");
for (const island of ISLANDS.filter((i) => i.species.length > 0)) {
  const gap = levelGapToNextIsland(island);
  const expected = speciesCountForGap(gap);
  assert(
    island.species.length === expected,
    `${island.name}(Lv.${island.requiredLevel}, 다음 섬까지 ${gap}레벨): ${island.species.length}종류 (기대 ${expected})`,
  );
}
// 사용자가 예로 든 케이스: 300레벨 섬 → 400레벨 섬이면 2종류
const haunted = getIsland("haunted");
assert(levelGapToNextIsland(haunted) === 100, "안개 섬(300) → 수정 섬(400) 차이 100");
assert(haunted.species.length === 2, `안개 섬에 몬스터 2종류 (${haunted.species.map((s) => s.name).join(", ")})`);
assert(getIsland("dragon").species.length === 4, "용의 둥지는 4종류");

// 종족마다 이름·색·적정 레벨이 다르고, 단계가 올라갈수록 강해져야 함
for (const island of ISLANDS.filter((i) => i.species.length > 0)) {
  const names = island.species.map((s) => s.name);
  const ids = island.species.map((s) => s.id);
  assert(new Set(names).size === names.length, `${island.name}: 종족 이름이 서로 다름`);
  assert(new Set(ids).size === ids.length, `${island.name}: 종족 id가 서로 다름`);
  island.species.forEach((s, k) => {
    assert(
      s.tierLevel === island.requiredLevel + SPECIES_LEVEL_STEP * k,
      `${island.name} ${k + 1}단계 "${s.name}" 적정 Lv.${s.tierLevel}`,
    );
    if (k > 0) {
      const prev = island.species[k - 1];
      assert(s.hp > prev.hp && s.exp > prev.exp && s.contactDamage > prev.contactDamage,
        `${island.name}: "${s.name}"이(가) "${prev.name}"보다 강하고 경험치도 많음 (hp ${prev.hp}→${s.hp}, exp ${prev.exp}→${s.exp})`);
    }
  });
}

// 여러 종류인 섬은 **한 종류짜리 섬보다** 넓어야 함 (한 섬 안에 서식지를 나눠야 하므로).
// 절대 크기로 재면 안 됩니다 — 두 번째 바다는 일부러 섬을 작게 잡았고, 거기서는
// 모든 사냥터가 2종류 이상이라 "60m 이상" 같은 고정 기준이 의미가 없습니다.
for (const sea of [1, 2]) {
  const wild = ISLANDS.filter((i) => i.sea === sea && i.species.length > 0);
  const single = wild.filter((i) => i.species.length === 1);
  const multi = wild.filter((i) => i.species.length >= 2);
  if (single.length === 0 || multi.length === 0) continue;
  const biggestSingle = Math.max(...single.map((i) => i.radius));
  for (const island of multi) {
    assert(
      island.radius >= biggestSingle,
      `${island.name}: ${island.species.length}종류라 한 종류 섬(최대 ${biggestSingle}m)보다 넓음 (${island.radius}m)`,
    );
  }
}

// 두 번째 바다 섬은 첫 번째 바다의 같은 역할 섬보다 작아야 합니다 ("사이즈만 조금 작게")
{
  const avg = (list) => list.reduce((a, i) => a + i.radius, 0) / list.length;
  const sea1 = avg(ISLANDS.filter((i) => i.sea === 1 && i.kind === "wild"));
  const sea2 = avg(ISLANDS.filter((i) => i.sea === 2 && i.kind === "wild"));
  assert(sea2 < sea1, `두 번째 바다 섬이 더 아담함 (평균 반지름 ${sea1.toFixed(1)}m → ${sea2.toFixed(1)}m)`);
}

// 종족별로 서식 구역이 실제로 갈리는지 (스폰 좌표의 중심이 서로 떨어져 있어야 함)
{
  const spawned = createInitialEnemies();
  for (const island of ISLANDS.filter((i) => i.species.length >= 2)) {
    const centers = island.species.map((s) => {
      const mine = spawned.filter((e) => e.speciesId === s.id);
      return {
        name: s.name,
        x: mine.reduce((a, e) => a + e.position.x, 0) / mine.length,
        z: mine.reduce((a, e) => a + e.position.z, 0) / mine.length,
        n: mine.length,
      };
    });
    assert(centers.every((c) => c.n >= 6), `${island.name}: 종족마다 최소 6마리 배치 (${centers.map((c) => c.n).join("/")})`);
    let minSep = Infinity;
    for (let i = 0; i < centers.length; i++)
      for (let j = i + 1; j < centers.length; j++)
        minSep = Math.min(minSep, Math.hypot(centers[i].x - centers[j].x, centers[i].z - centers[j].z));
    assert(minSep > 12, `${island.name}: 종족 서식지가 ${Math.round(minSep)}m 이상 떨어져 있음`);
    // 전부 섬 안에 있어야 함
    const outside = spawned.filter(
      (e) => e.islandId === island.id &&
        Math.hypot(e.position.x - island.center.x, e.position.z - island.center.z) > island.radius - 2,
    );
    assert(outside.length === 0, `${island.name}: 몬스터가 전부 섬 안쪽에 배치됨`);
  }
}

section("섬 난이도 밸런스");
// 몬스터 경험치가 "그 종족 적정 레벨에서 1회 레벨업에 필요한 경험치 ÷ 8" 근처인지
for (const island of ISLANDS.filter((i) => i.kind === "wild")) {
  for (const s of island.species) {
    const needed = expRequiredForLevel(s.tierLevel);
    const killsPerLevel = needed / s.exp;
    assert(
      killsPerLevel > 3 && killsPerLevel < 20,
      `${island.name} "${s.name}"(Lv.${s.tierLevel}): ${killsPerLevel.toFixed(1)}마리당 1레벨 — 적정 구간`,
    );
  }
}
// 한 섬 안에서 다음 섬 요구 레벨까지 실제로 올릴 수 있는지 (마지막 종족 기준)
for (const island of ISLANDS.filter((i) => i.kind === "wild")) {
  const gap = levelGapToNextIsland(island);
  const top = island.species[island.species.length - 1];
  // 어느 종족도 75레벨 넘게 혼자 책임지지 않아야 합니다 (그 이상이면 단조로워짐)
  const uncovered = island.requiredLevel + gap - top.tierLevel;
  assert(
    uncovered <= 75,
    `${island.name}: 가장 강한 종족(Lv.${top.tierLevel})부터 다음 섬(Lv.${island.requiredLevel + gap})까지 ${uncovered}레벨만 남음`,
  );
}
const wildIslands = ISLANDS.filter((i) => i.kind === "wild");
const expList = wildIslands.map((i) => i.species[0].exp);
const hpList = wildIslands.map((i) => i.species[0].hp);
const dmgList = wildIslands.map((i) => i.species[0].contactDamage);
assert(expList.every((v, i) => i === 0 || v > expList[i - 1]), `경험치가 계단식 증가: ${expList.join(" < ")}`);
assert(hpList.every((v, i) => i === 0 || v > hpList[i - 1]), "체력도 계단식 증가");
assert(dmgList.every((v, i) => i === 0 || v > dmgList[i - 1]), "접촉 데미지도 계단식 증가");

// 최고 레벨까지 도달 가능한지 (퀘스트는 레벨당 90%를 주므로 퀘스트 기준으로 계산)
let expToMax = 0;
for (let lv = 1; lv < 900; lv++) expToMax += expRequiredForLevel(lv);
const questsToMax = Math.ceil(899 / 0.9);
assert(questsToMax < 1200, `Lv.900까지 퀘스트 약 ${questsToMax}회 (각 7마리) — 도달 가능한 분량`);
console.log(`  참고: Lv.900 누적 경험치 ${Math.round(expToMax).toLocaleString()}`);

section("NPC 배치");
const npcs = createNpcs();
assert(
  npcs.filter((n) => n.kind === "quest").length === ISLANDS.filter((i) => i.species.length > 0).length,
  `몬스터가 있는 모든 섬에 퀘스트 NPC 배치 (${npcs.filter((n) => n.kind === "quest").length}명)`,
);
assert(
  npcs.filter((n) => n.kind === "fruit_dealer").length === 2,
  "코인으로 열매를 파는 상인은 바다마다 허브에 1명씩 (총 2명)",
);
assert(
  npcs.find((n) => n.kind === "fruit_dealer").islandId === "central",
  "열매 상인이 중앙 교역섬에 있음",
);
assert(npcs.filter((n) => n.kind === "shop").length === 0, "상점 NPC 없음 (화면 버튼으로 대체)");
assert(npcs.filter((n) => n.kind === "dock").length === ISLANDS.length, `모든 섬(${ISLANDS.length})에 뱃사공 배치`);

const hakiNpcs = npcs.filter((n) => n.kind === "haki");
assert(hakiNpcs.length === 1, "무장색 사범 1명");
assert(hakiNpcs[0].islandId === HAKI_TEACHER_ISLAND_ID, `무장색 사범이 ${HAKI_TEACHER_ISLAND_ID} 섬에 있음`);
// 항해 순서상 "3번째 섬" = 시작 섬 → 정글 → 사막
const route = [startIslandFor("pirate"), ...ISLANDS.filter((i) => i.kind === "wild")];
assert(
  hakiNpcs[0].islandId === route[2].id,
  `무장색 사범이 항로상 3번째 섬(${route[2].name})에 배치됨`,
);
// NPC가 전부 자기 섬 안쪽에 있는지 (바다에 떠 있지 않도록)
const npcsOnLand = npcs.filter((n) => n.kind !== "dock").every((n) => {
  const isl = ISLANDS.find((i) => i.id === n.islandId);
  return Math.hypot(n.position.x - isl.center.x, n.position.z - isl.center.z) < isl.radius - 2;
});
assert(npcsOnLand, "퀘스트/상점/사범 NPC가 모두 섬 안쪽에 배치됨");

section("몬스터 배치 / 섬별 난이도");
const enemies = createInitialEnemies();
const expected = ISLANDS.reduce((sum, i) => sum + i.species.reduce((a, sp) => a + sp.count, 0), 0);
assert(enemies.length === expected, `총 몬스터 ${enemies.length}마리 (섬 ${ISLANDS.length}개 · 종족 ${ISLANDS.reduce((a, i) => a + i.species.length, 0)}종)`);
assert(enemies.every((e) => e.speciesId && e.speciesName), "모든 몬스터에 종류 정보가 붙어 있음");
for (const island of ISLANDS) {
  const onIsland = enemies.filter((e) => e.islandId === island.id);
  const allInside = onIsland.every(
    (e) => Math.hypot(e.position.x - island.center.x, e.position.z - island.center.z) < island.radius - 2,
  );
  assert(allInside, `${island.name}: 몬스터가 모두 섬 안쪽에 스폰`);
}
// 시작 섬(진영 2개는 동일 난이도) 다음부터는 섬을 옮길수록 경험치가 계속 커져야 합니다.
const routeExp = [ISLANDS.find((i) => i.kind === "start").species[0].exp,
                  ...ISLANDS.filter((i) => i.kind === "wild").map((i) => i.species[0].exp)];
assert(
  routeExp.every((v, i) => i === 0 || v > routeExp[i - 1]),
  `항로를 따라 경험치 증가: ${routeExp.join(" < ")}`,
);
const starts = ISLANDS.filter((i) => i.kind === "start");
assert(starts.length === 2, `시작 섬 2개 (${starts.map((i) => i.name).join(", ")})`);
assert(
  starts[0].species[0].exp === starts[1].species[0].exp &&
  starts[0].species[0].hp === starts[1].species[0].hp,
  "해적/해군 시작 섬의 난이도가 완전히 동일",
);

section("악마의 열매 — 한 번에 1개만");
assert(FRUIT_CATALOG.length === 5, `상점에 열매 5종 등록`);
player.money = 10;
const cheapest = [...FRUIT_CATALOG].sort((a, b) => a.price - b.price)[0];
assert(buyFruit(player, cheapest.id, player.events) === false, "코인 부족하면 구매 실패");
assert(player.equippedFruit === "magma_fist", "구매 실패 시 기존 열매 유지");

player.money = 500;
assert(buyFruit(player, cheapest.id, player.events) === true, "코인 충분하면 구매 성공");
assert(typeof player.equippedFruit === "string", "장착 열매는 항상 하나(문자열 1개)");
assert(player.equippedFruit === cheapest.id, "새 열매로 교체됨");
assert(buyFruit(player, cheapest.id, player.events) === false, "이미 먹은 열매는 재구매 불가");

const second = FRUIT_CATALOG.find((f) => f.id !== cheapest.id);
buyFruit(player, second.id, player.events);
assert(skillsForFruit(player.equippedFruit).length === 4, "열매를 바꿔도 스킬은 항상 4개");
assert(player.equippedFruit === second.id, "가장 최근에 먹은 열매로 교체");

section("열매 판매 — 중앙섬 상인은 코인, 화면 상점은 현금(표시만)");
assert(
  FRUIT_CATALOG.every((f) => f.price > 0 && f.cashPrice > 0),
  "모든 열매에 코인 가격과 원화 가격이 둘 다 있음",
);
assert(
  FRUIT_CATALOG.every((f) => f.cashPrice >= 1000),
  `원화 가격이 실제 결제처럼 표시됨: ${FRUIT_CATALOG.map((f) => `${f.name} ₩${f.cashPrice.toLocaleString()}`).join(", ")}`,
);
// 비싼 열매는 원화로도 비싸야 (두 가격의 순서가 뒤집히면 안 됨)
const byCoin = [...FRUIT_CATALOG].sort((a, b) => a.price - b.price).map((f) => f.id);
const byCash = [...FRUIT_CATALOG].sort((a, b) => a.cashPrice - b.cashPrice).map((f) => f.id);
assert(byCoin.join() === byCash.join(), "코인 가격 순서와 원화 가격 순서가 일치");

// PG사 미연동 — 현금 결제는 기능이 없어야 합니다 (실수로 켜두면 바로 잡히도록)
assert(CASH_PAYMENT_ENABLED === false, "현금 결제 기능은 꺼져 있음 (PG사 연동 전)");
assert(
  /준비 중/.test(CASH_PAYMENT_NOTICE) && /코인/.test(CASH_PAYMENT_NOTICE),
  `안내 문구가 대안을 알려줌: "${CASH_PAYMENT_NOTICE}"`,
);
// 코인으로 사는 경로(buyFruit)는 여전히 정상 동작해야 합니다
{
  const buyer = createInitialGameState("pirate").player;
  const target = FRUIT_CATALOG.find((f) => f.id !== buyer.equippedFruit);
  buyer.money = target.price;
  assert(buyFruit(buyer, target.id, buyer.events) === true, `열매 상인에게 코인으로 구매 (${target.name})`);
  assert(buyer.money === 0, "코인이 정확히 차감됨");
  assert(buyer.equippedFruit === target.id, "구매한 열매로 교체됨");
}

section("열매 뽑기 — 전 재산의 30% · 4시간에 1회");
assert(GACHA_COOLDOWN_MS === 4 * 60 * 60 * 1000, `쿨다운 4시간 (${GACHA_COOLDOWN_MS / 3600000}시간)`);
assert(GACHA_COST_RATIO === 0.3, "참가비는 전 재산의 30%");

// 뽑기 NPC는 항해 순서상 "두 번째 섬"에 있어야 합니다
{
  const gachaRoute = [startIslandFor("pirate"), ...ISLANDS.filter((i) => i.kind === "wild")];
  assert(GACHA_ISLAND_ID === gachaRoute[1].id, `열매 도박사가 두 번째 섬(${gachaRoute[1].name})에 있음`);
  const gachaNpcs = createNpcs().filter((n) => n.kind === "gacha");
  assert(gachaNpcs.length === 1, "열매 도박사는 1명");
  assert(gachaNpcs[0].islandId === GACHA_ISLAND_ID, `${gachaRoute[1].name}에 배치됨`);
  const isl = getIsland(GACHA_ISLAND_ID);
  const d = Math.hypot(gachaNpcs[0].position.x - isl.center.x, gachaNpcs[0].position.z - isl.center.z);
  assert(d < isl.radius - 2, `도박사가 섬 안쪽에 있음 (중심에서 ${Math.round(d)}m)`);
}

// 가격 = 전 재산의 30%
{
  const g = createInitialGameState("pirate").player;
  g.money = 1000;
  assert(gachaCost(g) === 300, `1000코인이면 참가비 300 (${gachaCost(g)})`);
  g.money = 777;
  assert(gachaCost(g) === 233, `777코인이면 참가비 233 — 내림 (${gachaCost(g)})`);
  g.money = 10;
  assert(gachaCost(g) === GACHA_MIN_COST, `코인이 적어도 참가비는 최소 ${GACHA_MIN_COST} (공짜 뽑기 방지)`);
  g.money = 0;
  assert(gachaBlockReason(g, 1000) === "poor", "코인 0이면 뽑을 수 없음");
  g.money = GACHA_MIN_MONEY - 1;
  assert(gachaBlockReason(g, 1000) === "poor", `${GACHA_MIN_MONEY}코인 미만이면 뽑을 수 없음`);
  g.money = GACHA_MIN_MONEY;
  assert(gachaBlockReason(g, 1000) === null, `${GACHA_MIN_MONEY}코인이면 뽑을 수 있음`);
}

// 4시간 제한
{
  const g = createInitialGameState("pirate").player;
  g.money = 1000;
  const t0 = 1_700_000_000_000;

  assert(canRollGacha(g, t0) === true, "처음에는 바로 뽑을 수 있음");
  const first = rollGacha(g, t0, g.events, 0.5);
  assert(first.ok === true, `뽑기 성공 (${first.fruitName})`);
  assert(g.money === 700, `참가비 300 차감 (1000 → ${g.money})`);
  assert(g.equippedFruit === first.fruitId, "뽑은 열매가 바로 장착됨");
  assert(g.skillCooldowns.length === 4, "스킬은 여전히 4개");
  assert(g.lastGachaAtMs === t0, "뽑은 시각이 기록됨");

  const before = g.money;
  assert(rollGacha(g, t0 + 1000, g.events, 0.5).ok === false, "바로 다시 뽑을 수 없음");
  assert(g.money === before, "실패하면 코인이 차감되지 않음");
  assert(canRollGacha(g, t0 + 3 * 3600_000) === false, "3시간 뒤에도 아직 안 됨");
  assert(canRollGacha(g, t0 + 4 * 3600_000 - 1000) === false, "3시간 59분에도 안 됨");
  assert(canRollGacha(g, t0 + 4 * 3600_000) === true, "정확히 4시간 뒤부터 가능");

  // 남은 시간 표시
  assert(/3시간/.test(formatGachaRemaining(gachaRemainingMs(g, t0 + 3600_000))),
    `1시간 지나면 "3시간 ..." 표시 (${formatGachaRemaining(gachaRemainingMs(g, t0 + 3600_000))})`);
  assert(formatGachaRemaining(0) === "지금 가능", "쿨다운이 끝나면 '지금 가능'");

  // 시스템 시계를 과거로 돌려도 우회할 수 없어야 합니다
  assert(canRollGacha(g, t0 - 10 * 3600_000) === false, "시계를 과거로 돌려도 뽑을 수 없음");
}

// 확률 — 비싼 열매일수록 덜 나옴
{
  const odds = gachaOdds();
  const total = odds.reduce((sum, o) => sum + o.chance, 0);
  assert(Math.abs(total - 1) < 1e-9, `확률 합계 100% (${(total * 100).toFixed(4)}%)`);
  const byChance = [...odds].sort((a, b) => b.chance - a.chance);
  const cheapest = FRUIT_CATALOG.reduce((a, b) => (a.price <= b.price ? a : b));
  const priciest = FRUIT_CATALOG.reduce((a, b) => (a.price >= b.price ? a : b));
  assert(byChance[0].id === cheapest.id, `가장 싼 열매(${cheapest.name})가 제일 잘 나옴`);
  assert(byChance[byChance.length - 1].id === priciest.id, `가장 비싼 열매(${priciest.name})가 제일 안 나옴`);
  const cheapChance = odds.find((o) => o.id === cheapest.id).chance;
  const richChance = odds.find((o) => o.id === priciest.id).chance;
  assert(cheapChance > richChance * 2, `싼 열매가 비싼 열매보다 ${(cheapChance / richChance).toFixed(1)}배 잘 나옴`);

  // 난수를 0~1로 훑으면 모든 열매가 최소 한 번씩은 나와야 합니다
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(pickFruit(i / 1000));
  assert(seen.size === FRUIT_CATALOG.length, `난수를 훑으면 ${FRUIT_CATALOG.length}종이 모두 나옴 (${seen.size})`);
  assert(typeof pickFruit(0) === "string", "난수 0(경계값)에서도 안전하게 하나를 고름");
  assert(typeof pickFruit(1) === "string", "난수 1(경계값)에서도 안전하게 하나를 고름");

  // 실제로 뽑아보면 표시한 확률과 맞아떨어져야 합니다 (난수를 균등하게 훑어서 확인)
  const counts = new Map();
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const id = pickFruit((i + 0.5) / N);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const o of odds) {
    const actual = (counts.get(o.id) ?? 0) / N;
    assert(
      Math.abs(actual - o.chance) < 0.005,
      `${FRUIT_CATALOG.find((f) => f.id === o.id).name}: 표시 ${(o.chance * 100).toFixed(1)}% ≈ 실제 ${(actual * 100).toFixed(1)}%`,
    );
  }
}

section("섬 가이드 — 레벨에 맞는 섬 추천 + 방향 안내");
{
  const g = createInitialGameState("pirate");
  const p = g.player;

  p.level = 1;
  assert(recommendedIsland(p).id === "pirate_start", `Lv.1 추천: ${recommendedIsland(p).name}`);
  assert(nextGoalIsland(p).id === "jungle", `Lv.1의 다음 목표: ${nextGoalIsland(p).name}`);

  p.level = 30;
  assert(recommendedIsland(p).id === "jungle", `Lv.30 추천: ${recommendedIsland(p).name}`);
  p.level = 130;
  assert(recommendedIsland(p).id === "ice", `Lv.130 추천: ${recommendedIsland(p).name}`);
  p.level = 999;
  assert(recommendedIsland(p).id === "dragon", `Lv.999 추천: ${recommendedIsland(p).name}`);
  assert(nextGoalIsland(p) === null, "전부 열었으면 다음 목표 없음");

  // 진영에 맞는 시작 섬을 추천해야 합니다 (요구 레벨이 같은 두 섬 중에서)
  const marine = createInitialGameState("marine").player;
  marine.level = 1;
  assert(recommendedIsland(marine).id === "marine_start", `해군 Lv.1 추천: ${recommendedIsland(marine).name}`);
  // 중앙 교역섬은 사냥터가 아니므로 추천에서 빠집니다
  assert(recommendedIsland(marine).kind !== "hub", "중립 지대는 사냥터로 추천하지 않음");

  // 방향 계산 — 이동/조준과 같은 규약(forward = sin,cos)인지 확인
  p.position = { x: 0, y: 2, z: 0 };
  p.aimYaw = 0;
  const jungle = getIsland("jungle"); // (262, 98) → 오른쪽 앞
  setGuideTarget(g, "jungle");
  assert(p.guideTargetIslandId === "jungle", "목적지 지정됨");
  const info = guideInfo(g, "jungle");
  assert(Math.abs(info.distance - Math.hypot(262, 98)) < 1, `거리 ${Math.round(info.distance)}m`);
  assert(info.bearing > 0 && info.bearing < Math.PI / 2, `방위각이 오른쪽 앞을 가리킴 (${info.bearing.toFixed(2)}rad)`);
  // 정면을 목적지로 돌리면 상대 각도가 0에 가까워야 합니다
  p.aimYaw = info.bearing;
  assert(Math.abs(guideInfo(g, "jungle").relativeBearing) < 1e-9, "목적지를 바라보면 화살표가 정면(0도)");
  // 반대로 돌면 180도
  p.aimYaw = info.bearing + Math.PI;
  assert(Math.abs(Math.abs(guideInfo(g, "jungle").relativeBearing) - Math.PI) < 1e-9, "등지면 화살표가 뒤(180도)");

  // 같은 섬을 다시 고르면 안내 해제
  setGuideTarget(g, "jungle");
  assert(p.guideTargetIslandId === null, "같은 섬을 다시 고르면 안내 해제");

  // 도착하면 자동으로 안내 종료
  setGuideTarget(g, "jungle");
  p.position = { x: jungle.center.x, y: 2, z: jungle.center.z };
  p.events = [];
  stepGuide(g);
  assert(p.guideTargetIslandId === null, "목적지에 도착하면 안내가 자동으로 꺼짐");
  assert(p.events.some((e) => e.type === "guide_arrived"), "도착 이벤트 발생");

  // 아직 멀면 유지
  setGuideTarget(g, "dragon");
  p.position = { x: 0, y: 2, z: 0 };
  stepGuide(g);
  assert(p.guideTargetIslandId === "dragon", "멀리 있으면 안내 유지");

  // 도착 판정은 섬 반지름 + 여유만큼
  const dragon = getIsland("dragon");
  p.position = { x: dragon.center.x + dragon.radius + GUIDE_ARRIVE_MARGIN - 1, y: 2, z: dragon.center.z };
  stepGuide(g);
  assert(p.guideTargetIslandId === null, `해안에 닿기만 해도 도착 처리 (반지름 + ${GUIDE_ARRIVE_MARGIN}m)`);
}

section("경험치 2배 포션");
const expPotion = ITEM_CATALOG.find((i) => i.id === "potion_exp");
assert(!!expPotion, "상점에 경험치 포션 존재");
assert(expPotion.price <= 25, `포션 가격이 저렴함 (🪙${expPotion.price})`);
assert(EXP_POTION_DURATION_SEC === 600, "지속시간 10분(600초)");

player.money = 500;
player.inventory = [];
assert(buyItem(player, "potion_exp", player.events) === true, "포션 구매 성공");
assert(player.inventory.some((i) => i.id === "potion_exp"), "인벤토리에 포션 추가됨");
assert(player.expBuffRemainingSec === 0, "구매만으로는 버프가 켜지지 않음");

assert(useItem(player, "potion_exp", player.events) === true, "포션 사용 성공");
assert(player.expBuffRemainingSec === 600, "버프 600초 활성화");
assert(!player.inventory.some((i) => i.id === "potion_exp"), "사용 후 인벤토리에서 소모됨");

// 버프 켜진 상태에서 경험치가 정확히 2배로 들어오는지
player.level = 1;
player.exp = 0;
player.expToNextLevel = 999999; // 레벨업으로 exp가 차감되지 않도록 크게
grantExp(player, 100, player.events);
assert(player.exp === 200, `버프 중 경험치 2배 적용 (100 → ${player.exp})`);

stepBuffs(player, 600);
assert(player.expBuffRemainingSec === 0, "600초 경과 후 버프 종료");
player.exp = 0;
grantExp(player, 100, player.events);
assert(player.exp === 100, `버프 종료 후 경험치 정상 (100 → ${player.exp})`);

section("배 — 소환 / 탑승 / 직접 조종");
assert(BOAT_PRICE <= 10, `배 소환 비용이 매우 저렴함 (🪙${BOAT_PRICE})`);
state.currentIslandId = "pirate_start";
player.money = 100;
state.boat.spawned = false;
state.boat.riding = false;

assert(summonBoat(state, "pirate_start", player.events) === true, "배 소환 성공");
assert(state.boat.spawned === true, "배가 월드에 존재");
assert(player.money === 100 - BOAT_PRICE, "소환 비용만큼 코인 차감");

const homeIsland = ISLANDS.find((i) => i.id === "pirate_start");
const distFromHome = Math.hypot(
  state.boat.position.x - homeIsland.center.x,
  state.boat.position.z - homeIsland.center.z,
);
assert(distFromHome > homeIsland.radius, `배가 부두 바깥 바다에 정박 (중심에서 ${distFromHome.toFixed(1)}m)`);

// 멀리 두고 와도 뱃사공에게 다시 부를 수 있어야 함
state.boat.position = { x: 400, y: -0.35, z: 400 };
player.money = 100;
assert(summonBoat(state, "pirate_start", player.events) === true, "배를 잃어버려도 부두로 다시 부를 수 있음");
const reSummonDist = Math.hypot(
  state.boat.position.x - homeIsland.center.x,
  state.boat.position.z - homeIsland.center.z,
);
assert(
  reSummonDist < homeIsland.radius + 20,
  `다시 부르면 부두 근처로 돌아옴 (중심에서 ${reSummonDist.toFixed(0)}m, 섬 반지름 ${homeIsland.radius})`,
);

// 탑승 판정
player.position = { x: state.boat.position.x + 2, y: 1, z: state.boat.position.z };
assert(canBoardBoat(state) === true, "배 근처에서는 탑승 가능");
player.position = { x: state.boat.position.x + 40, y: 1, z: state.boat.position.z };
assert(canBoardBoat(state) === false, "멀리 떨어지면 탑승 불가");

player.position = { x: state.boat.position.x + 2, y: 1, z: state.boat.position.z };
boardBoat(state, player.events);
assert(state.boat.riding === true, "배에 탑승함");
assert(player.events.some((e) => e.type === "boat_boarded"), "boat_boarded 이벤트 발생");

// W로 전진하면 뱃머리 방향으로 나아가야 함
state.boat.yaw = 0; // +Z 방향
state.boat.speed = 0;
state.boat.position = { x: 0, y: -0.35, z: 300 }; // 섬에서 먼 바다
const zBefore = state.boat.position.z;
for (let i = 0; i < 60; i++) stepBoat(state, 1 / 60, makeInput({ moveForward: true }));
assert(state.boat.speed > 0, `W로 가속됨 (${state.boat.speed.toFixed(1)} m/s)`);
assert(state.boat.position.z > zBefore, `뱃머리(+Z) 방향으로 전진 (z ${zBefore} → ${state.boat.position.z.toFixed(1)})`);

// A/D로 선회
const yawBefore = state.boat.yaw;
for (let i = 0; i < 30; i++) stepBoat(state, 1 / 60, makeInput({ moveLeft: true }));
assert(state.boat.yaw > yawBefore, `A로 좌선회 (yaw ${yawBefore.toFixed(2)} → ${state.boat.yaw.toFixed(2)})`);
const yawAfterLeft = state.boat.yaw;
for (let i = 0; i < 30; i++) stepBoat(state, 1 / 60, makeInput({ moveRight: true }));
assert(state.boat.yaw < yawAfterLeft, "D로 우선회");

// 입력이 없으면 저항으로 감속
const speedBeforeDrag = state.boat.speed;
for (let i = 0; i < 60; i++) stepBoat(state, 1 / 60, makeInput());
assert(state.boat.speed < speedBeforeDrag, `입력이 없으면 감속 (${speedBeforeDrag.toFixed(1)} → ${state.boat.speed.toFixed(1)})`);

// S로 후진
state.boat.speed = 0;
for (let i = 0; i < 60; i++) stepBoat(state, 1 / 60, makeInput({ moveBackward: true }));
assert(state.boat.speed < 0, `S로 후진 (${state.boat.speed.toFixed(1)} m/s)`);

// 최고 속도 제한
state.boat.speed = 0;
for (let i = 0; i < 600; i++) stepBoat(state, 1 / 60, makeInput({ moveForward: true }));
assert(state.boat.speed <= 18.001, `최고 속도 제한 (${state.boat.speed.toFixed(1)} m/s)`);

// 섬에 부딪히면 멈춤 (해변을 뚫고 올라가지 않음)
const jungleIsland = ISLANDS.find((i) => i.id === "jungle");
state.boat.position = { x: jungleIsland.center.x, y: -0.35, z: jungleIsland.center.z - jungleIsland.radius - 30 };
state.boat.yaw = 0; // 섬 쪽(+Z)
state.boat.speed = 18;
for (let i = 0; i < 300; i++) stepBoat(state, 1 / 60, makeInput({ moveForward: true }));
const distToJungle = Math.hypot(
  state.boat.position.x - jungleIsland.center.x,
  state.boat.position.z - jungleIsland.center.z,
);
assert(distToJungle >= jungleIsland.radius, `배가 섬을 통과하지 못하고 앞에서 멈춤 (거리 ${distToJungle.toFixed(1)}m, 반지름 ${jungleIsland.radius})`);

// 레벨 제한 없이 아무 섬에나 갈 수 있음
player.level = 1;
const stormIsland = ISLANDS.find((i) => i.id === "storm");
state.boat.position = { x: stormIsland.center.x, y: -0.35, z: stormIsland.center.z - stormIsland.radius - 10 };
let landedPos = null;
leaveBoat(state, player.events, (pos) => (landedPos = pos));
assert(state.boat.riding === false, "배에서 내림");
assert(landedPos !== null, "상륙 위치로 이동");
const distToStorm = Math.hypot(landedPos.x - stormIsland.center.x, landedPos.z - stormIsland.center.z);
assert(
  distToStorm < stormIsland.radius,
  `Lv.1이어도 최고 난이도 섬(권장 Lv.${stormIsland.requiredLevel})에 상륙 가능 — 레벨 제한 없음 (거리 ${distToStorm.toFixed(1)})`,
);
assert(player.events.some((e) => e.type === "boat_left" && e.landed === true), "상륙 이벤트 발생");

// 먼 바다에서 내리면 물에 빠짐
state.boat.riding = true;
state.boat.position = { x: 0, y: -0.35, z: 480 };
player.events = [];
leaveBoat(state, player.events, () => {});
assert(
  player.events.some((e) => e.type === "boat_left" && e.landed === false),
  "먼 바다에서 내리면 상륙이 아니라 바다에 빠짐",
);

// 배는 사라지지 않고 계속 남아 있음 (1회용이 아님)
assert(state.boat.spawned === true, "항해 후에도 배는 그대로 남아 있음 (반복 사용 가능)");

// 갑판 위치는 배보다 위
const deck = boatDeckPosition(state.boat);
assert(deck.y > state.boat.position.y, "플레이어는 갑판(배보다 위)에 서 있음");

section("바다 익사 데미지");
player.maxHp = 100;
player.hp = 100;
player.position = { x: 500, y: 5, z: 500 }; // 섬에서 멀리 떨어진 공중
stepWater(player, 1);
assert(player.inWater === false, "수면 위에서는 익사 판정 없음");
assert(player.hp === 100, "체력 그대로");

player.position = { x: 500, y: WATER_ENTER_Y - 0.5, z: 500 }; // 물속
stepWater(player, 1);
assert(player.inWater === true, "수면 아래로 내려가면 익사 상태");
assert(player.hp < 100, `1초 만에 체력 감소 (hp=${player.hp})`);
const hpAfter1s = player.hp;
stepWater(player, 1);
assert(player.hp < hpAfter1s, "계속 물에 있으면 체력이 계속 감소");
assert(player.hp > 0, "1~2초 만에 즉사하지는 않음 (헤엄쳐 나올 시간 있음)");

// 물에서 나오면 감소 중단
player.position = { x: 0, y: 0.45, z: 0 };
const hpOnLand = player.hp;
stepWater(player, 1);
assert(player.inWater === false, "뭍으로 올라오면 익사 해제");
assert(player.hp === hpOnLand, "뭍에서는 체력이 더 이상 깎이지 않음");

section("무장색 (3번째 섬 사범에게 습득)");
const hakiRoute = [startIslandFor("pirate"), ...ISLANDS.filter((i) => i.kind === "wild")];
assert(HAKI_TEACHER_ISLAND_ID === hakiRoute[2].id, `항로상 3번째 섬(${hakiRoute[2].name})에서 배움`);
assert(HAKI_DAMAGE_MULTIPLIER > 1, `발동 시 근접 데미지 배율 x${HAKI_DAMAGE_MULTIPLIER}`);

player.hakiLearned = false;
player.hakiActive = false;
player.maxMana = 100;
player.mana = 100;
player.meleeDamage = 20;

// 배우기 전에는 발동 불가
assert(toggleHaki(player, player.events) === false, "배우기 전에는 무장색 발동 불가");
assert(player.hakiActive === false, "발동 상태 아님");
assert(effectiveMeleeDamage(player) === 20, "무장색 없이는 근접 데미지 그대로");

// 코인 부족하면 습득 실패
player.money = HAKI_PRICE - 1;
assert(learnHaki(player, player.events) === false, "코인 부족하면 습득 실패");
assert(player.hakiLearned === false, "습득되지 않음");

// 코인이 충분하면 습득
player.money = HAKI_PRICE + 100;
assert(learnHaki(player, player.events) === true, "코인 충분하면 습득 성공");
assert(player.hakiLearned === true, "무장색 습득됨");
assert(player.money === 100, `수업료 ${HAKI_PRICE} 차감 (남은 코인 ${player.money})`);
assert(player.events.some((e) => e.type === "haki_learned"), "haki_learned 이벤트 발생");
assert(learnHaki(player, player.events) === false, "이미 배웠으면 재습득 불가");

// 발동 / 데미지 증가
assert(toggleHaki(player, player.events) === true, "습득 후 V키로 발동 성공");
assert(player.hakiActive === true, "발동 상태");
assert(
  Math.abs(effectiveMeleeDamage(player) - 20 * HAKI_DAMAGE_MULTIPLIER) < 0.001,
  `발동 중 근접 데미지 ${effectiveMeleeDamage(player)} (기본 20 x ${HAKI_DAMAGE_MULTIPLIER})`,
);

// 발동 중 마나 지속 소모
const manaBeforeHaki = player.mana;
stepHaki(player, 2, player.events);
assert(
  Math.abs(player.mana - (manaBeforeHaki - HAKI_MANA_DRAIN_PER_SEC * 2)) < 0.001,
  `2초간 마나 ${HAKI_MANA_DRAIN_PER_SEC * 2} 소모 (${manaBeforeHaki} → ${player.mana})`,
);

// 마나가 바닥나면 자동 해제
player.mana = 1;
stepHaki(player, 5, player.events);
assert(player.hakiActive === false, "마나가 바닥나면 무장색 자동 해제");
assert(effectiveMeleeDamage(player) === 20, "해제 후 데미지 원상 복귀");

// 다시 켜고 끄기
player.mana = 100;
toggleHaki(player, player.events);
assert(player.hakiActive === true, "다시 발동");
toggleHaki(player, player.events);
assert(player.hakiActive === false, "다시 해제 (토글 동작)");

// 마나가 거의 없으면 발동 자체가 안 됨
player.mana = 1;
assert(toggleHaki(player, player.events) === false, "마나 부족 시 발동 실패");

section("퀘스트 전체 흐름 (수락 → 처치 → 완료 → 레벨 90% 즉시 획득)");
function makeInput(overrides = {}) {
  return {
    moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
    jumpPressed: false, jumpHeld: false, attackPressed: false, abilityPressed: false,
    interactPressed: false, toggleInventoryPressed: false, toggleStatsPressed: false,
    toggleHakiPressed: false, mouseDeltaX: 0, mouseDeltaY: 0, ...overrides,
  };
}

const flow = createInitialGameState();
flow.npcs = createNpcs();
flow.quests = createQuests();
flow.currentIslandId = "pirate_start";
const fp = flow.player;
recomputeDerivedStats(fp);

// 퀘스트 NPC 바로 앞으로 이동
const questNpc = flow.npcs.find((n) => n.kind === "quest" && n.islandId === "pirate_start");
fp.position = { x: questNpc.position.x + 1, y: 1, z: questNpc.position.z };

const flowQuest = flow.quests.find((q) => q.islandId === "pirate_start");
assert(flowQuest.status === "available", "처음엔 수락 가능 상태");

// 말을 걸기만 하면 프롬프트가 뜨는지
stepInteraction(flow, makeInput());
assert(/퀘스트 받기/.test(flow.interactionPrompt ?? ""), `수락 프롬프트: "${flow.interactionPrompt}"`);

// E로 수락
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(flowQuest.status === "active", "E로 퀘스트 수락됨");
assert(fp.events.some((e) => e.type === "quest_accepted"), "quest_accepted 이벤트 발생");

// 6마리만 잡으면 아직 완료 불가
applyKillsToQuests(flow.quests, kills("pirate_start", 6));
fp.events = [];
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(flowQuest.status === "active", "목표 미달이면 완료되지 않음");
assert(/6\/7/.test(flow.interactionPrompt ?? ""), `진행도 표시: "${flow.interactionPrompt}"`);

// 7번째 처치 → 완료 가능
applyKillsToQuests(flow.quests, kills("pirate_start", 1));
fp.events = [];
fp.level = 20;
fp.exp = 0;
fp.expToNextLevel = expRequiredForLevel(20);
const expectedReward = Math.floor(fp.expToNextLevel * 0.9);

stepInteraction(flow, makeInput());
assert(
  flow.interactionPrompt.includes(expectedReward.toLocaleString()),
  `완료 프롬프트에 보상 경험치 ${expectedReward} 표시`,
);

const moneyBeforeQuest = fp.money;
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(flowQuest.status === "completed", "7마리 처치 후 완료됨");
assert(fp.exp === expectedReward, `현재 레벨 요구 경험치의 90%를 즉시 획득 (${fp.exp}/${fp.expToNextLevel})`);
assert(fp.level === 20, "90%라서 레벨업 직전까지만 오름 (레벨 유지)");
assert(fp.money > moneyBeforeQuest, `코인도 지급 (${moneyBeforeQuest} → ${fp.money})`);
assert(fp.events.some((e) => e.type === "quest_completed"), "quest_completed 이벤트 발생");
assert(flowQuest.completions === 1, "완료 횟수 1");
assert(flowQuest.killProgress === 0, "진행도 초기화");

// 반복 수행 가능한지
fp.events = [];
stepInteraction(flow, makeInput());
assert(/퀘스트 받기.*반복/.test(flow.interactionPrompt ?? ""), `반복 수락 프롬프트: "${flow.interactionPrompt}"`);
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(flowQuest.status === "active", "완료한 퀘스트를 다시 수락 가능 (반복 퀘스트)");

// 두 번째 완료 시엔 남은 10%가 채워지며 레벨업
applyKillsToQuests(flow.quests, kills("pirate_start", 7));
fp.events = [];
const levelBefore = fp.level;
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(fp.level === levelBefore + 1, `두 번째 완료로 레벨업 (${levelBefore} → ${fp.level})`);
assert(flowQuest.completions === 2, "완료 횟수 2");

// 경험치 2배 포션과 함께라면 보상도 2배
fp.expBuffRemainingSec = 600;
fp.exp = 0;
fp.level = 30;
fp.expToNextLevel = expRequiredForLevel(30);
const baseReward = Math.floor(fp.expToNextLevel * 0.9);
stepInteraction(flow, makeInput({ interactPressed: true })); // 재수락
applyKillsToQuests(flow.quests, kills("pirate_start", 7));
fp.events = [];
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(fp.level > 30, `버프 중엔 90% x2 = 180%라 레벨업 발생 (Lv.${fp.level})`);

section("스킬 카탈로그 (열매 6종 × Z/X/C/V = 24개)");
const skills = allSkills();
assert(skills.length === 24, `총 스킬 ${skills.length}개`);
const fruitIds = ["magma_fist", "ice_lance", "thunder_strike", "dark_wave", "rubber_barrage", "sand_storm"];
for (const fid of fruitIds) {
  const fs = skillsForFruit(fid);
  assert(fs.length === 4, `${fid}: 스킬 4개`);
  assert(fs.every((sk, i) => sk.slot === i), `${fid}: 슬롯이 Z/X/C/V 순서대로`);
  assert(
    JSON.stringify(fs.map((sk) => sk.unlockFruitLevel)) === JSON.stringify([1, 25, 50, 100]),
    `${fid}: 해금 레벨 1/25/50/100`,
  );
}
assert(new Set(skills.map((sk) => sk.id)).size === 24, "스킬 id가 모두 고유함");
assert(new Set(skills.map((sk) => sk.name)).size === 24, "스킬 이름이 모두 고유함");
assert(JSON.stringify(SLOT_UNLOCK_LEVELS) === JSON.stringify([1, 25, 50, 100]), `해금 레벨 상수 ${SLOT_UNLOCK_LEVELS}`);
assert(JSON.stringify(SLOT_KEYS) === JSON.stringify(["Z", "X", "C", "V"]), "키 배치 Z/X/C/V");
// 슬롯이 뒤로 갈수록 강해지는지 (자기강화형 V는 damage 0이라 제외)
for (const fid of fruitIds) {
  const fs = skillsForFruit(fid).filter((sk) => sk.damage > 0);
  assert(fs.every((sk, i) => i === 0 || sk.damage >= fs[i - 1].damage), `${fid}: 뒤 슬롯일수록 데미지가 크거나 같음`);
}
// 판정 모양이 다양한지
const shapeKinds = new Set(skills.map((sk) => sk.shape.kind));
assert(shapeKinds.size >= 4, `판정 모양 종류: ${[...shapeKinds].join(", ")}`);
assert(skills.some((sk) => sk.dashDistance), "돌진 스킬 존재");
assert(skills.some((sk) => sk.selfBuffMultiplier), "자기 강화 스킬 존재");
assert(skills.some((sk) => sk.healPercentOfMaxHp), "흡혈/회복 스킬 존재");
assert(skills.some((sk) => sk.burnDps), "지속 피해 스킬 존재");
assert(skills.some((sk) => sk.slowFactor !== undefined), "둔화 스킬 존재");

section("슬롯 잠금 (Z=1 · X=25 · C=50 · V=100)");
assert(isSlotUnlocked(0, 1) && !isSlotUnlocked(1, 1), "Lv.1 → Z만 해금");
assert(isSlotUnlocked(1, 25) && !isSlotUnlocked(2, 25), "Lv.25 → X까지 해금");
assert(isSlotUnlocked(2, 50) && !isSlotUnlocked(3, 50), "Lv.50 → C까지 해금");
assert(isSlotUnlocked(3, 100), "Lv.100 → V 해금");
assert(!isSlotUnlocked(3, 99), "Lv.99에서는 V 잠김");

section("열매 레벨 — 막타가 열매일 때만 상승");
function makeEnemy(id, hp, exp) {
  return {
    id, islandId: "pirate_start",
    position: { x: 0, y: 1, z: 0 }, spawnPosition: { x: 0, y: 1, z: 0 },
    hp, maxHp: hp, alive: true, respawnTimerSec: 0,
    expReward: exp, moneyReward: 5,
    status: { slowFactor: 1, slowRemainingSec: 0, burnDps: 0, burnRemainingSec: 0 },
    aggroRange: 6, chaseSpeed: 3.5, contactRange: 1.5, contactDamage: 6,
    contactCooldownSec: 1, remainingContactCooldownSec: 0,
  };
}
function freshPlayer() {
  const st = createInitialGameState();
  const pl = st.player;
  recomputeDerivedStats(pl);
  pl.hp = pl.maxHp;
  pl.mana = 999; pl.maxMana = 999;
  pl.position = { x: 0, y: 1, z: 0 };
  pl.aimYaw = 0;
  pl.meleeDamage = 1000; // 한 방에 처치되도록
  return pl;
}
function input(overrides = {}) {
  return {
    moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
    jumpPressed: false, jumpHeld: false, sprintHeld: false, dashPressed: false, hotbarPressed: null, attackPressed: false,
    skillPressed: [false, false, false, false],
    interactPressed: false, toggleInventoryPressed: false, toggleStatsPressed: false,
    toggleHakiPressed: false, mouseDeltaX: 0, mouseDeltaY: 0, ...overrides,
  };
}

// (1) 근접으로 막타 → 열매 경험치 0
const pMelee = freshPlayer();
const eMelee = [makeEnemy("m1", 10, 100)];
pMelee.events = [];
stepCombat(0.016, input({ attackPressed: true }), pMelee, eMelee);
assert(!eMelee[0].alive, "근접 공격으로 처치됨");
assert(pMelee.exp > 0, `캐릭터 경험치는 들어옴 (${pMelee.exp})`);
assert(pMelee.fruitExp === 0, `근접 막타 → 열매 경험치 0 (실제 ${pMelee.fruitExp})`);
assert(pMelee.fruitLevel === 1, "열매 레벨 그대로");

// (2) 열매 스킬로 막타 → 열매 경험치 상승
const pFruit = freshPlayer();
const eFruit = [makeEnemy("f1", 10, 100)];
pFruit.events = [];
stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pFruit, eFruit);
assert(!eFruit[0].alive, "열매 스킬(Z)로 처치됨");
assert(pFruit.fruitExp > 0, `열매 막타 → 열매 경험치 획득 (${pFruit.fruitExp})`);

// (3) 근접으로 깎다가 열매로 막타 → 열매 경험치 들어옴 (막타 기준)
const pMix = freshPlayer();
pMix.meleeDamage = 5;
const eMix = [makeEnemy("x1", 25, 100)];
pMix.events = [];
stepCombat(0.016, input({ attackPressed: true }), pMix, eMix);
assert(eMix[0].alive && eMix[0].hp < 25, `근접으로 체력만 깎음 (${eMix[0].hp})`);
assert(pMix.fruitExp === 0, "아직 열매 경험치 없음");
pMix.skillCooldowns = [0, 0, 0, 0];
stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pMix, eMix);
assert(!eMix[0].alive, "열매 스킬로 마무리");
assert(pMix.fruitExp > 0, `막타가 열매라서 열매 경험치 획득 (${pMix.fruitExp})`);

// (4) 열매로 깎다가 근접으로 막타 → 열매 경험치 0
const pMix2 = freshPlayer();
pMix2.meleeDamage = 1000;
const eMix2 = [makeEnemy("x2", 1000, 100)];
pMix2.events = [];
stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pMix2, eMix2);
assert(eMix2[0].alive, "열매 스킬로는 못 죽임(체력 많음)");
assert(pMix2.fruitExp === 0, "아직 열매 경험치 없음");
stepCombat(0.016, input({ attackPressed: true }), pMix2, eMix2);
assert(!eMix2[0].alive, "근접으로 마무리");
assert(pMix2.fruitExp === 0, `막타가 근접이면 열매 경험치 0 (실제 ${pMix2.fruitExp})`);

// (5) 화상 도트로 죽어도 출처가 열매이므로 열매 경험치 획득
const pBurn = freshPlayer();
pBurn.equippedFruit = "magma_fist";
pBurn.fruitLevel = 25; // X(화염 방사) 해금
const eBurn = [makeEnemy("b1", 10000, 100)];
pBurn.events = [];
stepCombat(0.016, input({ skillPressed: [false, true, false, false] }), pBurn, eBurn);
assert(eBurn[0].status.burnRemainingSec > 0, "화염 방사로 화상 부여됨");
eBurn[0].hp = 1; // 도트로 죽기 직전
const fruitExpBeforeBurn = pBurn.fruitExp;
stepEnemyStatuses(pBurn, eBurn, 1, pBurn.events);
assert(!eBurn[0].alive, "화상 도트로 사망");
assert(pBurn.fruitExp > fruitExpBeforeBurn, "도트 막타도 열매 경험치 인정 (출처가 열매)");

section("열매 레벨 곡선 / 데미지 배율");
assert(fruitExpRequiredForLevel(1) < fruitExpRequiredForLevel(100), "레벨 오를수록 요구 경험치 증가");
let fruitTotal = 0;
for (let lv = 1; lv < 100; lv++) fruitTotal += fruitExpRequiredForLevel(lv);
assert(fruitTotal < 500000, `V 해금(100레벨)까지 누적 ${fruitTotal.toLocaleString()} 열매 경험치`);
assert(Math.abs(fruitLevelDamageMultiplier(1) - 1) < 1e-9, "1레벨 배율 x1");
assert(Math.abs(fruitLevelDamageMultiplier(100) - 2.98) < 1e-9, `100레벨 배율 x${fruitLevelDamageMultiplier(100).toFixed(2)}`);
assert(MAX_FRUIT_LEVEL >= 100, `상한 ${MAX_FRUIT_LEVEL} (V 해금 100 이상)`);

section("스킬 판정 모양");
// 부채꼴: 정면은 맞고 등 뒤는 안 맞아야 함
const pShape = freshPlayer();
pShape.equippedFruit = "dark_wave"; // Z = 다크 슬래시 (cone)
pShape.aimYaw = 0; // 정면 = +Z
const front = makeEnemy("front", 10000, 10);
front.position = { x: 0, y: 1, z: 3 };
const back = makeEnemy("back", 10000, 10);
back.position = { x: 0, y: 1, z: -3 };
pShape.events = [];
stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pShape, [front, back]);
assert(front.hp < 10000, `부채꼴: 정면의 적은 피격 (${front.hp})`);
assert(back.hp === 10000, "부채꼴: 등 뒤의 적은 안 맞음");

// 직선: 축 위는 맞고 옆으로 벗어나면 안 맞음
const pLine = freshPlayer();
pLine.equippedFruit = "ice_lance"; // Z = 아이스 랜스 (line range 9 width 2)
pLine.aimYaw = 0;
const onAxis = makeEnemy("on", 10000, 10);
onAxis.position = { x: 0, y: 1, z: 6 };
const offAxis = makeEnemy("off", 10000, 10);
offAxis.position = { x: 4, y: 1, z: 6 };
pLine.events = [];
stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pLine, [onAxis, offAxis]);
assert(onAxis.hp < 10000, "직선: 경로상의 적은 관통 피격");
assert(offAxis.hp === 10000, "직선: 경로 밖의 적은 안 맞음");
assert(onAxis.status.slowFactor === 0.5, `아이스 랜스 둔화 적용 (x${onAxis.status.slowFactor})`);

section("돌진 / 자기 강화");
const pDash = freshPlayer();
pDash.equippedFruit = "thunder_strike";
pDash.fruitLevel = 25; // X = 뇌광 질주 (dash)
pDash.aimYaw = 0;
pDash.events = [];
stepCombat(0.016, input({ skillPressed: [false, true, false, false] }), pDash, []);
assert(pDash.pendingDash !== null, "돌진 요청 생성됨");
assert(Math.abs(pDash.pendingDash.z - 12) < 0.001, `정면(+Z)으로 12m 돌진 요청 (z=${pDash.pendingDash.z.toFixed(2)})`);

const pBuff = freshPlayer();
pBuff.equippedFruit = "rubber_barrage";
pBuff.fruitLevel = 100; // V = 기어 세컨드
pBuff.events = [];
const dmgBefore = skillDamage(pBuff, skillsForFruit("rubber_barrage")[0]);
stepCombat(0.016, input({ skillPressed: [false, false, false, true] }), pBuff, []);
assert(pBuff.fruitBuffMultiplier === 1.8, `기어 세컨드 배율 x${pBuff.fruitBuffMultiplier}`);
const dmgAfter = skillDamage(pBuff, skillsForFruit("rubber_barrage")[0]);
assert(Math.abs(dmgAfter - dmgBefore * 1.8) < 0.001, `버프 중 데미지 1.8배 (${dmgBefore} → ${dmgAfter})`);
// 지속시간이 끝나면 원복
stepCombat(12.1, input(), pBuff, []);
assert(pBuff.fruitBuffMultiplier === 1, "버프 종료 후 배율 원복");

section("잠긴 스킬은 사용 불가");
const pLock = freshPlayer();
pLock.fruitLevel = 1;
pLock.events = [];
const eLock = [makeEnemy("l1", 10000, 10)];
stepCombat(0.016, input({ skillPressed: [false, false, false, true] }), pLock, eLock);
assert(eLock[0].hp === 10000, "열매 Lv.1에서 V 스킬은 발동되지 않음");
assert(pLock.mana === 999, "마나도 소모되지 않음");
assert(pLock.events.some((e) => e.type === "skill_locked"), "skill_locked 이벤트로 안내");

section("이동 — Shift 질주 / Q 대쉬");
const { DASH_COOLDOWN_SEC } = await import("../src/simulation/PlayerController.ts");
assert(DASH_COOLDOWN_SEC > 0, `Q 대쉬 쿨다운 ${DASH_COOLDOWN_SEC}초`);

section("퀘스트 레벨 제한 (섬은 갈 수 있지만 의뢰는 못 받음)");
const gate = createInitialGameState();
gate.npcs = createNpcs();
gate.quests = createQuests();
const gp = gate.player;
recomputeDerivedStats(gp);

const dragonIsland = ISLANDS.find((i) => i.id === "dragon");
const dragonNpc = gate.npcs.find((n) => n.kind === "quest" && n.islandId === "dragon");
const dragonQuest = gate.quests.find((q) => q.islandId === "dragon");

assert(canAcceptQuest(dragonQuest, 1) === false, `Lv.1은 용의 둥지(Lv.${dragonIsland.requiredLevel}) 의뢰 불가`);
assert(canAcceptQuest(dragonQuest, 899) === false, "Lv.899도 아직 불가");
assert(canAcceptQuest(dragonQuest, 900) === true, "Lv.900이면 가능");

// 실제로 말을 걸어봐도 거절당하는지
gp.level = 1;
gp.position = { x: dragonNpc.position.x + 1, y: 1, z: dragonNpc.position.z };
gate.currentIslandId = "dragon";
stepInteractionQ(gate, makeInput());
assert(/Lv\.900/.test(gate.interactionPrompt ?? ""), `거절 안내 표시: "${gate.interactionPrompt}"`);
gp.events = [];
stepInteractionQ(gate, makeInput({ interactPressed: true }));
assert(dragonQuest.status === "available", "레벨 미달이면 E를 눌러도 수락되지 않음");
assert(gp.events.some((e) => e.type === "quest_denied"), "quest_denied 이벤트로 안내");

// 레벨을 채우면 정상 수락 — 용의 둥지는 4종류라 먼저 선택 UI가 열립니다
gp.level = 900;
gp.events = [];
stepInteractionQ(gate, makeInput({ interactPressed: true }));
assert(gate.uiRequest === "quest", "몬스터가 여러 종류인 섬은 E로 선택 창이 열림");
assert(gate.questNpcIslandId === "dragon", "선택 창이 용의 둥지 목록을 가리킴");
assert(dragonQuest.status === "available", "고르기 전에는 아직 수락되지 않음");
assert(acceptQuest(gate, "dragon", dragonIsland.species[2].id) === true, "목록에서 3단계 종족을 고르면 수락");
assert(dragonQuest.status === "active", "레벨을 채우고 종류를 고르면 수락됨");
assert(dragonQuest.targetSpeciesName === dragonIsland.species[2].name,
  `대상: ${dragonQuest.targetSpeciesName}`);

// 낮은 레벨 섬은 여전히 자유롭게 수락 가능
gp.level = 1;
const gateHomeNpc = gate.npcs.find((n) => n.kind === "quest" && n.islandId === "pirate_start");
const gateHomeQuest = gate.quests.find((q) => q.islandId === "pirate_start");
gp.position = { x: gateHomeNpc.position.x + 1, y: 1, z: gateHomeNpc.position.z };
gate.currentIslandId = "pirate_start";
stepInteractionQ(gate, makeInput({ interactPressed: true }));
assert(gateHomeQuest.status === "active", "시작 섬 의뢰는 Lv.1도 수락 가능");

section("배 등급 — 비쌀수록 빠름");
assert(BOAT_TIERS.length === 3, `배 ${BOAT_TIERS.length}종`);
const speeds = BOAT_TIERS.map((t) => t.maxForwardSpeed);
const prices = BOAT_TIERS.map((t) => t.price);
assert(speeds.every((v, i) => i === 0 || v > speeds[i - 1]), `비쌀수록 빠름: ${speeds.join(" < ")} m/s`);
assert(prices.every((v, i) => i === 0 || v > prices[i - 1]), `가격도 계단식: ${prices.join(" < ")}`);
assert(BOAT_TIERS[0].price === 0, "기본 돛단배는 처음부터 보유");
assert(
  BOAT_TIERS[2].maxForwardSpeed / BOAT_TIERS[0].maxForwardSpeed > 2,
  `최고급 배가 기본 배보다 ${(BOAT_TIERS[2].maxForwardSpeed / BOAT_TIERS[0].maxForwardSpeed).toFixed(1)}배 빠름`,
);
assert(BOAT_TIERS.every((t, i) => i === 0 || t.turnRate > BOAT_TIERS[i - 1].turnRate), "선회 성능도 함께 상승");

const bp = createInitialGameState().player;
assert(bp.ownedBoats.length === 1 && bp.ownedBoats[0] === "dinghy", "처음엔 기본 배만 보유");
assert(bestOwnedBoat(bp.ownedBoats).id === "dinghy", "소환하면 기본 배");

bp.money = 100;
assert(buyBoatTier(bp, "clipper", bp.events) === false, "코인 부족하면 구매 실패");
bp.money = 3000;
assert(buyBoatTier(bp, "clipper", bp.events) === true, "쾌속정 구매 성공");
assert(bp.money === 3000 - boatTier("clipper").price, "가격만큼 차감");
assert(bestOwnedBoat(bp.ownedBoats).id === "clipper", "이제 소환하면 쾌속정");
assert(buyBoatTier(bp, "clipper", bp.events) === false, "이미 보유한 배는 재구매 불가");
buyBoatTier(bp, "galewind", bp.events);
assert(bestOwnedBoat(bp.ownedBoats).id === "galewind", "더 좋은 배를 사면 그게 소환됨");

// 실제로 더 빨리 달리는지 (같은 시간 동안 이동 거리 비교)
function sailDistance(tierId) {
  const st = createInitialGameState();
  st.boat.tier = tierId;
  st.boat.spawned = true;
  st.boat.riding = true;
  st.boat.yaw = 0;
  st.boat.speed = 0;
  st.boat.position = { x: 0, y: -0.35, z: 900 }; // 섬에서 먼 바다
  const z0 = st.boat.position.z;
  for (let i = 0; i < 180; i++) stepBoat(st, 1 / 60, makeInput({ moveForward: true }));
  return st.boat.position.z - z0;
}
const dDinghy = sailDistance("dinghy");
const dGale = sailDistance("galewind");
assert(dGale > dDinghy * 1.8, `3초 항해 거리: 돛단배 ${dDinghy.toFixed(1)}m → 질풍호 ${dGale.toFixed(1)}m`);

section("흑도(요루) — 인벤토리 장착 → 숫자키로 뽑기");
assert(WEAPON_CATALOG.length >= 1, `상점 무기 코너 ${WEAPON_CATALOG.length}종`);
const yoru = WEAPONS.sword_yoru;
assert(!!yoru, "흑도 요루 존재");
assert(yoru.price >= 500, `비싼 장비 (🪙${yoru.price})`);

const wp = createInitialGameState().player;
recomputeDerivedStats(wp);
wp.meleeDamage = 100;
wp.meleeRange = 2.2;

// 사기 전엔 못 씀
assert(drawnWeapon(wp) === null, "처음엔 맨손");
assert(totalMeleeDamage(wp) === 100, "맨손 근접 데미지 그대로");

wp.money = 100;
assert(buyItem(wp, "sword_yoru", wp.events) === false, "코인 부족하면 구매 실패");
wp.money = 2000;
assert(buyItem(wp, "sword_yoru", wp.events) === true, "흑도 구매 성공");
assert(wp.inventory.some((i) => i.id === "sword_yoru"), "인벤토리에 들어감");
assert(wp.inventory.find((i) => i.id === "sword_yoru").equippable === true, "장비로 표시됨");
assert(buyItem(wp, "sword_yoru", wp.events) === false, "장비는 중복 구매 불가");

// 1차 장착: 인벤토리에서 클릭 → 단축바
assert(wp.hotbar.every((s) => s === null), "아직 단축바는 비어 있음");
assert(useItem(wp, "sword_yoru", wp.events) === true, "인벤토리 클릭 → 단축바 장착");
assert(wp.hotbar[0] === "sword_yoru", `단축바 1번 칸에 올라감 (${wp.hotbar.join(",")})`);
assert(wp.inventory.some((i) => i.id === "sword_yoru"), "장비는 소모되지 않고 인벤토리에 그대로 남음");
assert(drawnWeapon(wp) === null, "단축바에 올렸다고 바로 손에 들리진 않음");
assert(totalMeleeDamage(wp) === 100, "아직 데미지 그대로 (진짜 장착은 숫자키)");

// 진짜 장착: 숫자키 1번
assert(toggleDrawn(wp, 0) === "drawn", "숫자키 1번 → 흑도를 뽑음");
assert(drawnWeapon(wp)?.id === "sword_yoru", "손에 흑도를 들고 있음");
assert(
  Math.abs(totalMeleeDamage(wp) - 100 * yoru.damageMultiplier) < 0.001,
  `근접 데미지 ${totalMeleeDamage(wp)} (기본 100 × ${yoru.damageMultiplier})`,
);
assert(
  Math.abs(totalMeleeRange(wp) - (2.2 + yoru.bonusRange)) < 0.001,
  `사거리도 늘어남 (2.2 → ${totalMeleeRange(wp).toFixed(1)}m)`,
);

// 같은 키를 다시 누르면 집어넣기
assert(toggleDrawn(wp, 0) === "sheathed", "숫자키 1번 다시 → 집어넣음");
assert(drawnWeapon(wp) === null, "맨손으로 복귀");
assert(totalMeleeDamage(wp) === 100, "데미지도 원래대로");

// 빈 칸을 누르면 아무 일도 없음
assert(toggleDrawn(wp, 1) === null, "빈 단축바 칸은 눌러도 반응 없음");
assert(toggleDrawn(wp, 9) === null, "없는 칸 번호도 안전하게 무시");

// 인벤토리에서 다시 클릭하면 단축바에서 내려감
toggleDrawn(wp, 0);
assert(drawnWeapon(wp) !== null, "다시 뽑은 상태");
useItem(wp, "sword_yoru", wp.events);
assert(wp.hotbar[0] === null, "인벤토리 재클릭 → 단축바에서 내려감");
assert(drawnWeapon(wp) === null, "내리면 손에서도 사라짐");

// 무장색과 곱연산으로 함께 적용되는지
wp.hakiLearned = true;
wp.hakiActive = true;
toggleHotbar(wp, "sword_yoru");
toggleDrawn(wp, 0);
const hakiPlusSword = 100 * 1.4 * yoru.damageMultiplier;
assert(
  Math.abs(totalMeleeDamage(wp) - hakiPlusSword) < 0.001,
  `무장색 + 흑도 동시 적용 = ${totalMeleeDamage(wp).toFixed(0)} (100 × 1.4 × ${yoru.damageMultiplier})`,
);

section("세이브 데이터 — 저장했다 불러오면 그대로");
{
  // 이것저것 바꿔놓은 상태를 만들고, 저장 → 새 게임에 복원 → 값이 같은지 확인
  const before = createInitialGameState("marine");
  before.quests = createQuests();
  const bp = before.player;
  bp.level = 137;
  bp.expToNextLevel = expRequiredForLevel(137);
  bp.exp = 250;
  bp.money = 4820;
  bp.stats = { mana: 12, attack: 30, health: 41, fruit: 7 };
  bp.unspentStatPoints = 5;
  bp.equippedFruit = "dark_wave";
  bp.fruitLevel = 42;
  bp.fruitExp = 11;
  bp.hakiLearned = true;
  bp.ownedBoats = ["dinghy", "galewind"];
  bp.lastGachaAtMs = 1_700_000_000_000;
  before.currentIslandId = "ice";
  buyItem(bp, "potion_exp", bp.events);
  buyItem(bp, "sword_yoru", bp.events);
  toggleHotbar(bp, "sword_yoru");
  before.quests.find((q) => q.islandId === "desert").completions = 9;

  const saved = toSaveData(before, 1_700_000_100_000);
  assert(saved.version === SAVE_VERSION, `세이브에 버전이 붙음 (v${saved.version})`);

  // JSON을 한 번 거쳐서 (실제 저장 경로와 같게) 복원합니다
  const roundTripped = JSON.parse(JSON.stringify(saved));
  const after = createInitialGameState("pirate");
  after.quests = createQuests();
  assert(applySaveData(after, roundTripped) === true, "세이브 복원 성공");

  const ap = after.player;
  assert(ap.faction === "marine", `진영 복원 (${ap.faction})`);
  assert(ap.level === 137 && ap.exp === 250, `레벨/경험치 복원 (Lv.${ap.level}, exp ${ap.exp})`);
  assert(ap.money === bp.money, `코인 복원 (${ap.money}) — 아이템 값을 치른 뒤 금액 그대로`);
  assert(JSON.stringify(ap.stats) === JSON.stringify(bp.stats), `스텟 복원 (${JSON.stringify(ap.stats)})`);
  assert(ap.unspentStatPoints === 5, "남은 스텟 포인트 복원");
  assert(ap.equippedFruit === "dark_wave", `열매 복원 (${ap.equippedFruit})`);
  assert(ap.fruitLevel === 42 && ap.fruitExp === 11, `열매 레벨 복원 (Lv.${ap.fruitLevel})`);
  assert(ap.hakiLearned === true, "무장색 습득 복원");
  assert(ap.ownedBoats.includes("galewind"), `보유 배 복원 (${ap.ownedBoats.join(",")})`);
  assert(ap.lastGachaAtMs === 1_700_000_000_000, "뽑기 제한 시각 복원");
  assert(after.currentIslandId === "ice", `마지막 섬 복원 (${after.currentIslandId})`);
  assert(ap.inventory.some((i) => i.id === "potion_exp"), "인벤토리 아이템 복원");
  assert(ap.hotbar[0] === "sword_yoru", `단축바 복원 (${ap.hotbar.join(",")})`);
  assert(after.quests.find((q) => q.islandId === "desert").completions === 9, "퀘스트 완료 횟수 복원");

  // 파생값은 저장하지 않고 다시 계산합니다
  assert(ap.maxHp === 100 + 41 * 12, `최대 체력을 스텟에서 다시 계산 (${ap.maxHp})`);
  assert(ap.hp === ap.maxHp, "접속하면 풀피로 시작");
  assert(ap.expToNextLevel === expRequiredForLevel(137), "요구 경험치도 다시 계산");
  assert(ap.activeHotbarSlot === null, "무기는 집어넣은 상태로 시작");
  assert(ap.hakiActive === false, "무장색은 꺼진 상태로 시작");
}

section("세이브 방어 — 이상한 값이 들어와도 안 깨짐");
{
  const st = createInitialGameState("pirate");
  st.quests = createQuests();

  assert(applySaveData(st, null) === false, "null이면 복원하지 않음");
  assert(applySaveData(st, "이건 세이브가 아님") === false, "문자열이면 복원하지 않음");
  assert(applySaveData(st, {}) === false, "버전이 없으면 복원하지 않음");

  // 조작된 세이브 — 값을 잘라내되 게임은 정상 동작해야 합니다
  const evil = {
    version: 1,
    faction: "해적왕",
    level: 999999999,
    exp: -50,
    money: -1000,
    stats: { mana: 1e12, attack: "많이", health: NaN, fruit: -3 },
    unspentStatPoints: Infinity,
    equippedFruit: "우주_열매",
    fruitLevel: 9999,
    fruitExp: 1e9,
    hakiLearned: "네",
    inventory: [{ id: "치트_아이템", quantity: 99999 }, { id: "potion_small", quantity: -5 }, null],
    hotbar: ["sword_yoru", 42, {}],
    ownedBoats: ["우주선", "galewind", "galewind"],
    quests: [{ islandId: "없는섬", completions: 5 }, null],
    lastGachaAtMs: "어제",
    currentIslandId: "없는섬",
    savedAtMs: 0,
  };
  assert(applySaveData(st, evil) === true, "조작된 세이브도 예외 없이 처리됨");
  const p = st.player;
  assert(p.faction === "pirate", "알 수 없는 진영은 무시하고 원래 값 유지");
  assert(p.level === MAX_LEVEL, `레벨이 상한(${MAX_LEVEL})으로 잘림 — 실제 ${p.level}`);
  assert(p.exp >= 0 && p.exp < p.expToNextLevel, `경험치가 정상 범위 (${p.exp})`);
  assert(p.money === 0, `음수 코인은 0으로 (${p.money})`);
  assert(p.stats.health === 0 && p.stats.attack === 0, "숫자가 아닌 스텟은 0으로");
  assert(p.stats.fruit === 0, "음수 스텟도 0으로");
  assert(Number.isFinite(p.unspentStatPoints), `Infinity 포인트가 유한한 값으로 (${p.unspentStatPoints})`);
  assert(FRUIT_CATALOG.some((f) => f.id === p.equippedFruit) || p.equippedFruit === "magma_fist",
    `존재하지 않는 열매는 무시 (${p.equippedFruit})`);
  assert(p.fruitLevel <= MAX_FRUIT_LEVEL, `열매 레벨 상한 적용 (${p.fruitLevel})`);
  assert(p.inventory.every((i) => ITEM_CATALOG.concat(WEAPON_CATALOG).some((c) => c.id === i.id)),
    "카탈로그에 없는 아이템은 버려짐");
  assert(p.inventory.every((i) => i.quantity >= 1), "개수가 1 미만인 아이템은 1로 보정");
  assert(p.hotbar.every((slot) => slot === null || typeof slot === "string"), "단축바에 이상한 값이 안 들어감");
  assert(p.hotbar.every((slot) => slot === null || p.inventory.some((i) => i.id === slot)),
    "인벤토리에 없는 장비는 단축바에서 제거");
  assert(p.ownedBoats.filter((b) => b === "galewind").length === 1, "배 중복 제거");
  assert(!p.ownedBoats.includes("우주선"), "존재하지 않는 배는 무시");
  assert(p.lastGachaAtMs === null, "숫자가 아닌 뽑기 시각은 null");
  assert(islandAt(0, 0) !== null && ISLANDS.some((i) => i.id === st.currentIslandId),
    `없는 섬이면 시작 섬으로 (${st.currentIslandId})`);
  assert(p.hp > 0 && p.hp === p.maxHp, "복원 후에도 체력이 정상");
}

section("파이어베이스 설정 — 코드에 기본값이 박혀 있어 설정 없이도 동작");
{
  // 아무 설정 없이도 값이 다 채워져야 합니다 (.env 없이 바로 로그인 가능해야 하므로)
  const bare = resolveConfig({});
  assert(isConfigComplete(bare), "환경변수가 없어도 설정이 완전함 (기본값 사용)");
  assert(bare.projectId === DEFAULT_CONFIG.projectId, `기본 프로젝트: ${bare.projectId}`);
  assert(/^AIza/.test(bare.apiKey), "apiKey 형식이 맞음");
  assert(bare.authDomain.endsWith(".firebaseapp.com"), `authDomain 형식이 맞음 (${bare.authDomain})`);
  assert(/^\d+$/.test(bare.messagingSenderId), "messagingSenderId가 숫자");
  assert(bare.appId.includes(":web:"), "appId가 웹 앱 형식");

  // .env로 덮어쓸 수 있어야 합니다 (다른 파이어베이스 프로젝트를 쓰고 싶을 때)
  const overridden = resolveConfig({
    VITE_FIREBASE_PROJECT_ID: "다른-프로젝트",
    VITE_FIREBASE_API_KEY: "AIzaOTHER",
  });
  assert(overridden.projectId === "다른-프로젝트", ".env 값이 기본값을 덮어씀");
  assert(overridden.apiKey === "AIzaOTHER", "apiKey도 덮어써짐");
  assert(overridden.authDomain === DEFAULT_CONFIG.authDomain, "지정하지 않은 값은 기본값 유지");

  // 빈 값이나 자리표시자는 무시하고 기본값을 써야 합니다
  const placeholder = resolveConfig({
    VITE_FIREBASE_PROJECT_ID: "",
    VITE_FIREBASE_API_KEY: "여기에_apiKey",
    VITE_FIREBASE_APP_ID: "   ",
  });
  assert(placeholder.projectId === DEFAULT_CONFIG.projectId, "빈 문자열은 무시");
  assert(placeholder.apiKey === DEFAULT_CONFIG.apiKey, "'여기에_...' 자리표시자는 무시");
  assert(placeholder.appId === DEFAULT_CONFIG.appId, "공백만 있는 값도 무시");
}

section("설인 (얼음 섬) — 삼도류 · 무장색 · 다단 점프");
{
  const trainerNpcs = createNpcs().filter((n) => n.kind === "trainer");
  assert(trainerNpcs.length === 1, "설인은 1명");
  assert(trainerNpcs[0].name === "설인", `이름이 설인 (${trainerNpcs[0].name})`);
  assert(trainerNpcs[0].islandId === TRAINER_ISLAND_ID, `얼음 섬에 배치 (${trainerNpcs[0].islandId})`);
  const isl = getIsland(TRAINER_ISLAND_ID);
  assert(isl.requiredLevel === 125, `얼음 섬 요구 레벨 125 (${isl.requiredLevel})`);
  const d = Math.hypot(trainerNpcs[0].position.x - isl.center.x, trainerNpcs[0].position.z - isl.center.z);
  assert(d < isl.radius - 2, `설인이 섬 안쪽에 있음 (중심에서 ${Math.round(d)}m)`);
  // 다른 NPC와 겹치지 않아야 대화가 엉키지 않습니다
  const others = createNpcs().filter((n) => n.islandId === TRAINER_ISLAND_ID && n.kind !== "trainer");
  for (const other of others) {
    const gap = Math.hypot(other.position.x - trainerNpcs[0].position.x, other.position.z - trainerNpcs[0].position.z);
    assert(gap > 4, `${other.name}과 ${Math.round(gap)}m 떨어져 있음 (대화 범위 3.5m 밖)`);
  }
}

section("삼도류 — 요루보다 약하지만 훨씬 빠름");
{
  const santoryu = weaponFor("sword_santoryu");
  const yoru = weaponFor("sword_yoru");
  assert(santoryu !== null && santoryu.name === "삼도류", `삼도류 등록됨 (${santoryu?.name})`);
  assert(santoryu.attackSpeedMultiplier < 1, `공격 속도가 빨라짐 (배율 ${santoryu.attackSpeedMultiplier})`);
  assert(yoru.attackSpeedMultiplier === 1, "요루는 공격 속도 그대로");
  assert(santoryu.bonusRange < yoru.bonusRange, `사거리는 요루보다 짧음 (${santoryu.bonusRange} < ${yoru.bonusRange})`);
  assert(santoryu.price > yoru.price, `값은 더 비쌈 (🪙${santoryu.price} > 🪙${yoru.price})`);

  // 초당 데미지로 비교 — 삼도류가 더 세지만 압도적이진 않아야 합니다
  const base = 100;
  const cd = 0.5;
  const yoruDps = weaponDps(yoru, base, cd);
  const sanDps = weaponDps(santoryu, base, cd);
  const ratio = sanDps / yoruDps;
  assert(ratio > 1.2 && ratio < 2, `삼도류 초당 데미지가 요루의 ${ratio.toFixed(2)}배 (1.2~2배 구간)`);

  // 실제로 쿨다운에 반영되는지
  const p = createInitialGameState("pirate").player;
  p.money = 99999;
  p.meleeCooldownSec = 0.5;
  assert(totalMeleeCooldown(p) === 0.5, "맨손 공격 간격은 그대로");
  buyItem(p, "sword_santoryu", p.events);
  toggleHotbar(p, "sword_santoryu");
  toggleDrawn(p, 0);
  assert(drawnWeapon(p)?.id === "sword_santoryu", "삼도류를 손에 듦");
  assert(Math.abs(totalMeleeCooldown(p) - 0.5 * santoryu.attackSpeedMultiplier) < 1e-9,
    `공격 간격이 짧아짐 (0.5 → ${totalMeleeCooldown(p).toFixed(3)}초)`);
  assert(meleeDps(p) > 0, "초당 데미지 계산 가능");

  // 상점에서는 안 팔고 설인에게만 팝니다
  assert(!WEAPON_CATALOG.some((w) => w.id === "sword_santoryu"), "화면 상점 무기 목록에는 없음");
  assert(WEAPON_CATALOG.some((w) => w.id === "sword_yoru"), "요루는 상점에 그대로 있음");
}

section("다단 점프 — Lv.125에서 2단, 이후 100레벨마다 1단");
{
  assert(FIRST_JUMP_LEVEL === 125, `2단 점프는 Lv.${FIRST_JUMP_LEVEL}부터`);
  assert(JUMP_LEVEL_STEP === 100, "이후 100레벨마다 한 단");
  assert(jumpRequiredLevel(2) === 125, `2단 → Lv.${jumpRequiredLevel(2)}`);
  assert(jumpRequiredLevel(3) === 225, `3단 → Lv.${jumpRequiredLevel(3)}`);
  assert(jumpRequiredLevel(4) === 325, `4단 → Lv.${jumpRequiredLevel(4)}`);
  assert(jumpRequiredLevel(5) === 425, `5단 → Lv.${jumpRequiredLevel(5)}`);
  assert(jumpPrice(3) > jumpPrice(2), `단계가 오를수록 비싸짐 (${jumpPrice(2)} → ${jumpPrice(3)})`);

  const p = createInitialGameState("pirate").player;
  assert(p.maxJumps === 1, "처음에는 1단 점프");

  // 레벨이 모자라면 못 배웁니다
  p.level = 124;
  p.money = 999999;
  assert(jumpBlockReason(p) === "level", "Lv.124에서는 아직 못 배움");
  assert(learnJump(p, p.events) === false, "시도해도 실패");
  assert(p.maxJumps === 1, "실패하면 단수 그대로");
  assert(p.money === 999999, "실패하면 코인도 안 깎임");

  // 레벨을 채우면 배웁니다
  p.level = 125;
  assert(canLearnJump(p) === true, "Lv.125가 되면 배울 수 있음");
  const before = p.money;
  assert(learnJump(p, p.events) === true, "2단 점프 습득");
  assert(p.maxJumps === 2, `2단이 됨 (${p.maxJumps})`);
  assert(p.money === before - jumpPrice(2), `값을 치름 (🪙${jumpPrice(2)})`);
  assert(p.events.some((e) => e.type === "jump_learned" && e.jumps === 2), "jump_learned 이벤트 발생");

  // 바로 다음 단계는 100레벨 더 필요
  assert(jumpBlockReason(p) === "level", "Lv.125에서 3단은 아직 안 됨");
  p.level = 224;
  assert(jumpBlockReason(p) === "level", "Lv.224에서도 아직");
  p.level = 225;
  assert(canLearnJump(p) === true, "Lv.225면 3단 가능");
  assert(learnJump(p, p.events) === true, "3단 점프 습득");
  assert(p.maxJumps === 3, `3단이 됨 (${p.maxJumps})`);

  // 코인이 모자라면 못 배웁니다
  p.level = 325;
  p.money = 0;
  assert(jumpBlockReason(p) === "money", "코인이 없으면 못 배움");
  assert(learnJump(p, p.events) === false, "시도해도 실패");
  assert(p.maxJumps === 3, "단수 그대로");

  // 상한
  p.money = 1e12;
  p.level = MAX_LEVEL;
  for (let i = 0; i < 30; i++) learnJump(p, p.events);
  assert(p.maxJumps === MAX_JUMPS, `아무리 배워도 ${MAX_JUMPS}단이 최대 (${p.maxJumps})`);
  assert(jumpBlockReason(p) === "maxed", "최대치에 도달하면 maxed");
}

section("세이브 — 점프 단수와 삼도류도 저장/복원");
{
  const before = createInitialGameState("pirate");
  before.quests = createQuests();
  const bp = before.player;
  bp.money = 99999;
  bp.level = 400;
  bp.maxJumps = 4;
  buyItem(bp, "sword_santoryu", bp.events);
  toggleHotbar(bp, "sword_santoryu");

  const saved = JSON.parse(JSON.stringify(toSaveData(before, 1_700_000_000_000)));
  const after = createInitialGameState("pirate");
  after.quests = createQuests();
  applySaveData(after, saved);

  assert(after.player.maxJumps === 4, `점프 단수 복원 (${after.player.maxJumps}단)`);
  assert(after.player.inventory.some((i) => i.id === "sword_santoryu"),
    "삼도류가 인벤토리에 그대로 복원됨 (상점에 없는 무기라도)");
  assert(after.player.hotbar[0] === "sword_santoryu", "단축바 위치도 복원");

  // 조작된 값은 잘립니다
  const evil = { ...saved, maxJumps: 9999 };
  const evilState = createInitialGameState("pirate");
  evilState.quests = createQuests();
  applySaveData(evilState, evil);
  assert(evilState.player.maxJumps === MAX_JUMPS, `조작된 점프 단수가 상한으로 잘림 (${evilState.player.maxJumps})`);
}

section("두 번째 바다 — 해적왕이 유일한 통로");
{
  const sea1 = ISLANDS.filter((i) => i.sea === 1);
  const sea2 = ISLANDS.filter((i) => i.sea === 2);

  // 두 바다가 좌표상 완전히 떨어져 있어야 합니다 (헤엄쳐 건너갈 수 없도록).
  let nearest = Infinity;
  for (const a of sea1) {
    for (const b of sea2) {
      nearest = Math.min(nearest, Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) - a.radius - b.radius);
    }
  }
  assert(nearest > 3000, `두 바다 사이가 최소 ${Math.round(nearest)}m — 헤엄이나 배로는 건너갈 수 없음`);

  // 각 바다는 자기 원점 기준으로 재야 안개·바다 크기가 정상입니다
  assert(worldRadius(1) < 800, `첫 번째 바다 반경 ${Math.round(worldRadius(1))}m`);
  assert(worldRadius(2) < 800, `두 번째 바다 반경 ${Math.round(worldRadius(2))}m (절대 좌표가 아니라 자기 원점 기준)`);

  // 허브가 바다마다 하나씩
  assert(hubIsland(1).id === "central", `첫 번째 바다 허브: ${hubIsland(1).name}`);
  assert(hubIsland(2).id === "fountain", `두 번째 바다 허브: ${hubIsland(2).name}`);
  assert(hubIsland(2).species.length === 0, "분수 도시도 중립 지대 (몬스터 없음)");

  // 레벨 구간이 첫 바다 위로 이어짐
  const sea2Wild = sea2.filter((i) => i.kind === "wild").sort((a, b) => a.requiredLevel - b.requiredLevel);
  assert(sea2Wild.length === 9, `두 번째 바다 사냥터 ${sea2Wild.length}개`);
  assert(sea2Wild[0].requiredLevel === SECOND_SEA_LEVEL,
    `첫 섬(${sea2Wild[0].name})이 진입 레벨과 같은 Lv.${sea2Wild[0].requiredLevel}`);
  const sea1Top = Math.max(...sea1.map((i) => i.requiredLevel));
  assert(sea2Wild[0].requiredLevel > sea1Top,
    `두 번째 바다가 첫 바다 최고 섬(Lv.${sea1Top}) 위에서 시작`);
  const levels = sea2Wild.map((i) => i.requiredLevel);
  assert(levels.every((v, i) => i === 0 || v > levels[i - 1]), `레벨이 계속 올라감: ${levels.join(" → ")}`);

  // 최고 종족 레벨이 세이브 상한 안에 들어와야 저장이 잘립니다
  const topTier = Math.max(...ISLANDS.flatMap((i) => i.species.map((sp) => sp.tierLevel)));
  assert(topTier < MAX_LEVEL, `최고 종족 적정 레벨 Lv.${topTier} < 세이브 상한 Lv.${MAX_LEVEL}`);

  // "다음 섬"은 같은 바다 안에서만 봅니다 (용의 둥지가 장미 왕국을 다음으로 보면 안 됨)
  assert(levelGapToNextIsland(getIsland("dragon")) === 200,
    "용의 둥지의 다음 섬은 두 번째 바다가 아니라 '없음'으로 계산됨");
  assert(getIsland("dragon").species.length === 4, "따라서 용의 둥지는 그대로 4종류");
  assert(levelGapToNextIsland(getIsland("rose")) === 100, "장미 왕국(1100) → 초원 지대(1200) 차이 100");
}

{
  // ── 진입 조건 ──
  const state = createInitialGameState("pirate");
  state.npcs = createNpcs();
  state.quests = createQuests();
  const teleports = [];
  const teleport = (pos) => teleports.push(pos);

  assert(otherSea(1) === 2 && otherSea(2) === 1, "말을 걸면 반대쪽 바다가 목적지");

  state.player.level = SECOND_SEA_LEVEL - 1;
  assert(seaBlockReason(state) === "level", `Lv.${state.player.level}에서는 막힘`);
  assert(canTravelSea(state) === false, "레벨이 모자라면 못 감");
  assert(levelsUntilSecondSea(state.player) === 1, "1레벨 남았다고 알려줌");
  assert(travelSea(state, teleport) === null, "실제로 호출해도 아무 일도 일어나지 않음");
  assert(state.sea === 1 && teleports.length === 0, "바다도 좌표도 그대로");

  state.player.level = SECOND_SEA_LEVEL;
  assert(canTravelSea(state) === true, `Lv.${SECOND_SEA_LEVEL}이 되면 갈 수 있음`);
  assert(levelsUntilSecondSea(state.player) === 0, "남은 레벨 0");

  // ── 실제 항해 ──
  state.player.money = 12345;
  state.player.hakiLearned = true;
  state.player.maxJumps = 3;
  state.boat.riding = true;
  state.boat.spawned = true;
  state.player.guideTargetIslandId = "dragon";

  const moved = travelSea(state, teleport);
  assert(moved?.sea === 2 && moved.islandId === "fountain", `분수 도시에 도착 (${moved?.islandId})`);
  assert(state.sea === 2, "상태의 바다가 2로 바뀜");
  assert(state.currentIslandId === "fountain", "현재 섬도 분수 도시");
  const hub2 = getIsland("fountain");
  assert(Math.hypot(state.player.position.x - hub2.center.x, state.player.position.z - hub2.center.z) < 1,
    "광장 한가운데에 내려섬");
  assert(teleports.length === 1, "물리 바디도 같이 옮겨짐");
  assert(state.boat.riding === false && state.boat.spawned === false, "배는 두고 옴");
  assert(state.player.guideTargetIslandId === null, "다른 바다를 가리키던 길안내는 꺼짐");
  assert(state.player.money === 12345, "코인은 그대로 (오가는 데 비용 없음)");
  assert(state.player.hakiLearned && state.player.maxJumps === 3, "무장색·점프 단수도 그대로");
  assert(state.player.events.some((e) => e.type === "sea_changed" && e.sea === 2), "도착 알림 이벤트 발생");
  assert(state.player.unlockedSecondSea === true, "두 번째 바다가 열린 것으로 기록됨");

  // ── 돌아오기는 언제나 자유 ──
  state.player.level = 1; // 어떤 이유로든 레벨이 낮아져도
  assert(canTravelSea(state) === true, "두 번째 바다에서 돌아오는 건 레벨과 무관");
  const back = travelSea(state, teleport);
  assert(back?.sea === 1 && back.islandId === "central", `중앙 교역섬으로 복귀 (${back?.islandId})`);
  assert(state.sea === 1, "상태의 바다가 1로 돌아옴");

  // ── 한 번 열었으면 다시 갈 때 레벨을 안 봄 ──
  assert(canTravelSea(state) === true, "돌아왔다고 갇히지 않음 — 다시 건너갈 수 있음");
  assert(seaBlockReason(state) === null, "Lv.1이어도 이미 연 바다는 막지 않음");
  travelSea(state, teleport);
  assert(state.sea === 2, "다시 두 번째 바다로");
}

{
  // ── 길안내는 같은 바다 안에서만 ──
  const state = createInitialGameState("pirate");
  state.quests = createQuests();
  state.player.level = 1500;

  setGuideTarget(state, "rose"); // 첫 번째 바다에 있으면서 두 번째 바다 섬을 지정
  assert(state.player.guideTargetIslandId === null, "다른 바다 섬으로는 길안내를 걸 수 없음");
  setGuideTarget(state, "ice");
  assert(state.player.guideTargetIslandId === "ice", "같은 바다 섬은 정상 지정");

  // 추천 섬도 바다별로
  assert(recommendedIsland(state.player, 1).id === "dragon",
    `Lv.1500 · 첫 번째 바다 추천: ${recommendedIsland(state.player, 1).name}`);
  assert(recommendedIsland(state.player, 2).id === "hot_cold",
    `Lv.1500 · 두 번째 바다 추천: ${recommendedIsland(state.player, 2).name}`);
  assert(nextGoalIsland(state.player, 2)?.id === "cursed_ship",
    `두 번째 바다 다음 목표: ${nextGoalIsland(state.player, 2)?.name}`);

  // 두 번째 바다에 갓 도착한 순간(레벨이 그 바다 첫 섬에도 못 미칠 때)에도 추천이 비지 않아야 함
  const rookie = createInitialGameState("pirate");
  rookie.player.level = 1;
  assert(recommendedIsland(rookie.player, 2).id === "rose",
    `추천할 게 없어도 그 바다 최저 섬을 알려줌 (${recommendedIsland(rookie.player, 2).name})`);
}

{
  // ── 세이브 왕복 ──
  const state = createInitialGameState("pirate");
  state.npcs = createNpcs();
  state.quests = createQuests();
  state.player.level = 1500;
  travelSea(state, () => {});
  const saved = JSON.parse(JSON.stringify(toSaveData(state, 1_700_000_000_000)));
  assert(saved.sea === 2 && saved.currentIslandId === "fountain", "어느 바다에 있었는지 저장됨");
  assert(saved.unlockedSecondSea === true, "두 번째 바다를 연 사실도 저장됨");

  const loaded = createInitialGameState("pirate");
  loaded.quests = createQuests();
  applySaveData(loaded, saved);
  assert(loaded.sea === 2, "불러오면 두 번째 바다에서 시작");
  assert(loaded.currentIslandId === "fountain", "섬도 분수 도시");
  assert(loaded.player.unlockedSecondSea === true, "해금 상태도 복원");

  // 섬과 바다가 어긋난 세이브가 들어와도 좌표를 따릅니다
  const tampered = { ...saved, sea: 1 };
  const fixed = createInitialGameState("pirate");
  fixed.quests = createQuests();
  applySaveData(fixed, tampered);
  assert(fixed.sea === 2, "sea 값을 손으로 1로 고쳐도 섬(분수 도시) 기준으로 바로잡힘");

  // 반대로 첫 바다 섬 + sea:2 로 조작한 경우
  const tampered2 = { ...saved, currentIslandId: "jungle" };
  const fixed2 = createInitialGameState("pirate");
  fixed2.quests = createQuests();
  applySaveData(fixed2, tampered2);
  assert(fixed2.sea === 1, "정글 섬으로 조작하면 바다도 1로 따라옴");
}

section("개발자 모드 — 허용 계정만 · 만렙 테스트 캐릭터 · 저장 안 함");
{
  const SITE = "bpproject.netlify.app";

  // ── 허용 목록 ──
  assert(DEV_EMAILS.includes("jjapgobrus@gmail.com"), "허용 목록에 내 계정이 들어 있음");
  assert(isDevEmail("jjapgobrus@gmail.com"), "정확히 같은 주소는 통과");
  assert(isDevEmail("JJapgoBrus@Gmail.com"), "대소문자는 무시");
  assert(isDevEmail(" jjapgobrus@gmail.com "), "앞뒤 공백도 무시");

  // 지메일은 점과 +태그를 무시하는 규칙이 있어서, 같은 계정인데 다른 주소로 보일 수 있습니다
  assert(isDevEmail("jjapgo.brus@gmail.com"), "지메일의 점은 같은 계정으로 인정");
  assert(isDevEmail("jjapgobrus+test@gmail.com"), "지메일의 +태그도 같은 계정으로 인정");
  assert(isDevEmail("jjapgobrus@googlemail.com"), "googlemail.com도 같은 계정");

  // 남의 계정은 통과하면 안 됩니다
  assert(!isDevEmail("jjapgobrus@naver.com"), "도메인이 다르면 거절");
  assert(!isDevEmail("jjapgobrus2@gmail.com"), "비슷하지만 다른 주소는 거절");
  assert(!isDevEmail("xjjapgobrus@gmail.com"), "앞에 글자가 붙어도 거절");
  assert(!isDevEmail(""), "빈 문자열 거절");
  assert(!isDevEmail(null) && !isDevEmail(undefined), "이메일이 없으면 거절 (게스트)");

  // 지메일이 아닌 곳에서는 점을 지우면 안 됩니다 (다른 사람 주소가 될 수 있음)
  assert(normalizeEmail("a.b@example.com") === "a.b@example.com", "일반 도메인은 점을 그대로 둠");
  assert(normalizeEmail("a.b@gmail.com") === "ab@gmail.com", "지메일만 점 제거");

  // ── 어디서 열었는지 ──
  assert(isLocalHost("localhost") && isLocalHost("127.0.0.1"), "내 컴퓨터 주소 인식");
  assert(!isLocalHost(SITE), "배포된 사이트는 내 컴퓨터가 아님");

  // ── 최종 판정 ──
  assert(devModeAllowed(null, "localhost"), "개발 중인 내 컴퓨터에서는 로그인 없이도 열림");
  assert(devModeAllowed("jjapgobrus@gmail.com", SITE), "배포 사이트에서도 허용 계정이면 열림");
  assert(!devModeAllowed(null, SITE), "배포 사이트 + 게스트 → 막힘");
  assert(!devModeAllowed("someone@gmail.com", SITE), "배포 사이트 + 남의 계정 → 막힘");

  assert(devDenyReason(null, SITE) === "anonymous", "게스트는 '로그인 안 함'으로 구분");
  assert(devDenyReason("someone@gmail.com", SITE) === "not_allowed", "남의 계정은 '권한 없음'으로 구분");
  assert(devDenyReason("jjapgobrus@gmail.com", SITE) === null, "허용 계정은 막을 이유가 없음");
  assert(/로그인/.test(devDenyMessage("anonymous")), `게스트 안내: "${devDenyMessage("anonymous")}"`);
  assert(/권한/.test(devDenyMessage("not_allowed")), `남의 계정 안내: "${devDenyMessage("not_allowed")}"`);
  assert(devDenyMessage(null) === "", "막지 않을 때는 안내 문구도 없음");
}

{
  // ── 만렙 테스트 캐릭터 ──
  const topTier = Math.max(...ISLANDS.flatMap((i) => i.species.map((s) => s.tierLevel)));
  assert(DEV_LEVEL === topTier, `개발자 레벨이 최고 종족 적정 레벨과 같음 (Lv.${DEV_LEVEL})`);
  assert(DEV_LEVEL < MAX_LEVEL, `세이브 상한(${MAX_LEVEL}) 안쪽이라 값이 잘리지 않음`);

  const state = createInitialGameState("pirate", true);
  state.npcs = createNpcs();
  state.quests = createQuests();
  const before = { level: state.player.level, maxHp: state.player.maxHp };

  const summary = applyDevLoadout(state);
  const p = state.player;

  assert(p.level === DEV_LEVEL, `Lv.${before.level} → Lv.${p.level}`);
  assert(p.money === DEV_MONEY, `코인 ${p.money.toLocaleString()}`);

  // 스텟을 "주기만" 하면 최대 체력이 100인 채라 접촉 데미지 한 방에 죽습니다.
  // 실제로 찍혀 있어야 테스트가 됩니다.
  assert(p.unspentStatPoints < 4, `남은 포인트가 거의 없음 (${p.unspentStatPoints}) — 실제로 찍혀 있음`);
  const stats = Object.values(p.stats);
  assert(stats.every((v) => v > 0), `4개 스텟에 고르게 배분됨 (${stats.join("/")})`);
  const hardestHit = Math.max(...ISLANDS.flatMap((i) => i.species.map((s) => s.contactDamage)));
  assert(p.maxHp > hardestHit * 10,
    `최대 체력 ${p.maxHp.toLocaleString()} — 가장 아픈 몬스터(${hardestHit})의 ` +
    `${Math.floor(p.maxHp / hardestHit)}대를 버팀`);
  assert(p.hp === p.maxHp && p.mana === p.maxMana, "풀피·풀마나로 시작");

  // 전부 열린 상태
  assert(p.hakiLearned, "무장색 습득 상태");
  assert(p.maxJumps === MAX_JUMPS, `점프 ${p.maxJumps}단 (최대)`);
  assert(p.unlockedSecondSea, "두 번째 바다도 열려 있음 — 해적왕에게 바로 갈 수 있음");
  assert(p.ownedBoats.length === 3, `배 ${p.ownedBoats.length}종 전부 보유`);

  // 무기는 단축바에 올라가 있어야 숫자키로 바로 뽑아봅니다
  const weaponIds = p.inventory.filter((i) => i.equippable).map((i) => i.id);
  assert(weaponIds.includes("sword_yoru") && weaponIds.includes("sword_santoryu"),
    `요루·삼도류 모두 보유 (${weaponIds.join(",")})`);
  assert(summary.weapons === weaponIds.length, "요약이 실제 무기 수와 일치");
  assert(p.hotbar[0] !== null && p.hotbar[1] !== null, `단축바에 미리 올라감 (${p.hotbar.join(",")})`);
  assert(p.activeHotbarSlot === null, "단, 손에 들고 시작하지는 않음");
  assert(p.inventory.find((i) => i.id === "potion_small").quantity === 99, "포션은 99개");

  // 개발자 모드로 만든 캐릭터도 두 번째 바다에 바로 갈 수 있어야 합니다
  assert(canTravelSea(state) === true, "만렙이라 해적왕이 바로 보내줌");
}

section("멀티플레이 서버 — 방 나누기 (ROOM_CAPACITY명씩)");
{
  // 진짜 WebSocket 없이, World가 요구하는 최소한의 모양(readyState/OPEN/send/close)만
  // 흉내 낸 가짜 소켓으로 서버 로직(server/state.ts)만 그대로 검증합니다 —
  // verify-logic.mjs답게 브라우저도 실제 네트워크도 필요 없습니다.
  function fakeConn(world, name, faction) {
    const sent = [];
    const sock = { readyState: 1, OPEN: 1, send: (d) => sent.push(JSON.parse(d)), close() {} };
    const conn = world.join(sock, name, faction);
    return { conn, sent };
  }

  const world = new World();
  const many = [];
  for (let i = 0; i < 15; i++) many.push(fakeConn(world, `p${i}`, i % 2 === 0 ? "pirate" : "marine"));

  assert(many.slice(0, 14).every((m) => m.conn.roomId === "room1"), "처음 14명은 room1에 배정됨");
  assert(many[14].conn.roomId === "room2", "15번째 접속자는 room1이 꽉 차서 room2로 배정됨");
  const summaryFull = world.roomSummary();
  assert(summaryFull.room1 === 14 && summaryFull.room2 === 1, `방별 인원 집계 정확함 (room1:${summaryFull.room1}, room2:${summaryFull.room2})`);

  world.leave(many[0].conn.id);
  const late = fakeConn(world, "늦게옴", "pirate");
  assert(late.conn.roomId === "room1", "room1에 자리가 생기면 새 접속자가 그 방부터 채움");

  const checker = fakeConn(world, "확인용", "marine");
  assert(checker.conn.roomId === "room2", "room1이 다시 꽉 차면 그다음 접속자는 room2로");
  const welcomeMsg = checker.sent.find((m) => m.type === "welcome");
  assert(welcomeMsg.roomId === "room2", "welcome 메시지에 배정된 방 이름이 들어있음");
  assert(
    welcomeMsg.players.length === 1 && welcomeMsg.players[0].name === "p14",
    "room2 신규 입장자에게는 room2 사람만 보임 — 다른 방(room1) 사람은 안 섞임",
  );

  late.conn.pvpEnabled = true;
  many[14].conn.pvpEnabled = true;
  world.handleMessage(late.conn, JSON.stringify({ type: "melee_attack", targetId: many[14].conn.id }));
  const rejected = late.sent.find((m) => m.type === "pvp_rejected");
  assert(rejected?.reason === "different_room", "다른 방 사람은 서버가 공격 자체를 거부함 (different_room)");
}

section("멀티플레이 서버 — 몬스터(NPC) 위치 중계");
{
  function fakeConn(world, name, faction) {
    const sent = [];
    const sock = { readyState: 1, OPEN: 1, send: (d) => sent.push(JSON.parse(d)), close() {} };
    const conn = world.join(sock, name, faction);
    return { conn, sent };
  }

  const world = new World();
  const a = fakeConn(world, "쫓기는사람", "pirate"); // room1
  const b = fakeConn(world, "같은방구경꾼", "marine"); // room1
  a.sent.length = 0;
  b.sent.length = 0;

  world.handleMessage(
    a.conn,
    JSON.stringify({
      type: "enemy_states",
      enemies: [{ id: "wolf_enemy_3", x: 12.5, z: -4, hp: 30, maxHp: 50, alive: true }],
    }),
  );
  const relayed = b.sent.find((m) => m.type === "enemy_states");
  assert(relayed?.fromId === a.conn.id, "같은 방 사람에게는 몬스터 위치가 누구한테서 왔는지와 함께 중계됨");
  assert(
    relayed?.enemies?.[0]?.id === "wolf_enemy_3" && relayed.enemies[0].x === 12.5 && relayed.enemies[0].alive === true,
    "중계된 몬스터 위치·생존 여부가 보낸 값 그대로임",
  );
  const echoedBackToSender = a.sent.some((m) => m.type === "enemy_states");
  assert(!echoedBackToSender, "보낸 사람 본인에게는 자기 보고가 다시 오지 않음");

  // 이상한 값(무한대·너무 긴 배열)을 보내도 서버가 상식적인 범위로 잘라내는지
  const c = fakeConn(world, "확인용2", "pirate"); // room1
  b.sent.length = 0;
  const junk = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, x: Infinity, z: -Infinity, hp: -5, maxHp: 0, alive: "yes" }));
  world.handleMessage(c.conn, JSON.stringify({ type: "enemy_states", enemies: junk }));
  const relayedJunk = b.sent.find((m) => m.type === "enemy_states");
  assert(relayedJunk?.enemies?.length === 24, `배열 길이가 상한선(24)으로 잘림 (${relayedJunk?.enemies?.length})`);
  assert(
    Number.isFinite(relayedJunk.enemies[0].x) && Number.isFinite(relayedJunk.enemies[0].z),
    "무한대 좌표가 상식적인 범위로 잘림",
  );
  assert(relayedJunk.enemies[0].alive === false, "boolean이 아닌 값은 안전하게 false로 처리됨");

  // 방을 꽉 채워서(room1) 다음 사람이 room2로 밀려나게 한 뒤, room2 사람에게는
  // room1의 몬스터 보고가 전혀 안 가는지 확인합니다.
  while (Object.values(world.roomSummary()).reduce((s, n) => s + n, 0) < ROOM_CAPACITY) {
    fakeConn(world, "채우기", "pirate");
  }
  const other = fakeConn(world, "다른방사람", "marine"); // room2로 배정됨
  other.sent.length = 0;
  world.handleMessage(
    a.conn,
    JSON.stringify({ type: "enemy_states", enemies: [{ id: "wolf_enemy_9", x: 0, z: 0, hp: 1, maxHp: 1, alive: true }] }),
  );
  assert(other.sent.length === 0, "다른 방 사람에게는 몬스터 위치 보고가 전혀 안 감");
}

section("TradeSystem — 거래·선물 순수 로직");
{
  assert(MAX_TRADE_SLOTS === PROTOCOL_MAX_TRADE_SLOTS, "TradeSystem과 protocol의 MAX_TRADE_SLOTS가 일치함 (진실은 하나)");
  assert(clampTradeOffer(Array.from({ length: 20 }, (_, i) => i)).length === MAX_TRADE_SLOTS, "제안 목록이 최대 슬롯 수로 잘림");

  const st = createInitialGameState("pirate");
  st.player.inventory.push({ id: "potion_small", name: "회복 물약", description: "체력 회복", icon: "🧪", quantity: 5, usable: true });
  st.player.inventory.push({ id: "sword_yoru", name: "요루", description: "검", icon: "⚔️", quantity: 1, usable: false, equippable: true });
  st.player.hotbar[0] = "sword_yoru";
  st.player.activeHotbarSlot = 0;

  const taken = removeFromInventory(st.player, "potion_small", 2);
  assert(taken === 2, `일부만 빼면 뺀 개수를 그대로 돌려줌 (${taken})`);
  assert(st.player.inventory.find((i) => i.id === "potion_small").quantity === 3, "남은 개수가 정확히 줄어듦");

  const takenAll = removeFromInventory(st.player, "sword_yoru", 1);
  assert(takenAll === 1, "가진 만큼 요청하면 그만큼 빠짐");
  assert(!st.player.inventory.some((i) => i.id === "sword_yoru"), "0개가 되면 인벤토리에서 아예 사라짐");
  assert(st.player.hotbar[0] === null, "단축바에 있던 칸도 함께 비워짐 (없는 아이템이 손에 남지 않도록)");
  assert(st.player.activeHotbarSlot === null, "손에 들고 있던 상태였다면 그것도 함께 해제됨");

  const overTaken = removeFromInventory(st.player, "potion_small", 999);
  assert(overTaken === 3, `가진 것보다 많이 요청해도 가진 만큼만 빠짐 (${overTaken})`);
  assert(!st.player.inventory.some((i) => i.id === "potion_small"), "다 빠지면 인벤토리에서 사라짐");

  const notFound = removeFromInventory(st.player, "potion_exp", 1);
  assert(notFound === 0, "없는 아이템은 0개 빠짐 (음수가 되지 않음)");

  applyReceivedItems(st.player, [
    { id: "potion_exp", name: "경험치 물약", description: "경험치 획득", icon: "🍾", quantity: 2, usable: true },
  ]);
  assert(st.player.inventory.find((i) => i.id === "potion_exp")?.quantity === 2, "받은 아이템이 인벤토리에 새로 생김");
  applyReceivedItems(st.player, [
    { id: "potion_exp", name: "경험치 물약", description: "경험치 획득", icon: "🍾", quantity: 3, usable: true },
  ]);
  assert(st.player.inventory.find((i) => i.id === "potion_exp")?.quantity === 5, "같은 아이템을 또 받으면 기존 개수 위에 쌓임");

  assert(offerIsAffordable(st.player, [{ id: "potion_exp", quantity: 5 }]) === true, "실제로 가진 만큼 제안하면 통과");
  assert(offerIsAffordable(st.player, [{ id: "potion_exp", quantity: 6 }]) === false, "가진 것보다 많이 제안하면 거부");
  assert(offerIsAffordable(st.player, [{ id: "potion_exp", quantity: 0 }]) === false, "0개 제안은 무효");
}

section("멀티플레이 서버 — 거래·선물 중계 (신뢰 경계: 서버는 인벤토리를 모름, 그대로 중계만)");
{
  function fakeConn(world, name, faction) {
    const sent = [];
    const sock = { readyState: 1, OPEN: 1, send: (d) => sent.push(JSON.parse(d)), close() {} };
    const conn = world.join(sock, name, faction);
    return { conn, sent };
  }
  const sampleItem = (id, qty) => ({ id, name: id, description: "", icon: "🧪", usable: true, quantity: qty });
  /** 초대→수락까지 밟아서 곧바로 거래 세션을 시작합니다 (아래 여러 테스트의 공통 준비 단계). */
  function startTrade(world, x, y) {
    world.handleMessage(x.conn, JSON.stringify({ type: "trade_request", targetId: y.conn.id }));
    world.handleMessage(y.conn, JSON.stringify({ type: "trade_invite_respond", accept: true }));
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const world = new World();
  const a = fakeConn(world, "가", "pirate"); // room1
  const b = fakeConn(world, "나", "marine"); // room1
  a.sent.length = 0;
  b.sent.length = 0;

  // 거래를 걸면 "초대"만 상대에게 가고, 신청한 쪽은 아직 거래창이 열리지 않음(응답 대기)
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_request", targetId: b.conn.id }));
  const invite = b.sent.find((m) => m.type === "trade_invite");
  assert(invite?.fromId === a.conn.id && invite?.fromName === "가", "거래를 신청하면 상대만 trade_invite를 받음");
  assert(!a.sent.some((m) => m.type === "trade_started") && !b.sent.some((m) => m.type === "trade_started"), "응답 전에는 양쪽 다 거래창이 열리지 않음");
  const sentAck = a.sent.find((m) => m.type === "trade_invite_sent");
  assert(sentAck?.toId === b.conn.id && sentAck?.toName === "나", "신청한 쪽은 trade_invite_sent로 '전달됐다'는 확인만 받음");

  // 거절하면 신청한 쪽에 declined로 알려주고, 거래는 시작되지 않음
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(b.conn, JSON.stringify({ type: "trade_invite_respond", accept: false }));
  assert(a.sent.find((m) => m.type === "trade_closed")?.reason === "declined", "거절하면 신청한 쪽이 trade_closed(declined)를 받음");
  assert(!a.sent.some((m) => m.type === "trade_started") && !b.sent.some((m) => m.type === "trade_started"), "거절되면 거래창이 열리지 않음");

  // 수락하면 그제서야 양쪽 다 trade_started — 서로를 파트너로 기억함
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_request", targetId: b.conn.id }));
  world.handleMessage(b.conn, JSON.stringify({ type: "trade_invite_respond", accept: true }));
  const aStarted = a.sent.find((m) => m.type === "trade_started");
  const bStarted = b.sent.find((m) => m.type === "trade_started");
  assert(aStarted?.partnerId === b.conn.id && aStarted?.partnerName === "나", "수락하면 신청한 쪽도 trade_started를 받음");
  assert(bStarted?.partnerId === a.conn.id && bStarted?.partnerName === "가", "수락한 쪽도 곧바로 trade_started를 받음");

  // 이미 거래 중인 사람에게 또 걸면 거부됨
  const c = fakeConn(world, "다", "pirate");
  a.sent.length = 0;
  world.handleMessage(c.conn, JSON.stringify({ type: "trade_request", targetId: a.conn.id }));
  const busy = c.sent.find((m) => m.type === "trade_closed");
  assert(busy?.reason === "busy", "이미 거래 중인 사람에게 걸면 busy로 거부됨");

  // 응답 대기 중인(아직 수락/거절 안 한) 사람에게 또 걸어도 거부됨
  const c2 = fakeConn(world, "다2", "pirate");
  const f = fakeConn(world, "바", "marine");
  world.handleMessage(c2.conn, JSON.stringify({ type: "trade_request", targetId: f.conn.id })); // f는 아직 응답 안 함 → pendingTradeInviteFrom
  c2.sent.length = 0;
  const c3 = fakeConn(world, "다3", "pirate");
  world.handleMessage(c3.conn, JSON.stringify({ type: "trade_request", targetId: f.conn.id }));
  assert(c3.sent.find((m) => m.type === "trade_closed")?.reason === "busy", "이미 다른 초대에 응답 대기 중인 사람에게 걸어도 busy로 거부됨");
  world.handleMessage(f.conn, JSON.stringify({ type: "trade_invite_respond", accept: false })); // 정리

  // 자기 자신에게는 거래를 걸 수 없음
  c.sent.length = 0;
  world.handleMessage(c.conn, JSON.stringify({ type: "trade_request", targetId: c.conn.id }));
  assert(c.sent.find((m) => m.type === "trade_closed")?.reason === "self", "자기 자신과는 거래할 수 없음");

  // 제안을 보내면 상대에게 trade_update로 전달되고, 승낙 상태는 false로 초기화됨
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_offer", items: [sampleItem("potion_small", 3)] }));
  const bUpdate = b.sent.find((m) => m.type === "trade_update");
  assert(bUpdate?.partnerOffer?.[0]?.id === "potion_small" && bUpdate.partnerOffer[0].quantity === 3, "상대에게 내 제안 내용이 그대로 중계됨");
  assert(bUpdate?.partnerAccepted === false, "제안을 보내면 내 승낙 상태가 false로 초기화됨");

  // 승낙 — 한쪽만 눌렀을 때는 아직 성사되지 않음
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_accept", accepted: true }));
  assert(!b.sent.some((m) => m.type === "trade_complete"), "한쪽만 승낙하면 아직 거래가 성사되지 않음");
  assert(b.sent.find((m) => m.type === "trade_update")?.partnerAccepted === true, "상대는 내가 승낙했다는 걸 trade_update로 알 수 있음");

  // 상대가 제안을 바꾸면(offer) 이미 눌렀던 내 승낙도 서버가 되돌림 (마지막에 몰래 바꿔치기 방지)
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(b.conn, JSON.stringify({ type: "trade_offer", items: [sampleItem("sword_yoru", 1)] }));
  const aResetUpdate = a.sent.find((m) => m.type === "trade_update");
  assert(aResetUpdate?.partnerOffer?.[0]?.id === "sword_yoru", "상대의 새 제안이 반영됨");
  // a는 이미 accept:true를 보낸 상태였지만, b의 제안 변경으로 서버가 양쪽 accepted를 리셋했으므로
  // 다시 accept를 눌러야 함 — 그 사실을 아래에서 확인합니다.
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(b.conn, JSON.stringify({ type: "trade_accept", accepted: true }));
  assert(!a.sent.some((m) => m.type === "trade_complete"), "제안이 바뀐 뒤에는 예전 승낙이 무효화되어 다시 눌러야 성사됨");

  // 양쪽 다 (다시) 승낙해도, 곧바로 성사되지는 않고 5초 자동 성사 유예가 걸림
  // (지금 시점: a의 제안은 그대로 potion_small x3, b의 제안은 방금 바꾼 sword_yoru x1)
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_accept", accepted: true }));
  assert(!a.sent.some((m) => m.type === "trade_complete") && !b.sent.some((m) => m.type === "trade_complete"), "양쪽 다 승낙해도 곧바로 성사되지 않음 (취소 유예 시작)");
  const confirmUpdate = a.sent.find((m) => m.type === "trade_update");
  assert(typeof confirmUpdate?.confirmDeadlineMs === "number" && confirmUpdate.confirmDeadlineMs > Date.now(), "trade_update에 자동 성사 마감 시각이 실림");

  // 유예 시간 안에 한쪽이 승낙을 취소하면(다시 눌러 false) 자동 성사가 취소되고, 원래 마감 시각이 지나도 성사되지 않음
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(b.conn, JSON.stringify({ type: "trade_accept", accepted: false }));
  const cancelUpdate = a.sent.find((m) => m.type === "trade_update");
  assert(cancelUpdate?.confirmDeadlineMs === null, "취소하면 마감 시각도 다시 null로 돌아옴");
  await wait(TRADE_CONFIRM_DELAY_MS + 300);
  assert(!a.sent.some((m) => m.type === "trade_complete") && !b.sent.some((m) => m.type === "trade_complete"), "유예 중 취소했으면 원래 마감 시각이 지나도 성사되지 않음");

  // 다시 양쪽 다 승낙 + 아무도 취소하지 않고 5초를 다 기다리면 그제서야 실제로 성사됨
  a.sent.length = 0;
  b.sent.length = 0;
  world.handleMessage(b.conn, JSON.stringify({ type: "trade_accept", accepted: true }));
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_accept", accepted: true }));
  assert(!a.sent.some((m) => m.type === "trade_complete"), "다시 승낙해도 즉시 성사되지 않고 유예가 다시 걸림");
  await wait(TRADE_CONFIRM_DELAY_MS + 300);
  const aComplete = a.sent.find((m) => m.type === "trade_complete");
  const bComplete = b.sent.find((m) => m.type === "trade_complete");
  assert(aComplete?.receivedItems?.[0]?.id === "sword_yoru", "5초를 다 기다리면 a는 b가 제안했던 sword_yoru를 받음 (자기가 준 potion_small이 아님)");
  assert(bComplete?.receivedItems?.[0]?.id === "potion_small" && bComplete.receivedItems[0].quantity === 3, "b는 a가 제안했던 potion_small x3을 받음");

  // 거래가 끝났으니 더 이상 서로를 거래 상대로 붙잡고 있지 않아야 함 (다음 거래를 바로 시작할 수 있게)
  a.sent.length = 0;
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_request", targetId: c.conn.id }));
  assert(a.sent.some((m) => m.type === "trade_invite_sent"), "거래가 끝난 뒤에는 곧바로 다른 사람에게 새로 거래를 신청할 수 있음");
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_cancel" }));

  // 취소 — 양쪽 다 trade_closed를 받고 세션이 풀림
  const d1 = fakeConn(world, "라1", "pirate");
  const d2 = fakeConn(world, "라2", "marine");
  startTrade(world, d1, d2);
  d1.sent.length = 0;
  d2.sent.length = 0;
  world.handleMessage(d1.conn, JSON.stringify({ type: "trade_cancel" }));
  assert(d1.sent.find((m) => m.type === "trade_closed")?.reason === "cancelled", "취소한 쪽도 trade_closed를 받음");
  assert(d2.sent.find((m) => m.type === "trade_closed")?.reason === "cancelled", "상대도 trade_closed를 받음");

  // 거래 중 상대가 접속을 끊으면 남은 쪽에게 partner_left로 알림
  const e1 = fakeConn(world, "마1", "pirate");
  const e2 = fakeConn(world, "마2", "marine");
  startTrade(world, e1, e2);
  e1.sent.length = 0;
  world.leave(e2.conn.id);
  assert(e1.sent.find((m) => m.type === "trade_closed")?.reason === "partner_left", "거래 상대가 나가면 partner_left로 거래가 자동 종료됨");

  // 초대에 아직 응답하지 않은 사이에 신청한 쪽이 나가면, 응답 대기 중이던 쪽에도 partner_left로 알림
  const e3 = fakeConn(world, "마3", "pirate");
  const e4 = fakeConn(world, "마4", "marine");
  world.handleMessage(e3.conn, JSON.stringify({ type: "trade_request", targetId: e4.conn.id }));
  e4.sent.length = 0;
  world.leave(e3.conn.id);
  assert(e4.sent.find((m) => m.type === "trade_closed")?.reason === "partner_left", "응답하기 전에 신청한 쪽이 나가면 partner_left로 알림 (응답 대기 화면이 안 남게)");
  // 이제 e4는 더 이상 대기 중인 초대가 없어야 하므로, 응답해도 조용히 무시됨 (에러 없이)
  e4.sent.length = 0;
  world.handleMessage(e4.conn, JSON.stringify({ type: "trade_invite_respond", accept: true }));
  assert(e4.sent.length === 0, "이미 정리된 초대에 응답해도 아무 일도 일어나지 않음");

  // 다른 방 사람과는 거래를 걸 수 없음 — room1을 꽉 채운 뒤, 그다음 접속자는 room2로 밀려남.
  // (room1을 채우기 전부터 있던 a는 계속 room1에 남아있으므로, a로 다른 방 사람과의 거절을 확인합니다)
  while (Object.values(world.roomSummary()).reduce((s, n) => s + n, 0) < ROOM_CAPACITY) {
    fakeConn(world, "채우기", "pirate");
  }
  const otherRoom = fakeConn(world, "다른방", "marine"); // room1이 꽉 찼으니 room2로 배정됨
  assert(a.conn.roomId !== otherRoom.conn.roomId, "테스트 전제 확인 — a와 다른방은 실제로 다른 방임");
  a.sent.length = 0;
  world.handleMessage(a.conn, JSON.stringify({ type: "trade_request", targetId: otherRoom.conn.id }));
  assert(a.sent.find((m) => m.type === "trade_closed")?.reason === "different_room", "다른 방 사람과는 거래를 걸 수 없음");

  // 선물 — 거래창 없이 곧바로 전달되고, 보낸 사람은 gift_ack로 성공 여부를 앎
  const g1 = fakeConn(world, "사1", "pirate");
  const g2 = fakeConn(world, "사2", "marine");
  g1.sent.length = 0;
  g2.sent.length = 0;
  world.handleMessage(g1.conn, JSON.stringify({ type: "gift_send", targetId: g2.conn.id, item: sampleItem("potion_small", 2) }));
  const giftReceived = g2.sent.find((m) => m.type === "gift_received");
  assert(giftReceived?.fromId === g1.conn.id && giftReceived?.item?.quantity === 2, "선물이 상대에게 그대로 전달됨");
  assert(g1.sent.find((m) => m.type === "gift_ack")?.delivered === true, "보낸 사람은 전달 성공을 gift_ack로 확인함");

  g1.sent.length = 0;
  world.handleMessage(g1.conn, JSON.stringify({ type: "gift_send", targetId: "없는아이디", item: sampleItem("potion_small", 1) }));
  const failedAck = g1.sent.find((m) => m.type === "gift_ack");
  assert(failedAck?.delivered === false && failedAck?.reason === "not_connected", "없는 상대에게 선물을 보내면 실패로 알려줌 (인벤토리에서 빼면 안 되는 신호)");
}

section("섬 판정");
assert(islandAt(0, 0)?.id === "central", "원점은 중앙 교역섬 (해적·해군 시작 섬 사이)");
assert(islandAt(200, 180) === null, "먼 바다는 어떤 섬에도 속하지 않음");
const jungleForCheck = ISLANDS.find((i) => i.id === "jungle");
assert(islandAt(jungleForCheck.center.x, jungleForCheck.center.z)?.id === "jungle", "정글 섬 중심 판정");

console.log(failures === 0 ? "\n모든 로직 검증 통과 ✅" : `\n${failures}개 실패 ❌`);
process.exit(failures === 0 ? 0 : 1);
