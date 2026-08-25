// ---------------------------------------------------------------------------
// 개발자 모드 캐릭터 — "만렙에서 뭐든 다 해본다"를 위한 준비물 한 벌.
//
// 왜 필요한가: 두 번째 바다(Lv.1100~)나 설인의 10단 점프 같은 걸 확인하려면
// 원래는 몇천 마리를 잡아야 합니다. 개발자 모드는 둘러보기용이므로 그 과정을
// 통째로 건너뛰고 **처음부터 만렙 상태**로 시작합니다.
//
// **이 상태는 저장되지 않습니다.** main.ts가 개발자 모드에서는 세이브를 읽지도
// 쓰지도 않게 잠그기 때문에, 여기서 뭘 하든 내 진짜 캐릭터는 그대로입니다.
// (자세한 이유는 core/DevAccess.ts 주석 참고)
// ---------------------------------------------------------------------------

import type { GameState, ItemId } from "../core/GameState";
import { ISLANDS } from "../world/islands";
import { recomputeDerivedStats } from "./StatSystem";
import { expRequiredForLevel } from "../core/ExpCurve";
import { BOAT_TIERS } from "./BoatSystem";
import { ALL_PURCHASABLE } from "./ShopSystem";
import { MAX_JUMPS } from "./TrainerSystem";
import { weaponExpRequiredForLevel } from "./WeaponLeveling";
import { fruitExpRequiredForLevel } from "./FruitLeveling";

/** 레벨업 한 번에 받는 스텟 포인트 (Leveling.ts와 같은 값) */
const STAT_POINTS_PER_LEVEL = 3;

/**
 * 개발자 모드 시작 레벨 = **모든 몬스터의 적정 레벨 중 가장 높은 값**.
 *
 * 진짜 레벨 상한(ExpCurve.ts의 MAX_LEVEL, 2056)을 그대로 쓰지 않는 이유:
 * 여기서 필요한 건 "이 게임의 모든 콘텐츠를 끝까지 겪어본 사람" 그 자체라서,
 * 상한이 아니라 마지막 섬 최상위 종족("저택의 주인")의 적정 레벨을 씁니다
 * (섬을 더 추가하면 이 값도 저절로 따라 올라갑니다). MAX_LEVEL은 그보다
 * 살짝 위(콘텐츠를 다 겪고도 조금 더 올릴 여지)로 잡아뒀을 뿐입니다.
 */
export const DEV_LEVEL = Math.max(
  ...ISLANDS.flatMap((i) => i.species.map((s) => s.tierLevel)),
);

/** 개발자 모드에서 쥐여주는 코인 — 뭘 사든 모자라지 않을 만큼 */
export const DEV_MONEY = 10_000_000;

/** 인벤토리에 넣어줄 물건 (무기 전부 + 소모품) */
const DEV_ITEM_QUANTITY: Partial<Record<ItemId, number>> = {
  potion_small: 99,
  potion_exp: 99,
};

/**
 * 만렙 테스트 캐릭터를 만듭니다. 이미 만들어진 GameState를 제자리에서 고칩니다.
 * @returns 적용 결과 요약 (콘솔/HUD 표시용)
 */
export function applyDevLoadout(state: GameState) {
  const p = state.player;

  p.level = DEV_LEVEL;
  p.expToNextLevel = expRequiredForLevel(p.level);
  p.exp = 0;

  // 레벨업으로 받았을 스텟 포인트를 5개 스텟에 고르게 나눠 찍어둡니다.
  // 안 찍고 포인트만 주면 최대 체력이 100인 채라, 접촉 데미지 640짜리 섬에서
  // 무적을 끄는 순간 바로 죽습니다 — "테스트가 되는 상태"로 만들어 두는 게 목적입니다.
  const totalPoints = (p.level - 1) * STAT_POINTS_PER_LEVEL;
  const each = Math.floor(totalPoints / 5);
  p.stats = { attack: each, defense: each, sword: each, gun: each, fruit: each };
  p.unspentStatPoints = totalPoints - each * 5;

  p.money = DEV_MONEY;
  p.hakiLearned = true;
  p.maxJumps = MAX_JUMPS;
  p.teleportLearned = true;
  p.unlockedSecondSea = true;

  // 배는 전부 보유 (뱃사공이 최고급 배를 내줍니다)
  p.ownedBoats = BOAT_TIERS.map((b) => b.id);

  // 살 수 있는 물건은 전부 인벤토리에 (무기는 1개, 소모품은 99개)
  p.inventory = ALL_PURCHASABLE.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    quantity: DEV_ITEM_QUANTITY[entry.id] ?? 1,
    usable: entry.usable,
    equippable: entry.equippable,
  }));

  // 무기는 단축바에 미리 올려둡니다 (숫자키로 바로 뽑아볼 수 있게).
  // 단축바는 3칸뿐인데 무기가 4종(도검 3 + 새총 1)이라 전부는 못 올립니다 —
  // 새총도 바로 테스트해볼 수 있게 도검 하나를 새총으로 바꿔 넣습니다.
  const weapons = p.inventory.filter((i) => i.equippable).map((i) => i.id);
  const swordIds = weapons.filter((id) => id !== "gun_slingshot");
  p.hotbar = [swordIds[0] ?? null, "gun_slingshot", swordIds[1] ?? null];
  p.activeHotbarSlot = null;
  p.fruitDrawn = false;

  // 열매/무기 스킬을 전부 확인해볼 수 있게 열매 레벨과 각 무기 숙련도를
  // 전부 만렙(=100, Z/X/C/V 해금 최고 조건)으로 맞춰둡니다.
  p.fruitLevel = 100;
  p.fruitExpToNext = fruitExpRequiredForLevel(100);
  p.fruitExp = 0;
  for (const weaponId of weapons) {
    p.weaponMastery[weaponId] = { level: 100, exp: 0, expToNext: weaponExpRequiredForLevel(100) };
  }

  recomputeDerivedStats(p);
  p.hp = p.maxHp;
  p.mana = p.maxMana;

  return {
    level: p.level,
    money: p.money,
    maxHp: p.maxHp,
    weapons: weapons.length,
  };
}
