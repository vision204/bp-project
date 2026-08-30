import type { PlayerState, StatBlock } from "../core/GameState";

// 스텟 포인트 1개당 파생 능력치에 얼마나 반영되는지에 대한 밸런스 상수.
// 값 자체는 나중에 얼마든지 조정 가능하도록 한 곳에 모아뒀습니다.
const BASE_MAX_HP = 100;
export const HP_PER_POINT = 12; // defense 스텟 1당 최대체력 +12

const BASE_MAX_MANA = 50;
export const MANA_PER_POINT = 8; // attack 스텟 1당 최대마나 +8 (예전의 "마나" 스텟 역할)

const BASE_MELEE_DAMAGE = 8;
// 예전에는 attack 스텟 1당 근접(맨손) 데미지에 +2씩 반영됐지만(ATTACK_DMG_PER_POINT),
// 이제 attack 스텟은 최대마나만 올리고 근접 데미지에는 전혀 영향을 주지 않습니다.
// meleeDamage는 항상 BASE_MELEE_DAMAGE 고정값입니다 — 무기를 아예 안 든(맨손)
// 상태의 기준치로만 쓰이고, 검/총을 든 상태의 데미지 계산에는 더 이상 쓰이지
// 않습니다 (아래 statAttackPower / recomputeDerivedStats 참고).

/**
 * 검/총 데미지의 새 기준 공식 — "스텟 1당 배율(%)"이 아니라 "스텟 1당 고정
 * 공격력(+)"으로 계산합니다. stat=0일 때 10(예전 맨손 기준치 8과 비슷한 초반
 * 감각을 유지), stat 1당 +0.5씩 늘어납니다. 검/총 각각 이 값을 무기의
 * damageMultiplier에 그대로 곱한 것이 최종 데미지입니다 — 예전처럼 meleeDamage
 * 위에 배율을 얹는 게 아니라, 이 값 자체가 기준치를 완전히 대체합니다
 * (CombatSystem.ts의 totalMeleeDamage / WeaponSystem.ts의 weaponDamageMultiplier 참고).
 */
export const BASE_ATTACK_POWER = 10;
export const ATTACK_POWER_PER_POINT = 0.5;
export function statAttackPower(statValue: number): number {
  return BASE_ATTACK_POWER + statValue * ATTACK_POWER_PER_POINT;
}

// 예전 "스텟 1당 +6%" 배율 상수들 — 검/총 데미지 계산에는 더 이상 쓰이지 않지만
// (위 statAttackPower로 대체됨), 다른 곳(예: 무기 스킬 데미지가 아닌, 밸런스
// 문서/테스트에서 옛 공식을 참고용으로 재현하는 곳)에서 여전히 이 이름으로
// import하므로 상수 자체는 남겨둡니다.
export const SWORD_DMG_MULT_PER_POINT = 0.06;
export const GUN_DMG_MULT_PER_POINT = 0.06;

const FRUIT_DMG_MULT_PER_POINT = 0.08; // 열매 스텟 1당 열매 능력 데미지 +8% (참고용 — 실제 계산은 statAttackPower 기반, 아래 참고)

/**
 * stats(공격/방어/검/총/열매)로부터 실제 게임플레이 수치(최대체력, 최대마나,
 * 도검/원거리 무기 배율, 열매 능력 배율)를 다시 계산합니다.
 * 스텟 포인트를 배분할 때마다 호출해야 합니다.
 *
 * attack 스텟은 최대마나만 올립니다 — 근접 공격력(meleeDamage)에는 절대 영향을
 * 주지 않으며, meleeDamage는 항상 BASE_MELEE_DAMAGE 고정값입니다. defense 스텟은
 * 예전의 "체력" 스텟과 완전히 같은 역할(최대체력)입니다 — 이름만 바뀌었습니다.
 */
export function recomputeDerivedStats(player: PlayerState) {
  const prevMaxHp = player.maxHp;
  const prevMaxMana = player.maxMana;

  player.maxHp = BASE_MAX_HP + player.stats.defense * HP_PER_POINT;
  player.maxMana = BASE_MAX_MANA + player.stats.attack * MANA_PER_POINT;
  player.meleeDamage = BASE_MELEE_DAMAGE;
  // 검/총: "배율(1+stat*0.06)"이 아니라 statAttackPower(stat) 자체가 무기의
  // damageMultiplier에 곱해지는 기준 공격력입니다 — meleeDamage는 이 계산에
  // 전혀 관여하지 않습니다 (CombatSystem.totalMeleeDamage 참고).
  player.swordDamageMultiplier = statAttackPower(player.stats.sword);
  player.gunDamageMultiplier = statAttackPower(player.stats.gun);
  // 열매 스킬 데미지는 (기존처럼) "기본값 × 배율" 구조를 그대로 유지하되,
  // 그 배율을 같은 statAttackPower 공식에서 끌어옵니다 — stat=0일 때 정확히
  // 1.0이 되도록 BASE_ATTACK_POWER로 정규화해서, 각 스킬에 미리 튜닝해둔
  // 기본 데미지값이 stat=0에서 그대로 유지됩니다.
  player.abilityDamageMultiplier = statAttackPower(player.stats.fruit) / BASE_ATTACK_POWER;

  // 최대치가 늘어난 만큼 현재치도 같이 늘려주되(=포인트 찍었다고 손해보지 않게),
  // 새 최대치를 넘지는 않도록 클램프합니다.
  const hpGain = player.maxHp - prevMaxHp;
  if (hpGain !== 0) player.hp = Math.min(player.maxHp, Math.max(0, player.hp + hpGain));

  const manaGain = player.maxMana - prevMaxMana;
  if (manaGain !== 0) player.mana = Math.min(player.maxMana, Math.max(0, player.mana + manaGain));
}

export function allocateStatPoint(player: PlayerState, stat: keyof StatBlock): boolean {
  if (player.unspentStatPoints <= 0) return false;
  player.unspentStatPoints -= 1;
  player.stats[stat] += 1;
  recomputeDerivedStats(player);
  return true;
}
