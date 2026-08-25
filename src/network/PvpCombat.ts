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
import { skillsForFruit } from "../simulation/skills";
import { skillsForWeapon } from "../simulation/weaponSkills";
import type { CombatStatsSnapshot } from "./protocol";
import type { MultiplayerClient } from "./MultiplayerClient";

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

  for (const ev of p.events) {
    if (ev.type === "melee_attack_fired") {
      const range = totalMeleeRange(p);
      for (const target of mp.meleeCandidates(range)) {
        mp.sendMeleeAttack(target.snapshot.id);
      }
    } else if (ev.type === "skill_fired") {
      const skill = activeSkillsFor(state)[ev.slot];
      if (!skill || skill.shape.kind === "self") continue;
      for (const target of mp.shapeCandidates(skill.shape)) {
        mp.sendSkillAttack(target.snapshot.id, ev.slot);
      }
    }
  }
}

/** 지금 손에 든 무기 id (없으면 null) — 서버 동기화 + 원격 렌더링용 */
export function drawnWeaponId(state: GameState): string | null {
  return drawnWeapon(state.player)?.id ?? null;
}
