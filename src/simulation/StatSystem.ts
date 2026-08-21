import type { PlayerState, StatBlock } from "../core/GameState";

// 스텟 포인트 1개당 파생 능력치에 얼마나 반영되는지에 대한 밸런스 상수.
// 값 자체는 나중에 얼마든지 조정 가능하도록 한 곳에 모아뒀습니다.
const BASE_MAX_HP = 100;
const HP_PER_POINT = 12;

const BASE_MAX_MANA = 50;
const MANA_PER_POINT = 8;

const BASE_MELEE_DAMAGE = 8;
const ATTACK_DMG_PER_POINT = 2;

const FRUIT_DMG_MULT_PER_POINT = 0.08; // 열매 스텟 1당 열매 능력 데미지 +8%

/**
 * stats(마나/공격력/체력/열매)로부터 실제 게임플레이 수치(최대체력, 최대마나,
 * 근접 공격력, 열매 능력 배율)를 다시 계산합니다. 스텟 포인트를 배분할 때마다
 * 호출해야 합니다.
 */
export function recomputeDerivedStats(player: PlayerState) {
  const prevMaxHp = player.maxHp;
  const prevMaxMana = player.maxMana;

  player.maxHp = BASE_MAX_HP + player.stats.health * HP_PER_POINT;
  player.maxMana = BASE_MAX_MANA + player.stats.mana * MANA_PER_POINT;
  player.meleeDamage = BASE_MELEE_DAMAGE + player.stats.attack * ATTACK_DMG_PER_POINT;
  player.abilityDamageMultiplier = 1 + player.stats.fruit * FRUIT_DMG_MULT_PER_POINT;

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
