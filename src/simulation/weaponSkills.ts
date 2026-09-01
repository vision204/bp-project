import type { ItemId } from "../core/GameState";
import { SLOT_UNLOCK_LEVELS, type SkillDef } from "./skills";

// ---------------------------------------------------------------------------
// 무기 스킬 카탈로그 — skills.ts(열매 스킬)와 완전히 같은 형태(SkillDef)를
// 재사용합니다. 무기를 손에 들었을 때(뽑았을 때)만 Z/X/C/V에 이 스킬들이
// 뜨고, 무기 숙련도(WeaponLeveling.ts)가 SLOT_UNLOCK_LEVELS([1,25,50,100])에
// 닿을 때마다 하나씩 풀립니다 — 열매와 완전히 같은 규칙입니다.
//
// SkillDef.unlockFruitLevel 필드명은 열매 스킬 카탈로그에서 붙인 이름이지만,
// 여기서는 "이 무기 숙련도 이상이어야 사용 가능"이라는 뜻으로 그대로
// 재사용합니다 (타입을 새로 만들 만큼 의미가 달라지지 않아서입니다).
// ---------------------------------------------------------------------------

export const WEAPON_SKILLS: Partial<Record<ItemId, SkillDef[]>> = {
  // ── 요루: 무겁고 느리지만 한 방이 가장 강한 대검 ──────────────────────
  sword_yoru: [
    {
      id: "yoru_z",
      name: "칼바람 베기",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 3,
      manaCost: 12,
      damage: 2.5,
      shape: { kind: "cone", range: 5.5, halfAngleDeg: 40 },
      description: "흑도를 크게 휘둘러 전방 부채꼴을 베어냅니다.",
    },
    {
      id: "yoru_x",
      name: "패도 일섬",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 7,
      manaCost: 24,
      damage: 3.4,
      shape: { kind: "line", range: 10, width: 2.2 },
      dashDistance: 10,
      description: "몸을 던져 일직선으로 베어 가르며 돌진합니다.",
    },
    {
      id: "yoru_c",
      name: "귀참",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 13,
      manaCost: 36,
      damage: 4.6,
      shape: { kind: "radial", radius: 6 },
      slowFactor: 0.4,
      slowDurationSec: 2.5,
      description: "주변을 통째로 베어 넘기며 상대를 크게 휘청이게 합니다.",
    },
    {
      id: "yoru_v",
      name: "명도의 진각",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 24,
      manaCost: 60,
      damage: 9.6,
      shape: { kind: "cone", range: 8, halfAngleDeg: 55 },
      description: "세계 최강의 대검이 내리꽂히는 필살의 일격.",
    },
  ],

  // ── 삼도류: 짧지만 빠른 연타형 ─────────────────────────────────────────
  sword_santoryu: [
    {
      id: "santoryu_z",
      name: "삼도 난무",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 1.6,
      manaCost: 8,
      damage: 1.5,
      shape: { kind: "radial", radius: 3 },
      description: "칼 세 자루로 빠르게 연속 베기.",
    },
    {
      id: "santoryu_x",
      name: "질풍 베기",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 4.5,
      manaCost: 16,
      damage: 1.9,
      shape: { kind: "line", range: 9, width: 1.8 },
      dashDistance: 9,
      description: "바람처럼 빠르게 파고들며 베어 넘깁니다.",
    },
    {
      id: "santoryu_c",
      name: "선풍참",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 8,
      manaCost: 26,
      damage: 2.5,
      shape: { kind: "radial", radius: 5.5 },
      description: "제자리에서 회전하며 주변을 연속으로 베어냅니다.",
    },
    {
      id: "santoryu_v",
      name: "오니기리",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 18,
      manaCost: 48,
      damage: 7.0,
      shape: { kind: "cone", range: 6.5, halfAngleDeg: 60 },
      description: "삼도류 최고의 오의 — 순식간에 수십 번을 베어냅니다.",
    },
  ],

  // ── 엔마: 가장 길고 가벼운 붉은 장검 (사거리 특화) ──────────────────────
  sword_enma: [
    {
      id: "enma_z",
      name: "적룡 찌르기",
      slot: 0,
      unlockFruitLevel: 1,
      cooldownSec: 2.4,
      manaCost: 10,
      damage: 1.8,
      shape: { kind: "line", range: 8.5, width: 1.6 },
      description: "가장 긴 사거리로 찔러 꿰뚫습니다.",
    },
    {
      id: "enma_x",
      name: "붉은 궤적",
      slot: 1,
      unlockFruitLevel: 25,
      cooldownSec: 6,
      manaCost: 20,
      damage: 2.2,
      shape: { kind: "line", range: 13, width: 2 },
      dashDistance: 13,
      description: "붉은 궤적을 그리며 가장 멀리 돌진 베기.",
    },
    {
      id: "enma_c",
      name: "화룡 베기",
      slot: 2,
      unlockFruitLevel: 50,
      cooldownSec: 11,
      manaCost: 32,
      damage: 3.0,
      shape: { kind: "cone", range: 7.5, halfAngleDeg: 45 },
      burnDps: 8,
      burnDurationSec: 3,
      description: "칼날에 열기를 둘러 베인 상처가 계속 타오릅니다.",
    },
    {
      id: "enma_v",
      name: "명왕참",
      slot: 3,
      unlockFruitLevel: 100,
      cooldownSec: 22,
      manaCost: 55,
      damage: 7.8,
      shape: { kind: "line", range: 16, width: 2.6 },
      burnDps: 12,
      burnDurationSec: 4,
      description: "가장 긴 사거리로 일직선을 그으며 불태워버립니다.",
    },
  ],
};

export function skillsForWeapon(weaponId: ItemId | null): SkillDef[] {
  if (!weaponId) return [];
  return WEAPON_SKILLS[weaponId] ?? [];
}

export function allWeaponSkills(): SkillDef[] {
  return Object.values(WEAPON_SKILLS).flat();
}

/** slot: 0=Z,1=X,2=C,3=V. masteryLevel: 이 무기의 현재 숙련 레벨. */
export function isWeaponSlotUnlocked(slot: number, masteryLevel: number) {
  return masteryLevel >= SLOT_UNLOCK_LEVELS[slot];
}
