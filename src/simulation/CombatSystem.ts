import type { EnemyState, GameEvent, ItemId, PlayerState } from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { damageEnemy } from "./EnemyManager";
import { grantExp } from "./Leveling";
import { effectiveMeleeDamage, HAKI_DAMAGE_MULTIPLIER } from "./HakiSystem";
import { fruitExpFromEnemy, fruitLevelDamageMultiplier, grantFruitExp } from "./FruitLeveling";
import { weaponExpFromEnemy, weaponLevelDamageMultiplier, weaponMasteryLevel, grantWeaponExp } from "./WeaponLeveling";
import {
  DRAGON_FLIGHT_SKILL,
  DRAGON_FORM_RANGE_MULTIPLIER,
  LIGHT_FLIGHT_SKILL,
  isSlotUnlocked,
  skillsForFruit,
  withCharge,
  withRangeMultiplier,
  type SkillDef,
} from "./skills";
import { isWeaponSlotUnlocked, skillsForWeapon } from "./weaponSkills";
import {
  drawnWeapon,
  weaponAttackSpeedMultiplier,
  weaponBonusRange,
  weaponDamageMultiplier,
} from "./WeaponSystem";
import { dist2D, isMouseTargetInRange, pointInShape, skillOrigin } from "./ShapeMath";

/** 뇌광 질주(번개 열매 X)의 변신 수치 — skills.ts가 유일한 출처이므로 여기서 다시 정의하지 않고 그대로 읽습니다. */
const LIGHTNING_FORM_SKILL = skillsForFruit("thunder_strike")[1];
/** 사막의 대검(모래 열매 V)의 소환 수치 — 마찬가지로 skills.ts를 그대로 읽습니다. */
const SAND_BLADE_SKILL = skillsForFruit("sand_storm")[3];

/**
 * 데미지의 출처.
 *   · "fruit"  — 열매 경험치는 출처가 "fruit"인 막타에만 들어옵니다.
 *   · "weapon" — 무기 경험치는 그 무기를 손에 든 채로 낸 근접/무기스킬
 *                막타에서 들어옵니다 (아래 dealDamage 참고).
 */
export type DamageSource = "melee" | "fruit" | "weapon";

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
    skillOrigin(player.position, player.aimYaw, skill, player.aimGroundPoint),
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
 * 무기 스킬의 최종 데미지 = 기본값 × (근접 데미지 비율) × 무기 배율 × 무기숙련 배율.
 * 열매의 abilityDamageMultiplier(열매 스텟에서 파생)에 대응해, 여기서는
 * 고정값인 근접 데미지(player.meleeDamage, 기본값 8 — 스텟 배분과 무관)를
 * 기준으로 스케일합니다.
 */
export function weaponSkillDamage(player: PlayerState, skill: SkillDef, weaponId: ItemId) {
  return (
    skill.damage *
    (player.meleeDamage / 8) *
    weaponDamageMultiplier(player) *
    weaponLevelDamageMultiplier(weaponMasteryLevel(player, weaponId))
  );
}

/**
 * 실제로 피해를 입히고, 죽었으면 보상을 지급합니다.
 *   · source가 "fruit"이면 열매 경험치가 들어갑니다.
 *   · 그 외(근접·무기 스킬)에는, 그 순간 무기를 손에 들고 있었다면 그 무기의
 *     숙련 경험치가 들어갑니다 (맨손이면 아무 무기 경험치도 들어오지 않음).
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

  // 여기가 핵심: 막타가 열매였을 때만 열매 경험치, 무기를 들고 있었을 때만 그 무기 경험치.
  if (source === "fruit") {
    grantFruitExp(player, fruitExpFromEnemy(enemy.expReward), events);
  } else {
    const weapon = drawnWeapon(player);
    if (weapon) grantWeaponExp(player, weapon.id, weaponExpFromEnemy(enemy.expReward), events);
  }
}

/**
 * 스킬 하나를 실제로 적용합니다. 열매/무기 스킬이 공통으로 쓰며, 데미지 값은
 * 호출부(stepCombat)가 각자의 공식(skillDamage/weaponSkillDamage)으로 미리
 * 계산해서 넘깁니다. 자기 강화·회복은 열매 스킬 전용입니다 — 무기 스킬은
 * 순수 공격/기동 위주로 설계했습니다.
 */
function applySkill(
  player: PlayerState,
  enemies: EnemyState[],
  skill: SkillDef,
  source: DamageSource,
  damage: number,
  events: GameEvent[],
) {
  // 자기 강화 — 열매 스킬 전용
  if (source === "fruit" && skill.selfBuffMultiplier && skill.selfBuffDurationSec) {
    player.fruitBuffMultiplier = skill.selfBuffMultiplier;
    player.fruitBuffRemainingSec = skill.selfBuffDurationSec;
  }

  // 회복 — 열매 스킬 전용
  if (source === "fruit" && skill.healPercentOfMaxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * skill.healPercentOfMaxHp);
  }

  // 판정 원점 — originAtMouse/originAtAim 스킬이면 마우스/조준 지점 기준으로
  // 재계산됩니다. 돌진 방향도 이 origin.aimYaw(마우스 방향으로 재조준된 값)를
  // 써야 "선더 스트라이크가 마우스 방향으로 돌진한다" 등이 실제로 맞습니다.
  const origin = skillOrigin(player.position, player.aimYaw, skill, player.aimGroundPoint);

  // 돌진 — 물리 바디 이동은 Simulation이 처리하도록 요청만 남깁니다. (공통)
  if (skill.dashDistance) {
    player.pendingDash = {
      x: Math.sin(origin.aimYaw) * skill.dashDistance,
      z: Math.cos(origin.aimYaw) * skill.dashDistance,
    };
  }

  if (skill.shape.kind === "self") return;

  // 낙뢰처럼 조준 없이 "근처 가장 가까운 대상 하나"만 노리는 스킬은, 범위 안에
  // 있는 후보들 중 가장 가까운 하나만 골라 그 대상에게만 효과를 적용합니다.
  // "가장 가까운"의 기준점도 originAtAim/originAtMouse 스킬이면 실제 판정
  // 원점(조준·마우스 지점)과 맞춰야 합니다 — 안 그러면 화면상 번개가 안 떨어진
  // 곳의 적이 맞을 수 있습니다.
  let targets = enemies.filter((enemy) => enemy.alive && isInShape(player, enemy, skill));
  if (skill.autoTargetNearest && targets.length > 1) {
    let nearest = targets[0];
    let nearestDist = dist2D(origin.x, origin.z, nearest.position.x, nearest.position.z);
    for (const enemy of targets.slice(1)) {
      const d = dist2D(origin.x, origin.z, enemy.position.x, enemy.position.z);
      if (d < nearestDist) {
        nearest = enemy;
        nearestDist = d;
      }
    }
    targets = [nearest];
  }

  for (const enemy of targets) {
    // 상태이상은 죽기 전에 걸어둡니다 (죽으면 어차피 의미 없음)
    if (skill.freezeDurationSec) {
      enemy.status.freezeRemainingSec = skill.freezeDurationSec;
    }
    if (skill.slowFactor !== undefined && skill.slowDurationSec) {
      enemy.status.slowFactor = skill.slowFactor;
      enemy.status.slowRemainingSec = skill.slowDurationSec;
    }
    if (skill.burnDps && skill.burnDurationSec) {
      enemy.status.burnDps = skill.burnDps;
      enemy.status.burnRemainingSec = skill.burnDurationSec;
    }

    if (damage > 0) dealDamage(player, enemy, damage, source, events);
  }
}

/**
 * 무장색과 손에 든 무기까지 반영한 최종 근접 데미지.
 *
 * 검/총을 실제로 손에 든 상태(또는 사막의 대검으로 검처럼 취급되는 상태)라면
 * meleeDamage(맨손 고정값)는 전혀 관여하지 않습니다 — player.swordDamageMultiplier /
 * gunDamageMultiplier 자체가 이미 statAttackPower(그 무기가 보는 스텟)로 계산된
 * "기준 공격력"이라서, 여기에 무기의 damageMultiplier만 곱하면 됩니다
 * (StatSystem.recomputeDerivedStats 참고). 진짜로 맨손일 때만(무기도 대검도
 * 없을 때) meleeDamage(+무장색 배율)를 씁니다 — 다만 canMeleeAttack이 이 경우
 * 애초에 공격 자체를 막으므로, 실전에서는 HUD 미리보기 정도에만 쓰입니다.
 *
 * 사막의 대검(모래 열매 V)이 장착돼 있는 동안은(sandBladeActive — 쿨다운 없이
 * V로 장착/해제하는 토글) 손에 진짜 무기가 없어도(열매를 뽑은 채로) 대검을 든
 * 것처럼 취급합니다 — 무기 배율 대신 그 스킬의 meleeFormMultiplier(요루보다
 * 살짝 낮음)를 쓰고, 검 스텟 기준 공격력(swordDamageMultiplier)도 실제 검처럼
 * 그대로 곱합니다. 이미 진짜 무기를 뽑은 상태라면(=fruitDrawn이 false) 이
 * 조건은 성립하지 않으므로 실제 무기 배율이 그대로 쓰입니다.
 */
export function totalMeleeDamage(player: PlayerState) {
  if (player.fruitDrawn && player.sandBladeActive) {
    const mult = SAND_BLADE_SKILL?.meleeFormMultiplier ?? 1;
    const base = mult * player.swordDamageMultiplier;
    return player.hakiActive ? base * HAKI_DAMAGE_MULTIPLIER : base;
  }
  if (!drawnWeapon(player)) return effectiveMeleeDamage(player);
  const base = weaponDamageMultiplier(player);
  return player.hakiActive ? base * HAKI_DAMAGE_MULTIPLIER : base;
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

/**
 * 지금 근접 공격(좌클릭)을 낼 수 있는 상태인지 — 사용자 요청으로 "맨주먹
 * 공격"을 완전히 없앴습니다. 손에 진짜 무기를 들고 있거나(drawnWeapon),
 * 사막의 대검이 장착돼 있을 때(fruitDrawn && sandBladeActive — 대검도 실제
 * 무기처럼 취급하는 예외)만 공격이 나갑니다. 접속 시 기본으로 나무 검을
 * 쥐고 시작하므로(다른 턴의 요청) 정상적인 플레이에서는 사실상 항상
 * true지만, 숫자키로 무기를 완전히 집어넣은 채 열매도 안 뽑은 경우처럼
 * "진짜로 아무것도 안 든" 상태에서는 false가 되어 평타 자체가 막힙니다.
 */
export function canMeleeAttack(player: PlayerState): boolean {
  return drawnWeapon(player) !== null || (player.fruitDrawn && player.sandBladeActive);
}

/**
 * 근접 공격 (좌클릭) — 기본은 플레이어 주변 원형 판정입니다.
 *
 * 새총처럼 rangedAttack이 있는 무기를 들었으면 원형 대신, 조준 방향(카메라
 * 기준 aimYaw)으로 길게 뻗는 직선 판정을 씁니다 — "마우스가 가리키는 방향으로
 * 쏜다"는 원거리 무기의 정체성을 살린 판정입니다. 이 게임은 3인칭 카메라-상대
 * 조준 방식이라, 다른 직선형 스킬들과 마찬가지로 aimYaw를 그대로 재사용합니다.
 */
function applyMelee(player: PlayerState, enemies: EnemyState[], events: GameEvent[]) {
  const damage = totalMeleeDamage(player);
  const weapon = drawnWeapon(player);

  if (weapon?.rangedAttack) {
    const origin = { x: player.position.x, z: player.position.z, aimYaw: player.aimYaw };
    const shape = { kind: "line" as const, range: weapon.rangedAttack.range, width: weapon.rangedAttack.width };
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (!pointInShape(origin, enemy.position.x, enemy.position.z, shape)) continue;
      dealDamage(player, enemy, damage, "melee", events);
    }
    return;
  }

  const range = totalMeleeRange(player);
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (dist2D(player.position.x, player.position.z, enemy.position.x, enemy.position.z) > range) continue;
    dealDamage(player, enemy, damage, "melee", events);
  }
}

/**
 * 화상 등 지속 피해 처리. 열매 스킬 또는 무기 스킬(엔마 등)에서 비롯된
 * 효과이므로, 도트로 죽어도 그 순간 손에 든 게 무엇이냐에 따라 열매/무기
 * 경험치가 들어옵니다 (지금 뽑아 든 상태를 기준으로 판단합니다 — 이
 * 프로젝트의 다른 "막타 기준" 판정들과 같은 원칙입니다).
 */
export function stepEnemyStatuses(player: PlayerState, enemies: EnemyState[], dt: number, events: GameEvent[]) {
  const dotSource: DamageSource = player.fruitDrawn ? "fruit" : drawnWeapon(player) ? "weapon" : "melee";
  for (const enemy of enemies) {
    const st = enemy.status;

    if (st.freezeRemainingSec > 0) {
      st.freezeRemainingSec = Math.max(0, st.freezeRemainingSec - dt);
    }

    if (st.slowRemainingSec > 0) {
      st.slowRemainingSec = Math.max(0, st.slowRemainingSec - dt);
      if (st.slowRemainingSec === 0) st.slowFactor = 1;
    }

    if (st.burnRemainingSec > 0) {
      st.burnRemainingSec = Math.max(0, st.burnRemainingSec - dt);
      if (enemy.alive && st.burnDps > 0) {
        dealDamage(player, enemy, st.burnDps * dt, dotSource, events);
      }
      if (st.burnRemainingSec === 0) st.burnDps = 0;
    }
  }
}

/**
 * 뇌광 질주(번개 열매 X) — 번개 변신 중, 접촉 반경 안에 있는 몬스터에게
 * 매 프레임 지속 피해를 입힙니다 (화상 도트와 같은 "초당 피해 × dt" 방식).
 * PvP 접촉 피해는 별도로 src/network/PvpCombat.ts가 서버에 요청합니다
 * (다른 플레이어의 체력은 이 클라이언트가 직접 깎을 수 없으므로).
 */
export function stepLightningForm(player: PlayerState, enemies: EnemyState[], dt: number, events: GameEvent[]) {
  if (player.lightningFormRemainingSec <= 0) return;
  player.lightningFormRemainingSec = Math.max(0, player.lightningFormRemainingSec - dt);

  const dps = LIGHTNING_FORM_SKILL?.lightningFormDps ?? 0;
  const radius = LIGHTNING_FORM_SKILL?.lightningFormContactRadius ?? 0;
  if (dps <= 0 || radius <= 0) return;

  const tickDamage = dps * dt * player.abilityDamageMultiplier * fruitLevelDamageMultiplier(player.fruitLevel) * player.fruitBuffMultiplier;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (dist2D(player.position.x, player.position.z, enemy.position.x, enemy.position.z) > radius) continue;
    dealDamage(player, enemy, tickDamage, "fruit", events);
  }
}

/**
 * 빛빛(F: 빛의 비행)·용용(F: 용의 비행) 전용 특수 능력.
 *
 * **일반 Z/X/C/V 4슬롯 시스템(weaponSkillCooldowns/fruitSkillCooldowns 배열과
 * stepCombat의 슬롯 순회 루프)과 완전히 별개입니다** — F는 이 두 열매에만
 * 존재하는 예외라, 전용 PlayerState 필드(lightFlightCooldownRemainingSec 등)로
 * 독립적으로 관리합니다. 다른 어떤 무기/열매에도 F 슬롯은 없습니다.
 *
 * Simulation.step()이 PlayerController.step()보다 먼저 이 함수를 호출해야
 * player.dragonFlightActive가 이번 프레임 안에 바로 반영되어(같은 프레임에
 * 날기 시작) PlayerController가 그걸 보고 비행 이동으로 분기할 수 있습니다.
 */
export function stepFruitSpecialAbility(dt: number, input: InputSnapshot, player: PlayerState, nowMs: number) {
  // 쿨다운은 지금 어느 열매를 장착했는지와 무관하게 항상 흘러갑니다 —
  // weaponSkillCooldowns/fruitSkillCooldowns와 같은 원칙입니다. 다만 용의
  // 비행은 "착지한 뒤부터" 쿨다운이 도는 능력이라, 날고 있는 동안에는 흐르지
  // 않습니다(활성화 자체엔 쿨다운이 없고, 착지할 때 세팅됩니다).
  player.lightFlightCooldownRemainingSec = Math.max(0, player.lightFlightCooldownRemainingSec - dt);
  if (!player.dragonFlightActive) {
    player.dragonFlightCooldownRemainingSec = Math.max(0, player.dragonFlightCooldownRemainingSec - dt);
  }
  if (player.lightFormRemainingSec > 0) {
    player.lightFormRemainingSec = Math.max(0, player.lightFormRemainingSec - dt);
  }

  // 용의 비행 — 날고 있는 동안 매초 마나를 계속 소모하고, 다 떨어지면
  // 자동으로 착지합니다(사용자 요청 범위 밖의 안전장치: 마나 없이 무한 비행 방지).
  if (player.dragonFlightActive) {
    const drain = (DRAGON_FLIGHT_SKILL.flightManaDrainPerSec ?? 0) * dt;
    if (drain > 0) {
      player.mana = Math.max(0, player.mana - drain);
      player.lastManaSpentAtMs = nowMs;
    }
    if (player.mana <= 0) {
      player.dragonFlightActive = false;
      player.dragonFlightCooldownRemainingSec = DRAGON_FLIGHT_SKILL.cooldownSec;
    }
  }

  // F는 다른 스킬들과 같은 규칙 — 열매를 실제로 뽑아 든 상태여야 하고,
  // 아직 안 먹은 열매를 손에 든(heldFruitCandidate) 동안은 동작하지 않습니다.
  if (!input.flySkillPressed || !player.fruitDrawn || player.heldFruitCandidate) return;

  if (player.equippedFruit === "light_light") {
    const skill = LIGHT_FLIGHT_SKILL;
    if (player.fruitLevel < skill.unlockFruitLevel) {
      player.events.push({ type: "skill_locked", skillName: skill.name, requiredFruitLevel: skill.unlockFruitLevel });
      return;
    }
    if (player.lightFlightCooldownRemainingSec > 0) return;
    if (player.mana < skill.manaCost) return;

    // F를 처음 누른 그 순간의 조준 방향(마우스 지점이 있으면 그 지점 방향, 없으면
    // 카메라 방향)으로 딱 한 번만 벡터를 계산합니다 — 이후 비행 중에는 방향을
    // 다시 바꿀 수 없습니다(사용자 요청). 기존 dashDistance/pendingDash 메커니즘
    // (originAtMouse 스킬들의 방향 재조준과 정확히 같은 함수)을 그대로 재사용합니다.
    const origin = skillOrigin(player.position, player.aimYaw, skill, player.aimGroundPoint);
    player.pendingDash = {
      x: Math.sin(origin.aimYaw) * (skill.dashDistance ?? 0),
      z: Math.cos(origin.aimYaw) * (skill.dashDistance ?? 0),
    };
    player.mana -= skill.manaCost;
    player.lastManaSpentAtMs = nowMs;
    player.lightFlightCooldownRemainingSec = skill.cooldownSec;
    player.lightFormRemainingSec = skill.transformDurationSec ?? 0.5;
    // 일반 skill_fired 이벤트 루프 밖(F는 슬롯 시스템에 안 속함)이라, 다른
    // 플레이어 화면에 이 능력을 보여주려면 별도 이벤트가 필요합니다
    // (PvpCombat.ts의 broadcastSpecialAbilityFx가 이 이벤트를 보고 중계합니다).
    player.events.push({ type: "special_ability_fired", abilityId: "light_f" });
  } else if (player.equippedFruit === "dragon_dragon") {
    const skill = DRAGON_FLIGHT_SKILL;
    if (player.dragonFlightActive) {
      // 이미 날고 있으면 F를 다시 누르는 건 "착지" — dragonFlightActive를
      // 끄기만 하면, 다음 PlayerController.step()이 자연히 평소 중력/충돌
      // 물리로 넘어갑니다(별도 착지 연출 없음 — stepFlight()의 전례와 동일).
      player.dragonFlightActive = false;
      player.dragonFlightCooldownRemainingSec = skill.cooldownSec;
      return;
    }
    if (player.fruitLevel < skill.unlockFruitLevel) {
      player.events.push({ type: "skill_locked", skillName: skill.name, requiredFruitLevel: skill.unlockFruitLevel });
      return;
    }
    if (player.dragonFlightCooldownRemainingSec > 0) return;
    if (player.mana < skill.manaCost) return;

    player.mana -= skill.manaCost;
    player.lastManaSpentAtMs = nowMs;
    player.dragonFlightActive = true;
    // 위 light_f와 같은 이유 — F는 skill_fired 루프 밖이라 별도 이벤트가 필요합니다.
    player.events.push({ type: "special_ability_fired", abilityId: "dragon_f" });
  }
}

export function stepCombat(
  dt: number,
  input: InputSnapshot,
  player: PlayerState,
  enemies: EnemyState[],
  nowMs: number = Date.now(),
) {
  // 쿨다운 진행
  player.meleeRemainingCooldownSec = Math.max(0, player.meleeRemainingCooldownSec - dt);
  // 검 스킬과 열매 스킬 쿨다운은 완전히 독립적입니다 — 지금 어느 쪽을 손에
  // 들고 있는지와 상관없이 둘 다 매 프레임 흘러갑니다(예: 검 스킬을 쓰고
  // 열매로 바꿔도 검 쿨다운은 실제 경과 시간만큼 계속 줄어들어야, 나중에
  // 다시 검으로 돌아왔을 때 남은 쿨다운이 맞습니다).
  for (let i = 0; i < player.weaponSkillCooldowns.length; i++) {
    player.weaponSkillCooldowns[i] = Math.max(0, player.weaponSkillCooldowns[i] - dt);
  }
  for (let i = 0; i < player.fruitSkillCooldowns.length; i++) {
    player.fruitSkillCooldowns[i] = Math.max(0, player.fruitSkillCooldowns[i] - dt);
  }

  // 자기 강화 버프 타이머
  if (player.fruitBuffRemainingSec > 0) {
    player.fruitBuffRemainingSec = Math.max(0, player.fruitBuffRemainingSec - dt);
    if (player.fruitBuffRemainingSec === 0) player.fruitBuffMultiplier = 1;
  }

  // 빙결 감옥·절대 영도 등에 맞아 얼어붙은 시간 — 다 지나면 이동 입력이 다시 먹힙니다
  // (실제로 이동 입력을 무시하는 건 PlayerController.step이 이 값을 직접 읽어서 합니다).
  if (player.frozenRemainingSec > 0) {
    player.frozenRemainingSec = Math.max(0, player.frozenRemainingSec - dt);
  }

  // 뇌광 질주 — 번개 변신 중이면 접촉 반경 안 몬스터에게 지속 피해.
  stepLightningForm(player, enemies, dt, player.events);

  // 사용자 요청: 맨주먹 공격을 완전히 없앴습니다 — 무기(또는 사막의 대검)를
  // 손에 든 상태가 아니면 좌클릭을 눌러도 아무 일도 일어나지 않습니다(쿨다운도
  // 걸리지 않고, melee_attack_fired 이벤트도 뜨지 않아 휘두르는 애니메이션조차
  // 재생되지 않습니다 — SceneRenderer.ts가 이 이벤트로 팔 휘두르기를 재생합니다).
  if (input.attackPressed && player.meleeRemainingCooldownSec <= 0 && canMeleeAttack(player)) {
    player.meleeRemainingCooldownSec = totalMeleeCooldown(player);
    applyMelee(player, enemies, player.events);
    // 몬스터를 한 마리도 맞히지 못했어도 "공격이 나갔다"는 사실 자체는 필요합니다.
    // 멀티플레이 PvP 레이어가 이 이벤트를 보고 "혹시 사거리 안에 다른 플레이어가
    // 있었는지" 별도로 검사합니다 (GameState/CombatSystem은 다른 플레이어의
    // 존재를 전혀 모릅니다 — 싱글플레이 로직은 그대로 두고 그 위에 얹은 구조).
    player.events.push({ type: "melee_attack_fired" });
  }

  // 손에서 열매를 놓치면(무기로 바꾸거나 맨손이 되면) 진행 중이던 차지도
  // 함께 취소합니다 — 차지 중엔 아직 마나/쿨다운을 쓰지 않았으므로 그냥
  // 무산시켜도 안전합니다. 그대로 두면 나중에 열매를 다시 뽑았을 때 아주
  // 오래전에 시작한 차지가 갑자기 "다 찼다"며 튀어나가는 버그가 됩니다.
  if (player.chargingSkillSlot !== null && !player.fruitDrawn) {
    player.chargingSkillSlot = null;
  }

  // Z/X/C/V는 "지금 손에 뽑아 든 것"에 따라 열매 스킬 또는 무기 스킬로 갈립니다.
  // 아무것도 뽑지 않았으면(맨손) 숫자키를 눌러 열매(4번)나 무기(1~3번)를 먼저
  // 뽑아야 하고, 그 전까지는 스킬 입력을 아예 처리하지 않습니다 —
  // skill_locked 안내조차 뜨지 않습니다(HUD도 스킬 UI를 통째로 숨깁니다).
  // heldFruitCandidate(인벤토리에서 손에 들었지만 아직 안 먹은 열매)가 있는
  // 동안은 fruitDrawn이 이미 false로 강제되지만, 만약을 대비해 여기서도
  // 한 번 더 막습니다 — "확정하기 전엔 스킬을 절대 못 쓴다"는 규칙입니다.
  const weapon = drawnWeapon(player);
  if (player.fruitDrawn && !player.heldFruitCandidate) {
    const skills = skillsForFruit(player.equippedFruit);
    for (let slot = 0; slot < 4; slot++) {
      const skill = skills[slot];
      if (!skill) continue;

      // 차지 스킬(고무 피스톨)은 "누르는 순간"이 아니라 "떼는 순간(또는
      // 최대 차지 시간 도달)"에 발동하므로, 이미 차지 중인 슬롯은
      // skillPressed(눌린 이번 프레임 엣지)가 아니어도 계속 지켜봐야 합니다.
      const isCharging = player.chargingSkillSlot === slot;
      if (!isCharging && !input.skillPressed[slot]) continue;

      if (!isCharging) {
        if (!isSlotUnlocked(slot, player.fruitLevel)) {
          player.events.push({
            type: "skill_locked",
            skillName: skill.name,
            requiredFruitLevel: skill.unlockFruitLevel,
          });
          continue;
        }

        // 토글 스킬(서리 발판·뇌광 질주)이 이미 켜져 있으면, 다시 누르는 건
        // "끄기"입니다 — 마나·쿨다운을 소모하지 않고 즉시 꺼집니다.
        if (skill.toggle && isToggleActive(player, skill)) {
          setToggleActive(player, skill, false, player.position);
          continue;
        }

        if (player.fruitSkillCooldowns[slot] > 0) continue;
        if (player.mana < skill.manaCost) continue;

        // 용암 지대·대분화(requireMouseInRange)는 마우스 지점이 물리적으로
        // 너무 멀면(또는 없으면) 아예 발동을 막습니다 — 마나·쿨다운 소모 없이
        // 조용히 무산되고, skill_target_too_far 이벤트로 HUD에 안내합니다.
        // (다른 originAtMouse 스킬들은 마우스가 없어도 originAtAim/발밑 기준으로
        // 조용히 폴백할 뿐 발동을 막지 않습니다 — 사용자 요청 범위가 그 두
        // 스킬로 한정돼 있었습니다.)
        if (skill.requireMouseInRange && !isMouseTargetInRange(player.position, player.aimGroundPoint)) {
          player.events.push({ type: "skill_target_too_far", skillName: skill.name });
          continue;
        }

        if (skill.chargeable) {
          // 여기서는 아직 마나·쿨다운을 소모하지 않습니다 — 실제로 손을
          // 뗄 때(아래) 소모합니다. 그래야 눌렀다가 취소하고 싶어서
          // 무한정 누르고 있어도(최대 차지 시간까지는) 손해가 없습니다.
          player.chargingSkillSlot = slot;
          player.chargingSkillStartedAtMs = nowMs;
          continue;
        }
      }

      // 여기부터는 (a) 이미 차지 중이던 슬롯이 놓임/최대 차지 도달로
      // 발동할 차례이거나, (b) 차지가 필요 없는 일반 스킬이 방금 눌린
      // 경우입니다.
      let chargeFrac = 0;
      if (isCharging) {
        const elapsedMs = nowMs - player.chargingSkillStartedAtMs;
        const maxMs = Math.max(1, (skill.maxChargeSec ?? 1) * 1000);
        if (input.skillHeld[slot] && elapsedMs < maxMs) continue; // 아직 누르고 있고 다 안 찼으면 계속 대기
        chargeFrac = Math.min(1, elapsedMs / maxMs);
        player.chargingSkillSlot = null;
        // 차지하는 동안 마나가 다른 스킬로 빠져나갔을 수 있으니 놓는
        // 순간 다시 한 번 확인합니다 — 부족하면 조용히 무산됩니다.
        if (player.mana < skill.manaCost) continue;
      }

      player.fruitSkillCooldowns[slot] = skill.cooldownSec;
      player.mana -= skill.manaCost;
      player.lastManaSpentAtMs = nowMs;
      let firedSkill = skill.chargeable ? withCharge(skill, chargeFrac) : skill;
      // 용으로 변신(dragonFormActive) 중이면, 그 열매(dragon_dragon)의 공격
      // 스킬(dragon_z/x/c) 사거리를 5배로 키웁니다 — dragon_v 자신(shape:"self")은
      // withRangeMultiplier가 자연히 손대지 않습니다. 데미지는 이미 별도로
      // fruitBuffMultiplier가 처리하므로 여기서는 손대지 않습니다.
      const dragonFormBoosted =
        player.dragonFormActive && player.equippedFruit === "dragon_dragon" && skill.shape.kind !== "self";
      if (dragonFormBoosted) firedSkill = withRangeMultiplier(firedSkill, DRAGON_FORM_RANGE_MULTIPLIER);
      applySkill(player, enemies, firedSkill, "fruit", skillDamage(player, firedSkill), player.events);
      if (skill.toggle) setToggleActive(player, skill, true, player.position);
      player.events.push({
        type: "skill_fired",
        slot,
        ...(skill.chargeable ? { chargeFrac } : {}),
        ...(dragonFormBoosted ? { rangeMult: DRAGON_FORM_RANGE_MULTIPLIER } : {}),
      });
    }
  } else if (weapon) {
    const skills = skillsForWeapon(weapon.id);
    const masteryLevel = weaponMasteryLevel(player, weapon.id);
    for (let slot = 0; slot < 4; slot++) {
      if (!input.skillPressed[slot]) continue;

      const skill = skills[slot];
      if (!skill) continue;

      if (!isWeaponSlotUnlocked(slot, masteryLevel)) {
        player.events.push({
          type: "weapon_skill_locked",
          skillName: skill.name,
          requiredWeaponLevel: skill.unlockFruitLevel,
        });
        continue;
      }
      if (player.weaponSkillCooldowns[slot] > 0) continue;
      if (player.mana < skill.manaCost) continue;

      player.weaponSkillCooldowns[slot] = skill.cooldownSec;
      player.mana -= skill.manaCost;
      player.lastManaSpentAtMs = nowMs;
      applySkill(player, enemies, skill, "weapon", weaponSkillDamage(player, skill, weapon.id), player.events);
      player.events.push({ type: "skill_fired", slot });
    }
  }
}

/** 토글 스킬(서리 발판·뇌광 질주)이 지금 켜져 있는지 — 스킬 id로 어느 상태 플래그를 볼지 정합니다. */
function isToggleActive(player: PlayerState, skill: SkillDef): boolean {
  if (skill.id === "ice_x") return player.iceWalkActive;
  if (skill.id === "thunder_x") return player.lightningFormRemainingSec > 0;
  if (skill.id === "sand_v") return player.sandBladeActive;
  if (skill.id === "dragon_v") return player.dragonFormActive;
  return false;
}

/** 토글 스킬을 켜거나 끕니다. 켤 때는 지금 위치를 중심으로 기록합니다(서리 발판의 얼음판 중심). */
function setToggleActive(player: PlayerState, skill: SkillDef, active: boolean, position: { x: number; z: number }) {
  if (skill.id === "ice_x") {
    player.iceWalkActive = active;
    player.iceWalkCenter = active ? { x: position.x, z: position.z } : null;
  } else if (skill.id === "thunder_x") {
    player.lightningFormRemainingSec = active ? skill.lightningFormDurationSec ?? 0 : 0;
  } else if (skill.id === "sand_v") {
    // 쿨다운 없이 V로 장착/해제 — 뇌광 질주와 달리 시간 제한 없이 다시 누를
    // 때까지 그대로 유지됩니다(사용자 요청).
    player.sandBladeActive = active;
  } else if (skill.id === "dragon_v") {
    // 용으로 변신 — 사막의 대검과 같은 무제한 지속 토글. 켜질 때 열매 데미지
    // 배율(fruitBuffMultiplier)을 직접 세팅하고, 꺼질 때 1로 되돌립니다.
    // rubber_v(기어 세컨드)와 달리 fruitBuffRemainingSec 타이머를 쓰지 않으므로
    // (0인 채로 둠) stepCombat의 자동 만료 로직과 충돌하지 않습니다 — 오직 V를
    // 다시 눌러야만 꺼집니다.
    player.dragonFormActive = active;
    player.fruitBuffMultiplier = active ? 1 + (skill.dragonFormDamageMultiplierBonus ?? 0) : 1;
  }
}
