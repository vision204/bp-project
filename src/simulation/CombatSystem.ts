import type { EnemyState, GameEvent, ItemId, PlayerState } from "../core/GameState";
import type { InputSnapshot } from "../core/InputManager";
import { damageEnemy } from "./EnemyManager";
import { grantExp } from "./Leveling";
import { effectiveMeleeDamage } from "./HakiSystem";
import { fruitExpFromEnemy, fruitLevelDamageMultiplier, grantFruitExp } from "./FruitLeveling";
import { weaponExpFromEnemy, weaponLevelDamageMultiplier, weaponMasteryLevel, grantWeaponExp } from "./WeaponLeveling";
import { isSlotUnlocked, skillsForFruit, withCharge, type SkillDef } from "./skills";
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
 * 무기 스킬의 최종 데미지 = 기본값 × (공격 스텟 비율) × 무기 배율 × 무기숙련 배율.
 * 열매의 abilityDamageMultiplier(열매 스텟에서 파생)에 대응해, 여기서는
 * 공격 스텟에서 파생된 근접 데미지(player.meleeDamage, 기본값 8)를 기준으로
 * 스케일합니다.
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
 * 사막의 대검(모래 열매 V)이 장착돼 있는 동안은(sandBladeActive — 쿨다운 없이
 * V로 장착/해제하는 토글) 손에 진짜 무기가 없어도(열매를 뽑은 채로) 대검을 든
 * 것처럼 취급합니다 — 무기 배율 대신 그 스킬의 meleeFormMultiplier(요루보다
 * 살짝 낮음)를 쓰고, 검 스텟(swordDamageMultiplier)도 실제 검처럼 그대로
 * 곱합니다. 이미 진짜 무기를 뽑은 상태라면(=fruitDrawn이 false) 이 조건은
 * 성립하지 않으므로 실제 무기 배율이 그대로 쓰입니다.
 */
export function totalMeleeDamage(player: PlayerState) {
  if (player.fruitDrawn && player.sandBladeActive) {
    const mult = SAND_BLADE_SKILL?.meleeFormMultiplier ?? 1;
    return effectiveMeleeDamage(player) * mult * player.swordDamageMultiplier;
  }
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

export function stepCombat(
  dt: number,
  input: InputSnapshot,
  player: PlayerState,
  enemies: EnemyState[],
  nowMs: number = Date.now(),
) {
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

  // 빙결 감옥·절대 영도 등에 맞아 얼어붙은 시간 — 다 지나면 이동 입력이 다시 먹힙니다
  // (실제로 이동 입력을 무시하는 건 PlayerController.step이 이 값을 직접 읽어서 합니다).
  if (player.frozenRemainingSec > 0) {
    player.frozenRemainingSec = Math.max(0, player.frozenRemainingSec - dt);
  }

  // 뇌광 질주 — 번개 변신 중이면 접촉 반경 안 몬스터에게 지속 피해.
  stepLightningForm(player, enemies, dt, player.events);

  if (input.attackPressed && player.meleeRemainingCooldownSec <= 0) {
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

        if (player.skillCooldowns[slot] > 0) continue;
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

      player.skillCooldowns[slot] = skill.cooldownSec;
      player.mana -= skill.manaCost;
      player.lastManaSpentAtMs = nowMs;
      const firedSkill = skill.chargeable ? withCharge(skill, chargeFrac) : skill;
      applySkill(player, enemies, firedSkill, "fruit", skillDamage(player, firedSkill), player.events);
      if (skill.toggle) setToggleActive(player, skill, true, player.position);
      player.events.push(
        skill.chargeable ? { type: "skill_fired", slot, chargeFrac } : { type: "skill_fired", slot },
      );
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
      if (player.skillCooldowns[slot] > 0) continue;
      if (player.mana < skill.manaCost) continue;

      player.skillCooldowns[slot] = skill.cooldownSec;
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
  }
}
