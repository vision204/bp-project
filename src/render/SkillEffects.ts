import * as THREE from "three";
import type { ItemId } from "../core/GameState";
import type { SkillDef } from "../simulation/skills";

// ---------------------------------------------------------------------------
// 요루 / 삼도류 / 엔마 — 무기 스킬(Z/X/C/V) 이펙트.
//
// 판정 모양(ShapeMath.pointInShape)과 정확히 같은 도형(부채꼴/직선/원형)을
// 그대로 눈에 보이는 이펙트로 그립니다 — "맞는 범위 = 보이는 범위"가 되도록.
// 좌표계도 ShapeMath와 맞춥니다: forward = (sin(yaw), cos(yaw))이므로, 여기서는
// 로컬 좌표계에서 정면(+Z)을 기준으로 도형을 만들고, 다 만든 그룹을
// group.rotation.y = aimYaw로 돌려서 씁니다 (SceneRenderer의 대쉬 바람
// 이펙트와 동일한 규약).
//
// 무기마다 색 테마를 다르게 줘서(요루=검보라, 삼도류=흰/연두, 엔마=빨강/주황)
// 한눈에 "어느 무기 스킬인지" 구분되게 하고, 필살기(슬롯 3 = V)는 한 단계
// 더 화려하게(파편 수↑, 밝은 섬광 추가) 만듭니다. 둔화(slowFactor)가 있으면
// 서리 파편을, 화상(burnDps)이 있으면 잉걸불이 타오르는 별도의 오래 남는
// 이펙트를 덧붙입니다.
// ---------------------------------------------------------------------------

export interface WeaponVfxTheme {
  core: number;
  glow: number;
  spark: number;
}

const WEAPON_VFX_THEMES: Partial<Record<ItemId, WeaponVfxTheme>> = {
  sword_yoru: { core: 0x1b0a2e, glow: 0x9b30ff, spark: 0xe0b3ff },
  sword_santoryu: { core: 0xeaffe9, glow: 0x7cfc9a, spark: 0xffffff },
  sword_enma: { core: 0xff2d10, glow: 0xff8a3d, spark: 0xffd27a },
};

const FROST_THEME: WeaponVfxTheme = { core: 0xbfe9ff, glow: 0xffffff, spark: 0xdff6ff };
const EMBER_THEME: WeaponVfxTheme = { core: 0xff5a1f, glow: 0xffb347, spark: 0xffe08a };

/** 스폰된 이펙트 하나 — SceneRenderer가 매 프레임 이 정보로 페이드/파편 이동을 갱신합니다. */
export interface BuiltSkillEffect {
  group: THREE.Group;
  durationMs: number;
  /** 시간이 지나며 그룹 전체가 이만큼(비율) 더 커집니다 (0이면 크기 고정). */
  growTo: number;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function makeBasicMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * 원점(0,0,0)을 기준으로 rInner~rOuter 사이, 정면(+Z)을 중심으로 좌우
 * ±halfAngle만큼 퍼지는 부채꼴 띠 메시. rInner=0이면 꽉 찬 부채꼴(원점이
 * 뾰족한 부분)이 되고, rInner를 rOuter에 가깝게 주면 얇은 테두리 아크가 됩니다.
 * halfAngle=Math.PI를 주면 360도 전체(원형)가 됩니다 — 원형 스킬 이펙트에도
 * 이 함수 하나로 재사용합니다.
 */
function buildArcMesh(
  rInner: number,
  rOuter: number,
  halfAngle: number,
  segments: number,
  color: number,
  opacity: number,
  y: number,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -halfAngle + (2 * halfAngle * i) / segments;
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    positions.push(sx * rInner, y, cz * rInner);
    positions.push(sx * rOuter, y, cz * rOuter);
  }
  for (let i = 0; i < segments; i++) {
    const i0 = i * 2;
    const i1 = i * 2 + 1;
    const i2 = i * 2 + 2;
    const i3 = i * 2 + 3;
    indices.push(i0, i1, i2, i1, i3, i2);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  const mat = makeBasicMat(color, opacity);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.baseOpacity = opacity;
  mesh.userData.role = "sweep";
  return mesh;
}

/** 부채꼴/원형 범위 안에서 바깥으로 튀어나가는 작은 파편들. */
function addRadialShards(
  group: THREE.Group,
  count: number,
  color: number,
  halfAngle: number,
  range: number,
) {
  for (let i = 0; i < count; i++) {
    const mat = makeBasicMat(color, 0.85);
    const size = 0.05 + Math.random() * 0.09;
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(size), mat);
    const a = -halfAngle + Math.random() * (2 * halfAngle);
    const r = range * (0.25 + Math.random() * 0.75);
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    mesh.position.set(sx * r, 0.35 + Math.random() * 0.9, cz * r);
    mesh.userData.baseOpacity = 0.85;
    mesh.userData.role = "shard";
    mesh.userData.vx = sx;
    mesh.userData.vz = cz;
    mesh.userData.vy = 0.3 + Math.random() * 0.6;
    mesh.userData.speed = 1.5 + Math.random() * 2.5;
    group.add(mesh);
  }
}

/** 직선(찌르기/돌진) 범위를 따라 흩뿌려지는 파편들 — 부채꼴/원형과 달리 z축(사거리)을 따라 고르게 분포. */
function addLineShards(group: THREE.Group, count: number, color: number, range: number, width: number) {
  for (let i = 0; i < count; i++) {
    const mat = makeBasicMat(color, 0.85);
    const size = 0.05 + Math.random() * 0.09;
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(size), mat);
    const z = range * (0.15 + Math.random() * 0.85);
    const x = (Math.random() - 0.5) * width * 1.4;
    mesh.position.set(x, 0.5 + Math.random() * 0.7, z);
    mesh.userData.baseOpacity = 0.85;
    mesh.userData.role = "shard";
    mesh.userData.vx = Math.sign(x || 1) * (0.3 + Math.random() * 0.5);
    mesh.userData.vz = 0.15 + Math.random() * 0.3;
    mesh.userData.vy = 0.4 + Math.random() * 0.5;
    mesh.userData.speed = 1.5 + Math.random() * 2.5;
    group.add(mesh);
  }
}

/** 필살기(슬롯 3)에 얹는 밝은 섬광 — 짧고 강하게 반짝였다 사라집니다. */
function addUltimateFlash(group: THREE.Group, y: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12), makeBasicMat(0xffffff, 0.95));
  mesh.position.y = y;
  mesh.userData.baseOpacity = 0.95;
  mesh.userData.role = "sweep";
  group.add(mesh);
}

/** 둔화(slowFactor) 효과가 있는 스킬에 덧붙는 서리 파편. */
function addFrostShards(group: THREE.Group, count: number, halfAngle: number, range: number) {
  for (let i = 0; i < count; i++) {
    const mat = makeBasicMat(FROST_THEME.spark, 0.8);
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.06 + Math.random() * 0.07), mat);
    const a = -halfAngle + Math.random() * (2 * halfAngle);
    const r = range * (0.2 + Math.random() * 0.8);
    mesh.position.set(Math.sin(a) * r, 0.2 + Math.random() * 0.7, Math.cos(a) * r);
    mesh.userData.baseOpacity = 0.8;
    mesh.userData.role = "shard";
    mesh.userData.vx = (Math.random() - 0.5) * 0.4;
    mesh.userData.vz = (Math.random() - 0.5) * 0.4;
    mesh.userData.vy = 0.15 + Math.random() * 0.25;
    mesh.userData.speed = 0.6 + Math.random();
    group.add(mesh);
  }
}

/**
 * 요루/삼도류/엔마 스킬 한 번 발동 = 이 함수를 한 번 호출해서 짧게 재생되고
 * 사라지는 이펙트 그룹을 만듭니다. 판정 도형(cone/line/radial)에 맞춰
 * 모양을 고르고, 무기 색 테마 + (필살기라면) 추가 섬광 + (둔화라면) 서리
 * 파편을 덧붙입니다.
 */
export function buildSkillEffectGroup(skill: SkillDef, weaponId: ItemId): BuiltSkillEffect {
  const theme = WEAPON_VFX_THEMES[weaponId] ?? { core: 0xffffff, glow: 0xbbbbbb, spark: 0xffffff };
  const ultimate = skill.slot === 3;
  const group = new THREE.Group();
  let durationMs = ultimate ? 850 : 600;
  let growTo = 0.15;

  const shape = skill.shape;
  if (shape.kind === "cone") {
    const halfAngle = toRad(shape.halfAngleDeg);
    group.add(buildArcMesh(0, shape.range, halfAngle, 20, theme.core, ultimate ? 0.5 : 0.42, 0.85));
    group.add(buildArcMesh(shape.range * 0.88, shape.range * 1.08, halfAngle, 20, theme.glow, 0.6, 0.95));
    addRadialShards(group, ultimate ? 24 : 14, theme.spark, halfAngle, shape.range);
    if (skill.slowFactor) addFrostShards(group, 10, halfAngle, shape.range);
  } else if (shape.kind === "line") {
    const coreMat = makeBasicMat(theme.core, ultimate ? 0.6 : 0.5);
    const core = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, shape.width * 0.55), 0.14, shape.range), coreMat);
    core.position.set(0, 0.9, shape.range / 2);
    core.userData.baseOpacity = coreMat.opacity;
    core.userData.role = "sweep";
    group.add(core);

    const glowMat = makeBasicMat(theme.glow, 0.35);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(shape.width, 0.24, shape.range), glowMat);
    glow.position.set(0, 0.9, shape.range / 2);
    glow.userData.baseOpacity = 0.35;
    glow.userData.role = "sweep";
    group.add(glow);

    const tipMat = makeBasicMat(theme.spark, 0.9);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.2, shape.width * 0.4), 10, 10), tipMat);
    tip.position.set(0, 0.9, shape.range);
    tip.userData.baseOpacity = 0.9;
    tip.userData.role = "sweep";
    group.add(tip);

    // 돌진기(dashDistance 있는 스킬)는 대쉬 바람 이펙트처럼 잔상 줄무늬를 더 추가.
    const streakCount = skill.dashDistance ? 8 : 4;
    for (let i = 0; i < streakCount; i++) {
      const len = shape.range * (0.15 + Math.random() * 0.25);
      const mat = makeBasicMat(theme.spark, 0.5);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), mat);
      const x = (Math.random() - 0.5) * shape.width * 1.3;
      const z = Math.random() * (shape.range - len);
      mesh.position.set(x, 0.5 + Math.random() * 0.9, z + len / 2);
      mesh.userData.baseOpacity = 0.5;
      mesh.userData.role = "sweep";
      group.add(mesh);
    }
    addLineShards(group, ultimate ? 20 : 12, theme.spark, shape.range, shape.width);
    if (skill.slowFactor) addFrostShards(group, 8, 0.35, shape.range);
    durationMs = ultimate ? 750 : 500;
    growTo = 0.05;
  } else if (shape.kind === "radial") {
    group.add(buildArcMesh(shape.radius * 0.8, shape.radius * 1.02, Math.PI, 32, theme.glow, ultimate ? 0.6 : 0.5, 0.12));
    group.add(buildArcMesh(0, shape.radius * 0.5, Math.PI, 32, theme.core, ultimate ? 0.45 : 0.35, 0.05));
    addRadialShards(group, ultimate ? 26 : 16, theme.spark, Math.PI, shape.radius);
    if (skill.slowFactor) addFrostShards(group, 12, Math.PI, shape.radius);
    growTo = 0.55;
  }

  if (ultimate) addUltimateFlash(group, shape.kind === "radial" ? 0.6 : 1.0);

  return { group, durationMs, growTo };
}

/**
 * 화상(burnDps)이 있는 스킬 전용 — 메인 이펙트보다 훨씬 오래(화상 지속시간만큼,
 * 최대 3.2초로 제한) 남아 타오르는 잉걸불 파티클. 메인 스킬 이펙트와는 별도의
 * SkillEffectEntry로 다뤄집니다(둘 다 같은 자리에서 시작하지만 수명이 다름).
 */
export function buildEmberOverlayGroup(skill: SkillDef): BuiltSkillEffect | null {
  if (!skill.burnDps) return null;
  const group = new THREE.Group();
  const shape = skill.shape;
  const range = shape.kind === "radial" ? shape.radius : shape.kind === "cone" || shape.kind === "line" ? shape.range : 3;
  const halfAngle = shape.kind === "cone" ? toRad(shape.halfAngleDeg) : shape.kind === "radial" ? Math.PI : 0.3;

  for (let i = 0; i < 18; i++) {
    const mat = makeBasicMat(i % 2 === 0 ? EMBER_THEME.core : EMBER_THEME.glow, 0.75);
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.05 + Math.random() * 0.08), mat);
    if (shape.kind === "line") {
      const z = range * Math.random();
      const x = (Math.random() - 0.5) * shape.width * 1.2;
      mesh.position.set(x, 0.1 + Math.random() * 0.4, z);
    } else {
      const a = -halfAngle + Math.random() * (2 * halfAngle);
      const r = range * (0.15 + Math.random() * 0.8);
      mesh.position.set(Math.sin(a) * r, 0.1 + Math.random() * 0.4, Math.cos(a) * r);
    }
    mesh.userData.baseOpacity = 0.75;
    mesh.userData.role = "shard";
    mesh.userData.vx = (Math.random() - 0.5) * 0.15;
    mesh.userData.vz = (Math.random() - 0.5) * 0.15;
    mesh.userData.vy = 0.5 + Math.random() * 0.5; // 잉걸불은 위로 천천히 떠오릅니다.
    mesh.userData.speed = 0.5 + Math.random() * 0.4;
    group.add(mesh);
  }

  const durationMs = Math.min(3.2, skill.burnDurationSec ?? 2) * 1000;
  return { group, durationMs, growTo: 0 };
}
