// ---------------------------------------------------------------------------
// 싱글플레이 전투(CombatSystem.ts)와 멀티플레이 PvP를 잇는 얇은 다리입니다.
//
// CombatSystem.ts는 여전히 몬스터만 알고, 다른 플레이어의 존재를 전혀
// 모릅니다 — 그래야 싱글플레이 동작과 verify-logic.mjs 검증이 그대로 유지됩니다.
// 대신 "근접 공격이 나갔다"/"스킬을 썼다" 이벤트(melee_attack_fired/skill_fired)를
// 매 프레임 여기서 확인해서, 사거리 안에 PvP가 켜진 다른 진영 플레이어가
// 있으면 서버에 공격 요청만 보냅니다. 실제 데미지 판정과 적용은 서버와
// MultiplayerClient가 담당합니다 (server/state.ts 참고).
// ---------------------------------------------------------------------------

import type { GameState } from "../core/GameState";
import { totalMeleeRange } from "../simulation/CombatSystem";
import { drawnWeapon } from "../simulation/WeaponSystem";
import { weaponMasteryLevel } from "../simulation/WeaponLeveling";
import { dist2D } from "../simulation/ShapeMath";
import { skillsForFruit, withRangeMultiplier } from "../simulation/skills";
import { skillsForWeapon } from "../simulation/weaponSkills";
import { isInSafeZone } from "../world/SafeZones";
import { LIGHTNING_CONTACT_INTERVAL_MS, type CombatStatsSnapshot } from "./protocol";
import type { MultiplayerClient, RemotePlayerView } from "./MultiplayerClient";

/** 뇌광 질주(번개 열매 X)의 변신 수치 — src/simulation/skills.ts가 유일한 출처입니다. */
const LIGHTNING_FORM_SKILL = skillsForFruit("thunder_strike")[1];
/** 마지막으로 lightning_contact를 보낸 시각 — 서버와 같은 간격으로 스스로 걸러서 보냅니다. */
let lastLightningSentAtMs = 0;

/** 현재 스텟으로부터 서버 동기화용 스냅샷을 만듭니다. */
export function buildCombatStatsSnapshot(state: GameState): CombatStatsSnapshot {
  const p = state.player;
  const weapon = drawnWeapon(p);
  return {
    meleeDamage: p.meleeDamage,
    meleeRange: p.meleeRange,
    meleeCooldownSec: p.meleeCooldownSec,
    hakiActive: p.hakiActive,
    activeHotbarSlot: p.activeHotbarSlot,
    hotbar: [...p.hotbar],
    abilityDamageMultiplier: p.abilityDamageMultiplier,
    swordDamageMultiplier: p.swordDamageMultiplier,
    gunDamageMultiplier: p.gunDamageMultiplier,
    fruitLevel: p.fruitLevel,
    fruitBuffMultiplier: p.fruitBuffMultiplier,
    equippedFruit: p.equippedFruit,
    fruitDrawn: p.fruitDrawn,
    weaponMasteryLevel: weapon ? weaponMasteryLevel(p, weapon.id) : 1,
    dragonFormActive: p.dragonFormActive,
  };
}

/** 지금 스킬 판정에 써야 할 카탈로그 — 뽑아 든 게 열매면 열매 스킬, 무기면 무기 스킬. */
function activeSkillsFor(state: GameState) {
  const p = state.player;
  if (p.fruitDrawn) return skillsForFruit(p.equippedFruit);
  const weapon = drawnWeapon(p);
  return weapon ? skillsForWeapon(weapon.id) : [];
}

/**
 * 이번 프레임에 발생한 공격 이벤트를 보고, PvP가 켜진 다른 진영 플레이어가
 * 사거리 안에 있으면 서버로 공격 요청을 보냅니다.
 *
 * 실제로 맞았는지, 데미지가 얼마인지는 여기서 정하지 않습니다 — 서버가
 * 같은 CombatSystem 공식으로 다시 계산해서 최종 판정합니다 (클라이언트
 * 후보 필터링은 "굳이 서버에 물어볼 필요도 없는 공격"을 줄이기 위한
 * 최적화일 뿐, 데미지의 출처가 아닙니다).
 */
export function processPvpAttacks(state: GameState, mp: MultiplayerClient) {
  if (!mp.connected || !state.player.pvpEnabled) return;
  const p = state.player;
  // 본부 건물 안(PvP 안전지역)에서는 공격 자체를 내보내지 않습니다 — 서버도
  // 같은 좌표 판정을 다시 하므로(server/state.ts basicPvpCheck) 이건 그냥
  // "굳이 서버에 물어볼 필요도 없는 공격"을 거르는 최적화이지, 판정의 출처가
  // 아닙니다(파일 상단 설명과 같은 원칙).
  if (isInSafeZone(p.position.x, p.position.z)) return;

  for (const ev of p.events) {
    if (ev.type === "melee_attack_fired") {
      const range = totalMeleeRange(p);
      for (const target of mp.meleeCandidates(range)) {
        if (isInSafeZone(target.renderX, target.renderZ)) continue;
        mp.sendMeleeAttack(target.snapshot.id);
      }
    } else if (ev.type === "skill_fired") {
      let skill = activeSkillsFor(state)[ev.slot];
      if (!skill || skill.shape.kind === "self") continue;
      // 용으로 변신 중이면(rangeMult가 실려 있으면) CombatSystem.ts가 실제로
      // 판정에 쓴 것과 같은(5배 넓어진) 범위로 후보를 찾아야, 넓어진 사거리
      // 안의 다른 플레이어에게도 실제로 skill_attack이 갑니다.
      if (ev.rangeMult) skill = withRangeMultiplier(skill, ev.rangeMult);
      let candidates = mp.shapeCandidates(skill.shape);
      // 낙뢰처럼 "근처 가장 가까운 대상 하나"만 노리는 스킬은 서버도 같은 이름의
      // 후보 하나만 검증하므로, 여기서도 가장 가까운 후보 하나만 골라 보냅니다.
      if (skill.autoTargetNearest && candidates.length > 1) {
        const p = state.player;
        candidates = [
          candidates.reduce((nearest, cur) =>
            dist2D(p.position.x, p.position.z, cur.renderX, cur.renderZ) <
            dist2D(p.position.x, p.position.z, nearest.renderX, nearest.renderZ)
              ? cur
              : nearest,
          ),
        ];
      }
      for (const target of candidates) {
        if (isInSafeZone(target.renderX, target.renderZ)) continue;
        mp.sendSkillAttack(target.snapshot.id, ev.slot);
      }
    }
  }
}

/**
 * 뇌광 질주(번개 열매 X) — 번개 변신 중이면, 접촉 반경 안에 있는 PvP 후보들에게
 * 짧은 간격으로 반복 접촉 피해 요청을 보냅니다. NPC(몬스터)에게 주는 피해는
 * CombatSystem.stepLightningForm이 이미 매 프레임 직접 처리하므로 여기서는
 * 다른 플레이어만 다룹니다 — 다른 사람의 체력은 서버를 거쳐야만 바뀔 수 있어서입니다.
 */
export function processLightningForm(state: GameState, mp: MultiplayerClient, nowMs: number) {
  if (!mp.connected || !state.player.pvpEnabled) return;
  if (state.player.lightningFormRemainingSec <= 0) return;
  if (nowMs - lastLightningSentAtMs < LIGHTNING_CONTACT_INTERVAL_MS) return;
  if (isInSafeZone(state.player.position.x, state.player.position.z)) return;

  const radius = LIGHTNING_FORM_SKILL?.lightningFormContactRadius ?? 0;
  if (radius <= 0) return;
  const nearby: RemotePlayerView[] = mp
    .meleeCandidates(radius)
    .filter((t) => !isInSafeZone(t.renderX, t.renderZ));
  if (nearby.length === 0) return;

  lastLightningSentAtMs = nowMs;
  for (const target of nearby) {
    mp.sendLightningContact(target.snapshot.id);
  }
}

/** 지금 손에 든 무기 id (없으면 null) — 서버 동기화 + 원격 렌더링용 */
export function drawnWeaponId(state: GameState): string | null {
  return drawnWeapon(state.player)?.id ?? null;
}

/**
 * 지금 스킬 이펙트에 써야 할 id — 열매를 뽑았으면 열매 id, 무기를 뽑았으면 무기 id.
 * drawnWeaponId와 굳이 분리해둔 이유: drawnWeaponId는 "무기를 손에 쥐고 있는지"
 * (원격 무기 모델 표시용)만 나타내야 해서 열매를 뽑았을 때는 null이어야 하지만,
 * 스킬 이펙트는 열매 스킬을 썼을 때도 당연히 화면에 보여야 하기 때문입니다.
 * (열매 id와 무기 id는 서로 겹치지 않으므로 같은 skill_fx.weaponId 필드에 그대로 실어 보냅니다)
 */
function activeSkillFxId(state: GameState): string | null {
  const p = state.player;
  if (p.fruitDrawn) return p.equippedFruit;
  return drawnWeapon(p)?.id ?? null;
}

/**
 * 스킬을 쓸 때마다(전투 후보 유무·PvP 켬/끔과 무관하게) 같은 방의 다른 사람
 * 화면에도 스킬 이펙트가 보이도록 순수 연출용 알림을 보냅니다.
 *
 * processPvpAttacks와 굳이 분리해둔 이유: processPvpAttacks는 맨 위에서
 * `!state.player.pvpEnabled`면 통째로 return해버리는데(데미지 판정이니까 당연),
 * 이펙트는 PvP를 꺼둔 사람이 써도 다른 사람 눈에는 보여야 자연스러워서
 * 그 가드에 걸리지 않는 별도 함수로 뒀습니다.
 */
export function broadcastSkillFx(state: GameState, mp: MultiplayerClient) {
  if (!mp.connected) return;
  const p = state.player;
  for (const ev of p.events) {
    if (ev.type === "skill_fired") {
      // chargeFrac/rangeMult를 그대로 실어 보내서, 다른 사람 화면의 이펙트도
      // 내가 실제로 판정에 쓴 것과 같은 크기(차지 사거리·용으로 변신 5배)로
      // 보이게 합니다 — 안 그러면 원격 이펙트는 항상 기본 크기로만 보여서
      // "분명 넓게 맞았는데 이펙트는 작았다"는 어긋남이 생깁니다.
      mp.sendSkillFx(ev.slot, activeSkillFxId(state), p.position, p.aimYaw, ev.chargeFrac, ev.rangeMult);
    }
  }
}

/**
 * 빛의 비행(F)·용의 비행(F)을 쓸 때마다(전투 후보 유무·PvP 켬/끔과 무관하게) 같은
 * 방의 다른 사람 화면에도 이펙트가 보이도록 순수 연출용 알림을 보냅니다.
 * broadcastSkillFx와 같은 이유로 별도 함수로 뒀습니다 — F는 일반 skill_fired
 * 이벤트/슬롯 시스템 밖이라(special_ability_fired) 완전히 분리된 경로가 필요합니다.
 */
export function broadcastSpecialAbilityFx(state: GameState, mp: MultiplayerClient) {
  if (!mp.connected) return;
  const p = state.player;
  for (const ev of p.events) {
    if (ev.type === "special_ability_fired") {
      mp.sendSpecialAbilityFx(ev.abilityId, p.position, p.aimYaw);
    }
  }
}

/**
 * 기본 근접 공격(좌클릭)을 쓸 때마다(전투 후보 유무·PvP 켬/끔과 무관하게) 같은
 * 방의 다른 사람 화면에도 휘두르는 모션이 보이도록 순수 연출용 알림을 보냅니다.
 * broadcastSkillFx와 같은 이유로 processPvpAttacks(데미지 판정, pvpEnabled 가드)와
 * 분리해뒀습니다.
 */
export function broadcastMeleeFx(state: GameState, mp: MultiplayerClient) {
  if (!mp.connected) return;
  for (const ev of state.player.events) {
    if (ev.type === "melee_attack_fired") {
      mp.sendMeleeFx();
    }
  }
}

/**
 * Q 대쉬가 나갈 때마다(전투 후보 유무·PvP 켬/끔과 무관하게) 같은 방의 다른 사람
 * 화면에도 바람 이펙트가 보이도록 순수 연출용 알림을 보냅니다.
 */
export function broadcastDashFx(state: GameState, mp: MultiplayerClient) {
  if (!mp.connected) return;
  for (const ev of state.player.events) {
    if (ev.type === "player_dashed") {
      mp.sendDashFx(ev.dx, ev.dz);
    }
  }
}
