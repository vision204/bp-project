import type { SkillDef, SkillShape } from "./skills";

// ---------------------------------------------------------------------------
// 스킬 판정 모양(원형·부채꼴·직선) 기하 계산을 CombatSystem에서 분리했습니다.
//
// 원래는 CombatSystem.ts 안에서 "플레이어 vs 몬스터"만 검사하는 사적 함수였는데,
// 멀티플레이 PvP가 생기면서 "플레이어 vs 다른 플레이어"에도 **똑같은 판정**이
// 필요해졌습니다. 클라이언트(공격 후보 필터링)와 서버(진짜 판정)가 이 함수를
// 그대로 같이 써야 "클라에서는 맞은 것 같은데 서버가 인정 안 해준다" 같은
// 어긋남이 생기지 않습니다. CombatSystem.ts의 몬스터 판정 동작은 이 파일을
// 호출하도록 바뀌었을 뿐, 계산식 자체는 한 글자도 바뀌지 않았습니다.
// ---------------------------------------------------------------------------

/** 판정의 원점 — 위치(x,z)와 조준 방향(카메라 기준 yaw) */
export interface ShapeOrigin {
  x: number;
  z: number;
  aimYaw: number;
}

/** targetX/targetZ가 origin에서 쏜 skill 판정 범위 안에 있는지 검사합니다. */
export function pointInShape(origin: ShapeOrigin, targetX: number, targetZ: number, shape: SkillShape): boolean {
  const dx = targetX - origin.x;
  const dz = targetZ - origin.z;
  const dist = Math.hypot(dx, dz);

  switch (shape.kind) {
    case "self":
      return false;

    case "radial":
      return dist <= shape.radius;

    case "cone": {
      if (dist > shape.range) return false;
      if (dist < 0.001) return true;
      // 이동 벡터와 같은 규약: forward = (sin(yaw), cos(yaw))
      const fx = Math.sin(origin.aimYaw);
      const fz = Math.cos(origin.aimYaw);
      const cos = (dx * fx + dz * fz) / dist;
      const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      return angleDeg <= shape.halfAngleDeg;
    }

    case "line": {
      const fx = Math.sin(origin.aimYaw);
      const fz = Math.cos(origin.aimYaw);
      // 전방 축 투영 거리 (뒤쪽이면 음수 → 제외)
      const along = dx * fx + dz * fz;
      if (along < 0 || along > shape.range) return false;
      // 축에서 좌우로 벗어난 거리
      const perp = Math.abs(dx * fz - dz * fx);
      return perp <= shape.width / 2;
    }
  }
}

/** 두 지점의 수평(x,z) 거리 — 근접 공격/사거리 판정에 씁니다. */
export function dist2D(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * 스킬의 실제 판정 원점을 계산합니다. 대부분의 스킬은 플레이어 위치 그대로지만,
 * skill.originAtAim이 true인 스킬(낙뢰·빙결 감옥·절대 영도·중력정)은 조준 방향으로
 * "반경 × 0.6"만큼 앞선 지점이 원점이 됩니다 — 발밑이 아니라 내가 보는 곳을
 * 때리는 스킬이기 때문입니다(사용자 요청).
 *
 * CombatSystem.ts(PvE)와 server/state.ts(PvP)가 이 함수를 그대로 같이 써야
 * "클라에서는 맞은 것 같은데 서버가 인정 안 해준다" 같은 어긋남이 생기지 않습니다
 * — ShapeMath.ts 파일 상단 설명과 같은 이유입니다.
 */
export function skillOrigin(position: { x: number; z: number }, aimYaw: number, skill: SkillDef): ShapeOrigin {
  if (!skill.originAtAim || skill.shape.kind !== "radial") {
    return { x: position.x, z: position.z, aimYaw };
  }
  const offset = skill.shape.radius * 0.6;
  return {
    x: position.x + Math.sin(aimYaw) * offset,
    z: position.z + Math.cos(aimYaw) * offset,
    aimYaw,
  };
}
