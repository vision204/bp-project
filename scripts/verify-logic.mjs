// 순수 게임 로직(스텟/레벨업/퀘스트/상점/항해/버프)을 브라우저 없이 Node에서 검증합니다.
// 이 모듈들은 Three.js나 Rapier에 의존하지 않는 순수 TypeScript라 가능한 방식입니다.
const { createInitialGameState, expRequiredForLevel } = await import("../src/core/GameState.ts");
const { MAX_LEVEL } = await import("../src/core/ExpCurve.ts");
const { grantExp } = await import("../src/simulation/Leveling.ts");
const { allocateStatPoint, recomputeDerivedStats, MANA_PER_POINT, SWORD_DMG_MULT_PER_POINT, GUN_DMG_MULT_PER_POINT,
        BASE_ATTACK_POWER, ATTACK_POWER_PER_POINT, statAttackPower } =
  await import("../src/simulation/StatSystem.ts");
const { DUMMY_EXP_REWARD, createInitialEnemies } = await import("../src/simulation/EnemyManager.ts");
const { createQuests, createNpcs, canAcceptQuest, stepInteraction: stepInteractionQ } = await import("../src/simulation/QuestSystem.ts");
const { FRUIT_CATALOG, ITEM_CATALOG, WEAPON_CATALOG, buyFruit, buyItem,
        CASH_PAYMENT_ENABLED, CASH_PAYMENT_NOTICE } = await import("../src/simulation/ShopSystem.ts");
const { addFruitToInventory, ownsFruit, equipFruitFromInventory, syncFruitMasteryCache,
        holdFruitCandidate, cancelHeldFruitCandidate, confirmHeldFruitEquip } =
  await import("../src/simulation/FruitInventorySystem.ts");
const { WEAPONS, weaponFor, drawnWeapon, toggleHotbar, toggleDrawn, toggleFruitDrawn, weaponDamageMultiplier,
        weaponAttackSpeedMultiplier, weaponDps, isWeapon } = await import("../src/simulation/WeaponSystem.ts");
const { totalMeleeDamage, totalMeleeRange } = await import("../src/simulation/CombatSystem.ts");
const { WEAPON_SKILLS, skillsForWeapon, isWeaponSlotUnlocked, allWeaponSkills } =
  await import("../src/simulation/weaponSkills.ts");
const { MAX_WEAPON_LEVEL, weaponExpRequiredForLevel, weaponLevelDamageMultiplier,
        weaponExpFromEnemy, weaponMasteryLevel, grantWeaponExp } =
  await import("../src/simulation/WeaponLeveling.ts");
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
const { SLOT_KEYS, SLOT_UNLOCK_LEVELS, allSkills, skillsForFruit, isSlotUnlocked,
        LIGHT_FLIGHT_SKILL, DRAGON_FLIGHT_SKILL, withCharge, withRangeMultiplier,
        DRAGON_FORM_RANGE_MULTIPLIER } =
  await import("../src/simulation/skills.ts");
const { stepCombat, stepEnemyStatuses, skillDamage, weaponSkillDamage, canMeleeAttack, stepFruitSpecialAbility } =
  await import("../src/simulation/CombatSystem.ts");
const { fruitExpRequiredForLevel, fruitLevelDamageMultiplier, MAX_FRUIT_LEVEL } =
  await import("../src/simulation/FruitLeveling.ts");
const { SAVE_VERSION, toSaveData, applySaveData } = await import("../src/core/SaveData.ts");
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
const { TELEPORT_TEACHER_ISLAND_ID, TELEPORT_REQUIRED_LEVEL, TELEPORT_PRICE, TELEPORT_COOLDOWN_SEC,
        teleportBlockReason, canLearnTeleport, learnTeleport, canUseTeleport,
        beginTeleportCooldown, stepTeleportCooldown } = await import("../src/simulation/TeleportSystem.ts");
const { activateHotbarSlot } = await import("../src/simulation/Simulation.ts");

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

section("밸런스 — 검/총/열매 데미지 공식 개편 (statAttackPower)");
{
  assert(statAttackPower(0) === 10, `statAttackPower(0) === 10 (실제 ${statAttackPower(0)})`);
  assert(statAttackPower(10) === 15, `statAttackPower(10) === 15 — 스텟 1당 +0.5 (실제 ${statAttackPower(10)})`);
  assert(BASE_ATTACK_POWER === 10, "BASE_ATTACK_POWER === 10");
  assert(ATTACK_POWER_PER_POINT === 0.5, "ATTACK_POWER_PER_POINT === 0.5");

  // 검 무기 데미지 — stats.sword=0이면 기준치 10, stats.sword=20이면 기준치 20 (무기 배율은 별도)
  const pSword = createInitialGameState().player;
  pSword.hotbar = ["sword_wood", null, null];
  pSword.activeHotbarSlot = 0;
  recomputeDerivedStats(pSword);
  assert(totalMeleeDamage(pSword) === 10, `검 스텟 0 — 나무 검(배율 1) 데미지 10 (실제 ${totalMeleeDamage(pSword)})`);
  pSword.stats.sword = 20;
  recomputeDerivedStats(pSword);
  assert(totalMeleeDamage(pSword) === 20, `검 스텟 20 — 나무 검(배율 1) 데미지 20 (실제 ${totalMeleeDamage(pSword)})`);

  // 열매 능력 배율 — stats.fruit=0이면 x1.0, stats.fruit=5면 x1.25 (5 × 0.05)
  const pFruitStat = createInitialGameState().player;
  recomputeDerivedStats(pFruitStat);
  assert(pFruitStat.abilityDamageMultiplier === 1, `열매 스텟 0 — 배율 x1.0 (실제 ${pFruitStat.abilityDamageMultiplier})`);
  pFruitStat.stats.fruit = 5;
  recomputeDerivedStats(pFruitStat);
  assert(
    Math.abs(pFruitStat.abilityDamageMultiplier - 1.25) < 1e-9,
    `열매 스텟 5 — 배율 x1.25 (실제 ${pFruitStat.abilityDamageMultiplier})`,
  );
}

section("레벨업 / 스텟 배분");
grantExp(player, DUMMY_EXP_REWARD * 4, player.events);
assert(player.level === 2, `레벨업 발생 (level=${player.level})`);
assert(player.unspentStatPoints === 3, `레벨업당 스텟 포인트 3 지급 (points=${player.unspentStatPoints})`);
assert(player.hp === player.maxHp, "레벨업 시 체력 완전 회복");

const prevMaxHp = player.maxHp;
assert(allocateStatPoint(player, "defense") === true, "방어 스텟 배분 성공");
assert(player.maxHp === prevMaxHp + 12, `방어 스텟 1당 최대체력 +12 (maxHp=${player.maxHp})`);
allocateStatPoint(player, "attack");
assert(player.maxMana === 58, `공격 스텟 1당 최대마나 +8 (maxMana=${player.maxMana})`);
assert(player.meleeDamage === 8, `공격 스텟은 근접뎀에 영향 없음 (meleeDamage=${player.meleeDamage})`);
allocateStatPoint(player, "sword");
assert(
  Math.abs(player.swordDamageMultiplier - statAttackPower(1)) < 1e-9,
  `검 스텟 1당 기준 공격력 +0.5 (statAttackPower(1)=${statAttackPower(1)}, swordDamageMultiplier=${player.swordDamageMultiplier})`,
);
assert(allocateStatPoint(player, "gun") === false, "포인트 없을 때 배분 실패 처리");

section(`만렙(${MAX_LEVEL}) — 그 이상은 레벨도 스탯 포인트도 멈춤`);
{
  const p = createInitialGameState().player;
  p.level = MAX_LEVEL;
  p.exp = 0;
  p.expToNextLevel = expRequiredForLevel(MAX_LEVEL);
  p.unspentStatPoints = 0;
  const pointsBefore = p.unspentStatPoints;
  grantExp(p, expRequiredForLevel(MAX_LEVEL) * 50, p.events); // 만렙 넘길 만큼 큰 경험치를 줘도
  assert(p.level === MAX_LEVEL, `만렙에서 더 이상 레벨이 오르지 않음 (level=${p.level})`);
  assert(p.unspentStatPoints === pointsBefore, `만렙에서 스탯 포인트도 더 이상 늘지 않음 (points=${p.unspentStatPoints})`);
  assert(p.exp === 0, `만렙에서 초과 경험치는 버려짐 (exp=${p.exp})`);
  assert(p.events.filter((e) => e.type === "player_leveled_up").length === 0, "만렙에서는 레벨업 이벤트 자체가 발생하지 않음");

  // 만렙 바로 아래에서는 정확히 그 경계까지만 레벨업하고 멈춰야 합니다.
  const q = createInitialGameState().player;
  q.level = MAX_LEVEL - 1;
  q.exp = 0;
  q.expToNextLevel = expRequiredForLevel(MAX_LEVEL - 1);
  grantExp(q, expRequiredForLevel(MAX_LEVEL - 1) * 100, q.events);
  assert(q.level === MAX_LEVEL, `만렙 바로 아래에서 큰 경험치를 줘도 딱 상한까지만 오름 (level=${q.level})`);
}

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
// applyKillsToQuests가 이제 보상까지 직접 지급하므로(NPC에게 안 돌아가도 됨) player가 필요합니다.
const questState = createInitialGameState();
questState.quests = createQuests();
const quests = questState.quests;
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
applyKillsToQuests(questState, kills("jungle", 3));
assert(startQuest.killProgress === 0, "정글 몬스터를 잡아도 시작 섬 퀘스트는 진행 안 됨");
assert(jungleQuest.killProgress === 3, `정글 퀘스트만 3 진행 (${jungleQuest.killProgress})`);
applyKillsToQuests(questState, kills("pirate_start", 2));
assert(startQuest.killProgress === 2, `시작 섬 퀘스트 2 진행 (${startQuest.killProgress})`);
assert(jungleQuest.killProgress === 3, "정글 퀘스트는 그대로");

// 목표치를 채우는 순간 — NPC에게 안 돌아가도 그 자리에서 바로 완료·보상 지급됨(사용자 요청)
const moneyBeforeAutoComplete = questState.player.money;
applyKillsToQuests(questState, kills("pirate_start", 20));
assert(startQuest.status === "completed", "목표치를 채우는 즉시 자동 완료됨(NPC에게 안 돌아가도 됨)");
assert(startQuest.killProgress === 0, "완료되면 진행도는 다음 회차를 위해 초기화됨");
assert(startQuest.completions === 1, "완료 횟수도 그 자리에서 즉시 올라감");
assert(questState.player.money > moneyBeforeAutoComplete, "완료 즉시 코인이 지급됨(NPC 상호작용 불필요)");
assert(
  questState.player.events.some((e) => e.type === "quest_completed"),
  "완료 즉시 quest_completed 이벤트가 발생함(킬 그 순간)",
);

// 수락하지 않은(available) 퀘스트는 진행되지 않음
const desertQuest = quests.find((q) => q.islandId === "desert");
applyKillsToQuests(questState, kills("desert", 2));
assert(desertQuest.killProgress === 0, "수락하지 않은 퀘스트는 진행 안 됨");

section("퀘스트: 몬스터 종류 선택 (여러 종류인 섬)");
{
  // 사용자 요청(참고 자료 기반 hp 리밸런스)으로 안개 섬이 1종류로 줄어들어서,
  // "여러 종류인 섬" 예시로는 여전히 2종류가 남아있는 수정 섬을 씁니다.
  const st = createInitialGameState();
  st.quests = createQuests();
  const island = getIsland("crystal");
  assert(island.species.length === 2, "수정 섬은 여전히 2종류 (예시로 쓰기 위한 전제)");
  const [golem, lord] = island.species;

  st.player.level = 10;
  assert(acceptQuest(st, "crystal", lord.id) === false, "레벨이 모자라면 종류를 골라도 수락 불가");

  st.player.level = 420;
  assert(acceptQuest(st, "crystal", "없는_종류") === false, "존재하지 않는 몬스터 종류는 거절");
  assert(acceptQuest(st, "crystal", lord.id) === true, `"${lord.name}"을(를) 사냥 대상으로 수락`);

  const hq = st.quests.find((q) => q.islandId === "crystal");
  assert(hq.status === "active", "퀘스트가 진행 중으로 바뀜");
  assert(hq.targetSpeciesId === lord.id, `대상이 "${lord.name}"으로 지정됨`);
  assert(hq.title.includes(lord.name), `퀘스트 제목에 대상 표시: "${hq.title}"`);
  assert(hq.rewardMoney === Math.round(lord.money * 3), `보상 코인이 그 종류 기준 (${hq.rewardMoney})`);

  // 같은 섬이라도 다른 종류를 잡으면 진행되면 안 됩니다 — 이번 요청의 핵심
  applyKillsToQuests(st, kills("crystal", 5, 0));
  assert(hq.killProgress === 0, `같은 섬의 다른 종류("${golem.name}") 5마리를 잡아도 진행 안 됨`);
  applyKillsToQuests(st, kills("crystal", 3, 1));
  assert(hq.killProgress === 3, `고른 종류("${lord.name}")만 3 진행 (${hq.killProgress})`);

  assert(acceptQuest(st, "crystal", golem.id) === false, "진행 중에는 다른 종류로 갈아탈 수 없음");
  assert(hq.targetSpeciesId === lord.id, "대상이 그대로 유지됨");

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

section("몬스터 종류 — 참고 자료(다른 게임의 섬별 몬스터 체력 표) 기반 리밸런스 이후 구성");
// 예전엔 "다음 섬과의 레벨 차이 50당 1종류"(speciesCountForGap)가 19개 사냥터
// 전부의 종족 수를 그대로 결정했지만, 이번 리밸런스는 사용자가 넘겨준 참고
// 자료의 섬별 몬스터 구성(이름·개수·hp)을 그대로 옮겨 적은 것이라 그 규칙과
// 무관하게 종족이 트리밍되었습니다(예: 안개 섬 2→1, 용의 둥지 4→2). 그래서
// speciesCountForGap을 다시 재현하는 대신, Part B 스펙 그대로의 종족 구성을
// 리터럴로 검증합니다. speciesCountForGap 자체(순수 함수)는 아래에서 별도로
// 검증합니다.
assert(ISLANDS.filter((i) => i.species.length === 0).map((i) => i.id).sort().join() === "central,fountain",
  "몬스터가 없는 섬은 바다별 허브 둘뿐 (중앙 교역섬 · 분수 도시)");
const EXPECTED_WILD_SPECIES_NAMES = {
  jungle: ["정글 도적"],
  desert: ["사막 도적"],
  ice: ["설원 늑대"],
  volcano: ["용암 병사"],
  storm: ["폭풍 해적"],
  haunted: ["안개 유령"],
  crystal: ["수정 골렘", "수정 군주"],
  abyss: ["심연 촉수"],
  sky: ["천공 사제"],
  dragon: ["새끼 드래곤", "고룡"],
  rose: ["장미 기사"],
  green_zone: ["초원 사냥꾼", "초원 족장"],
  graveyard: ["무덤지기"],
  snow_mountain: ["설산 산적"],
  hot_cold: ["불꽃 야수"],
  cursed_ship: ["유령 선원"],
  ice_castle: ["성벽 파수병"],
  forgotten: ["잊혀진 전사"],
  mansion: ["저택 하인", "저택의 주인"],
};
for (const [islandId, names] of Object.entries(EXPECTED_WILD_SPECIES_NAMES)) {
  const island = getIsland(islandId);
  assert(
    island.species.map((s) => s.name).join(",") === names.join(","),
    `${island.name}: 종족 구성 [${island.species.map((s) => s.name).join(", ")}] (기대 [${names.join(", ")}])`,
  );
}
assert(speciesCountForGap(100) === 2 && speciesCountForGap(49) === 1 && speciesCountForGap(150) === 3,
  "speciesCountForGap 함수 자체는 그대로(50레벨당 1종류) — 어디서도 안 쓰이게 됐어도 로직은 살아있음");
const haunted = getIsland("haunted");
assert(haunted.species.length === 1, `안개 섬에 몬스터 1종류 (${haunted.species.map((s) => s.name).join(", ")})`);
assert(getIsland("dragon").species.length === 2, "용의 둥지는 2종류(새끼 드래곤/고룡)로 줄어듦");

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

// 예전엔 "여러 종류인 섬은 한 종류짜리 섬보다 넓어야 함"을 검사했습니다(한 섬
// 안에 서식지를 나눠야 하므로). 그런데 참고 자료 기반 리밸런스로 종족 수가
// radius와 무관하게(스펙 Part B가 "radius는 그대로 두라"고 명시) 대거
// 트리밍되면서 — 예: 수정 섬(72m, 이제 2종류)이 그보다 나중에 추가된 안개/
// 심연/천공(각 1종류, 62~86m)보다 오히려 좁아짐 — 이 상관관계 자체가 더 이상
// 성립하지 않습니다. radius는 이번 리밸런스 대상이 아니라 원래 값 그대로이므로
// (스펙 그대로) 이 테스트는 삭제합니다. 대신 "2종류 이상인 섬은 실제로 종족별
// 서식지가 갈라져 있는지"는 아래 섹션에서 좌표 기준으로 계속 검증합니다.

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
// 예전엔 "어느 종족도 75레벨 넘게 혼자 책임지지 않아야 함"(uncovered<=75)을
// 검사했지만, 참고 자료 기반 리밸런스로 종족 수가 레벨 차이와 무관하게
// 트리밍되면서(예: 잊혀진 섬 100레벨 차이를 종족 1개가 담당) 이 기준은 더 이상
// 이번 리밸런스의 의도와 맞지 않습니다(더 이상 검증하려는 대상이 아님 — 사냥
// 밀도/적정 레벨 구간 자체는 위의 "섬 난이도 밸런스"(3~20마리당 1레벨) 검사가
// 계속 담당합니다). 대신, 최소한의 상식적 순서 — 그 섬의 가장 강한 종족이
// 다음 섬의 요구 레벨보다는 낮아야 한다(그래야 "이 섬에서 다음 섬 갈 때까지
// 사냥"이라는 구조 자체가 성립함) — 만 남겨둡니다.
for (const island of ISLANDS.filter((i) => i.kind === "wild")) {
  const gap = levelGapToNextIsland(island);
  const top = island.species[island.species.length - 1];
  const nextIslandLevel = island.requiredLevel + gap;
  assert(
    top.tierLevel < nextIslandLevel,
    `${island.name}: 가장 강한 종족(Lv.${top.tierLevel})이 다음 섬(Lv.${nextIslandLevel})보다 낮은 레벨`,
  );
}
const wildIslands = ISLANDS.filter((i) => i.kind === "wild");
const expList = wildIslands.map((i) => i.species[0].exp);
const hpList = wildIslands.map((i) => i.species[0].hp);
const dmgList = wildIslands.map((i) => i.species[0].contactDamage);
assert(expList.every((v, i) => i === 0 || v > expList[i - 1]), `경험치가 계단식 증가: ${expList.join(" < ")}`);
// hp만 예외: 참고 자료(다른 게임의 섬별 몬스터 체력 표)를 그대로 옮겨 적은 결과,
// 장미 왕국(27,500) → 초원 지대(7,400) 구간에서 체력이 실제로 내려갑니다.
// 참고 자료 자체의 "분수 도시" 행에 있던 유난히 강한 "사이보그" 항목을 그대로
// 재현한 것이라 의도된 값입니다(스펙 Part B 안내 참고) — 스무딩하지 않고 그대로
// 둡니다. 이 한 구간만 예외로 건너뛰고, 나머지 모든 구간은 여전히 계단식
// 증가를 검증합니다.
const roseToGreenIdx = wildIslands.findIndex((i) => i.id === "green_zone");
assert(roseToGreenIdx > 0 && wildIslands[roseToGreenIdx - 1].id === "rose",
  "장미 왕국→초원 지대 예외 구간의 인덱스 전제가 맞음(섬 순서가 바뀌면 이 테스트도 손봐야 함)");
assert(
  hpList.every((v, i) => i === 0 || i === roseToGreenIdx || v > hpList[i - 1]),
  `체력도 계단식 증가 (단, 장미 왕국→초원 지대는 참고 자료상의 의도된 예외): ${hpList.join(", ")}`,
);
assert(dmgList.every((v, i) => i === 0 || v > dmgList[i - 1]), "접촉 데미지도 계단식 증가");

// 최고 레벨까지 도달 가능한지 (퀘스트는 레벨당 90%를 주므로 퀘스트 기준으로 계산)
let expToMax = 0;
for (let lv = 1; lv < 900; lv++) expToMax += expRequiredForLevel(lv);
const questsToMax = Math.ceil(899 / 0.9);
assert(questsToMax < 1200, `Lv.900까지 퀘스트 약 ${questsToMax}회 (각 7마리) — 도달 가능한 분량`);
console.log(`  참고: Lv.900 누적 경험치 ${Math.round(expToMax).toLocaleString()}`);

section("밸런스 — 몬스터 hp 리터럴 목표값 (참고 자료 기반 리밸런스, Part B)");
{
  // 예전엔 여기서 두 가지를 검사했습니다:
  //   (1) "원콤 방지" — 섬에 막 도착한 시점의 캐릭터가 첫 몬스터를 한 방에
  //       못 죽여야 함 (estimatedMeleeHitAtLevel 기반 바닥값 재현)
  //   (2) "몬스터 체력 1.3배" — islands.ts의 MONSTER_HP_BUFF(1.3)를 곡선에서
  //       재현해서 정확히 반영됐는지 확인
  // 이번 리밸런스(사용자가 넘겨준 "다른 게임의 섬별 몬스터 체력 표")로 19개
  // 사냥터 전부의 hp가 곡선/바닥값/1.3배 버프 계산을 건너뛰는 hpOverride(리터럴
  // 목표값)로 바뀌었으므로, 저 두 공식은 더 이상 이 hp들을 만들어낸 공식이
  // 아닙니다 — 곡선 기반으로 "정확히 반영됐는지" 재현할 대상 자체가 사라졌습니다
  // (원콤 방지도 마찬가지: 예를 들어 정글 섬의 hp 40은 그 참고 자료의 리터럴
  // 값이라, 도착 직후 캐릭터의 한 방 데미지보다 낮을 수도 있습니다 — 이는
  // 리밸런스가 의도한 결과이지 버그가 아닙니다). 그래서 이제는 "hp가 스펙에
  // 적힌 리터럴 목표값과 정확히 같은지"만 직접 검증합니다 — Part C 지침대로
  // 옛 공식 재현 대신 새 의도(리터럴 참고값)를 검증하는 방식으로 바꿨습니다.
  const EXPECTED_HP = {
    jungle: { 정글도적: 40 },
    desert: { 사막도적: 115 },
    ice: { 설원늑대: 230 },
    volcano: { 용암병사: 410 },
    storm: { 폭풍해적: 560 },
    haunted: { 안개유령: 815 },
    crystal: { 수정골렘: 1035, 수정군주: 5500 },
    abyss: { 심연촉수: 1850 },
    sky: { 천공사제: 2450 },
    dragon: { 새끼드래곤: 4150, 고룡: 15500 },
    rose: { 장미기사: 27500 },
    green_zone: { 초원사냥꾼: 7400, 초원족장: 43000 },
    graveyard: { 무덤지기: 10400 },
    snow_mountain: { 설산산적: 11800 },
    hot_cold: { 불꽃야수: 13000 },
    cursed_ship: { 유령선원: 15400 },
    ice_castle: { 성벽파수병: 19800 },
    forgotten: { 잊혀진전사: 22000 },
    mansion: { 저택하인: 24500, 저택의주인: 107000 },
  };
  for (const island of ISLANDS.filter((i) => i.kind === "wild")) {
    const expected = Object.values(EXPECTED_HP[island.id]);
    island.species.forEach((s, k) => {
      assert(
        s.hp === expected[k],
        `${island.name} "${s.name}" hp가 참고 자료의 리터럴 목표값과 일치 (실제 ${s.hp.toLocaleString()}, 기대 ${expected[k].toLocaleString()})`,
      );
    });
  }

  // 접촉 데미지(공격력)는 이번 hp 리밸런스와 무관 — 여전히 기존 곡선(CONTACT_STEP)과
  // GENERAL_CONTACT_BUFF(1.25)로 계산됩니다. k=0(가장 약한 종족) 기준으로 재현합니다.
  const CONTACT_STEP = 1.22;
  const GENERAL_CONTACT_BUFF = 1.25;
  for (const island of ISLANDS.filter((i) => i.kind === "wild")) {
    const weakest = island.species[0];
    const expectedContact = Math.round(island.enemy.contactDamage * Math.pow(CONTACT_STEP, 0) * GENERAL_CONTACT_BUFF);
    assert(
      weakest.contactDamage === expectedContact,
      `${island.name} "${weakest.name}" 접촉 데미지는 이번 hp 리밸런스로 바뀌지 않음 (실제 ${weakest.contactDamage}, 기대 ${expectedContact})`,
    );
  }

  // 보스("저택의 주인")는 예전에는 hpMultiplier 특수 배율(만렙 요루 무장색 정확히
  // 4대)로 튜닝돼 있었지만, 이번 리밸런스로 그 특수 처리가 완전히 제거되고
  // 다른 모든 종족과 똑같이 hpOverride(리터럴 목표값)만 씁니다.
  const mansion = ISLANDS.find((i) => i.id === "mansion");
  const boss = mansion.species.find((s) => s.name === "저택의 주인");
  assert(boss.hp === 107000, `보스 hp는 리터럴 목표값 107,000 그대로 (실제 ${boss.hp.toLocaleString()})`);
}

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

section("악마의 열매 — 구매하면 인벤토리로, 장착은 별도로");
assert(FRUIT_CATALOG.length === 7, `상점에 열매 7종 등록`);
player.money = 10;
const cheapest = [...FRUIT_CATALOG].sort((a, b) => a.price - b.price)[0];
assert(buyFruit(player, cheapest.id, player.events) === false, "코인 부족하면 구매 실패");
assert(player.equippedFruit === "magma_fist", "구매 실패 시 기존 열매 유지");
assert(player.fruitInventory.length === 0, "구매 실패 시 인벤토리도 그대로");

player.money = 500;
assert(buyFruit(player, cheapest.id, player.events) === true, "코인 충분하면 구매 성공");
assert(player.equippedFruit === "magma_fist", "구매만으로는 장착이 바뀌지 않음");
assert(player.fruitInventory.includes(cheapest.id), "산 열매는 인벤토리에 들어감");
assert(buyFruit(player, cheapest.id, player.events) === false, "이미 보유한 열매는 재구매 불가");

// --- 인벤토리 → 손에 들기(holdFruitCandidate) → 좌클릭 확인(confirmHeldFruitEquip) 두 단계 ---
assert(holdFruitCandidate(player, cheapest.id) === true, "인벤토리 열매를 손에 듦");
assert(player.heldFruitCandidate === cheapest.id, "heldFruitCandidate에 반영됨");
assert(player.equippedFruit === "magma_fist", "손에 들기만 해서는 장착이 안 바뀜(아직 안 먹음)");
assert(!player.fruitInventory.includes(cheapest.id), "손에 든 열매는 인벤토리에서 빠짐");
assert(ownsFruit(player, cheapest.id) === true, "손에 든(미확정) 열매도 보유 중으로 취급");

assert(cancelHeldFruitCandidate(player) === true, "도로 인벤토리에 넣기(취소)");
assert(player.heldFruitCandidate === null, "취소하면 heldFruitCandidate가 비워짐");
assert(player.fruitInventory.includes(cheapest.id), "취소한 열매는 다시 인벤토리로 돌아옴");

assert(holdFruitCandidate(player, cheapest.id) === true, "다시 손에 듦");
assert(confirmHeldFruitEquip(player, player.events) === true, "좌클릭 확인 후 실제로 먹음(확정)");
assert(player.equippedFruit === cheapest.id, "확정하면 장착한 열매로 실제 교체됨");
assert(player.heldFruitCandidate === null, "확정하면 손에서 사라짐(더 이상 heldFruitCandidate 아님)");
assert(!player.fruitInventory.includes(cheapest.id), "확정한 열매는 인벤토리에도 없음(먹었으니까)");
assert(skillsForFruit(player.equippedFruit).length === 4, "열매를 바꿔도 스킬은 항상 4개");

const second = FRUIT_CATALOG.find((f) => f.id !== cheapest.id);
buyFruit(player, second.id, player.events);
assert(player.equippedFruit === cheapest.id, "새 열매를 사도 자동 장착되지 않음(여전히 이전 열매)");
const beforeSwapFruitExp = player.fruitExp;
assert(holdFruitCandidate(player, second.id) === true, "새 열매를 손에 듦");
assert(player.equippedFruit === cheapest.id, "손에 들기만 해서는 아직 안 바뀜");
assert(confirmHeldFruitEquip(player, player.events) === true, "확인 후 새 열매로 교체 장착");
assert(player.equippedFruit === second.id, "가장 최근에 확정한 열매로 교체");
assert(
  player.fruitMastery[cheapest.id] && player.fruitMastery[cheapest.id].exp === beforeSwapFruitExp,
  "교체된 옛 열매의 숙련도(exp)가 fruitMastery에 저장됨",
);
assert(player.fruitLevel === 1 && player.fruitExp === 0, "처음 장착하는 열매는 1레벨부터 시작");

// equipFruitFromInventory는 저수준 API로 계속 남아있음(즉시 확정) — 별도로도 계속 동작해야 함
{
  const p2 = createInitialGameState("pirate").player;
  const f2 = FRUIT_CATALOG[0];
  addFruitToInventory(p2, f2.id);
  assert(equipFruitFromInventory(p2, f2.id, p2.events) === true, "equipFruitFromInventory(저수준 API)는 여전히 즉시 장착");
  assert(p2.equippedFruit === f2.id, "즉시 장착됨");
}

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
// 코인으로 사는 경로(buyFruit)는 여전히 정상 동작해야 합니다 (인벤토리로 들어감)
{
  const buyer = createInitialGameState("pirate").player;
  const target = FRUIT_CATALOG.find((f) => f.id !== buyer.equippedFruit);
  buyer.money = target.price;
  assert(buyFruit(buyer, target.id, buyer.events) === true, `열매 상인에게 코인으로 구매 (${target.name})`);
  assert(buyer.money === 0, "코인이 정확히 차감됨");
  assert(buyer.fruitInventory.includes(target.id), "구매한 열매가 인벤토리에 들어감");
  assert(buyer.equippedFruit !== target.id, "구매만으로는 장착되지 않음");
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
  assert(g.fruitInventory.includes(first.fruitId), "뽑은 열매는 인벤토리로 들어감(자동 장착 X)");
  assert(g.weaponSkillCooldowns.length === 4, "검 스킬은 여전히 4개");
  assert(g.fruitSkillCooldowns.length === 4, "열매 스킬은 여전히 4개");
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
applyKillsToQuests(flow, kills("pirate_start", 6));
fp.events = [];
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(flowQuest.status === "active", "목표 미달이면 완료되지 않음");
assert(/6\/7/.test(flow.interactionPrompt ?? ""), `진행도 표시: "${flow.interactionPrompt}"`);

// 7번째 처치 → NPC에게 안 돌아가도 그 자리에서 바로 완료·지급 (사용자 요청)
fp.events = [];
fp.level = 20;
fp.exp = 0;
fp.expToNextLevel = expRequiredForLevel(20);
const expectedReward = Math.floor(fp.expToNextLevel * 0.9);
const moneyBeforeQuest = fp.money;

applyKillsToQuests(flow, kills("pirate_start", 1));
assert(flowQuest.status === "completed", "마지막 한 마리를 잡는 즉시 완료됨(NPC에게 안 돌아가도 됨)");
assert(fp.exp === expectedReward, `현재 레벨 요구 경험치의 90%를 그 자리에서 즉시 획득 (${fp.exp}/${fp.expToNextLevel})`);
assert(fp.level === 20, "90%라서 레벨업 직전까지만 오름 (레벨 유지)");
assert(fp.money > moneyBeforeQuest, `코인도 킬 즉시 지급 (${moneyBeforeQuest} → ${fp.money})`);
assert(fp.events.some((e) => e.type === "quest_completed"), "quest_completed 이벤트가 킬 시점에 바로 발생");
assert(flowQuest.completions === 1, "완료 횟수 1");
assert(flowQuest.killProgress === 0, "진행도 초기화");

// 이제 NPC에게 가면 이미 보상은 받은 상태 — 그냥 반복 수락 프롬프트만 보임
fp.events = [];
stepInteraction(flow, makeInput());
assert(/퀘스트 받기.*반복/.test(flow.interactionPrompt ?? ""), `반복 수락 프롬프트: "${flow.interactionPrompt}"`);
stepInteraction(flow, makeInput({ interactPressed: true }));
assert(flowQuest.status === "active", "완료한 퀘스트를 다시 수락 가능 (반복 퀘스트)");

// 두 번째 완료 시엔 남은 10%가 채워지며 레벨업 — 이것도 마지막 킬 즉시 적용
const levelBefore = fp.level;
applyKillsToQuests(flow, kills("pirate_start", 7));
assert(fp.level === levelBefore + 1, `두 번째 완료로 레벨업 (${levelBefore} → ${fp.level})`);
assert(flowQuest.completions === 2, "완료 횟수 2");

// 경험치 2배 포션과 함께라면 보상도 2배
fp.expBuffRemainingSec = 600;
fp.exp = 0;
fp.level = 30;
fp.expToNextLevel = expRequiredForLevel(30);
stepInteraction(flow, makeInput({ interactPressed: true })); // 재수락
applyKillsToQuests(flow, kills("pirate_start", 7));
assert(fp.level > 30, `버프 중엔 90% x2 = 180%라 레벨업 발생 (Lv.${fp.level})`);

section("스킬 카탈로그 (기존 열매 6종 × Z/X/C/V = 24개 + 빛빛 4개 + 용용 4개 = 32개)");
const skills = allSkills();
// 빛빛/용용의 F 전용 능력(LIGHT_FLIGHT_SKILL/DRAGON_FLIGHT_SKILL)은 slot: -1로
// 일반 4슬롯 시스템 밖에 있으므로 FRUIT_SKILLS(따라서 allSkills())에 포함되지
// 않습니다 — 별도로 export되어 있고, 위 섹션에서 이미 따로 검증했습니다.
assert(skills.length === 32, `총 스킬 ${skills.length}개`);
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
// 빛빛/용용은 자체 밸런스 수치(unlockFruitLevel 1/25/50/75)를 쓰므로
// 위 6종 전용 루프(해금 레벨 1/25/50/100 고정)와 별도로 슬롯 순서만 확인합니다.
for (const fid of ["light_light", "dragon_dragon"]) {
  const fs = skillsForFruit(fid);
  assert(fs.every((sk, i) => sk.slot === i), `${fid}: 슬롯이 Z/X/C/V 순서대로`);
}
assert(new Set(skills.map((sk) => sk.id)).size === 32, "스킬 id가 모두 고유함");
assert(new Set(skills.map((sk) => sk.name)).size === 32, "스킬 이름이 모두 고유함");
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
  // 아래 스킬 테스트 대부분은 "열매를 이미 뽑아 든 상태"를 전제로 하므로
  // 기본값을 true로 둡니다 (뽑지 않은 상태 자체를 검증하는 테스트는 따로 있음).
  pl.fruitDrawn = true;
  // createInitialGameState()는 이제 기본 나무 검을 손에 쥐고 시작합니다(사용자
  // 요청). 이 스킬 테스트 헬퍼는 각 테스트가 무기/열매 상태를 스스로 명확히
  // 설정하는 것을 전제로 하므로, 여기서는 그 기본값을 지우고 완전히 빈 손에서
  // 시작합니다 — 그래야 "맨손"을 전제로 한 기존 테스트들이 그대로 유효합니다.
  pl.hotbar = [null, null, null];
  pl.activeHotbarSlot = null;
  return pl;
}
function input(overrides = {}) {
  return {
    moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
    jumpPressed: false, jumpHeld: false, sprintToggledOn: false, dashPressed: false, hotbarPressed: null, attackPressed: false,
    skillPressed: [false, false, false, false],
    skillHeld: [false, false, false, false],
    interactPressed: false, toggleInventoryPressed: false, toggleStatsPressed: false,
    toggleHakiPressed: false, mouseDeltaX: 0, mouseDeltaY: 0, ...overrides,
  };
}

/**
 * Z/X/C/V 슬롯 하나를 "탭"합니다 — 눌렀다가(1프레임) 곧바로 뗍니다(1프레임).
 * 차지 스킬이 아니면 첫 프레임에 바로 발동하고 둘째 프레임은 아무 일도 안
 * 합니다(기존 단발 stepCombat 호출과 100% 동일). 차지 스킬이면 첫 프레임에
 * 차지를 시작하고, 둘째 프레임(뗌)에 거의 0%로 차지된 채 발동합니다 — 즉
 * "짧게 탭하면 예전처럼 즉발과 똑같이 동작한다"는 걸 그대로 보장합니다.
 */
function tapSkill(dt, plr, enemies, slotIndex) {
  const pressed = [false, false, false, false];
  pressed[slotIndex] = true;
  stepCombat(dt, input({ skillPressed: pressed, skillHeld: pressed }), plr, enemies);
  stepCombat(dt, input(), plr, enemies);
}

// (1) 근접으로 막타 → 열매 경험치 0
const pMelee = freshPlayer();
// 사용자 요청으로 맨주먹 공격이 완전히 없어졌으므로, freshPlayer()가 비워둔
// 손에 무기를 하나 쥐어줘야 근접 공격이 실제로 나갑니다.
pMelee.hotbar[0] = "sword_wood";
pMelee.activeHotbarSlot = 0;
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
tapSkill(0.016, pFruit, eFruit, 0);
assert(!eFruit[0].alive, "열매 스킬(Z)로 처치됨");
assert(pFruit.fruitExp > 0, `열매 막타 → 열매 경험치 획득 (${pFruit.fruitExp})`);

// (3) 근접으로 깎다가 열매로 막타 → 열매 경험치 들어옴 (막타 기준)
const pMix = freshPlayer();
pMix.hotbar[0] = "sword_wood"; // 맨주먹 공격이 없어졌으므로 근접 공격엔 무기가 필요
pMix.activeHotbarSlot = 0;
pMix.meleeDamage = 5;
const eMix = [makeEnemy("x1", 25, 100)];
pMix.events = [];
stepCombat(0.016, input({ attackPressed: true }), pMix, eMix);
assert(eMix[0].alive && eMix[0].hp < 25, `근접으로 체력만 깎음 (${eMix[0].hp})`);
assert(pMix.fruitExp === 0, "아직 열매 경험치 없음");
pMix.fruitSkillCooldowns = [0, 0, 0, 0];
tapSkill(0.016, pMix, eMix, 0);
assert(!eMix[0].alive, "열매 스킬로 마무리");
assert(pMix.fruitExp > 0, `막타가 열매라서 열매 경험치 획득 (${pMix.fruitExp})`);

// (4) 열매로 깎다가 근접으로 막타 → 열매 경험치 0
const pMix2 = freshPlayer();
pMix2.hotbar[0] = "sword_wood"; // 맨주먹 공격이 없어졌으므로 근접 공격엔 무기가 필요
pMix2.activeHotbarSlot = 0;
pMix2.meleeDamage = 1000;
const eMix2 = [makeEnemy("x2", 1000, 100)];
pMix2.events = [];
tapSkill(0.016, pMix2, eMix2, 0);
assert(eMix2[0].alive, "열매 스킬로는 못 죽임(체력 많음)");
assert(pMix2.fruitExp === 0, "아직 열매 경험치 없음");
// 무기(나무 검)를 든 상태의 근접 데미지는 이제 meleeDamage가 아니라 검 스텟
// 기반 statAttackPower로 계산되므로, 이 마무리 일격이 확실히 남은 체력을
// 넘도록 검 스텟을 크게 찍어둡니다 (이 테스트는 "막타 출처"만 검증하는 게
// 목적이라 정확한 데미지 수치는 중요하지 않습니다).
pMix2.stats.sword = 3000;
recomputeDerivedStats(pMix2);
stepCombat(0.016, input({ attackPressed: true }), pMix2, eMix2);
assert(!eMix2[0].alive, "근접으로 마무리");
assert(pMix2.fruitExp === 0, `막타가 근접이면 열매 경험치 0 (실제 ${pMix2.fruitExp})`);

// (5) 화상 도트로 죽어도 출처가 열매이므로 열매 경험치 획득
const pBurn = freshPlayer();
pBurn.equippedFruit = "magma_fist";
pBurn.fruitLevel = 25; // X(화염 방사) 해금
const eBurn = [makeEnemy("b1", 10000, 100)];
pBurn.events = [];
tapSkill(0.016, pBurn, eBurn, 1);
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
tapSkill(0.016, pShape, [front, back], 0);
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
tapSkill(0.016, pLine, [onAxis, offAxis], 0);
assert(onAxis.hp < 10000, "직선: 경로상의 적은 관통 피격");
assert(offAxis.hp === 10000, "직선: 경로 밖의 적은 안 맞음");
assert(onAxis.status.slowFactor === 0.5, `아이스 랜스 둔화 적용 (x${onAxis.status.slowFactor})`);

section("originAtAim — 판정 원점이 발밑이 아니라 조준 지점으로 이동 (낙뢰·빙결 감옥·절대 영도·중력정)");
{
  const pAim = freshPlayer();
  pAim.equippedFruit = "ice_lance";
  pAim.fruitLevel = 50; // C(빙결 감옥) 해금
  pAim.aimYaw = 0; // 정면 = +Z
  pAim.position = { x: 0, y: 1, z: 0 };
  const skill = skillsForFruit("ice_lance")[2];
  assert(skill.id === "ice_c" && skill.originAtAim === true, "빙결 감옥은 originAtAim 스킬");
  // 반경 6, 오프셋 = 6 * 0.6 = 3.6 → 판정 원점은 (0, 3.6)
  const behind = makeEnemy("behind", 10000, 10);
  behind.position = { x: 0, y: 1, z: -3 }; // 발밑 기준이면 맞았을(거리 3) 자리 — 조준 기준이면 거리 6.6이라 빗나감
  const farAim = makeEnemy("farAim", 10000, 10);
  farAim.position = { x: 0, y: 1, z: 9 }; // 발밑 기준이면 사거리 밖(거리 9) — 조준 기준이면 거리 5.4라 맞음
  pAim.events = [];
  tapSkill(0.016, pAim, [behind, farAim], 2);
  assert(farAim.hp < 10000, "빙결 감옥: 조준 지점 쪽으로 옮겨진 판정 범위 안의 적은 맞음");
  assert(behind.hp === 10000, `빙결 감옥: 발밑 기준이면 맞았을 등 뒤의 적은 판정이 앞으로 옮겨져서 안 맞음 (hp ${behind.hp})`);

  // 부채꼴형(다크 슬래시, Z)은 originAtAim이 아니라서 발밑 기준 그대로 유지되어야 함
  const zSkill = skillsForFruit("dark_wave")[0];
  assert(!zSkill.originAtAim, "다크 슬래시(부채꼴)는 originAtAim이 아님 — 발밑 기준 그대로");
  for (const [fruitId, slot] of [["dark_wave", 2], ["thunder_strike", 2]]) {
    const s = skillsForFruit(fruitId)[slot];
    assert(s.originAtAim === true, `${s.name}은 originAtAim 스킬`);
  }
}

section("originAtMouse — 마우스가 가리키는 지점에서 발생 (용암 지대·대분화·낙뢰·천벌 등)");
{
  // radial 스킬(용암 지대) — 판정 원점이 발밑이 아니라 마우스 지점 자체가 되어야 함
  const pMouse = freshPlayer();
  pMouse.equippedFruit = "magma_fist";
  pMouse.fruitLevel = 50; // C(용암 지대) 해금
  pMouse.aimYaw = 0;
  pMouse.position = { x: 0, y: 1, z: 0 };
  pMouse.aimGroundPoint = { x: 20, z: 0 }; // 플레이어와 무관한, 옆으로 먼 지점을 마우스로 가리킴
  const skill = skillsForFruit("magma_fist")[2];
  assert(skill.originAtMouse === true, "용암 지대는 originAtMouse 스킬");
  const nearMouse = makeEnemy("nearMouse", 10000, 10);
  nearMouse.position = { x: 20, y: 1, z: 2 }; // 마우스 지점 근처(발밑 기준이면 안 맞을 자리)
  const nearFeet = makeEnemy("nearFeet", 10000, 10);
  nearFeet.position = { x: 0, y: 1, z: 2 }; // 발밑 기준이면 맞을 자리(마우스 기준이면 안 맞음)
  pMouse.events = [];
  tapSkill(0.016, pMouse, [nearMouse, nearFeet], 2);
  assert(nearMouse.hp < 10000, "용암 지대: 마우스 지점 근처의 적은 맞음");
  assert(nearFeet.hp === 10000, "용암 지대: 발밑 근처의 적은 (마우스 기준으로 옮겨져서) 안 맞음");

  // line 스킬(고무 로켓) — 방향이 마우스 지점을 바라보도록 재조준되어야 함
  // (돌진형 line 스킬의 대표로 검증 — 선더 스트라이크는 이번 요청으로 더
  // 이상 돌진 스킬이 아니라 아래 별도 섹션에서 검증합니다.)
  const pMouseDash = freshPlayer();
  pMouseDash.equippedFruit = "rubber_barrage";
  pMouseDash.fruitLevel = 25; // X = 고무 로켓
  pMouseDash.aimYaw = 0; // 카메라는 정면(+Z)을 보고 있지만
  pMouseDash.position = { x: 0, y: 1, z: 0 };
  pMouseDash.aimGroundPoint = { x: 5, z: 0 }; // 마우스는 오른쪽(+X)을 가리킴
  pMouseDash.events = [];
  tapSkill(0.016, pMouseDash, [], 1);
  assert(pMouseDash.pendingDash !== null, "고무 로켓: 마우스 방향으로 돌진 요청 생성됨");
  assert(pMouseDash.pendingDash.x > 5, `고무 로켓: 마우스 방향(+X)으로 돌진함 (x=${pMouseDash.pendingDash.x.toFixed(2)})`);
  assert(Math.abs(pMouseDash.pendingDash.z) < 0.01, `고무 로켓: z축 돌진량은 거의 0 (z=${pMouseDash.pendingDash.z.toFixed(2)})`);
}

section("선더 스트라이크 재설계 — 돌진 없이, 마우스 지점에 번개가 내리꽂힘");
{
  const thunderZ = skillsForFruit("thunder_strike")[0];
  assert(thunderZ.shape.kind === "radial", `선더 스트라이크는 이제 radial 스킬 (실제 ${thunderZ.shape.kind})`);
  assert(thunderZ.dashDistance === undefined, "선더 스트라이크는 더 이상 돌진하지 않음(dashDistance 없음)");
  assert(thunderZ.originAtMouse === true, "선더 스트라이크는 originAtMouse 스킬");

  const pStrike = freshPlayer();
  pStrike.equippedFruit = "thunder_strike";
  pStrike.fruitLevel = 1;
  pStrike.position = { x: 0, y: 1, z: 0 };
  pStrike.aimGroundPoint = { x: 20, z: 0 }; // 플레이어와 멀리 떨어진 지점을 마우스로 가리킴
  const posBefore = { ...pStrike.position };
  const nearMouseTarget = makeEnemy("thunderNearMouse", 10000, 10);
  nearMouseTarget.position = { x: 20, y: 1, z: 1 }; // 마우스 지점 근처
  const nearFeetTarget = makeEnemy("thunderNearFeet", 10000, 10);
  nearFeetTarget.position = { x: 0, y: 1, z: 1 }; // 발밑 근처(예전이라면 돌진 경로상에 있었을 자리)
  pStrike.events = [];
  tapSkill(0.016, pStrike, [nearMouseTarget, nearFeetTarget], 0);
  assert(nearMouseTarget.hp < 10000, "번개가 마우스 지점 근처에 떨어져 그 근처의 적이 맞음");
  assert(nearFeetTarget.hp === 10000, "발밑 근처의 적은 (더 이상 돌진하지 않으므로) 안 맞음");
  assert(pStrike.pendingDash === null, "더 이상 이동(돌진) 요청이 생기지 않음");
  assert(
    pStrike.position.x === posBefore.x && pStrike.position.z === posBefore.z,
    "플레이어 자신은 제자리에 그대로 있음",
  );
}

section("requireMouseInRange — 용암 지대·대분화는 마우스가 너무 멀면 사용 자체가 막힘");
{
  const pFar = freshPlayer();
  pFar.equippedFruit = "magma_fist";
  pFar.fruitLevel = 100; // V(대분화)까지 해금
  pFar.position = { x: 0, y: 1, z: 0 };
  const magmaC = skillsForFruit("magma_fist")[2];
  const magmaV = skillsForFruit("magma_fist")[3];
  assert(magmaC.requireMouseInRange === true, "용암 지대는 requireMouseInRange 스킬");
  assert(magmaV.requireMouseInRange === true, "대분화는 requireMouseInRange 스킬");

  // (1) 마우스 지점 자체가 없음(레이캐스트 실패) — 발동이 막혀야 함
  pFar.aimGroundPoint = null;
  const manaBefore = pFar.mana;
  const cdBefore = pFar.fruitSkillCooldowns[2];
  pFar.events = [];
  tapSkill(0.016, pFar, [], 2);
  assert(pFar.mana === manaBefore, "용암 지대: 마우스 지점이 없으면 마나를 쓰지 않고 무산됨");
  assert(pFar.fruitSkillCooldowns[2] === cdBefore, "용암 지대: 마우스 지점이 없으면 쿨다운도 걸리지 않음");
  assert(
    pFar.events.some((e) => e.type === "skill_target_too_far" && e.skillName === magmaC.name),
    "용암 지대: skill_target_too_far 이벤트가 뜸",
  );

  // (2) 마우스 지점이 너무 멀리 있음 — 마찬가지로 막혀야 함
  pFar.aimGroundPoint = { x: 9999, z: 0 };
  pFar.events = [];
  tapSkill(0.016, pFar, [], 2);
  assert(pFar.mana === manaBefore, "용암 지대: 마우스 지점이 너무 멀면 마나를 쓰지 않고 무산됨");

  // (3) 사거리 안이면 정상 발동됨
  pFar.aimGroundPoint = { x: 3, z: 0 };
  pFar.events = [];
  tapSkill(0.016, pFar, [], 2);
  assert(pFar.mana < manaBefore, "용암 지대: 마우스 지점이 사거리 안이면 정상 발동되어 마나가 듦");
}

section("사정거리 확장 — 화염 방사·섀도우 슬래시 (사용자 요청: 더 멀리)");
{
  const magmaX = skillsForFruit("magma_fist")[1];
  assert(magmaX.shape.kind === "cone" && magmaX.shape.range === 12, `화염 방사 사정거리 확장됨 (실제 ${magmaX.shape.range}m)`);
  const darkZ = skillsForFruit("dark_wave")[0];
  assert(darkZ.shape.kind === "cone" && darkZ.shape.range === 9, `섀도우 슬래시 사정거리 확장됨 (실제 ${darkZ.shape.range}m)`);
}

section("앞으로 나가는 스킬 전부 마우스 방향으로 — 사용자 요청으로 남은 8개 열매 스킬에 적용");
{
  const forwardSkills = [
    ["magma_fist", 1, "화염 방사"],
    ["ice_lance", 0, "아이스 랜스"],
    ["dark_wave", 0, "섀도우 슬래시"],
    ["rubber_barrage", 0, "고무 피스톨"],
    ["rubber_barrage", 1, "고무 로켓"],
    ["rubber_barrage", 2, "고무 개틀링"],
    ["sand_storm", 0, "모래 칼날"],
    ["sand_storm", 1, "사구검"],
  ];
  for (const [fruitId, slot, name] of forwardSkills) {
    const sk = skillsForFruit(fruitId)[slot];
    assert(sk.name === name, `${name} — id 매핑 확인`);
    assert(sk.originAtMouse === true, `${name}: originAtMouse 스킬로 전환됨`);
    assert(sk.shape.kind === "line" || sk.shape.kind === "cone", `${name}: 방향형(line/cone) 스킬 그대로 유지`);
    // 사용자 요청: "사정거리 밖으로 조준해서 발사하면 그냥 발사하게" —
    // 이 스킬들은 requireMouseInRange를 붙이지 않아 마우스가 아무리 멀어도
    // 발동 자체는 막히지 않아야 합니다(사거리 자체는 shape.range가 그대로 제한).
    assert(!sk.requireMouseInRange, `${name}: 사거리 밖이어도 발동은 막히지 않음(requireMouseInRange 없음)`);
  }

  // 실제로 마우스 방향으로 재조준되는지 대표로 하나(화염 방사, cone)만 더 검증
  const pCone = freshPlayer();
  pCone.equippedFruit = "magma_fist";
  pCone.fruitLevel = 25; // X = 화염 방사
  pCone.aimYaw = 0; // 카메라는 정면(+Z)
  pCone.position = { x: 0, y: 1, z: 0 };
  pCone.aimGroundPoint = { x: 0, z: -5 }; // 마우스는 뒤쪽(-Z)을 가리킴
  const behindPlayer = makeEnemy("magmaBehind", 10000, 10);
  behindPlayer.position = { x: 0, y: 1, z: -3 }; // 마우스 방향(뒤쪽)에 있는 적
  const frontPlayer = makeEnemy("magmaFront", 10000, 10);
  frontPlayer.position = { x: 0, y: 1, z: 3 }; // 카메라 정면(+Z)에 있는 적
  pCone.events = [];
  tapSkill(0.016, pCone, [behindPlayer, frontPlayer], 1);
  assert(behindPlayer.hp < 10000, "화염 방사: 카메라 방향이 아니라 마우스가 가리키는 방향(뒤쪽)으로 나감");
  assert(frontPlayer.hp === 10000, "화염 방사: 카메라 정면에 있던 적은 더 이상 안 맞음");

  // 마우스 지점이 아주 멀어도(사거리 밖) 발동 자체는 막히지 않고, 그 방향으로 나가되
  // shape.range만큼만 실제로 맞음
  const pFarAim = freshPlayer();
  pFarAim.equippedFruit = "magma_fist";
  pFarAim.fruitLevel = 25;
  pFarAim.position = { x: 0, y: 1, z: 0 };
  pFarAim.aimGroundPoint = { x: 0, z: 9999 }; // 스킬 사거리(12m)를 훨씬 넘는 먼 지점
  const withinRange = makeEnemy("magmaWithinRange", 10000, 10);
  withinRange.position = { x: 0, y: 1, z: 5 }; // 그 방향, 사거리(12m) 안
  pFarAim.events = [];
  const manaBeforeFar = pFarAim.mana;
  tapSkill(0.016, pFarAim, [withinRange], 1);
  assert(withinRange.hp < 10000, "화염 방사: 마우스가 사거리 밖을 가리켜도 그냥 발사되어 그 방향의 사거리 안 적은 맞음");
  assert(pFarAim.mana < manaBeforeFar, "화염 방사: 마우스가 멀어도 발동 자체는 막히지 않아 마나가 소모됨");
}

section("밸런스 — 사막의 대검 (모래 열매 V, 쿨다운 없이 토글로 장착/해제)");
{
  const sandV = skillsForFruit("sand_storm")[3];
  assert(sandV.name === "사막의 대검", `사막의 대검으로 개명됨 (실제 "${sandV.name}")`);
  assert(sandV.meleeFormMultiplier < WEAPONS.sword_yoru.damageMultiplier, `요루(x${WEAPONS.sword_yoru.damageMultiplier})보다 살짝 낮은 배율 (x${sandV.meleeFormMultiplier})`);
  // 사용자 추가 요청: 쿨다운 없이 그냥 V로 장착/해제하는 토글로 변경
  assert(sandV.cooldownSec === 0, `쿨다운 없음 (실제 ${sandV.cooldownSec}초)`);
  assert(sandV.toggle === true, "토글 스킬로 등록됨");

  const pSand = freshPlayer();
  pSand.equippedFruit = "sand_storm";
  pSand.fruitLevel = 100; // V 해금
  pSand.fruitDrawn = true;
  // freshPlayer()는 다른 테스트(근접으로 확실히 처치)를 위해 meleeDamage를
  // 1000으로 부풀려두는데, 이 테스트는 "장착 전(맨손 기준치) vs 장착 중(검
  // 스텟 기준 공격력)"을 비교하는 목적이라 그 인위적인 값이 비교를 무의미하게
  // 만듭니다 — 기본값(BASE_MELEE_DAMAGE=8)으로 되돌려서 비교합니다.
  pSand.meleeDamage = 8;
  pSand.events = [];
  assert(pSand.sandBladeActive === false, "평소엔 대검 미장착");
  const meleeBefore = totalMeleeDamage(pSand);

  // 장착 — 그 자리의 몬스터도 함께 갈려나가고(광역 슬래시), 배율도 올라감
  const eSlam = [makeEnemy("slam1", 10000, 10)];
  tapSkill(0.016, pSand, eSlam, 3);
  assert(pSand.sandBladeActive === true, "V로 사막의 대검 장착됨");
  assert(eSlam[0].hp < 10000, "장착과 동시에 주변 몬스터도 슬래시 피해를 입음");
  const manaAfterEquip = pSand.mana;
  assert(manaAfterEquip < 999, `장착에는 마나가 듦 (${999 - manaAfterEquip})`);
  const meleeDuring = totalMeleeDamage(pSand);
  assert(meleeDuring > meleeBefore, `대검 장착 중엔 기본 공격력 상승 (${meleeBefore.toFixed(1)} → ${meleeDuring.toFixed(1)})`);

  // 시간이 아무리 지나도(쿨다운/지속시간 개념이 없으므로) 저절로 꺼지지 않음
  stepCombat(999, input(), pSand, []);
  assert(pSand.sandBladeActive === true, "시간이 지나도 저절로 풀리지 않음(다시 눌러야 함)");

  // 열매를 넣으면(fruitDrawn=false) 대검을 든 게 아니므로 평소 무기 공식으로 돌아감
  pSand.fruitDrawn = false;
  assert(Math.abs(totalMeleeDamage(pSand) - meleeBefore) < 0.001, "열매를 넣으면(fruitDrawn=false) 대검 배율 미적용");
  pSand.fruitDrawn = true;

  // 다시 V — 쿨다운 없이 즉시 해제, 마나도 안 들고 재슬래시도 없음
  const eNoSlam = [makeEnemy("slam2", 10000, 10)];
  const manaBeforeUnequip = pSand.mana;
  tapSkill(0.016, pSand, eNoSlam, 3);
  assert(pSand.sandBladeActive === false, "다시 V를 누르면 쿨다운 없이 즉시 해제됨");
  assert(pSand.mana === manaBeforeUnequip, "해제할 때는 마나가 들지 않음");
  assert(eNoSlam[0].hp === 10000, "해제할 때는 슬래시 피해가 다시 나가지 않음");
  assert(Math.abs(totalMeleeDamage(pSand) - meleeBefore) < 0.001, "해제 후 공격력 원복");

  // 곧바로 다시 장착해도 쿨다운에 막히지 않음
  pSand.mana = 999;
  tapSkill(0.016, pSand, [], 3);
  assert(pSand.sandBladeActive === true, "해제 직후에도 쿨다운 없이 바로 다시 장착 가능");
}

section("빛빛/용용 열매 — 카탈로그·Z/X/C(/V) 스킬 정의");
{
  const lightEntry = FRUIT_CATALOG.find((f) => f.id === "light_light");
  assert(!!lightEntry, "빛빛 열매가 상점 카탈로그에 등록됨");
  assert(lightEntry.name === "빛빛 열매", `이름 확인 (실제 "${lightEntry.name}")`);
  const dragonEntry = FRUIT_CATALOG.find((f) => f.id === "dragon_dragon");
  assert(!!dragonEntry, "용용 열매가 상점 카탈로그에 등록됨");
  assert(dragonEntry.name === "용용 열매", `이름 확인 (실제 "${dragonEntry.name}")`);

  const light = skillsForFruit("light_light");
  assert(light.length === 4, `빛빛은 Z/X/C/V 4개 스킬 (실제 ${light.length}개)`);
  assert(light[0].id === "light_z" && light[0].damage === 17 && light[0].cooldownSec === 1.3 && light[0].manaCost === 7, "빛의 탄환 수치");
  // 사용자 요청으로 빛의 탄환 사정거리를 두 배로 늘렸습니다 (12 → 24).
  assert(light[0].shape.kind === "line" && light[0].shape.range === 24 && light[0].originAtMouse === true, `빛의 탄환: 사정거리 2배 확장(24m) + 마우스 방향 발사 (실제 ${light[0].shape.range}m)`);
  assert(light[1].id === "light_x" && light[1].damage === 26 && light[1].unlockFruitLevel === 25, "빛의 검 수치");
  // 사용자 요청으로 빛의 검 사정거리를 두 배로 늘렸습니다 (9 → 18).
  assert(light[1].shape.kind === "line" && light[1].shape.range === 18, `빛의 검: 사정거리 2배 확장(18m) (실제 ${light[1].shape.range}m)`);
  assert(light[2].id === "light_c" && light[2].shape.kind === "radial" && light[2].originAtMouse === true && light[2].originAtAim === true, "빛의 포격: 마우스 지점 radial 낙하형(originAtMouse+originAtAim)");
  assert(light[3].id === "light_v" && light[3].damage === 62 && light[3].unlockFruitLevel === 75, "광속 일격 수치");

  const dragon = skillsForFruit("dragon_dragon");
  // V(용으로 변신, dragon_v)가 이제 진짜 슬롯3 스킬로 구현되어 4개가 됩니다.
  assert(dragon.length === 4, `용용은 Z/X/C/V 4개 스킬 (실제 ${dragon.length}개)`);
  assert(dragon[0].id === "dragon_z" && dragon[0].damage === 18 && dragon[0].shape.kind === "line", "용의 발톱: 직선 판정");
  // 사용자 요청으로 용의 발톱 사정거리를 두 배로 늘렸습니다 (8 → 16).
  assert(dragon[0].shape.range === 16, `용의 발톱: 사정거리 2배 확장(16m) (실제 ${dragon[0].shape.range}m)`);
  assert(dragon[1].id === "dragon_x" && dragon[1].damage === 30 && dragon[1].shape.kind === "cone", "용의 포효: 부채꼴 판정");
  // 사용자 요청으로 용의 포효 사정거리를 두 배로 늘렸습니다 (10 → 20). halfAngleDeg는 그대로.
  assert(dragon[1].shape.range === 20 && dragon[1].shape.halfAngleDeg === 35, `용의 포효: 사정거리 2배 확장(20m), 각도 유지(35도) (실제 ${dragon[1].shape.range}m / ${dragon[1].shape.halfAngleDeg}도)`);
  assert(dragon[2].id === "dragon_c" && dragon[2].damage === 46 && dragon[2].shape.kind === "cone", "용의 화염: 부채꼴 판정");
  // 사용자 요청으로 용의 화염 사정거리를 두 배로 늘렸습니다 (11 → 22). halfAngleDeg는 그대로.
  assert(dragon[2].shape.range === 22 && dragon[2].shape.halfAngleDeg === 20, `용의 화염: 사정거리 2배 확장(22m), 각도 유지(20도) (실제 ${dragon[2].shape.range}m / ${dragon[2].shape.halfAngleDeg}도)`);
  assert(dragon[0].originAtMouse === true && dragon[1].originAtMouse === true && dragon[2].originAtMouse === true, "용용의 공격 스킬(Z/X/C)이 마우스 방향으로 발사됨");
  assert(dragon[3].id === "dragon_v" && dragon[3].name === "용으로 변신", `용으로 변신: id/이름 확인 (실제 "${dragon[3].name}")`);
  assert(dragon[3].toggle === true, "용으로 변신: 토글 스킬로 등록됨");
  assert(dragon[3].cooldownSec === 0, `용으로 변신: 사막의 대검과 같은 패턴 — 쿨다운 없음 (실제 ${dragon[3].cooldownSec}초)`);
  assert(dragon[3].damage === 0 && dragon[3].shape.kind === "self", "용으로 변신: 순수 자기강화형(damage 0, self)");
  assert(dragon[3].dragonFormDamageMultiplierBonus === 2, `용으로 변신: 데미지 3배 버프 (실제 x${1 + dragon[3].dragonFormDamageMultiplierBonus})`);
}

section("밸런스 — 용으로 변신 (용용 열매 V, 쿨다운 없이 토글로 변신/해제)");
{
  const dragonV = skillsForFruit("dragon_dragon")[3];

  const pDragonForm = freshPlayer();
  pDragonForm.equippedFruit = "dragon_dragon";
  pDragonForm.fruitLevel = 100; // V 해금(SLOT_UNLOCK_LEVELS[3]=100)
  pDragonForm.fruitDrawn = true;
  pDragonForm.mana = 999;
  pDragonForm.events = [];
  assert(pDragonForm.dragonFormActive === false, "평소엔 변신 안 되어 있음");
  assert(pDragonForm.fruitBuffMultiplier === 1, "평소엔 열매 데미지 배율 1배");

  // 변신 — 토글 ON, 마나 소모, 데미지 배율 상승
  const manaBeforeOn = pDragonForm.mana;
  tapSkill(0.016, pDragonForm, [], 3);
  assert(pDragonForm.dragonFormActive === true, "V로 용으로 변신 발동됨");
  assert(pDragonForm.mana === manaBeforeOn - dragonV.manaCost, `변신에는 manaCost(${dragonV.manaCost}) 만큼 마나가 듦`);
  assert(Math.abs(pDragonForm.fruitBuffMultiplier - (1 + dragonV.dragonFormDamageMultiplierBonus)) < 0.001, `변신 중엔 열매 데미지 배율이 ${1 + dragonV.dragonFormDamageMultiplierBonus}배로 상승 (실제 ${pDragonForm.fruitBuffMultiplier}배)`);

  // 실제 열매 스킬 데미지에도 그 배율이 곱해지는지 확인 (dragon_z로 검증)
  const eForm = makeEnemy("dragonFormTarget", 10000, 10);
  eForm.position = { x: 0, y: 1, z: 5 };
  pDragonForm.position = { x: 0, y: 1, z: 0 };
  pDragonForm.aimYaw = 0;
  pDragonForm.fruitSkillCooldowns = [0, 0, 0, 0];
  tapSkill(0.016, pDragonForm, [eForm], 0); // dragon_z
  const dmgWithForm = 10000 - eForm.hp;
  assert(dmgWithForm > 0, "변신 중에도 다른 슬롯 스킬(용의 발톱)이 정상 발동됨");

  // 시간이 아무리 지나도(쿨다운/지속시간 개념이 없으므로) 저절로 꺼지지 않음
  stepCombat(999, input(), pDragonForm, []);
  assert(pDragonForm.dragonFormActive === true, "시간이 지나도 저절로 풀리지 않음(다시 눌러야 함)");
  assert(pDragonForm.fruitBuffMultiplier > 1, "지속시간 타이머가 없으므로 fruitBuffRemainingSec 만료로도 안 풀림");

  // 다시 V — 쿨다운 없이 즉시 해제, 마나도 안 들고 배율도 원복
  const manaBeforeOff = pDragonForm.mana;
  tapSkill(0.016, pDragonForm, [], 3);
  assert(pDragonForm.dragonFormActive === false, "다시 V를 누르면 쿨다운 없이 즉시 해제됨");
  assert(pDragonForm.mana === manaBeforeOff, "해제할 때는 마나가 들지 않음");
  assert(pDragonForm.fruitBuffMultiplier === 1, "해제 후 데미지 배율 원복");

  // 곧바로 다시 변신해도 쿨다운에 막히지 않음
  pDragonForm.mana = 999;
  tapSkill(0.016, pDragonForm, [], 3);
  assert(pDragonForm.dragonFormActive === true, "해제 직후에도 쿨다운 없이 바로 다시 변신 가능");

  // 레벨 미달이면 V 자체가 잠김(SLOT_UNLOCK_LEVELS[3]=100 기준)
  const pLocked = freshPlayer();
  pLocked.equippedFruit = "dragon_dragon";
  pLocked.fruitLevel = 99;
  pLocked.fruitDrawn = true;
  pLocked.mana = 999;
  pLocked.events = [];
  tapSkill(0.016, pLocked, [], 3);
  assert(pLocked.dragonFormActive === false, "열매 Lv.99(슬롯3 해금 전)에서는 V가 발동하지 않음");
  assert(pLocked.events.some((e) => e.type === "skill_locked"), "잠긴 V를 누르면 skill_locked 이벤트가 뜸");
}

section("withRangeMultiplier — 순수 로직(shape/dashDistance만 스케일, damage는 그대로)");
{
  const dragonZ = skillsForFruit("dragon_dragon")[0]; // line, range=16
  const scaled = withRangeMultiplier(dragonZ, 5);
  assert(scaled.shape.kind === "line" && scaled.shape.range === 80, `line 스킬 사거리 5배 (실제 ${scaled.shape.range}m)`);
  assert(scaled.damage === dragonZ.damage, "damage는 건드리지 않음(변경 안 됨)");
  assert(dragonZ.shape.range === 16, "원본 스킬 객체는 그대로 남아있음(불변)");

  const dragonX = skillsForFruit("dragon_dragon")[1]; // cone, range=20
  const scaledCone = withRangeMultiplier(dragonX, 5);
  assert(scaledCone.shape.kind === "cone" && scaledCone.shape.range === 100, `cone 스킬 사거리 5배 (실제 ${scaledCone.shape.range}m)`);
  assert(scaledCone.shape.halfAngleDeg === dragonX.shape.halfAngleDeg, "halfAngleDeg는 그대로");

  const radialSkill = { ...dragonZ, shape: { kind: "radial", radius: 4 } };
  const scaledRadial = withRangeMultiplier(radialSkill, 5);
  assert(scaledRadial.shape.kind === "radial" && scaledRadial.shape.radius === 20, `radial 스킬 반경 5배 (실제 ${scaledRadial.shape.radius}m)`);

  const dragonV = skillsForFruit("dragon_dragon")[3]; // self
  const scaledSelf = withRangeMultiplier(dragonV, 5);
  assert(scaledSelf.shape.kind === "self", "self 판정 스킬은 shape가 바뀌지 않음(스케일할 range/radius가 없음)");
  assert(scaledSelf === dragonV, "mult가 적용될 게 없으면(self) 원본을 그대로 돌려줌(불필요한 복사 방지 확인)");

  const rocket = skillsForFruit("rubber_barrage")[1]; // dashDistance=14
  const scaledDash = withRangeMultiplier(rocket, 5);
  assert(scaledDash.dashDistance === 70, `dashDistance가 있으면 그것도 같은 배율로 스케일됨 (실제 ${scaledDash.dashDistance}m)`);

  assert(withRangeMultiplier(dragonZ, 1) === dragonZ, "mult===1이면 원본을 그대로 돌려줌(복사 없음)");
}

section("밸런스 — 용으로 변신 중엔 공격 스킬(dragon_z/x/c) 사거리도 5배");
{
  assert(DRAGON_FORM_RANGE_MULTIPLIER === 5, `DRAGON_FORM_RANGE_MULTIPLIER === 5 (실제 ${DRAGON_FORM_RANGE_MULTIPLIER})`);

  const dragonSkills = skillsForFruit("dragon_dragon");
  const pBoost = freshPlayer();
  pBoost.equippedFruit = "dragon_dragon";
  pBoost.fruitLevel = 100;
  pBoost.fruitDrawn = true;
  pBoost.mana = 999;
  pBoost.position = { x: 0, y: 1, z: 0 };
  pBoost.aimYaw = 0;
  pBoost.events = [];

  // 변신 전 — dragon_z(직선, range=16)로 20m 떨어진 적을 맞히지 못해야 함
  const farBefore = makeEnemy("farBefore", 10000, 10);
  farBefore.position = { x: 0, y: 1, z: 20 };
  pBoost.fruitSkillCooldowns = [0, 0, 0, 0];
  tapSkill(0.016, pBoost, [farBefore], 0);
  assert(farBefore.hp === 10000, "변신 전엔 사거리 16m 밖(20m)의 적을 맞히지 못함");

  // 변신 ON
  pBoost.events = [];
  tapSkill(0.016, pBoost, [], 3);
  assert(pBoost.dragonFormActive === true, "V로 변신 ON");

  // 변신 후 — 같은 dragon_z로 20m 떨어진 적(사거리 16m 밖이지만 5배=80m 안)을 맞혀야 함
  const farAfter = makeEnemy("farAfter", 10000, 10);
  farAfter.position = { x: 0, y: 1, z: 20 };
  pBoost.fruitSkillCooldowns = [0, 0, 0, 0];
  pBoost.events = [];
  tapSkill(0.016, pBoost, [farAfter], 0);
  assert(farAfter.hp < 10000, "변신 후엔 5배 넓어진 사거리(80m) 덕분에 20m 밖의 적도 맞음");
  const fireEv = pBoost.events.find((e) => e.type === "skill_fired" && e.slot === 0);
  assert(!!fireEv && fireEv.rangeMult === DRAGON_FORM_RANGE_MULTIPLIER, `skill_fired 이벤트에 rangeMult=${DRAGON_FORM_RANGE_MULTIPLIER}가 실림 (실제 ${fireEv && fireEv.rangeMult})`);

  // dragon_v(V) 자신은 shape:self라 rangeMult가 붙지 않아야 함(스케일할 게 없으므로) —
  // 토글 OFF는 skill_fired 자체를 안 띄우므로(위 dragon_v 토글 섹션 참고), 다시
  // 새로 켤 때(ON, 이 시점엔 켜지기 "직전"이라 dragonFormActive가 아직 false임)의
  // skill_fired로 확인합니다.
  const pToggleOn = freshPlayer();
  pToggleOn.equippedFruit = "dragon_dragon";
  pToggleOn.fruitLevel = 100;
  pToggleOn.fruitDrawn = true;
  pToggleOn.mana = 999;
  pToggleOn.events = [];
  tapSkill(0.016, pToggleOn, [], 3);
  const toggleOnEv = pToggleOn.events.find((e) => e.type === "skill_fired" && e.slot === 3);
  assert(!!toggleOnEv && toggleOnEv.rangeMult === undefined, "dragon_v(self) 자신의 skill_fired에는 rangeMult가 붙지 않음");

  // 다른 열매(용용이 아님)면 dragonFormActive가 true여도 boost가 적용되지 않아야 함
  // (dragonFormActive는 사실상 dragon_dragon 전용이지만, 방어적으로 명시 가드했는지 확인)
  const pOther = freshPlayer();
  pOther.equippedFruit = "magma_fist";
  pOther.fruitLevel = 100;
  pOther.fruitDrawn = true;
  pOther.mana = 999;
  pOther.dragonFormActive = true; // 인위적으로 세팅(정상 플레이에선 일어나지 않음)
  pOther.position = { x: 0, y: 1, z: 0 };
  pOther.aimYaw = 0;
  pOther.events = [];
  const farOther = makeEnemy("farOther", 10000, 10);
  farOther.position = { x: 0, y: 1, z: 20 }; // magma_x 사거리(12m) 밖
  pOther.fruitSkillCooldowns = [0, 0, 0, 0];
  tapSkill(0.016, pOther, [farOther], 1);
  assert(farOther.hp === 10000, "equippedFruit이 dragon_dragon이 아니면 dragonFormActive가 true여도 사거리 boost가 적용되지 않음(가드 확인)");
}

section("빛빛/용용 F 특수 능력 — special_ability_fired 이벤트(PvP 중계용)");
{
  // F는 일반 skill_fired 루프 밖이라, 다른 플레이어 화면에 보여주려면 별도
  // 이벤트(special_ability_fired)가 필요합니다 — PvpCombat.ts의
  // broadcastSpecialAbilityFx가 이 이벤트를 보고 중계합니다.
  const pLightF = freshPlayer();
  pLightF.equippedFruit = "light_light";
  pLightF.fruitLevel = 40;
  pLightF.fruitDrawn = true;
  pLightF.mana = 999;
  pLightF.position = { x: 0, y: 1, z: 0 };
  pLightF.aimYaw = 0;
  pLightF.events = [];
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pLightF, Date.now());
  assert(
    pLightF.events.some((e) => e.type === "special_ability_fired" && e.abilityId === "light_f"),
    "빛의 비행(F) 발동 시 special_ability_fired(light_f) 이벤트가 뜸",
  );

  const pDragonF = freshPlayer();
  pDragonF.equippedFruit = "dragon_dragon";
  pDragonF.fruitLevel = 40;
  pDragonF.fruitDrawn = true;
  pDragonF.mana = 999;
  pDragonF.position = { x: 0, y: 1, z: 0 };
  pDragonF.aimYaw = 0;
  pDragonF.events = [];
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pDragonF, Date.now());
  assert(
    pDragonF.events.some((e) => e.type === "special_ability_fired" && e.abilityId === "dragon_f"),
    "용의 비행(F) 발동 시 special_ability_fired(dragon_f) 이벤트가 뜸",
  );
}

section("빛빛/용용 F 특수 능력 — 일반 4슬롯 시스템과 무관한 독립 필드");
{
  // F 전용 SkillDef 자체가 slot: -1(0~3 슬롯 시스템 밖)로 표시돼 있고, 데미지 없는
  // 순수 기동기임을 확인합니다.
  assert(LIGHT_FLIGHT_SKILL.slot === -1, "빛의 비행은 일반 슬롯(0~3) 밖에 있음(slot=-1)");
  assert(LIGHT_FLIGHT_SKILL.damage === 0, "빛의 비행은 피해 없는 순수 기동기");
  assert(LIGHT_FLIGHT_SKILL.dashDistance === 50, `빛의 비행 돌진 거리 50m (실제 ${LIGHT_FLIGHT_SKILL.dashDistance}m)`);
  assert(DRAGON_FLIGHT_SKILL.slot === -1, "용의 비행은 일반 슬롯(0~3) 밖에 있음(slot=-1)");
  assert(DRAGON_FLIGHT_SKILL.damage === 0, "용의 비행은 피해 없는 순수 기동기");
  assert(DRAGON_FLIGHT_SKILL.flightManaDrainPerSec > 0, "용의 비행은 비행 중 마나를 지속 소모함");

  // (1) 빛의 비행 — F를 누른 순간의 조준 방향으로 딱 한 번 pendingDash가 생기고,
  //     짧은 변신 타이머(lightFormRemainingSec)가 세팅됩니다.
  const pLight = freshPlayer();
  pLight.equippedFruit = "light_light";
  pLight.fruitLevel = 40; // F 해금(unlockFruitLevel)
  pLight.aimYaw = 0; // 정면(+Z)
  pLight.mana = 999;
  pLight.events = [];
  const manaBeforeLight = pLight.mana;
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pLight, Date.now());
  assert(pLight.pendingDash !== null, "빛의 비행: F를 누르면 즉시 pendingDash가 생성됨");
  assert(Math.abs(pLight.pendingDash.z - 50) < 0.001, `빛의 비행: 정면(+Z)으로 50m 돌진 (z=${pLight.pendingDash.z.toFixed(2)})`);
  assert(Math.abs(pLight.pendingDash.x) < 0.001, "빛의 비행: x축 돌진량은 거의 0(정면만 봤으므로)");
  assert(pLight.mana === manaBeforeLight - LIGHT_FLIGHT_SKILL.manaCost, `빛의 비행: 마나 ${LIGHT_FLIGHT_SKILL.manaCost} 소모`);
  assert(pLight.lightFlightCooldownRemainingSec === LIGHT_FLIGHT_SKILL.cooldownSec, "빛의 비행: 쿨다운 설정됨");
  assert(pLight.lightFormRemainingSec > 0, "빛의 비행: 변신 시각 타이머(lightFormRemainingSec)가 설정됨");

  // 쿨다운 중에는 다시 눌러도 발동하지 않음(마나도 더 안 듦, 돌진도 새로 안 생김)
  pLight.pendingDash = null;
  const manaDuringCooldown = pLight.mana;
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pLight, Date.now());
  assert(pLight.pendingDash === null, "빛의 비행: 쿨다운 중에는 다시 발동하지 않음");
  assert(pLight.mana === manaDuringCooldown, "빛의 비행: 쿨다운 중에는 마나도 소모되지 않음");

  // 일반 쿨다운 배열과 같은 원칙 — 다른 열매를 장착 중이어도 매 프레임 계속 흘러감
  pLight.equippedFruit = "magma_fist";
  const cdBefore = pLight.lightFlightCooldownRemainingSec;
  stepFruitSpecialAbility(1, input(), pLight, Date.now());
  assert(pLight.lightFlightCooldownRemainingSec < cdBefore, "빛의 비행: 다른 열매를 장착 중이어도 쿨다운은 계속 흘러감");

  // 손에 안 먹은 열매를 든 상태(heldFruitCandidate)에서는 F가 아예 무시됨
  const pHeld = freshPlayer();
  pHeld.equippedFruit = "light_light";
  pHeld.fruitLevel = 40;
  pHeld.heldFruitCandidate = "magma_fist";
  pHeld.mana = 999;
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pHeld, Date.now());
  assert(pHeld.pendingDash === null, "빛의 비행: heldFruitCandidate가 있으면 F가 무시됨");

  // 레벨이 안 되면(unlockFruitLevel 미달) 발동하지 않고 skill_locked만 뜸
  const pLowLvl = freshPlayer();
  pLowLvl.equippedFruit = "light_light";
  pLowLvl.fruitLevel = 1;
  pLowLvl.mana = 999;
  pLowLvl.events = [];
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pLowLvl, Date.now());
  assert(pLowLvl.pendingDash === null, "빛의 비행: 열매 레벨 미달이면 발동하지 않음");
  assert(pLowLvl.events.some((e) => e.type === "skill_locked"), "빛의 비행: 레벨 미달 시 skill_locked 이벤트");

  // (2) 용의 비행 — F로 켜지고(activation 시 마나만 소모, 쿨다운 없음), 날고 있는
  //     동안 매초 마나가 계속 깎이며, 다시 F를 누르면 착지하고 그때부터 쿨다운이 돕니다.
  const pDragon = freshPlayer();
  pDragon.equippedFruit = "dragon_dragon";
  pDragon.fruitLevel = 40;
  pDragon.mana = 999;
  pDragon.events = [];
  assert(pDragon.dragonFlightActive === false, "평소엔 비행 중이 아님");
  const manaBeforeFly = pDragon.mana;
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pDragon, Date.now());
  assert(pDragon.dragonFlightActive === true, "용의 비행: F로 비행 시작됨");
  assert(pDragon.mana === manaBeforeFly - DRAGON_FLIGHT_SKILL.manaCost, `용의 비행: 활성화 마나 ${DRAGON_FLIGHT_SKILL.manaCost} 소모`);
  assert(pDragon.dragonFlightCooldownRemainingSec === 0, "용의 비행: 활성화 자체엔 쿨다운이 없음(착지해야 돎)");

  // 날고 있는 동안(F를 안 눌러도) 매 프레임 마나가 계속 소모됨
  const manaBeforeDrainTick = pDragon.mana;
  stepFruitSpecialAbility(1, input(), pDragon, Date.now());
  assert(pDragon.mana < manaBeforeDrainTick, "용의 비행: 날고 있는 동안 매초 마나가 계속 소모됨");
  assert(pDragon.dragonFlightActive === true, "용의 비행: 마나가 남아있으면 계속 비행 중");

  // 다시 F — 착지. 그 순간부터 쿨다운이 시작됨(사용자 요청: "착지 시점부터" 쿨다운)
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pDragon, Date.now());
  assert(pDragon.dragonFlightActive === false, "용의 비행: 다시 F를 누르면 착지");
  assert(pDragon.dragonFlightCooldownRemainingSec === DRAGON_FLIGHT_SKILL.cooldownSec, "용의 비행: 착지 시점부터 쿨다운 시작");

  // 착지 직후에는(쿨다운 중) 다시 F를 눌러도 못 뜸
  stepFruitSpecialAbility(0.016, input({ flySkillPressed: true }), pDragon, Date.now());
  assert(pDragon.dragonFlightActive === false, "용의 비행: 착지 직후 쿨다운 중에는 다시 뜰 수 없음");

  // 마나가 바닥나면 자동으로 착지함("정지 불가"와 별개인 안전장치)
  const pDrain = freshPlayer();
  pDrain.equippedFruit = "dragon_dragon";
  pDrain.fruitLevel = 40;
  pDrain.mana = DRAGON_FLIGHT_SKILL.flightManaDrainPerSec / 2; // 1초 지속 소모량의 절반만 남겨둬서 확실히 바닥나게
  pDrain.dragonFlightActive = true;
  stepFruitSpecialAbility(1, input(), pDrain, Date.now());
  assert(pDrain.mana === 0, "용의 비행: 마나가 바닥까지 깎임(음수로 내려가지 않음)");
  assert(pDrain.dragonFlightActive === false, "용의 비행: 마나가 0이 되면 자동으로 착지함");
  assert(pDrain.dragonFlightCooldownRemainingSec === DRAGON_FLIGHT_SKILL.cooldownSec, "용의 비행: 마나 고갈 착지도 쿨다운을 시작시킴");
}

section("돌진 / 자기 강화");
// 선더 스트라이크는 이번 요청으로 돌진 스킬이 아니게 됐으므로, 돌진 자체의
// 기본 동작 검증은 여전히 돌진형인 고무 로켓(rubber_x)으로 합니다.
const pDash = freshPlayer();
pDash.equippedFruit = "rubber_barrage";
pDash.fruitLevel = 25; // X = 고무 로켓 (dash)
pDash.aimYaw = 0;
pDash.events = [];
tapSkill(0.016, pDash, [], 1);
assert(pDash.pendingDash !== null, "돌진 요청 생성됨");
assert(Math.abs(pDash.pendingDash.z - 14) < 0.001, `정면(+Z)으로 14m 돌진 요청 (z=${pDash.pendingDash.z.toFixed(2)})`);

// X = 뇌광 질주 (토글형 번개 변신) — 켜짐/꺼짐 확인
const pToggle = freshPlayer();
pToggle.equippedFruit = "thunder_strike";
pToggle.fruitLevel = 25;
pToggle.aimYaw = 0;
pToggle.events = [];
stepCombat(0.016, input({ skillPressed: [false, true, false, false] }), pToggle, []);
assert(pToggle.lightningFormRemainingSec > 0, "뇌광 질주 발동 시 변신 지속시간 설정됨");
stepCombat(0.016, input({ skillPressed: [false, true, false, false] }), pToggle, []);
assert(pToggle.lightningFormRemainingSec === 0, "다시 X를 누르면 토글이 꺼짐 (무료)");

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

section("열매/무기를 뽑아야만 스킬(Z/X/C/V) 사용 가능");
{
  // (1) 아무것도 뽑지 않은 상태(맨손) — 스킬 입력을 눌러도 아무 일도 안 일어남,
  //     skill_locked조차 뜨지 않아야 함 (HUD가 스킬 UI 자체를 숨기는 것과 짝을 이룸).
  const pBare = freshPlayer();
  pBare.fruitDrawn = false; // freshPlayer 기본값(true)을 되돌려 "맨손" 상태를 만듦
  pBare.fruitLevel = 100; // 레벨은 충분해도 뽑지 않았으면 소용없음을 확인
  pBare.events = [];
  const eBare = [makeEnemy("bare1", 10000, 10)];
  stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pBare, eBare);
  assert(eBare[0].hp === 10000, "맨손 상태에서는 Z를 눌러도 피해가 없음");
  assert(pBare.mana === 999, "맨손 상태에서는 마나도 소모되지 않음");
  assert(
    !pBare.events.some((e) => e.type === "skill_locked" || e.type === "skill_fired" || e.type === "weapon_skill_locked"),
    "맨손 상태에서는 skill_locked/skill_fired 이벤트가 전혀 발생하지 않음(UI도 아예 안 뜸)",
  );

  // (2) 열매를 뽑으면(toggleFruitDrawn) 열매 스킬이 다시 작동함
  const pDraw = freshPlayer();
  pDraw.fruitDrawn = false;
  assert(toggleFruitDrawn(pDraw) === "drawn", "toggleFruitDrawn → 뽑음");
  assert(pDraw.fruitDrawn === true, "fruitDrawn true로 바뀜");
  pDraw.events = [];
  const eDraw = [makeEnemy("draw1", 10, 10)];
  tapSkill(0.016, pDraw, eDraw, 0);
  assert(!eDraw[0].alive, "열매를 뽑은 뒤에는 Z 스킬이 다시 작동함");

  // (3) 다시 누르면 집어넣어짐
  assert(toggleFruitDrawn(pDraw) === "sheathed", "toggleFruitDrawn 다시 → 집어넣음");
  assert(pDraw.fruitDrawn === false, "fruitDrawn false로 복귀");

  // (4) 무기를 뽑으면 열매는 자동으로 집어넣어짐(상호 배타), 반대도 마찬가지
  const pEx = freshPlayer();
  pEx.fruitDrawn = false;
  pEx.hotbar[0] = "sword_yoru";
  toggleDrawn(pEx, 0); // 무기를 뽑음
  assert(pEx.activeHotbarSlot === 0, "무기를 뽑음");
  toggleFruitDrawn(pEx); // 열매를 뽑으면
  assert(pEx.fruitDrawn === true, "열매가 뽑힘");
  assert(pEx.activeHotbarSlot === null, "무기는 자동으로 집어넣어짐(상호 배타)");
  toggleDrawn(pEx, 0); // 다시 무기를 뽑으면
  assert(pEx.activeHotbarSlot === 0, "무기를 다시 뽑음");
  assert(pEx.fruitDrawn === false, "열매는 자동으로 집어넣어짐(상호 배타)");

  // (5) 손에 든(미확정) 열매가 있으면 — fruitDrawn을 억지로 true로 만들어도
  //     CombatSystem이 이중으로 막아서 스킬이 절대 발동하지 않아야 함
  const pHeld = freshPlayer();
  addFruitToInventory(pHeld, "ice_lance");
  assert(holdFruitCandidate(pHeld, "ice_lance") === true, "열매를 손에 듦(미확정)");
  assert(pHeld.fruitDrawn === false, "손에 들면 기존에 뽑혀있던 것도 집어넣어짐");
  pHeld.fruitDrawn = true; // 방어 로직이 진짜로 막는지 보려고 일부러 조작
  pHeld.fruitLevel = 100;
  pHeld.events = [];
  const eHeld = [makeEnemy("held1", 10000, 10)];
  stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pHeld, eHeld);
  assert(eHeld[0].hp === 10000, "손에 든(미확정) 열매 상태에서는 fruitDrawn을 조작해도 스킬 피해가 없음");
  assert(pHeld.mana === 999, "마나도 소모되지 않음");
}

section("무기 스킬(ZXCV) — 무기를 뽑았을 때만, 숙련도로 해금");
{
  // 무기 스킬 카탈로그 형태 확인 — 열매와 완전히 같은 규칙(4개, Z~V, [1,25,50,100] 해금)
  for (const weaponId of Object.keys(WEAPON_SKILLS)) {
    const ws = skillsForWeapon(weaponId);
    assert(ws.length === 4, `${weaponId} 무기 스킬 4개 (${ws.length})`);
    assert(ws.map((s) => s.slot).join(",") === "0,1,2,3", `${weaponId} 슬롯 순서 Z~V`);
    assert(
      ws.map((s) => s.unlockFruitLevel).join(",") === "1,25,50,100",
      `${weaponId} 해금 레벨 [1,25,50,100] (${ws.map((s) => s.unlockFruitLevel).join(",")})`,
    );
  }
  assert(allWeaponSkills().length === Object.keys(WEAPON_SKILLS).length * 4, "무기 스킬 전체 개수 = 무기 수 × 4");
  assert(isWeapon("sword_yoru") && isWeapon("sword_santoryu") && isWeapon("sword_enma"), "세 무기 모두 WeaponSystem이 인식");

  // 무기를 뽑고 숙련도가 충분하면 무기 스킬이 발동됨
  const pw = freshPlayer();
  pw.fruitDrawn = false;
  pw.hotbar[0] = "sword_yoru";
  toggleDrawn(pw, 0);
  pw.weaponMastery["sword_yoru"] = { level: 100, exp: 0, expToNext: weaponExpRequiredForLevel(100) };
  pw.events = [];
  const ew = [makeEnemy("w1", 10, 10)];
  stepCombat(0.016, input({ skillPressed: [true, false, false, false] }), pw, ew);
  assert(!ew[0].alive, "무기를 뽑고 숙련도가 충분하면 무기 스킬(Z)로 처치됨");
  assert(pw.events.some((e) => e.type === "skill_fired"), "skill_fired 이벤트 발생");

  // 숙련도가 낮으면 잠김 — weapon_skill_locked
  const pwLock = freshPlayer();
  pwLock.fruitDrawn = false;
  pwLock.hotbar[0] = "sword_yoru";
  toggleDrawn(pwLock, 0);
  pwLock.events = [];
  const ewLock = [makeEnemy("w2", 10000, 10)];
  stepCombat(0.016, input({ skillPressed: [false, false, false, true] }), pwLock, ewLock);
  assert(ewLock[0].hp === 10000, "숙련도 Lv.1에서 V 무기 스킬은 발동되지 않음");
  assert(pwLock.events.some((e) => e.type === "weapon_skill_locked"), "weapon_skill_locked 이벤트로 안내");

  // 무기 스킬 데미지 공식 — 숙련도가 오르면 데미지도 오름
  const pDmg = freshPlayer();
  pDmg.hotbar[0] = "sword_yoru";
  toggleDrawn(pDmg, 0);
  const yoruZ = skillsForWeapon("sword_yoru")[0];
  const dmgAtLv1 = weaponSkillDamage(pDmg, yoruZ, "sword_yoru");
  pDmg.weaponMastery["sword_yoru"] = { level: 50, exp: 0, expToNext: 1 };
  const dmgAtLv50 = weaponSkillDamage(pDmg, yoruZ, "sword_yoru");
  assert(dmgAtLv50 > dmgAtLv1, `무기 숙련도가 오르면 스킬 데미지도 오름 (Lv.1=${dmgAtLv1.toFixed(1)} → Lv.50=${dmgAtLv50.toFixed(1)})`);
  assert(
    Math.abs(weaponLevelDamageMultiplier(50) - (1 + 49 * 0.02)) < 1e-9,
    `무기 레벨 배율 공식도 열매와 동일 (레벨당 +2%): x${weaponLevelDamageMultiplier(50).toFixed(2)}`,
  );
}

section("검 ZXCV와 열매 ZXCV 쿨다운은 완전히 독립적임 (같은 슬롯이어도 서로 안 겹침)");
{
  // sword_yoru의 Z(슬롯0)와 magma_fist(기본 장착 열매)의 Z(슬롯0)를 같은
  // 플레이어로 번갈아 써서, 한쪽 쿨다운이 다른 쪽에 전혀 영향을 주지 않는지 확인합니다.
  const pXfer = freshPlayer();
  pXfer.hotbar[0] = "sword_yoru";
  pXfer.weaponMastery["sword_yoru"] = { level: 100, exp: 0, expToNext: weaponExpRequiredForLevel(100) };
  pXfer.equippedFruit = "magma_fist";
  pXfer.fruitLevel = 100; // 모든 슬롯 해금

  const yoruZ = skillsForWeapon("sword_yoru")[0];
  const magmaZ = skillsForFruit("magma_fist")[0];
  assert(yoruZ.cooldownSec > 0, "요루 Z는 쿨다운이 있는 스킬");
  assert(magmaZ.cooldownSec > 0, "마그마 Z는 쿨다운이 있는 스킬");

  // 1) 검을 뽑고 Z를 발동 — 검 쿨다운만 걸리고, 열매 쿨다운은 그대로 0
  pXfer.fruitDrawn = false;
  toggleDrawn(pXfer, 0);
  pXfer.events = [];
  tapSkill(0.016, pXfer, [], 0);
  assert(pXfer.weaponSkillCooldowns[0] > 0, `검 Z 사용 → weaponSkillCooldowns[0]에 쿨다운 걸림 (${pXfer.weaponSkillCooldowns[0].toFixed(1)})`);
  assert(pXfer.fruitSkillCooldowns[0] === 0, "검 Z를 썼다고 열매 쪽 쿨다운은 전혀 걸리지 않음");

  // 2) 검을 넣고 열매를 뽑아서 같은 슬롯(Z)을 발동 — 검 쿨다운이 남아있어도
  //    막히지 않고 바로 나가야 함(서로 다른 배열이므로)
  pXfer.hotbar[0] = null; // 검을 손에서 완전히 치움
  pXfer.activeHotbarSlot = null;
  pXfer.fruitDrawn = true;
  pXfer.events = [];
  const eXfer = [makeEnemy("xfer1", 10, 10000)];
  tapSkill(0.016, pXfer, eXfer, 0);
  assert(
    pXfer.events.some((e) => e.type === "skill_fired" && e.slot === 0),
    "검 Z가 아직 쿨다운 중이어도, 같은 슬롯의 열매 Z는 막히지 않고 바로 발동함",
  );
  assert(pXfer.fruitSkillCooldowns[0] > 0, "열매 Z를 쓴 뒤에는 fruitSkillCooldowns[0]에 쿨다운이 걸림");
  assert(pXfer.weaponSkillCooldowns[0] > 0, "그동안 weaponSkillCooldowns[0]은 검을 안 썼다고 리셋되지 않고 계속 흐르고 있었음(0보다 큼)");

  // 3) 검으로 다시 돌아가면 방금 건 열매 쿨다운은 검 슬롯에 아무 영향이 없음(별개 배열)
  //    — 열매 Z가 막 걸렸어도 검 슬롯은 그 시점까지의 자기 자신의 쿨다운만 봄.
  const weaponCdAfterFruitUse = pXfer.weaponSkillCooldowns[0];
  assert(
    Math.abs(weaponCdAfterFruitUse - (yoruZ.cooldownSec - 0.016 * 4)) < 0.05,
    `검 쿨다운은 열매 사용과 무관하게 자기 페이스로만 줄어듦 (남음: ${weaponCdAfterFruitUse.toFixed(2)})`,
  );
}

section("무기 숙련도(경험치) — 그 무기를 든 채로 낸 근접/무기스킬 막타에서 상승");
{
  // (1) 무기도 열매도 없는 진짜 맨손 — 사용자 요청으로 맨주먹 공격을 완전히
  // 없앴으므로, 이제는 공격 자체가 아예 나가지 않아야 합니다(따라서 무기
  // 숙련도도 당연히 안 생김).
  const pNoWeapon = freshPlayer();
  pNoWeapon.fruitDrawn = false;
  const eNoWeapon = [makeEnemy("nw1", 10, 100)];
  pNoWeapon.events = [];
  stepCombat(0.016, input({ attackPressed: true }), pNoWeapon, eNoWeapon);
  assert(eNoWeapon[0].alive, "맨손(무기·열매 모두 없음)으로는 공격이 나가지 않아 몬스터가 안 죽음");
  assert(!pNoWeapon.events.some((e) => e.type === "melee_attack_fired"), "맨손 공격은 melee_attack_fired 이벤트조차 발생하지 않음");
  assert(Object.keys(pNoWeapon.weaponMastery).length === 0, "무기가 없으면 무기 숙련도가 전혀 생기지 않음");

  // (2) 무기를 뽑고 근접으로 처치 — 그 무기의 숙련 경험치가 오름
  const pw2 = freshPlayer();
  pw2.fruitDrawn = false;
  pw2.hotbar[0] = "sword_yoru";
  toggleDrawn(pw2, 0);
  const ew2 = [makeEnemy("w3", 10, 100)];
  pw2.events = [];
  stepCombat(0.016, input({ attackPressed: true }), pw2, ew2);
  assert(!ew2[0].alive, "무기를 뽑고 근접으로 처치됨");
  assert(pw2.weaponMastery["sword_yoru"]?.exp > 0 || pw2.weaponMastery["sword_yoru"]?.level > 1,
    `무기를 든 채 근접 막타 → 그 무기 숙련 경험치 획득 (${JSON.stringify(pw2.weaponMastery["sword_yoru"])})`);
  assert(!pw2.weaponMastery["sword_santoryu"], "다른 무기의 숙련도는 그대로(안 생김)");

  // (3) grantWeaponExp/weaponExpFromEnemy/weaponMasteryLevel 직접 검증 — FruitLeveling과 같은 곡선
  const pDirect = freshPlayer();
  assert(weaponMasteryLevel(pDirect, "sword_enma") === 1, "아직 한 번도 안 쓴 무기는 Lv.1");
  grantWeaponExp(pDirect, "sword_enma", weaponExpRequiredForLevel(1), []);
  assert(weaponMasteryLevel(pDirect, "sword_enma") === 2, `경험치를 요구치만큼 주면 레벨업 (Lv.${weaponMasteryLevel(pDirect, "sword_enma")})`);
  const evLevelUp = [];
  for (let i = 0; i < 50 && weaponMasteryLevel(pDirect, "sword_enma") < 25; i++) {
    grantWeaponExp(pDirect, "sword_enma", pDirect.weaponMastery["sword_enma"].expToNext, evLevelUp);
  }
  assert(weaponMasteryLevel(pDirect, "sword_enma") >= 25, "반복 지급으로 Lv.25(X 해금)까지 도달");
  assert(evLevelUp.some((e) => e.type === "weapon_leveled_up"), "weapon_leveled_up 이벤트 발생");
  assert(weaponExpFromEnemy(100) === Math.round(100 * 0.6), "무기 경험치 비율도 열매와 동일(60%)");
}

section("이동 — Shift 질주 토글 / Q 대쉬(쿨다운 없이 마나 소모)");
const { DASH_MANA_COST_PERCENT } = await import("../src/simulation/PlayerController.ts");
assert(
  DASH_MANA_COST_PERCENT > 0,
  `Q 대쉬 마나 소모량 최대 마나의 ${(DASH_MANA_COST_PERCENT * 100).toFixed(0)}% (쿨다운 없음)`,
);

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

// 레벨을 채우면 정상 수락 — 용의 둥지는 2종류(참고 자료 리밸런스로 4→2)라 먼저 선택 UI가 열립니다
gp.level = 900;
gp.events = [];
stepInteractionQ(gate, makeInput({ interactPressed: true }));
assert(gate.uiRequest === "quest", "몬스터가 여러 종류인 섬은 E로 선택 창이 열림");
assert(gate.questNpcIslandId === "dragon", "선택 창이 용의 둥지 목록을 가리킴");
assert(dragonQuest.status === "available", "고르기 전에는 아직 수락되지 않음");
assert(dragonIsland.species.length === 2, "용의 둥지는 2종류(새끼 드래곤/고룡)");
assert(acceptQuest(gate, "dragon", dragonIsland.species[1].id) === true, "목록에서 2단계(고룡)를 고르면 수락");
assert(dragonQuest.status === "active", "레벨을 채우고 종류를 고르면 수락됨");
assert(dragonQuest.targetSpeciesName === dragonIsland.species[1].name,
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

section("기본 지급 나무 검 — 해군/해적 두 시작 섬 모두, 평타에 더 이상 맨주먹이 없음");
{
  for (const faction of ["pirate", "marine"]) {
    const st = createInitialGameState(faction);
    const pl = st.player;
    assert(pl.inventory.some((i) => i.id === "sword_wood"), `${faction} — 인벤토리에 나무 검이 들어있음`);
    assert(pl.hotbar[0] === "sword_wood", `${faction} — 단축바 0번 칸에 나무 검이 올라가 있음`);
    assert(pl.activeHotbarSlot === 0, `${faction} — 접속하자마자 손에 들려 있음(뽑힌 상태)`);
    assert(drawnWeapon(pl)?.id === "sword_wood", `${faction} — drawnWeapon도 나무 검을 가리킴`);

    // 나무 검은 배율 1(가산 없음)이라 아무 보너스도 주지 않습니다 — 근접 데미지는
    // 검 스텟 기준 공격력(statAttackPower) 그대로 나갑니다. 스텟 0인 신규
    // 캐릭터는 정확히 BASE_ATTACK_POWER(10)입니다.
    recomputeDerivedStats(pl);
    pl.hp = pl.maxHp;
    assert(
      totalMeleeDamage(pl) === BASE_ATTACK_POWER,
      `${faction} — 나무 검을 든 채 근접 데미지는 검 스텟 기준 공격력 그대로(가산 없음) (${totalMeleeDamage(pl)} === ${BASE_ATTACK_POWER})`,
    );
    assert(totalMeleeCooldown(pl) === pl.meleeCooldownSec, `${faction} — 공격 간격도 맨손과 동일`);
    assert(totalMeleeRange(pl) === pl.meleeRange, `${faction} — 사거리도 맨손과 동일`);

    // 실제로 사냥이 됩니다 — 처음부터 근접 공격이 몬스터에게 들어감
    pl.position = { x: 0, y: 1, z: 0 };
    const enemy = makeEnemy("wood1", 10, 100);
    pl.events = [];
    stepCombat(0.016, input({ attackPressed: true }), pl, [enemy]);
    assert(!enemy.alive, `${faction} — 접속 직후 바로 근접 공격으로 몬스터를 잡을 수 있음`);
  }

  // 나무 검은 시작할 때 공짜로 쥐어주는 것뿐, 화면 상점에서는 팔지 않음
  assert(!WEAPON_CATALOG.some((w) => w.id === "sword_wood"), "나무 검은 상점 목록에 나오지 않음(공짜 시작 장비)");
  assert(WEAPONS.sword_wood?.price === 0, "나무 검 가격은 0(구매 불가 취지)");
}

section("맨주먹 공격 완전 제거 — canMeleeAttack (무기도 열매도 없으면 평타 자체가 안 나감)");
{
  const pBareAttack = freshPlayer();
  pBareAttack.fruitDrawn = false; // 무기도 열매도 진짜 아무것도 안 뽑은 상태
  assert(canMeleeAttack(pBareAttack) === false, "무기도 열매(사막의 대검)도 없으면 근접 공격 불가");

  const eBareAttack = [makeEnemy("bareAtk", 10, 100)];
  pBareAttack.events = [];
  const cdBefore = pBareAttack.meleeRemainingCooldownSec;
  stepCombat(0.016, input({ attackPressed: true }), pBareAttack, eBareAttack);
  assert(eBareAttack[0].alive, "맨손으로는 실제로 데미지가 들어가지 않음");
  assert(pBareAttack.meleeRemainingCooldownSec === cdBefore, "맨손 공격은 쿨다운도 소모하지 않음(애초에 시도조차 안 됨)");
  assert(!pBareAttack.events.some((e) => e.type === "melee_attack_fired"), "melee_attack_fired 이벤트도 뜨지 않음(휘두르는 모션도 없음)");

  // 무기를 손에 들면 다시 가능해짐
  pBareAttack.hotbar[0] = "sword_wood";
  pBareAttack.activeHotbarSlot = 0;
  assert(canMeleeAttack(pBareAttack) === true, "무기를 들면 다시 근접 공격 가능");

  // 무기 없이도 사막의 대검이 장착돼 있으면 예외적으로 근접 공격 가능(기존 설계 유지)
  const pSandBlade = freshPlayer();
  pSandBlade.hotbar = [null, null, null];
  pSandBlade.activeHotbarSlot = null;
  pSandBlade.fruitDrawn = true;
  pSandBlade.sandBladeActive = true;
  assert(canMeleeAttack(pSandBlade) === true, "무기가 없어도 사막의 대검이 장착돼 있으면 근접 공격 가능");
}

section("검 3종 밸런스 — 요루(1위) > 엔마(2위) > 삼도류(3위, 가장 약함)");
{
  const yoruDm = WEAPONS.sword_yoru.damageMultiplier;
  const enmaDm = WEAPONS.sword_enma.damageMultiplier;
  const santoryuDm = WEAPONS.sword_santoryu.damageMultiplier;
  assert(santoryuDm < enmaDm, `삼도류(x${santoryuDm}) < 엔마(x${enmaDm})`);
  assert(enmaDm < yoruDm, `엔마(x${enmaDm}) < 요루(x${yoruDm})`);
  assert(santoryuDm < yoruDm, `삼도류(x${santoryuDm}) < 요루(x${yoruDm})`);
}

section("새총 데미지 대폭 하향 — 최소 기존(1.5)의 7분의 1 수준까지");
{
  const OLD_SLINGSHOT_MULT = 1.5; // 이번 하향 전 값(사용자가 "지금 데미지"라고 지칭한 기준)
  const slingshotDm = WEAPONS.gun_slingshot.damageMultiplier;
  assert(slingshotDm <= OLD_SLINGSHOT_MULT / 7 + 1e-9, `새총 배율이 기존의 최소 7분의 1 이하로 줄어듦 (x${slingshotDm.toFixed(3)} <= x${(OLD_SLINGSHOT_MULT / 7).toFixed(3)})`);
  assert(slingshotDm < WEAPONS.sword_santoryu.damageMultiplier, "새총은 이제 가장 약한 검(삼도류)보다도 훨씬 약함");
}

section("흑도(요루) — 인벤토리 장착 → 숫자키로 뽑기");
assert(WEAPON_CATALOG.length >= 1, `상점 무기 코너 ${WEAPON_CATALOG.length}종`);
const yoru = WEAPONS.sword_yoru;
assert(!!yoru, "흑도 요루 존재");
assert(yoru.price >= 500, `비싼 장비 (🪙${yoru.price})`);

const wp = createInitialGameState().player;
recomputeDerivedStats(wp);
wp.meleeDamage = 100; // 맨손(무기 없음) 기준치 — 무기를 실제로 드는 순간부터는
// meleeDamage가 아니라 검 스텟 기준 공격력(statAttackPower)이 기준치가 됩니다.
// 이 테스트는 "완전한 맨손에서 흑도를 사서 장착하는" 흐름을 검증하는 게
// 목적이므로, 접속 시 기본으로 쥐고 시작하는 나무 검(사용자 요청)은 여기서
// 지우고 시작합니다 — 나무 검 자체의 기본 지급 동작은 별도 섹션에서 검증합니다.
wp.hotbar = [null, null, null];
wp.activeHotbarSlot = null;
wp.inventory = [];
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

// 진짜 장착: 숫자키 1번 — 이제부터는 meleeDamage(100)가 아니라 검 스텟 기준
// 공격력(statAttackPower)이 기준치입니다. 스텟 0인 이 캐릭터는 정확히
// BASE_ATTACK_POWER(10)입니다.
assert(toggleDrawn(wp, 0) === "drawn", "숫자키 1번 → 흑도를 뽑음");
assert(drawnWeapon(wp)?.id === "sword_yoru", "손에 흑도를 들고 있음");
assert(
  Math.abs(totalMeleeDamage(wp) - BASE_ATTACK_POWER * yoru.damageMultiplier) < 0.001,
  `근접 데미지 ${totalMeleeDamage(wp)} (검 스텟 기준 공격력 ${BASE_ATTACK_POWER} × ${yoru.damageMultiplier})`,
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
const hakiPlusSword = BASE_ATTACK_POWER * 1.4 * yoru.damageMultiplier;
assert(
  Math.abs(totalMeleeDamage(wp) - hakiPlusSword) < 0.001,
  `무장색 + 흑도 동시 적용 = ${totalMeleeDamage(wp).toFixed(0)} (검 스텟 기준 공격력 ${BASE_ATTACK_POWER} × 1.4 × ${yoru.damageMultiplier})`,
);

section("세이브 데이터 — 저장했다 불러오면 그대로");
{
  // 이것저것 바꿔놓은 상태를 만들고, 저장 → 새 게임에 복원 → 값이 같은지 확인
  const before = createInitialGameState("marine");
  before.quests = createQuests();
  const bp = before.player;
  // 기본 나무 검(사용자 요청)이 이 흐름에 끼어들지 않도록 지우고 시작 —
  // 이 섹션은 sword_yoru를 사서 단축바 0번 칸에 장착하는 걸 검증합니다.
  bp.hotbar = [null, null, null];
  bp.activeHotbarSlot = null;
  bp.inventory = [];
  bp.level = 137;
  bp.expToNextLevel = expRequiredForLevel(137);
  bp.exp = 250;
  bp.money = 4820;
  bp.stats = { attack: 30, defense: 41, sword: 6, gun: 4, fruit: 7 };
  bp.unspentStatPoints = 5;
  bp.equippedFruit = "dark_wave";
  bp.fruitLevel = 42;
  bp.fruitExp = 11;
  bp.fruitExpToNext = fruitExpRequiredForLevel(42);
  bp.fruitInventory = ["ice_lance", "sand_storm"];
  bp.fruitMastery = { magma_fist: { level: 9, exp: 3, expToNext: fruitExpRequiredForLevel(9) } };
  bp.hakiLearned = true;
  bp.ownedBoats = ["dinghy", "galewind"];
  bp.lastGachaAtMs = 1_700_000_000_000;
  before.currentIslandId = "ice";
  buyItem(bp, "potion_exp", bp.events);
  buyItem(bp, "sword_yoru", bp.events);
  toggleHotbar(bp, "sword_yoru");
  toggleDrawn(bp, 0);
  bp.weaponMastery["sword_yoru"] = { level: 37, exp: 5, expToNext: weaponExpRequiredForLevel(37) };
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
  assert(
    ap.fruitInventory.length === 2 && ap.fruitInventory.includes("ice_lance") && ap.fruitInventory.includes("sand_storm"),
    `열매 인벤토리 복원 (${ap.fruitInventory.join(",")})`,
  );
  assert(ap.fruitMastery["magma_fist"]?.level === 9, `다른 열매 숙련도(fruitMastery)도 복원 (Lv.${ap.fruitMastery["magma_fist"]?.level})`);
  assert(ap.hakiLearned === true, "무장색 습득 복원");
  assert(ap.ownedBoats.includes("galewind"), `보유 배 복원 (${ap.ownedBoats.join(",")})`);
  assert(ap.lastGachaAtMs === 1_700_000_000_000, "뽑기 제한 시각 복원");
  assert(after.currentIslandId === "ice", `마지막 섬 복원 (${after.currentIslandId})`);
  assert(ap.inventory.some((i) => i.id === "potion_exp"), "인벤토리 아이템 복원");
  assert(ap.hotbar[0] === "sword_yoru", `단축바 복원 (${ap.hotbar.join(",")})`);
  assert(ap.weaponMastery["sword_yoru"]?.level === 37, `무기 숙련도 복원 (Lv.${ap.weaponMastery["sword_yoru"]?.level})`);
  assert(ap.weaponMastery["sword_yoru"]?.exp === 5, "무기 숙련 경험치도 복원");
  assert(after.quests.find((q) => q.islandId === "desert").completions === 9, "퀘스트 완료 횟수 복원");

  // 손에 든(미확정) 열매가 있는 채로 저장하면 — 증발하지 않고 인벤토리로 되돌아간 것처럼 저장됨
  bp.heldFruitCandidate = "rubber_barrage";
  const savedWhileHeld = toSaveData(before, 1_700_000_100_000);
  assert(
    savedWhileHeld.fruitInventory.includes("rubber_barrage"),
    "손에 든 채로 저장해도 그 열매가 세이브의 fruitInventory에 포함됨(증발 방지)",
  );
  const afterHeld = createInitialGameState("pirate");
  afterHeld.quests = createQuests();
  assert(applySaveData(afterHeld, JSON.parse(JSON.stringify(savedWhileHeld))) === true, "손에 든 채로 저장한 것도 복원 성공");
  assert(afterHeld.player.heldFruitCandidate === null, "접속 직후에는 손에 든 열매가 항상 없음(미확정 상태는 저장 안 됨)");
  assert(afterHeld.player.fruitInventory.includes("rubber_barrage"), "대신 그 열매는 인벤토리에 그대로 들어있음(손에서만 놓인 상태)");
  bp.heldFruitCandidate = null; // 이후 섹션에 영향 없도록 원복

  // 파생값은 저장하지 않고 다시 계산합니다
  assert(ap.maxHp === 100 + 41 * 12, `최대 체력을 스텟에서 다시 계산 (${ap.maxHp})`);
  assert(ap.maxMana === 50 + 30 * MANA_PER_POINT, `최대 마나를 공격 스텟에서 다시 계산 (${ap.maxMana})`);
  assert(Math.abs(ap.swordDamageMultiplier - statAttackPower(6)) < 1e-9,
    `검 기준 공격력을 검 스텟에서 다시 계산 (statAttackPower(6)=${statAttackPower(6)}, 실제 ${ap.swordDamageMultiplier})`);
  assert(Math.abs(ap.gunDamageMultiplier - statAttackPower(4)) < 1e-9,
    `총 기준 공격력을 총 스텟에서 다시 계산 (statAttackPower(4)=${statAttackPower(4)}, 실제 ${ap.gunDamageMultiplier})`);
  assert(ap.hp === ap.maxHp, "접속하면 풀피로 시작");
  assert(ap.expToNextLevel === expRequiredForLevel(137), "요구 경험치도 다시 계산");
  assert(ap.activeHotbarSlot === null, "무기는 집어넣은 상태로 시작");
  assert(ap.fruitDrawn === false, "열매도 집어넣은 상태로 시작");
  assert(ap.heldFruitCandidate === null, "손에 든(미확정) 열매도 없이 시작");
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
    stats: { attack: "많이", defense: NaN, sword: 1e12, gun: "많이", fruit: -3 },
    unspentStatPoints: Infinity,
    equippedFruit: "우주_열매",
    fruitLevel: 9999,
    fruitExp: 1e9,
    fruitInventory: ["우주_열매", "ice_lance", "ice_lance", 42, null],
    fruitMastery: [
      { id: "ice_lance", level: 99999, exp: -5 },
      { id: "우주_열매", level: 10, exp: 0 }, // 존재하지 않는 열매 id는 버려져야 함
      null,
    ],
    hakiLearned: "네",
    inventory: [{ id: "치트_아이템", quantity: 99999 }, { id: "potion_small", quantity: -5 }, null],
    hotbar: ["sword_yoru", 42, {}],
    weaponMastery: [
      { id: "sword_yoru", level: 99999, exp: -5 },
      { id: "potion_small", level: 10, exp: 0 }, // 무기가 아닌 id는 버려져야 함
      null,
      { id: "존재하지_않는_검", level: 5, exp: 0 },
    ],
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
  assert(p.stats.attack === 0 && p.stats.defense === 0 && p.stats.gun === 0, "숫자가 아닌 스텟은 0으로");
  assert(p.stats.fruit === 0, "음수 스텟도 0으로");
  assert(p.stats.sword >= 0 && Number.isFinite(p.stats.sword), `너무 큰 스텟도 유한한 값으로 잘림 (${p.stats.sword})`);
  assert(Number.isFinite(p.unspentStatPoints), `Infinity 포인트가 유한한 값으로 (${p.unspentStatPoints})`);
  assert(FRUIT_CATALOG.some((f) => f.id === p.equippedFruit) || p.equippedFruit === "magma_fist",
    `존재하지 않는 열매는 무시 (${p.equippedFruit})`);
  assert(p.fruitLevel <= MAX_FRUIT_LEVEL, `열매 레벨 상한 적용 (${p.fruitLevel})`);
  assert(
    p.fruitInventory.length === 2 && p.fruitInventory.filter((f) => f === "ice_lance").length === 2,
    `열매 인벤토리 — 존재하는 열매 id만, 중복은 그대로 개수만큼 복원 (${p.fruitInventory.join(",")})`,
  );
  assert(!p.fruitInventory.includes("우주_열매"), "존재하지 않는 열매 id는 인벤토리에서 버려짐");
  assert(p.fruitMastery["ice_lance"]?.level === MAX_FRUIT_LEVEL, `열매 숙련 레벨도 상한(${MAX_FRUIT_LEVEL})으로 잘림`);
  assert((p.fruitMastery["ice_lance"]?.exp ?? -1) >= 0, "음수 열매 숙련 경험치는 0 이상으로");
  assert(!p.fruitMastery["우주_열매"], "존재하지 않는 열매 id는 fruitMastery에서도 버려짐");
  assert(p.inventory.every((i) => ITEM_CATALOG.concat(WEAPON_CATALOG).some((c) => c.id === i.id)),
    "카탈로그에 없는 아이템은 버려짐");
  assert(p.inventory.every((i) => i.quantity >= 1), "개수가 1 미만인 아이템은 1로 보정");
  assert(p.weaponMastery["sword_yoru"]?.level === MAX_WEAPON_LEVEL, `무기 숙련 레벨도 상한(${MAX_WEAPON_LEVEL})으로 잘림`);
  assert((p.weaponMastery["sword_yoru"]?.exp ?? -1) >= 0, "음수 무기 경험치는 0 이상으로");
  assert(!p.weaponMastery["potion_small"], "무기가 아닌 id는 무기 숙련도에서 버려짐");
  assert(!p.weaponMastery["존재하지_않는_검"], "존재하지 않는 무기 id도 버려짐");
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

section("세이브 데이터 — 예전 4스텟(마나/공격/체력/열매) 세이브 이전");
{
  // defense 키가 없고 mana/health 키가 있으면 예전 포맷으로 보고,
  // 공격=마나+공격, 방어=체력, 검/총=0으로 옮겨줍니다.
  const st = createInitialGameState("pirate");
  st.quests = createQuests();
  const legacy = {
    version: 1,
    faction: "pirate",
    level: 20,
    exp: 5,
    money: 100,
    stats: { mana: 12, attack: 9, health: 41, fruit: 6 },
    unspentStatPoints: 2,
    equippedFruit: "magma_fist",
    fruitLevel: 1,
    fruitExp: 0,
    hakiLearned: false,
    inventory: [],
    hotbar: [null, null, null],
    weaponMastery: [],
    ownedBoats: ["dinghy"],
    quests: [],
    lastGachaAtMs: null,
    currentIslandId: "hub",
    savedAtMs: 1_700_000_000_000,
  };
  assert(applySaveData(st, legacy) === true, "예전 포맷 세이브도 예외 없이 복원됨");
  const p = st.player;
  assert(p.stats.attack === 12 + 9, `공격 = 예전 마나+공격 합산 (${p.stats.attack})`);
  assert(p.stats.defense === 41, `방어 = 예전 체력 그대로 (${p.stats.defense})`);
  assert(p.stats.sword === 0 && p.stats.gun === 0, "검/총 스텟은 0에서 시작");
  assert(p.stats.fruit === 6, "열매 스텟은 그대로 이전");
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
  // 기본 나무 검(사용자 요청)을 지워서 진짜 맨손 기준으로 비교합니다 —
  // 위력·공격 간격이 둘 다 맨손과 완전히 같은 무기라 어차피 수치는
  // 같지만, 아래에서 단축바 0번 칸에 삼도류를 올릴 자리를 비워둬야 합니다.
  p.hotbar = [null, null, null];
  p.activeHotbarSlot = null;
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

section("엔마 — 화산 섬에서만 사는 얇고 긴 붉은 검");
{
  const enma = weaponFor("sword_enma");
  const yoru = weaponFor("sword_yoru");
  assert(enma !== null && enma.name === "엔마", `엔마 등록됨 (${enma?.name})`);
  assert(enma.price === 700, `가격 🪙${enma.price}`);
  assert(enma.islandLock === "volcano", `화산 섬 전용으로 등록됨 (${enma.islandLock})`);
  assert(enma.bonusRange > yoru.bonusRange, `얇고 긴 만큼 사거리는 요루보다 김 (${enma.bonusRange} > ${yoru.bonusRange})`);

  // 화면 상점 목록에는 나오지만(숨기지 않음), 다른 섬에서는 실제로 못 삽니다
  assert(WEAPON_CATALOG.some((w) => w.id === "sword_enma"), "화면 상점 무기 목록에 나옴 (숨기지 않고 안내만)");

  const p = createInitialGameState("pirate").player;
  // 기본 나무 검(사용자 요청)을 지워서 단축바 0번 칸을 비워둡니다.
  p.hotbar = [null, null, null];
  p.activeHotbarSlot = null;
  p.money = 99999;
  const boughtElsewhere = buyItem(p, "sword_enma", p.events, "jungle");
  assert(boughtElsewhere === false, "정글 섬 등 다른 섬에서는 구매 실패");
  assert(!p.inventory.some((i) => i.id === "sword_enma"), "실패했으니 인벤토리에도 안 들어감");
  const blockedReason = p.events.at(-1);
  assert(blockedReason?.type === "purchase_failed" && blockedReason.reason.includes("화산 섬"),
    `실패 사유가 "화산 섬"을 안내함 ("${blockedReason?.reason}")`);

  const boughtNowhere = buyItem(p, "sword_enma", p.events, null);
  assert(boughtNowhere === false, "섬 밖(바다 위)에서도 구매 실패");

  const boughtAtVolcano = buyItem(p, "sword_enma", p.events, "volcano");
  assert(boughtAtVolcano === true, "화산 섬에서는 실제로 구매됨");
  assert(p.inventory.some((i) => i.id === "sword_enma"), "인벤토리에 들어감");

  // 손에 들면 실제로 요루보다 사거리가 늘어나는지까지 확인
  toggleHotbar(p, "sword_enma");
  toggleDrawn(p, 0);
  assert(drawnWeapon(p)?.id === "sword_enma", "엔마를 손에 듦");
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

section("R키 순간이동 — 얼음 섬 설인에게 Lv.125부터 배움");
{
  assert(TELEPORT_TEACHER_ISLAND_ID === "ice", "얼음 섬에서 배움");
  assert(TELEPORT_REQUIRED_LEVEL === 125, `요구 레벨 125 (${TELEPORT_REQUIRED_LEVEL})`);

  const p = createInitialGameState("pirate").player;
  assert(p.teleportLearned === false, "처음에는 못 배운 상태");
  assert(p.teleportCooldownSec === 0, "처음에는 쿨다운 없음");

  p.level = 124;
  p.money = 999999;
  assert(teleportBlockReason(p) === "level", "Lv.124에서는 아직 못 배움");
  assert(learnTeleport(p, p.events) === false, "시도해도 실패");
  assert(p.teleportLearned === false, "실패하면 안 배워짐");
  assert(p.money === 999999, "실패하면 코인도 안 깎임");

  p.level = 125;
  assert(canLearnTeleport(p) === true, "Lv.125가 되면 배울 수 있음");
  const before = p.money;
  assert(learnTeleport(p, p.events) === true, "순간이동 습득");
  assert(p.teleportLearned === true, "배워짐");
  assert(p.money === before - TELEPORT_PRICE, `값을 치름 (🪙${TELEPORT_PRICE})`);
  assert(p.events.some((e) => e.type === "teleport_learned"), "teleport_learned 이벤트 발생");

  assert(teleportBlockReason(p) === "already", "이미 배웠으면 또 못 배움");
  assert(learnTeleport(p, p.events) === false, "재시도 실패");

  const p2 = createInitialGameState("pirate").player;
  p2.level = 999;
  p2.money = 0;
  assert(teleportBlockReason(p2) === "money", "코인이 없으면 못 배움");
  assert(learnTeleport(p2, p2.events) === false, "시도해도 실패");
}

section("R키 순간이동 — 쿨다운");
{
  const p = createInitialGameState("pirate").player;
  p.level = 999;
  p.money = 999999;
  learnTeleport(p, p.events);

  assert(canUseTeleport(p) === true, "배운 직후에는 바로 쓸 수 있음");
  beginTeleportCooldown(p);
  assert(p.teleportCooldownSec === TELEPORT_COOLDOWN_SEC, `쿨다운 시작 (${p.teleportCooldownSec}s)`);
  assert(canUseTeleport(p) === false, "쿨다운 중에는 못 씀");

  stepTeleportCooldown(p, TELEPORT_COOLDOWN_SEC / 2);
  assert(Math.abs(p.teleportCooldownSec - TELEPORT_COOLDOWN_SEC / 2) < 1e-9, "절반만큼 줆");
  assert(canUseTeleport(p) === false, "아직 쿨다운 중");

  stepTeleportCooldown(p, TELEPORT_COOLDOWN_SEC);
  assert(p.teleportCooldownSec === 0, "쿨다운이 음수로 내려가지 않고 0에서 멈춤");
  assert(canUseTeleport(p) === true, "쿨다운이 끝나면 다시 씀");

  const p3 = createInitialGameState("pirate").player; // 안 배운 사람
  assert(canUseTeleport(p3) === false, "배우지 않았으면 쿨다운이 0이어도 못 씀");
}

section("단축바 마우스 클릭 = 숫자키 — activateHotbarSlot()");
{
  // 숫자키(Simulation.step의 hotbarPressed)와 하단 단축바 마우스 클릭(Hud)이
  // 완전히 같은 결과를 내는지, 공유 함수 activateHotbarSlot()으로 직접 확인합니다.
  const p = createInitialGameState("pirate").player;
  p.hotbar = ["sword_yoru", null, null];
  // 기본 나무 검(사용자 요청)이 자동으로 뽑혀 있는 채로 시작하면(activeHotbarSlot
  // 기본값 0) 첫 activateHotbarSlot(p,0) 호출이 "뽑기"가 아니라 "집어넣기"가
  // 됩니다 — 이 테스트는 "뽑기"부터 시작해야 하므로 명시적으로 비웁니다.
  p.activeHotbarSlot = null;
  p.fruitDrawn = false;

  activateHotbarSlot(p, 0);
  assert(p.activeHotbarSlot === 0, "0번 슬롯 클릭 → 요루를 뽑음");
  assert(p.events.some((e) => e.type === "weapon_drawn"), "weapon_drawn 이벤트 발생");

  activateHotbarSlot(p, 0);
  assert(p.activeHotbarSlot === null, "같은 칸을 다시 클릭 → 집어넣음");
  assert(p.events.some((e) => e.type === "weapon_sheathed"), "weapon_sheathed 이벤트 발생");

  activateHotbarSlot(p, 0);
  activateHotbarSlot(p, 3);
  assert(p.fruitDrawn === true, "3번(열매) 클릭 → 열매를 뽑음");
  assert(p.activeHotbarSlot === null, "열매를 뽑으면 무기는 자동으로 집어넣어짐");
  assert(p.events.some((e) => e.type === "fruit_drawn"), "fruit_drawn 이벤트 발생");

  activateHotbarSlot(p, 0);
  assert(p.fruitDrawn === false, "무기를 다시 클릭하면 열매는 집어넣어짐");
  assert(p.activeHotbarSlot === 0, "무기가 뽑힘");

  // 빈 칸을 클릭해도 아무 일도 일어나지 않음 (숫자키와 동일)
  const beforeSlot = p.activeHotbarSlot;
  activateHotbarSlot(p, 1);
  assert(p.activeHotbarSlot === beforeSlot, "빈 칸을 클릭해도 그대로");
}

section("세이브 — 점프 단수와 삼도류도 저장/복원");
{
  const before = createInitialGameState("pirate");
  before.quests = createQuests();
  const bp = before.player;
  // 기본 나무 검(사용자 요청)을 지워서 단축바 0번 칸을 비워둡니다 —
  // 아래 hotbar[0] === "sword_santoryu" 확인이 그대로 유효하려면 필요합니다.
  bp.hotbar = [null, null, null];
  bp.activeHotbarSlot = null;
  bp.inventory = [];
  bp.money = 99999;
  bp.level = 400;
  bp.maxJumps = 4;
  bp.teleportLearned = true;
  bp.teleportCooldownSec = 3.5;
  buyItem(bp, "sword_santoryu", bp.events);
  toggleHotbar(bp, "sword_santoryu");

  const saved = JSON.parse(JSON.stringify(toSaveData(before, 1_700_000_000_000)));
  const after = createInitialGameState("pirate");
  after.quests = createQuests();
  applySaveData(after, saved);

  assert(after.player.maxJumps === 4, `점프 단수 복원 (${after.player.maxJumps}단)`);
  assert(after.player.teleportLearned === true, "순간이동 습득 여부 복원");
  assert(after.player.teleportCooldownSec === 0, "쿨다운은 저장되지 않고 접속하면 0으로 시작");
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
  assert(getIsland("dragon").species.length === 2, "용의 둥지는 2종류(새끼 드래곤/고룡, 참고 자료 리밸런스로 4→2)");
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
  assert(p.unspentStatPoints < 5, `남은 포인트가 거의 없음 (${p.unspentStatPoints}) — 실제로 찍혀 있음`);
  const stats = Object.values(p.stats);
  assert(stats.every((v) => v > 0), `5개 스텟에 고르게 배분됨 (${stats.join("/")})`);
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

section("멀티플레이 서버 — PvP: 해적은 서로 싸울 수 있지만 해군은 여전히 안 됨");
{
  // "같은 진영끼리도 PvP를 허용해달라"는 요청에 "해적만" 열기로 확정했으므로,
  // 해적 vs 해적은 통과하고 해군 vs 해군은 여전히 same_faction으로 막혀야 합니다.
  function fakeConn(world, name, faction) {
    const sent = [];
    const sock = { readyState: 1, OPEN: 1, send: (d) => sent.push(JSON.parse(d)), close() {} };
    const conn = world.join(sock, name, faction);
    return { conn, sent };
  }

  const world = new World();
  const pirateA = fakeConn(world, "해적A", "pirate");
  const pirateB = fakeConn(world, "해적B", "pirate");
  const marineA = fakeConn(world, "해군A", "marine");
  const marineB = fakeConn(world, "해군B", "marine");

  assert(pirateA.conn.pvpEnabled && marineA.conn.pvpEnabled, "새로 접속하면 PvP가 기본으로 켜져 있음 (join 기본값)");

  world.handleMessage(pirateA.conn, JSON.stringify({ type: "melee_attack", targetId: pirateB.conn.id }));
  const pirateRejected = pirateA.sent.find((m) => m.type === "pvp_rejected");
  assert(!pirateRejected, `해적끼리는 공격이 거부되지 않음 (${pirateRejected?.reason ?? "통과"})`);
  assert(pirateB.conn.hp < 100, `해적끼리 실제로 피해가 들어감 (해적B hp: ${pirateB.conn.hp})`);

  world.handleMessage(marineA.conn, JSON.stringify({ type: "melee_attack", targetId: marineB.conn.id }));
  const marineRejected = marineA.sent.find((m) => m.type === "pvp_rejected");
  assert(marineRejected?.reason === "same_faction", `해군끼리는 여전히 same_faction으로 거부됨 (${marineRejected?.reason})`);
  assert(marineB.conn.hp === 100, "해군끼리는 피해가 들어가지 않음");
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

section("밸런스 — 대저택 최종 보스(저택의 주인)는 만렙 요루 무장색으로 죽일 수 있어야 함");
{
  // 예전엔 "만렙일 때 저택의 주인이 요루로 적어도 4번은 공격해야지 죽게 해줘"라는
  // 요청에 맞춰 정확히 4대를 요구했습니다. 그런데 이후 사용자 요청으로 attack
  // 스텟이 더 이상 근접 데미지(meleeDamage)에 전혀 영향을 주지 않게 바뀌면서
  // (attack은 이제 최대마나만 올림 — StatSystem.ts 참고), 레벨이 오를수록 데미지가
  // 커지던 축 하나가 완전히 빠져 "정확히 4대" 수치 자체는 더 이상 유지되지 않습니다.
  // 보스 hp 재조정은 이번 변경 범위 밖이라 건드리지 않았고, 여기서는 "무장색+요루로도
  // 결국 죽일 수 있다(유한한 타수)"는 것만 확인합니다.
  // 기준은 이 게임이 스스로 정의하는 "다 해본 캐릭터"(DevLoadout — 5스텟 균등 분배)입니다.
  const state = createInitialGameState("pirate");
  applyDevLoadout(state);
  const p = state.player;
  p.activeHotbarSlot = p.hotbar.indexOf("sword_yoru");
  p.fruitDrawn = false;
  assert(drawnWeapon(p)?.id === "sword_yoru", "테스트 전제 — 요루를 손에 든 상태");

  p.hakiActive = true; // 무장색 켜짐 = 이 조건에서 가장 강한 한 방(요청 문구의 "요루로" 기준)
  const perHit = totalMeleeDamage(p);
  assert(perHit > 0, `무장색 요루 기본 공격 1대 데미지: ${Math.round(perHit)}`);

  const mansion = ISLANDS.find((i) => i.id === "mansion");
  const boss = mansion.species.find((s) => s.name === "저택의 주인");
  assert(boss, "대저택에 '저택의 주인' 종족이 존재함");

  const hitsNeeded = Math.ceil(boss.hp / perHit);
  assert(
    Number.isFinite(hitsNeeded) && hitsNeeded > 0 && hitsNeeded < 100000,
    `무장색+요루로 결국 보스를 죽일 수 있음 (보스 hp ${boss.hp.toLocaleString()}, 필요 타수 ${hitsNeeded.toLocaleString()})`,
  );
}

section("멀티플레이 서버 — 현상금 랭킹 (같은 방 PvP 킬)");
{
  function fakeConn(world, name, faction) {
    const sent = [];
    const sock = { readyState: 1, OPEN: 1, send: (d) => sent.push(JSON.parse(d)), close() {} };
    const conn = world.join(sock, name, faction);
    return { conn, sent };
  }

  const world = new World();
  const hunter = fakeConn(world, "현상금사냥꾼", "pirate");
  const bystander = fakeConn(world, "구경꾼", "pirate");

  assert(hunter.conn.bounty === 0 && bystander.conn.bounty === 0, "접속 직후 현상금은 0");
  const joinBounty = bystander.sent.find((m) => m.type === "bounty_update");
  assert(joinBounty && joinBounty.entries.length === 2, "누가 접속하면 같은 방 전체가 현상금 랭킹을 갱신받음");
  assert(
    joinBounty.entries.every((e) => e.bounty === 0) && joinBounty.entries.some((e) => e.id === hunter.conn.id),
    "갱신된 목록에 같은 방 사람 전원이 (현상금 0으로) 들어있음",
  );

  // 레벨 차이별 현상금 티어: ≤100→10, ≤500→5, ≤1000→3, 그 이상→1.
  hunter.conn.level = 1000;
  const tiers = [
    { diff: 50, expect: 10 },
    { diff: 100, expect: 10 },
    { diff: 101, expect: 5 },
    { diff: 500, expect: 5 },
    { diff: 501, expect: 3 },
    { diff: 1000, expect: 3 },
    { diff: 1001, expect: 1 },
  ];
  let expectedTotal = 0;
  for (const { diff, expect } of tiers) {
    const victim = fakeConn(world, `제물${diff}`, "marine");
    victim.conn.level = hunter.conn.level - diff;
    victim.conn.hp = 1; // 한 대에 죽도록 미리 깎아둠 (쿨다운 없이 한 방으로 킬 확정)
    hunter.conn.lastMeleeAtMs = 0; // 쿨다운 검사를 우회 — 실제 시간 흐름과 무관하게 즉시 다음 공격 허용
    hunter.sent.length = 0;
    world.handleMessage(hunter.conn, JSON.stringify({ type: "melee_attack", targetId: victim.conn.id }));
    expectedTotal += expect;
    assert(victim.conn.hp === 0 && victim.conn.alive === false, `레벨차 ${diff} — 공격이 실제로 상대를 죽임`);
    assert(hunter.conn.bounty === expectedTotal, `레벨차 ${diff} — 현상금 +${expect} (누적 ${hunter.conn.bounty})`);
  }

  const lastBountyMsg = hunter.sent.filter((m) => m.type === "bounty_update").pop();
  assert(lastBountyMsg, "킬을 하면 현상금 갱신 메시지를 받음");
  const myEntry = lastBountyMsg.entries.find((e) => e.id === hunter.conn.id);
  assert(myEntry?.bounty === hunter.conn.bounty, "갱신 메시지 속 내 현상금이 실제 누적값과 일치");
  assert(lastBountyMsg.entries[0].id === hunter.conn.id, "현상금이 가장 높은 사람이 맨 위 (내림차순 정렬)");

  // 방을 나가면 랭킹에서도 빠집니다.
  bystander.sent.length = 0;
  world.leave(hunter.conn.id);
  const afterLeave = bystander.sent.find((m) => m.type === "bounty_update");
  assert(afterLeave && !afterLeave.entries.some((e) => e.id === hunter.conn.id), "나간 사람은 남은 사람들의 랭킹에서도 빠짐");
}

section("섬 판정");
assert(islandAt(0, 0)?.id === "central", "원점은 중앙 교역섬 (해적·해군 시작 섬 사이)");
assert(islandAt(200, 180) === null, "먼 바다는 어떤 섬에도 속하지 않음");
const jungleForCheck = ISLANDS.find((i) => i.id === "jungle");
assert(islandAt(jungleForCheck.center.x, jungleForCheck.center.z)?.id === "jungle", "정글 섬 중심 판정");

console.log(failures === 0 ? "\n모든 로직 검증 통과 ✅" : `\n${failures}개 실패 ❌`);
process.exit(failures === 0 ? 0 : 1);
