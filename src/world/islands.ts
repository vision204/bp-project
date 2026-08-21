// ---------------------------------------------------------------------------
// 섬 정의는 순수 데이터입니다 (THREE 의존성 없음). 시뮬레이션(적 배치, 퀘스트
// 레벨 제한, 익사 판정)과 렌더링(지형 생성) 양쪽이 같은 정의를 읽습니다.
//
// 배치 구조: 시작 섬을 중심으로 두 겹의 원형 고리.
//   · 안쪽 고리(중심에서 ~300m) — 정글/사막/얼음/화산/폭풍  (Lv.25 ~ 235)
//   · 바깥 고리(중심에서 ~640m) — 안개/수정/심연/천공/용의둥지 (Lv.300 ~ 900)
// 바깥으로 나갈수록 위험해지는 구조라, 수평선에 보이는 섬이 곧 다음 목표가 됩니다.
//
// ── 바다(세계)가 둘입니다 ────────────────────────────────────────────────────
// 첫 번째 바다(Lv.1~1100)를 다 올리면 중앙 교역섬의 **해적왕**에게 부탁해
// 두 번째 바다(Lv.1100~2050)로 건너갑니다. 두 바다는 **같은 월드 좌표계** 안에
// 6,000m 떨어진 두 구역으로 존재합니다. 이렇게 한 이유:
//   · 섬/몬스터/NPC 배열을 하나로 유지할 수 있어서 기존 코드가 거의 그대로 돕니다
//     (islandAt, 부활, 퀘스트, 세이브 모두 손댈 필요가 없음).
//   · 헤엄쳐서 건너가는 건 6km라 사실상 불가능하고, 배도 못 갑니다 — 해적왕이
//     유일한 통로라는 규칙이 물리적으로도 지켜집니다.
// 각 섬은 자기 바다의 원점 기준 좌표로 적고, 아래 withDock에서 절대 좌표로 옮깁니다.
// ---------------------------------------------------------------------------

import { expRequiredForLevel } from "../core/ExpCurve";

/** 바다(세계) 번호 */
export type Sea = 1 | 2;

export const SEA_LABELS: Record<Sea, string> = {
  1: "첫 번째 바다",
  2: "두 번째 바다",
};

/**
 * 바다별 월드 원점. 두 구역이 서로 섞이지 않을 만큼(6km) 떨어뜨렸습니다.
 * 첫 번째 바다는 (0,0)이라 기존 좌표가 전부 그대로 유효합니다.
 */
export const SEA_ORIGINS: Record<Sea, { x: number; z: number }> = {
  1: { x: 0, z: 0 },
  2: { x: 6000, z: 0 },
};

/** 해적왕에게 두 번째 바다로 보내달라고 할 수 있는 최소 레벨 */
export const SECOND_SEA_LEVEL = 1100;

/** 진영 — 시작 섬만 갈리고, 그 다음 항로는 양쪽이 완전히 같습니다. */
export type Faction = "pirate" | "marine";

export const FACTION_LABELS: Record<Faction, string> = {
  pirate: "해적",
  marine: "해군",
};

/**
 * 섬의 역할.
 *   · start — 진영별 시작 섬 (해적 마을 / 해군 기지)
 *   · hub   — 중앙 교역섬. 몬스터도 퀘스트도 없고 상인만 있습니다
 *   · wild  — 사냥터 섬 (기존 고리 섬들)
 */
export type IslandKind = "start" | "hub" | "wild";

export type IslandTheme =
  | "grass"
  | "pirate"
  | "marine"
  | "trade"
  | "jungle"
  | "desert"
  | "ice"
  | "volcano"
  | "storm"
  | "haunted"
  | "crystal"
  | "abyss"
  | "sky"
  | "dragon"
  // ── 두 번째 바다 ──
  | "fountain"
  | "rose"
  | "green"
  | "graveyard"
  | "snow"
  | "hotcold"
  | "cursed"
  | "icecastle"
  | "forgotten"
  | "mansion";

/** 그 섬의 "1번째(가장 약한) 종족" 기준값. 나머지 종족은 여기서 파생됩니다. */
export interface IslandEnemyProfile {
  count: number;
  hp: number;
  exp: number;
  money: number;
  contactDamage: number;
}

/** 실제로 배치되는 몬스터 종류 하나 */
export interface IslandEnemySpecies {
  id: string;
  name: string;
  /** 3D에서 구분되도록 종족마다 다른 색 */
  color: number;
  /** 상위 종족일수록 조금 더 큽니다 */
  scale: number;
  /** 이 종족을 잡기 적당한 레벨 (섬 요구 레벨 + 50 × 단계) */
  tierLevel: number;
  count: number;
  hp: number;
  exp: number;
  money: number;
  contactDamage: number;
}

/** 데이터로 적어두는 부분 — 숫자는 전부 아래 buildSpecies가 계산합니다. */
interface SpeciesSeed {
  name: string;
  color: number;
  scale?: number;
  count?: number;
}

export interface IslandDef {
  id: string;
  name: string;
  theme: IslandTheme;
  center: { x: number; z: number };
  radius: number;
  /**
   * 이 섬의 퀘스트를 받으려면 필요한 최소 레벨.
   * 상륙 자체는 레벨과 무관하게 자유롭지만, 레벨이 모자라면 토벌대장이
   * 의뢰를 주지 않습니다.
   */
  requiredLevel: number;
  /** 부두가 뻗어나가는 방향 (라디안). 지정하지 않으면 월드 중심을 향합니다. */
  dockAngle: number;
  enemy: IslandEnemyProfile;
  /** 이 섬에 사는 몬스터 종류들. 중앙 교역섬(hub)은 비어 있습니다 */
  species: IslandEnemySpecies[];
  kind: IslandKind;
  /** 어느 바다에 있는 섬인지 */
  sea: Sea;
  /** 자기 바다 원점 기준 좌표 (center는 절대 좌표) — 안개/바다 크기 계산용 */
  localCenter: { x: number; z: number };
  /** 시작 섬일 때만 — 어느 진영의 고향인지 */
  faction?: Faction;
}

// ── 몬스터 종류 수 규칙 ──────────────────────────────────────────────────────
// "다음 섬과 필요 레벨이 많이 차이나는 섬은 한 종류만 잡으면 단조롭다"는 요청에 따라,
// **레벨 차이 50당 몬스터 한 종류**를 배치합니다.
//   · 300레벨 섬 → 다음이 400레벨 → 차이 100 → 2종류
//   · 400레벨 섬 → 다음이 550레벨 → 차이 150 → 3종류
// 각 종족은 "섬 요구 레벨 + 50 × 단계"를 적정 레벨로 잡아서, 한 섬 안에서
// 다음 섬까지 레벨을 다 올릴 수 있게 했습니다.
export const SPECIES_LEVEL_STEP = 50;
/** 마지막 섬은 다음 섬이 없으므로 이 폭만큼 있다고 보고 종류를 정합니다 */
export const FINAL_ISLAND_LEVEL_SPAN = 200;

export function speciesCountForGap(levelGap: number) {
  return Math.max(1, Math.floor(levelGap / SPECIES_LEVEL_STEP));
}

// 상위 종족의 체력·피해·코인 증가폭. 경험치는 적정 레벨에서 직접 계산합니다.
const HP_STEP = 1.28;
const CONTACT_STEP = 1.22;
const MONEY_STEP = 1.35;

function buildSpecies(
  islandId: string,
  requiredLevel: number,
  base: IslandEnemyProfile,
  seeds: SpeciesSeed[],
): IslandEnemySpecies[] {
  return seeds.map((seed, k) => {
    const tierLevel = requiredLevel + SPECIES_LEVEL_STEP * k;
    return {
      id: `${islandId}_sp${k}`,
      name: seed.name,
      color: seed.color,
      scale: seed.scale ?? 1 + k * 0.09,
      tierLevel,
      count: seed.count ?? (k === 0 ? base.count : 8),
      hp: Math.round(base.hp * Math.pow(HP_STEP, k)),
      // 1번째 종족은 기존에 검증된 값을 그대로 쓰고, 상위 종족만 곡선에서 계산합니다.
      exp: k === 0 ? base.exp : Math.round(expRequiredForLevel(tierLevel) / 8),
      money: Math.round(base.money * Math.pow(MONEY_STEP, k)),
      contactDamage: Math.round(base.contactDamage * Math.pow(CONTACT_STEP, k)),
    };
  });
}

// 물 관련 상수 — 익사 판정과 바다 메시 높이가 서로 어긋나지 않도록 한 곳에서 관리합니다.
export const OCEAN_MESH_Y = -0.8;
/** 헤엄칠 때 몸이 뜨는 높이 (플레이어 바디 원점 기준) */
export const SWIM_SURFACE_Y = -1.0;
/** 이 높이보다 아래로 내려가면 "물에 빠진 상태"로 판정 */
export const WATER_ENTER_Y = -0.5;

interface IslandSeed extends Omit<IslandDef, "dockAngle" | "species" | "kind" | "sea" | "localCenter"> {
  dockAngle?: number;
  speciesSeeds: SpeciesSeed[];
  kind?: IslandKind;
  /** 생략하면 첫 번째 바다 */
  sea?: Sea;
}

/**
 * 부두는 기본적으로 **자기 바다의 중심**을 바라보게 둡니다.
 * 그래야 안쪽에서 배를 몰고 왔을 때 자연스럽게 부두 정면으로 접근하게 됩니다.
 *
 * seed.center는 **자기 바다 원점 기준 좌표**로 적고, 여기서 절대 좌표로 옮깁니다.
 * (두 번째 바다는 월드에서 x+6000만큼 떨어져 있습니다)
 */
function withDock(seed: IslandSeed): IslandDef {
  const sea: Sea = seed.sea ?? 1;
  const origin = SEA_ORIGINS[sea];
  const local = seed.center;
  const dockAngle =
    seed.dockAngle ??
    (local.x === 0 && local.z === 0 ? Math.PI * 0.25 : Math.atan2(-local.z, -local.x));
  const { speciesSeeds, ...rest } = seed;
  return {
    ...rest,
    sea,
    localCenter: { ...local },
    center: { x: origin.x + local.x, z: origin.z + local.z },
    kind: seed.kind ?? "wild",
    dockAngle,
    species: buildSpecies(seed.id, seed.requiredLevel, seed.enemy, speciesSeeds),
  };
}

export const ISLANDS: IslandDef[] = [
  // ── 중심부: 진영별 시작 섬 2개 + 그 사이의 중앙 교역섬 ──────────────────
  //
  // 해적 마을과 해군 기지는 원점을 사이에 두고 정확히 마주보게 두고,
  // 그 한가운데(원점)에 중앙 교역섬을 놓았습니다. 어느 진영으로 시작하든
  // 중앙섬까지의 거리가 같고, 중앙섬을 지나면 상대 진영 섬으로도 갈 수 있습니다.
  // 두 섬의 몬스터는 서로 상대 진영입니다 (해적 마을에는 해군 신병이 옵니다).
  withDock({
    id: "pirate_start",
    name: "해적 마을",
    theme: "pirate",
    kind: "start",
    faction: "pirate",
    center: { x: 144, z: -80 },
    radius: 60,
    requiredLevel: 1,
    enemy: { count: 6, hp: 30, exp: 15, money: 5, contactDamage: 6 },
    speciesSeeds: [{ name: "해군 신병", color: 0x4a6fa5 }],
  }),
  withDock({
    id: "marine_start",
    name: "해군 기지",
    theme: "marine",
    kind: "start",
    faction: "marine",
    center: { x: -144, z: 80 },
    radius: 60,
    requiredLevel: 1,
    enemy: { count: 6, hp: 30, exp: 15, money: 5, contactDamage: 6 },
    speciesSeeds: [{ name: "해적 잡병", color: 0x9c5a3c }],
  }),
  withDock({
    id: "central",
    name: "중앙 교역섬",
    theme: "trade",
    kind: "hub",
    center: { x: 0, z: 0 },
    radius: 55,
    requiredLevel: 1,
    // 중립 지대라 몬스터가 없습니다 (speciesSeeds가 비어 있음).
    enemy: { count: 0, hp: 0, exp: 0, money: 0, contactDamage: 0 },
    speciesSeeds: [],
  }),

  // ── 안쪽 고리 (Lv.25 ~ 235) ─────────────────────────────────────────────
  withDock({
    id: "jungle",
    name: "정글 섬",
    theme: "jungle",
    center: { x: 262, z: 98 },
    radius: 51,
    requiredLevel: 25,
    enemy: { count: 7, hp: 90, exp: 70, money: 18, contactDamage: 12 },
    speciesSeeds: [{ name: "정글 도적", color: 0x5aa469 }],
  }),
  withDock({
    id: "desert",
    name: "사막 섬",
    theme: "desert",
    center: { x: 98, z: 315 },
    radius: 51,
    requiredLevel: 50,
    enemy: { count: 7, hp: 240, exp: 260, money: 45, contactDamage: 20 },
    speciesSeeds: [{ name: "사막 도적", color: 0xd6a34f }],
  }),
  withDock({
    id: "ice",
    name: "얼음 섬",
    theme: "ice",
    center: { x: -255, z: 210 },
    radius: 51,
    requiredLevel: 125,
    enemy: { count: 8, hp: 700, exp: 900, money: 110, contactDamage: 32 },
    speciesSeeds: [{ name: "설원 늑대", color: 0x7fb8d8 }],
  }),
  withDock({
    id: "volcano",
    name: "화산 섬",
    theme: "volcano",
    center: { x: -292, z: -128 },
    radius: 51,
    requiredLevel: 200,
    enemy: { count: 8, hp: 1600, exp: 2600, money: 260, contactDamage: 48 },
    speciesSeeds: [{ name: "용암 병사", color: 0xe0623a }],
  }),
  withDock({
    id: "storm",
    name: "폭풍 섬",
    theme: "storm",
    center: { x: 68, z: -330 },
    radius: 51,
    requiredLevel: 235,
    enemy: { count: 9, hp: 3200, exp: 6000, money: 520, contactDamage: 65 },
    speciesSeeds: [{ name: "폭풍 해적", color: 0x6d7fc4 }],
  }),

  // ── 바깥 고리 (Lv.300 ~ 900) ────────────────────────────────────────────
  // 몬스터 경험치는 "그 레벨에서 한 번 레벨업에 필요한 경험치 ÷ 8" 기준으로 잡아
  // 어느 구간이든 대략 8마리에 1레벨씩 오르도록 맞췄습니다.
  withDock({
    id: "haunted",
    name: "안개 섬",
    theme: "haunted",
    center: { x: 444, z: 460 },
    radius: 62,
    requiredLevel: 300,
    enemy: { count: 9, hp: 3500, exp: 6900, money: 600, contactDamage: 85 },
    speciesSeeds: [
      { name: "안개 유령", color: 0x9aa7b5 },
      { name: "저주받은 선장", color: 0x6f5b9e },
    ],
  }),
  withDock({
    id: "crystal",
    name: "수정 섬",
    theme: "crystal",
    center: { x: -176, z: 615 },
    radius: 72,
    requiredLevel: 400,
    enemy: { count: 9, hp: 5500, exp: 10900, money: 900, contactDamage: 110 },
    speciesSeeds: [
      { name: "수정 골렘", color: 0x74d4e8 },
      { name: "수정 파수꾼", color: 0x4f8fd8 },
      { name: "수정 군주", color: 0xb98cf0 },
    ],
  }),
  withDock({
    id: "abyss",
    name: "심연 섬",
    theme: "abyss",
    center: { x: -634, z: 89 },
    radius: 76,
    requiredLevel: 550,
    enemy: { count: 10, hp: 9000, exp: 18200, money: 1500, contactDamage: 145 },
    speciesSeeds: [
      { name: "심연 촉수", color: 0x2f6f6a },
      { name: "심연 사냥꾼", color: 0x1f8f7a },
      { name: "심연 포식자", color: 0x7be0c0 },
    ],
  }),
  withDock({
    id: "sky",
    name: "천공 섬",
    theme: "sky",
    center: { x: -300, z: -565 },
    radius: 86,
    requiredLevel: 700,
    enemy: { count: 10, hp: 13500, exp: 26800, money: 2200, contactDamage: 185 },
    speciesSeeds: [
      { name: "천공 사제", color: 0xf2e6c9 },
      { name: "천공 기사", color: 0xd8c26a },
      { name: "천공 대장", color: 0xf0a83c },
      { name: "천공 수호신", color: 0xfff0a0 },
    ],
  }),
  withDock({
    id: "dragon",
    name: "용의 둥지",
    theme: "dragon",
    center: { x: 490, z: -411 },
    radius: 92,
    requiredLevel: 900,
    enemy: { count: 11, hp: 20000, exp: 40000, money: 3300, contactDamage: 240 },
    speciesSeeds: [
      { name: "새끼 드래곤", color: 0x7fbf5f },
      { name: "화염 드래곤", color: 0xe04b2a },
      { name: "폭풍 드래곤", color: 0x5f7fe0 },
      { name: "고룡", color: 0xf0d24b },
    ],
  }),

  // ═══════════════════════════════════════════════════════════════════════
  //  두 번째 바다 (Lv.1100 ~ 2050) — 해적왕에게 부탁해야 갈 수 있습니다.
  //
  //  블록스프루츠 2세계의 지명을 그대로 가져오되, 섬 크기와 간격은 첫 번째
  //  바다보다 조금씩 작게 잡았습니다. 구조는 같은 두 겹 고리라서, 첫 바다에서
  //  익힌 "바깥으로 나갈수록 위험하다"는 감각이 그대로 통합니다.
  //    · 중심      — 분수 도시 (허브. 몬스터 없음, 해적왕과 상인이 있음)
  //    · 안쪽 고리 — 장미 왕국 / 초원 지대 / 공동묘지 / 눈 덮인 산 (Lv.1100~1400)
  //    · 바깥 고리 — 화염과 얼음 / 저주받은 배 / 얼음 성 / 잊혀진 섬 / 대저택 (Lv.1500~1900)
  //  좌표는 전부 두 번째 바다 원점 기준입니다 (실제 월드에서는 x+6000).
  // ═══════════════════════════════════════════════════════════════════════
  withDock({
    id: "fountain",
    name: "분수 도시",
    theme: "fountain",
    kind: "hub",
    sea: 2,
    center: { x: 0, z: 0 },
    radius: 58,
    requiredLevel: SECOND_SEA_LEVEL,
    // 두 번째 바다의 관문이자 중립 지대 — 몬스터가 없습니다.
    enemy: { count: 0, hp: 0, exp: 0, money: 0, contactDamage: 0 },
    speciesSeeds: [],
  }),

  // ── 안쪽 고리 (Lv.1100 ~ 1400) ─────────────────────────────────────────
  withDock({
    id: "rose",
    name: "장미 왕국",
    theme: "rose",
    sea: 2,
    center: { x: 236, z: 88 },
    radius: 48,
    requiredLevel: 1100,
    enemy: { count: 10, hp: 26000, exp: 55300, money: 4200, contactDamage: 280 },
    speciesSeeds: [
      { name: "장미 기사", color: 0xd45a7a },
      { name: "장미 근위대장", color: 0xa03050 },
    ],
  }),
  withDock({
    id: "green_zone",
    name: "초원 지대",
    theme: "green",
    sea: 2,
    center: { x: 88, z: 284 },
    radius: 48,
    requiredLevel: 1200,
    enemy: { count: 10, hp: 30000, exp: 63400, money: 4800, contactDamage: 310 },
    speciesSeeds: [
      { name: "초원 사냥꾼", color: 0x6fbf5a },
      { name: "초원 족장", color: 0x3f8f3a },
    ],
  }),
  withDock({
    id: "graveyard",
    name: "공동묘지",
    theme: "graveyard",
    sea: 2,
    center: { x: -230, z: 190 },
    radius: 48,
    requiredLevel: 1300,
    enemy: { count: 11, hp: 35000, exp: 72000, money: 5500, contactDamage: 345 },
    speciesSeeds: [
      { name: "무덤지기", color: 0x7a8b7f },
      { name: "망자의 사제", color: 0x4d5f52 },
    ],
  }),
  withDock({
    id: "snow_mountain",
    name: "눈 덮인 산",
    theme: "snow",
    sea: 2,
    center: { x: -264, z: -116 },
    radius: 48,
    requiredLevel: 1400,
    enemy: { count: 11, hp: 41000, exp: 81100, money: 6300, contactDamage: 385 },
    speciesSeeds: [
      { name: "설산 산적", color: 0xcfe4f2 },
      { name: "설산 두목", color: 0x8fb4cc },
    ],
  }),

  // ── 바깥 고리 (Lv.1500 ~ 1900) ─────────────────────────────────────────
  withDock({
    id: "hot_cold",
    name: "화염과 얼음",
    theme: "hotcold",
    sea: 2,
    center: { x: 62, z: -298 },
    radius: 52,
    requiredLevel: 1500,
    enemy: { count: 11, hp: 48000, exp: 90600, money: 7200, contactDamage: 425 },
    speciesSeeds: [
      { name: "불꽃 야수", color: 0xf06a2a },
      { name: "서리 야수", color: 0x5ac8f0 },
    ],
  }),
  withDock({
    id: "cursed_ship",
    name: "저주받은 배",
    theme: "cursed",
    sea: 2,
    center: { x: 400, z: 414 },
    radius: 56,
    requiredLevel: 1600,
    enemy: { count: 12, hp: 56000, exp: 100500, money: 8200, contactDamage: 470 },
    speciesSeeds: [
      { name: "유령 선원", color: 0x6f7f8f },
      { name: "유령 선장", color: 0x9f6fd0 },
    ],
  }),
  withDock({
    id: "ice_castle",
    name: "얼음 성",
    theme: "icecastle",
    sea: 2,
    center: { x: -158, z: 554 },
    radius: 62,
    requiredLevel: 1700,
    enemy: { count: 12, hp: 65000, exp: 110700, money: 9400, contactDamage: 520 },
    speciesSeeds: [
      { name: "성벽 파수병", color: 0xa8dcf0 },
      { name: "서리 여왕의 기사", color: 0x5f9fd8 },
    ],
  }),
  withDock({
    id: "forgotten",
    name: "잊혀진 섬",
    theme: "forgotten",
    sea: 2,
    center: { x: -570, z: 80 },
    radius: 66,
    requiredLevel: 1800,
    enemy: { count: 12, hp: 76000, exp: 121400, money: 10700, contactDamage: 575 },
    speciesSeeds: [
      { name: "잊혀진 전사", color: 0x8f8a6a },
      { name: "잊혀진 수호자", color: 0xc0b070 },
    ],
  }),
  withDock({
    id: "mansion",
    name: "대저택",
    theme: "mansion",
    sea: 2,
    center: { x: 442, z: -370 },
    radius: 80,
    requiredLevel: 1900,
    enemy: { count: 13, hp: 88000, exp: 132500, money: 12200, contactDamage: 640 },
    speciesSeeds: [
      { name: "저택 하인", color: 0x8d6e63 },
      { name: "저택 경비대장", color: 0x5d4037 },
      { name: "가면의 귀족", color: 0xb08cd0 },
      { name: "저택의 주인", color: 0xf0c060 },
    ],
  }),
];

export function getIsland(id: string): IslandDef {
  const island = ISLANDS.find((i) => i.id === id);
  if (!island) throw new Error(`알 수 없는 섬 id: ${id}`);
  return island;
}

/** 그 바다의 섬들만 */
export function islandsInSea(sea: Sea): IslandDef[] {
  return ISLANDS.filter((i) => i.sea === sea);
}

/**
 * 요구 레벨 오름차순 목록 (다음 섬을 찾는 데 사용).
 * 바다를 지정하면 그 바다 안에서만 봅니다 — 첫 바다의 마지막 섬이 두 번째 바다의
 * 첫 섬을 "다음 목표"로 착각하지 않도록.
 */
export function islandsByLevel(sea?: Sea): IslandDef[] {
  const pool = sea ? islandsInSea(sea) : ISLANDS;
  return [...pool].sort((a, b) => a.requiredLevel - b.requiredLevel);
}

/** 다음 단계 섬과의 요구 레벨 차이. 그 바다의 마지막 섬은 FINAL_ISLAND_LEVEL_SPAN으로 봅니다. */
export function levelGapToNextIsland(island: IslandDef): number {
  const sorted = islandsByLevel(island.sea);
  const next = sorted.find((i) => i.requiredLevel > island.requiredLevel);
  return next ? next.requiredLevel - island.requiredLevel : FINAL_ISLAND_LEVEL_SPAN;
}

export function getSpecies(islandId: string, speciesId: string): IslandEnemySpecies | null {
  return getIsland(islandId).species.find((s) => s.id === speciesId) ?? null;
}

/** 진영별 시작 섬 */
export function startIslandFor(faction: Faction): IslandDef {
  const island = ISLANDS.find((i) => i.kind === "start" && i.faction === faction);
  if (!island) throw new Error(`${faction} 진영의 시작 섬이 없습니다`);
  return island;
}

/**
 * 그 바다의 허브 섬 (상인과 해적왕이 있는 중립 지대).
 * 첫 번째 바다는 중앙 교역섬, 두 번째 바다는 분수 도시입니다.
 */
export function hubIsland(sea: Sea = 1): IslandDef {
  const island = ISLANDS.find((i) => i.kind === "hub" && i.sea === sea);
  if (!island) throw new Error(`${sea}번째 바다에 허브 섬이 없습니다`);
  return island;
}

/** 몬스터가 사는 섬인지 (중앙 교역섬은 false) */
export function hasEnemies(island: IslandDef) {
  return island.species.length > 0;
}

/** 부두가 뻗어나가는 단위 방향 벡터 */
export function dockDirection(island: IslandDef) {
  return { x: Math.cos(island.dockAngle), z: Math.sin(island.dockAngle) };
}

/** 배가 정박하는 위치 (부두 끝) */
export function boatPosition(island: IslandDef) {
  const dir = dockDirection(island);
  return {
    x: island.center.x + dir.x * (island.radius + 9),
    y: -0.35,
    z: island.center.z + dir.z * (island.radius + 9),
  };
}

/** 뱃사공 NPC 위치 (부두 입구, 섬 안쪽) */
export function dockNpcPosition(island: IslandDef) {
  const dir = dockDirection(island);
  const perp = { x: -dir.z, z: dir.x };
  return {
    x: island.center.x + dir.x * (island.radius - 6) + perp.x * 3,
    y: 1,
    z: island.center.z + dir.z * (island.radius - 6) + perp.z * 3,
  };
}

/** 이 섬에 도착했을 때 플레이어가 내려서는 위치 */
export function islandArrivalPosition(island: IslandDef) {
  const dir = dockDirection(island);
  return {
    x: island.center.x + dir.x * (island.radius - 10),
    y: 2,
    z: island.center.z + dir.z * (island.radius - 10),
  };
}

export function distanceToIslandCenter(island: IslandDef, x: number, z: number) {
  return Math.hypot(x - island.center.x, z - island.center.z);
}

/**
 * 좌표가 어느 섬에 속하는지 (해변 경사 + 부두 + 정박한 배까지 포함). 먼 바다면 null.
 * 부두는 섬 반지름 +10까지 뻗어 있고 배는 +9에 정박하므로, 배 위에 서 있어도
 * "그 섬에 있다"고 판정되도록 여유를 +14로 잡았습니다.
 */
export function islandAt(x: number, z: number): IslandDef | null {
  for (const island of ISLANDS) {
    if (distanceToIslandCenter(island, x, z) <= island.radius + 14) return island;
  }
  return null;
}

/**
 * 그 바다의 원점에서 가장 바깥 섬까지의 거리 (바다 메시 크기·안개 범위용).
 *
 * **절대 좌표가 아니라 자기 바다 기준 좌표로 재는 게 핵심**입니다. 두 번째 바다는
 * 월드에서 6km 떨어져 있는데 그 거리로 안개를 잡으면 안개가 아예 안 걸려서
 * 첫 번째 바다의 분위기까지 망가집니다.
 */
export function worldRadius(sea: Sea = 1) {
  return Math.max(
    ...islandsInSea(sea).map((i) => Math.hypot(i.localCenter.x, i.localCenter.z) + i.radius),
  );
}

/** 두 바다를 통틀어 가장 큰 반경 (카메라 far plane처럼 한 번만 정하는 값에 사용) */
export function maxWorldRadius() {
  return Math.max(worldRadius(1), worldRadius(2));
}
