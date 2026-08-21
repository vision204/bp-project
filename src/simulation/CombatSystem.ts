import type { EnemyState, GameEvent, PlayerState } from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { damageEnemy } from "./EnemyManager";
import { grantExp } from "./Leveling";
import { effectiveMeleeDamage } from "./HakiSystem";
import { fruitExpFromEnemy, fruitLevelDamageMultiplier, grantFruitExp } from "./FruitLeveling";
import { isSlotUnlocked, skillsForFruit, type SkillDef } from "./skills";
import { weaponAttackSpeedMultiplier, weaponBonusRange, weaponDamageMultiplier } from "./WeaponSystem";
import { dist2D, pointInShape } from "./ShapeMath";

/** 데미지의 출처 — 열매 경험치는 출처가 "fruit"인 막타에만 들어옵니다. */
export type DamageSource = "melee" | "fruit";

/**
 * 몬스터가 스킬 판정 범위 안에 있는지 검사합니다.
 * 조준 방향은 카메라 방향(player.aimYaw) 기준이며, 이동 방향과 무관합니다.
 *
 * 실제 기하 계산은 ShapeMath.ts로 옮겼습니다 — 멀티플레이 PvP가 "플레이어 vs
 * 다른 플레이어"에도 똑같은 판정을 써야 하기 때문입니다 (클라 후보 필터링과
 * 서버 검증이 서로 다른 계산식을 쓰면 "분명 맞았는데 서버가 인정 안 해준다"
 * 같은 어긋남이 생깁니다). 여기서는 몬스터 좌표를 그대로 넘길 뿐입니다.
 */
function isInShape(player: PlayerState, enemy: EnemyState, skill: SkillDef): boolean {
  return pointInShape(
    { x: player.position.x, z: player.position.z, aimYaw: player.aimYaw },
    enemy.position.x,
    enemy.position.z,
    skill.shape,
  );
}

/** 열매 스킬의 최종 데미지 = 기본값 × 열매스텟 배율 × 열매레벨 배율 × 자기강화 버프 */
export function skillDamage(player: PlayerState, skill: SkillDef) {
  return (
    skill.damage *
    player.abilityDamageMultiplier *
    fruitLevelDamageMultiplier(player.fruitLevel) *
    player.fruitBuffMultiplier
  );
}

/**
 * 실제로 피해를 입히고, 죽었으면 보상을 지급합니다.
 * source가 "fruit"인 경우에만 열매 경험치가 들어갑니다.
 */
function dealDamage(
  player: PlayerState,
  enemy: EnemyState,
  amount: number,
  source: DamageSource,
  events: GameEvent[],
) {
  const died = damageEnemy(enemy, amount);
  events.push({ type: "player_hit_landed", targetId: enemy.id, damage: amount });
  if (!died) return;

  events.push({
    type: "enemy_died",
    enemyId: enemy.id,
    islandId: enemy.islandId,
    speciesId: enemy.speciesId,
    expAwarded: enemy.expReward,
  });
  player.money += enemy.moneyReward;
  grantExp(player, enemy.expReward, events);

  // 여기가 핵심: 막타가 열매였을 때만 열매 경험치 지급
  if (source === "fruit") {
    grantFruitExp(player, fruitExpFromEnemy(enemy.expReward), events);
  }
}

function applySkill(player: PlayerState, enemies: EnemyState[], skill: SkillDef, events: GameEvent[]) {
  // 자기 강화
  if (skill.selfBuffMultiplier && skill.selfBuffDurationSec) {
    player.fruitBuffMultiplier = skill.selfBuffMultiplier;
    player.fruitBuffRemainingSec = skill.selfBuffDurationSec;
  }

  // 회복
  if (skill.healPercentOfMaxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * skill.healPercentOfMaxHp);
  }

  // 돌진 — 물리 바디 이동은 Simulation이 처리하도록 요청만 남깁니다.
  if (skill.dashDistance) {
    player.pendingDash = {
      x: Math.sin(player.aimYaw) * skill.dashDistance,
      z: Math.cos(player.aimYaw) * skill.dashDistance,
    };
  }

  if (skill.shape.kind === "self") return;

  const damage = skillDamage(player, skill);
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (!isInShape(player, enemy, skill)) continue;

    // 상태이상은 죽기 전에 걸어둡니다 (죽으면 어차피 의미 없음)
    if (skill.slowFactor !== undefined && skill.slowDurationSec) {
      enemy.status.slowFactor = skill.slowFactor;
      enemy.status.slowRemainingSec = skill.slowDurationSec;
    }
    if (skill.burnDps && skill.burnDurationSec) {
      enemy.status.burnDps = skill.burnDps;
      enemy.status.burnRemainingSec = skill.burnDurationSec;
    }

    if (damage > 0) dealDamage(player, enemy, damage, "fruit", events);
  }
}

/** 무장색과 손에 든 무기까지 반영한 최종 근접 데미지 */
export function totalMeleeDamage(player: PlayerState) {
  return effectiveMeleeDamage(player) * weaponDamageMultiplier(player);
}

/** 손에 든 무기까지 반영한 근접 사거리 (큰 검일수록 멀리 닿습니다) */
export function totalMeleeRange(player: PlayerState) {
  return player.meleeRange + weaponBonusRange(player);
}

/** 손에 든 무기까지 반영한 근접 공격 간격 (삼도류처럼 가벼운 무기는 더 짧습니다) */
export function totalMeleeCooldown(player: PlayerState) {
  return player.meleeCooldownSec * weaponAttackSpeedMultiplier(player);
}

/** 초당 실제 근접 데미지 — 무기 비교용 */
export function meleeDps(player: PlayerState) {
  return totalMeleeDamage(player) / totalMeleeCooldown(player);
}

/** 근접 공격 (좌클릭) — 플레이어 주변 원형 판정 */
function applyMelee(player: PlayerState, enemies: EnemyState[], events: GameEvent[]) {
  const damage = totalMeleeDamage(player);
  const range = totalMeleeRange(player);
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (dist2D(player.position.x, player.position.z, enemy.position.x, enemy.position.z) > range) continue;
    dealDamage(player, enemy, damage, "melee", events);
  }
}

/**
 * 화상 등 지속 피해 처리. 열매 스킬에서 비롯된 효과이므로, 도트로 죽어도
 * 열매 경험치가 들어옵니다 (막타의 출처가 열매이기 때문).
 */
export function stepEnemyStatuses(player: PlayerState, enemies: EnemyState[], dt: number, events: GameEvent[]) {
  for (const enemy of enemies) {
    const st = enemy.status;

    if (st.slowRemainingSec > 0) {
      st.slowRemainingSec = Math.max(0, st.slowRemainingSec - dt);
      if (st.slowRemainingSec === 0) st.slowFactor = 1;
    }

    if (st.burnRemainingSec > 0) {
      st.burnRemainingSec = Math.max(0, st.burnRemainingSec - dt);
      if (enemy.alive && st.burnDps > 0) {
        dealDamage(player, enemy, st.burnDps * dt, "fruit", events);
      }
      if (st.burnRemainingSec === 0) st.burnDps = 0;
    }
  }
}

export function stepCombat(dt: number, input: InputSnapshot, player: PlayerState, enemies: EnemyState[]) {
  // 쿨다운 진행
  player.meleeRemainingCooldownSec = Math.max(0, player.meleeRemainingCooldownSec - dt);
  for (let i = 0; i < player.skillCooldowns.length; i++) {
    player.skillCooldowns[i] = Math.max(0, player.skillCooldowns[i] - dt);
  }

  // 자기 강화 버프 타이머
  if (player.fruitBuffRemainingSec > 0) {
    player.fruitBuffRemainingSec = Math.max(0, player.fruitBuffRemainingSec - dt);
    if (player.fruitBuffRemainingSec === 0) player.fruitBuffMultiplier = 1;
  }

  if (input.attackPressed && player.meleeRemainingCooldownSec <= 0) {
    player.meleeRemainingCooldownSec = totalMeleeCooldown(player);
    applyMelee(player, enemies, player.events);
    // 몬스터를 한 마리도 맞히지 못했어도 "공격이 나갔다"는 사실 자체는 필요합니다.
    // 멀티플레이 PvP 레이어가 이 이벤트를 보고 "혹시 사거리 안에 다른 플레이어가
    // 있었는지" 별도로 검사합니다 (GameState/CombatSystem은 다른 플레이어의
    // 존재를 전혀 모릅니다 — 싱글플레이 로직은 그대로 두고 그 위에 얹은 구조).
    player.events.push({ type: "melee_attack_fired" });
  }

  const skills = skillsForFruit(player.equippedFruit);
  for (let slot = 0; slot < 4; slot++) {
    if (!input.skillPressed[slot]) continue;

    const skill = skills[slot];
    if (!skill) continue;

    if (!isSlotUnlocked(slot, player.fruitLevel)) {
      player.events.push({
        type: "skill_locked",
        skillName: skill.name,
        requiredFruitLevel: skill.unlockFruitLevel,
      });
      continue;
    }
    if (player.skillCooldowns[slot] > 0) continue;
    if (player.mana < skill.manaCost) continue;

    player.skillCooldowns[slot] = skill.cooldownSec;
    player.mana -= skill.manaCost;
    applySkill(player, enemies, skill, player.events);
    player.events.push({ type: "skill_fired", slot });
  }
}
