import * as THREE from "three";
import type { FruitAbilityId, ItemId } from "../core/GameState";
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

// 열매마다 한눈에 구분되는 색 테마 — 실제 열매 성질을 그대로 반영합니다
// (마그마=용암, 얼음=서리, 번개=전격, 어둠=암흑, 고무=선명한 빨강, 모래=사막톤).
const FRUIT_VFX_THEMES: Partial<Record<FruitAbilityId, WeaponVfxTheme>> = {
  magma_fist: { core: 0x3d0f02, glow: 0xff5a1f, spark: 0xffcf5c },
  ice_lance: { core: 0x0b3550, glow: 0x59c8ff, spark: 0xdff6ff },
  thunder_strike: { core: 0x241d00, glow: 0xfff066, spark: 0xffffff },
  dark_wave: { core: 0x120018, glow: 0x8b2fd9, spark: 0xd9a8ff },
  rubber_barrage: { core: 0x4d1a12, glow: 0xff6b4a, spark: 0xffd9c2 },
  sand_storm: { core: 0x4a3110, glow: 0xd9b25c, spark: 0xf5e3b3 },
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

/**
 * 자기 강화형(shape: "self") 스킬 전용 — 적을 때리는 판정이 없으니 도형 이펙트
 * 대신, 몸 주위로 링이 위로 솟구치는 오라를 짧게 띄워 "발동했다"는 걸 보여줍니다.
 */
function addSelfBuffAura(group: THREE.Group, theme: WeaponVfxTheme, strong: boolean) {
  const ringCount = strong ? 4 : 3;
  for (let ring = 0; ring < ringCount; ring++) {
    const r = 0.55 + ring * 0.32;
    group.add(buildArcMesh(r * 0.82, r, Math.PI, 28, theme.glow, (strong ? 0.6 : 0.45) * (1 - ring * 0.12), 0.1 + ring * 0.5));
  }
  addRadialShards(group, strong ? 22 : 14, theme.spark, Math.PI, 1.1);
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
export function buildSkillEffectGroup(skill: SkillDef, sourceId: ItemId | FruitAbilityId): BuiltSkillEffect {
  const theme = WEAPON_VFX_THEMES[sourceId as ItemId] ??
    FRUIT_VFX_THEMES[sourceId as FruitAbilityId] ?? { core: 0xffffff, glow: 0xbbbbbb, spark: 0xffffff };
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
  } else if (shape.kind === "self") {
    addSelfBuffAura(group, theme, ultimate);
    growTo = 0.4;
    durationMs = ultimate ? 900 : 650;
  }

  if (ultimate) addUltimateFlash(group, shape.kind === "radial" ? 0.6 : 1.0);

  return { group, durationMs, growTo };
}

// ---------------------------------------------------------------------------
// 열매 스킬(Z/X/C/V) 전용 이펙트.
//
// 위의 buildSkillEffectGroup은 "판정 도형(부채꼴/직선/원형)에 색만 입힌" 범용
// 이펙트라 검 스킬과 열매 스킬이 실루엣까지 똑같아 보였습니다. 열매는 이름과
// 속성(빙결/전격/중력/탄성/모래)에 맞는 전용 모양·움직임을 따로 그립니다 —
// 판정 범위(shape)는 여전히 그대로 반영해 "맞는 범위 = 보이는 범위"는 지킵니다.
// ---------------------------------------------------------------------------

/** 지그재그로 꺾인 번개 줄기의 꼭짓점들을 만듭니다 (로컬 +Z가 사거리 방향). */
function buildZigzagPoints(range: number, width: number, segments: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  for (let i = 1; i < segments; i++) {
    pts.push({ x: (Math.random() - 0.5) * width * 1.7, z: (range * i) / segments });
  }
  pts.push({ x: 0, z: range });
  return pts;
}

/** 꼭짓점들을 잇는 얇은 상자들로 번개 줄기 하나를 그립니다. */
function addBoltSegments(group: THREE.Group, pts: { x: number; z: number }[], thickness: number, color: number, opacity: number, y: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.max(0.05, Math.hypot(dx, dz));
    const mat = makeBasicMat(color, opacity);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, len), mat);
    seg.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    seg.rotation.y = Math.atan2(dx, dz);
    seg.userData.baseOpacity = opacity;
    seg.userData.role = "sweep";
    group.add(seg);
  }
}

/** 번개 줄기에서 갈라져 지지직 튀는 잔가지 스파크 (깜빡임). */
function addBoltBranches(group: THREE.Group, pts: { x: number; z: number }[], theme: WeaponVfxTheme, count: number, y: number) {
  for (let i = 0; i < count; i++) {
    const base = pts[1 + Math.floor(Math.random() * Math.max(1, pts.length - 2))] ?? pts[0];
    const ang = Math.random() * Math.PI * 2;
    const len = 0.35 + Math.random() * 0.65;
    const mat = makeBasicMat(theme.spark, 0.85);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), mat);
    mesh.position.set(base.x + Math.sin(ang) * len * 0.3, y + (Math.random() - 0.5) * 0.5, base.z + Math.cos(ang) * len * 0.3);
    mesh.rotation.y = ang;
    mesh.userData.baseOpacity = 0.85;
    mesh.userData.role = "flicker";
    mesh.userData.flickerSpeed = 20 + Math.random() * 12;
    mesh.userData.flickerSeed = Math.random() * 10;
    group.add(mesh);
  }
}

/** 번개 열매 — 직선형 스킬(선더 스트라이크/천벌)에 쓰는 지그재그 번개 줄기. */
function buildLightningBolt(group: THREE.Group, range: number, width: number, theme: WeaponVfxTheme, ultimate: boolean, y = 1.0) {
  const pts = buildZigzagPoints(range, Math.max(0.7, width), ultimate ? 9 : 6);
  addBoltSegments(group, pts, Math.max(0.32, width * 0.85), theme.glow, ultimate ? 0.45 : 0.35, y);
  addBoltSegments(group, pts, Math.max(0.1, width * 0.28), theme.spark, ultimate ? 0.95 : 0.85, y);
  addBoltBranches(group, pts, theme, ultimate ? 10 : 5, y);
}

/** 번개 열매 — 하늘에서 한 지점(x,z)으로 내리꽂히는 수직 번개 줄기 (낙뢰). */
function buildLightningStrike(group: THREE.Group, x: number, z: number, theme: WeaponVfxTheme, ultimate: boolean, height = 9) {
  const segments = ultimate ? 8 : 5;
  const pts: { x: number; y: number }[] = [{ x: 0, y: height }];
  for (let i = 1; i < segments; i++) pts.push({ x: (Math.random() - 0.5) * 0.9, y: height - (height * i) / segments });
  pts.push({ x: 0, y: 0 });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.max(0.1, Math.abs(b.y - a.y));
    const midY = (a.y + b.y) / 2;
    const midX = x + (a.x + b.x) / 2;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.5, len, 0.5), makeBasicMat(theme.glow, ultimate ? 0.5 : 0.4));
    glow.position.set(midX, midY, z);
    glow.userData.baseOpacity = ultimate ? 0.5 : 0.4;
    glow.userData.role = "sweep";
    group.add(glow);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.16, len, 0.16), makeBasicMat(theme.spark, 0.95));
    core.position.copy(glow.position);
    core.userData.baseOpacity = 0.95;
    core.userData.role = "flicker";
    core.userData.flickerSpeed = 24;
    core.userData.flickerSeed = i * 1.7;
    group.add(core);
  }
  const ring = buildArcMesh(0, 1.6, Math.PI, 20, theme.glow, ultimate ? 0.65 : 0.55, 0.05);
  ring.position.set(x, 0, z);
  group.add(ring);
}

/** 번개 열매 — 뇌광 질주(토글 변신) 동안 몸을 휘감는 전격 오라. */
function addLightningAura(group: THREE.Group, theme: WeaponVfxTheme, strong: boolean) {
  const count = strong ? 16 : 10;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * 0.6;
    const h = 0.3 + Math.random() * 1.3;
    const len = 0.3 + Math.random() * 0.5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), makeBasicMat(Math.random() < 0.4 ? theme.core : theme.spark, 0.85));
    mesh.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
    mesh.rotation.y = a + (Math.random() - 0.5);
    mesh.rotation.x = (Math.random() - 0.5) * 0.8;
    mesh.userData.baseOpacity = 0.85;
    mesh.userData.role = "flicker";
    mesh.userData.flickerSpeed = 16 + Math.random() * 14;
    mesh.userData.flickerSeed = Math.random() * 10;
    group.add(mesh);
  }
  const ring = buildArcMesh(0.9, 1.15, Math.PI, 24, theme.glow, strong ? 0.55 : 0.4, 0.05);
  group.add(ring);
}

/** 얼음 열매 — 바닥에서 솟는 결정 가시. 빙결기(freeze)일수록 더 굵고 진하게. */
function addIceSpikes(group: THREE.Group, count: number, theme: WeaponVfxTheme, halfAngle: number, range: number, freeze: boolean) {
  for (let i = 0; i < count; i++) {
    const a = -halfAngle + Math.random() * (2 * halfAngle);
    const r = range * (0.15 + Math.random() * 0.85);
    const h = 0.5 + Math.random() * (freeze ? 1.7 : 0.9);
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.09 + Math.random() * 0.08, h, 4), makeBasicMat(i % 2 === 0 ? theme.core : theme.glow, freeze ? 0.7 : 0.55));
    mesh.position.set(Math.sin(a) * r, h / 2, Math.cos(a) * r);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.userData.baseOpacity = freeze ? 0.7 : 0.55;
    mesh.userData.role = "sweep";
    group.add(mesh);
  }
}

/** 얼음 열매 — 서리 발판(토글) 전용: 발밑에 퍼지는 얇은 얼음판. */
function addFrostFloor(group: THREE.Group, theme: WeaponVfxTheme, radius: number) {
  const disc = buildArcMesh(0, radius, Math.PI, 40, theme.core, 0.32, 0.03);
  group.add(disc);
  const rim = buildArcMesh(radius * 0.9, radius * 1.05, Math.PI, 40, theme.glow, 0.55, 0.04);
  group.add(rim);
  addFrostShards(group, 14, Math.PI, radius);
}

/** 어둠 열매 — 중력정처럼 빨아들이는 작은 공허 코어 + 바닥 테두리. */
function addVoidCore(group: THREE.Group, theme: WeaponVfxTheme, scale: number, ultimate: boolean) {
  const core = new THREE.Mesh(new THREE.SphereGeometry(Math.min(0.95, scale * 0.2), 14, 14), makeBasicMat(0x050008, ultimate ? 0.8 : 0.65));
  core.position.y = 0.95;
  core.userData.baseOpacity = ultimate ? 0.8 : 0.65;
  core.userData.role = "sweep";
  group.add(core);
  const rim = buildArcMesh(scale * 0.05, scale * 0.26, Math.PI, 24, theme.glow, ultimate ? 0.6 : 0.45, 0.05);
  group.add(rim);
}

/** 어둠 열매 — 바깥에서 중심으로 빨려드는 파편 (다른 열매는 전부 바깥으로 튐, 어둠만 안쪽으로). */
function addInwardVoidShards(group: THREE.Group, count: number, theme: WeaponVfxTheme, halfAngle: number, range: number) {
  for (let i = 0; i < count; i++) {
    const a = -halfAngle + Math.random() * (2 * halfAngle);
    const r = range * (0.4 + Math.random() * 0.6);
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.06 + Math.random() * 0.08), makeBasicMat(theme.spark, 0.75));
    mesh.position.set(sx * r, 0.3 + Math.random() * 1.0, cz * r);
    mesh.userData.baseOpacity = 0.75;
    mesh.userData.role = "shard";
    mesh.userData.vx = -sx * (0.6 + Math.random() * 0.5);
    mesh.userData.vz = -cz * (0.6 + Math.random() * 0.5);
    mesh.userData.vy = -0.15 - Math.random() * 0.2;
    mesh.userData.speed = 1.2 + Math.random() * 1.5;
    group.add(mesh);
  }
}

/** 고무 열매 — 여러 지점에서 동시에 터지는 작은 충격 링(주먹이 여러 번 꽂힌 느낌). */
function addImpactRings(group: THREE.Group, theme: WeaponVfxTheme, count: number, maxRadius: number, halfAngle: number, ultimate: boolean) {
  for (let i = 0; i < count; i++) {
    const full = halfAngle >= Math.PI - 0.01;
    const a = full ? Math.random() * Math.PI * 2 : -halfAngle + Math.random() * (2 * halfAngle);
    const r = maxRadius * (0.2 + Math.random() * 0.7);
    const ringR = 0.32 + Math.random() * 0.32;
    const ring = buildArcMesh(ringR * 0.65, ringR, Math.PI, 14, i % 2 === 0 ? theme.core : theme.glow, ultimate ? 0.7 : 0.55, 0.35 + Math.random() * 0.7);
    ring.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    group.add(ring);
  }
}

/** 고무 열매 — 앞으로 쭉 뻗어나가는 주먹 스트리크 (둥근 실루엣이라 검/얼음의 각진 파편과 다르게 보입니다). */
function addPunchStreaks(group: THREE.Group, theme: WeaponVfxTheme, count: number, range: number, width: number) {
  for (let i = 0; i < count; i++) {
    const len = 0.5 + Math.random() * 0.6;
    const z = range * Math.random();
    const x = (Math.random() - 0.5) * width * 1.3;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, len, 6), makeBasicMat(theme.spark, 0.85));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.5 + Math.random() * 0.9, z);
    mesh.userData.baseOpacity = 0.85;
    mesh.userData.role = "shard";
    mesh.userData.vx = (Math.random() - 0.5) * 0.3;
    mesh.userData.vy = 0.1;
    mesh.userData.vz = 1.2 + Math.random();
    mesh.userData.speed = 2 + Math.random() * 2;
    group.add(mesh);
  }
}

/**
 * 고무 열매 — 흰 크레센트(초승달) 슬래시 + 별 모양 섬광. 사용자가 보내준
 * 실제 블록스프루트 영상 속 펀치 임팩트가 컬러감 없이 흰색 위주였던 걸
 * 참고해, 타격 순간의 핵심 모양은 흰색으로 두고 테두리(글로우)만 고무
 * 테마색으로 물들입니다.
 */
function addPunchImpact(group: THREE.Group, theme: WeaponVfxTheme, x: number, y: number, z: number, scale: number, appearAtT = 0) {
  const thetaLen = Math.PI * (0.55 + Math.random() * 0.25);
  const thetaStart = Math.random() * Math.PI * 2;
  const rotX = Math.PI / 2 + (Math.random() - 0.5) * 0.7;
  const rotZ = Math.random() * Math.PI;

  const glow = new THREE.Mesh(new THREE.RingGeometry(0.3 * scale, 0.5 * scale, 24, 1, thetaStart, thetaLen), makeBasicMat(theme.glow, 0.55));
  glow.position.set(x, y, z);
  glow.rotation.set(rotX, 0, rotZ);
  glow.userData.baseOpacity = 0.55;
  glow.userData.role = "sweep";
  glow.userData.appearAtT = appearAtT;
  group.add(glow);

  const core = new THREE.Mesh(new THREE.RingGeometry(0.36 * scale, 0.44 * scale, 24, 1, thetaStart, thetaLen), makeBasicMat(0xffffff, 0.92));
  core.position.set(x, y, z);
  core.rotation.set(rotX, 0, rotZ);
  core.userData.baseOpacity = 0.92;
  core.userData.role = "sweep";
  core.userData.appearAtT = appearAtT;
  group.add(core);

  // 타격 중심의 짧은 십자형 별 섬광 (블록스프루트 특유의 흰 별 반짝임)
  for (const rot of [0, Math.PI / 2]) {
    const spark = new THREE.Mesh(new THREE.BoxGeometry(scale * 0.9, scale * 0.07, scale * 0.07), makeBasicMat(0xffffff, 0.9));
    spark.position.set(x, y, z);
    spark.rotation.y = rot;
    spark.userData.baseOpacity = 0.9;
    spark.userData.role = "flicker";
    spark.userData.flickerSpeed = 26 + Math.random() * 8;
    spark.userData.flickerSeed = Math.random() * 6;
    spark.userData.appearAtT = appearAtT;
    group.add(spark);
  }
}

/** 고무 열매 — 로켓처럼 튕겨나갈 때 경로에 남기는 속도선 잔상 (고무 테마색). */
function addRocketStreaks(group: THREE.Group, theme: WeaponVfxTheme, count: number, range: number, width: number) {
  for (let i = 0; i < count; i++) {
    const len = 0.6 + Math.random() * 0.9;
    const z = range * Math.random();
    const x = (Math.random() - 0.5) * width * 1.4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), makeBasicMat(i % 2 === 0 ? theme.spark : theme.glow, 0.6));
    mesh.position.set(x, 0.4 + Math.random() * 1.0, z);
    mesh.userData.baseOpacity = 0.6;
    mesh.userData.role = "sweep";
    group.add(mesh);
  }
}

/**
 * 고무 열매 — 무장색으로 검어진 팔이 어깨에서부터 쭉 늘어나며 뻗어나갔다가
 * 되감기는 모션. 사용자가 보내준 실제 영상에서 "타격이 나갈 때 화면에
 * 보이던 검은 직사각형"이 사실 이 늘어난 팔이었다고 해서 추가했습니다 —
 * SceneRenderer의 "extendZ" 롤(role)이 매 프레임 길이(scale.z)를 갱신합니다.
 * @param angle 어깨를 기준으로 팔이 뻗는 방향 (라디안, 0이면 정면 +Z)
 * @param length 팔이 최대로 늘어나는 길이(m)
 */
function addStretchArm(
  group: THREE.Group,
  length: number,
  angle: number,
  thickness: number,
  peakT: number,
  holdT: number,
  retractT: number,
) {
  const pivot = new THREE.Group();
  pivot.position.set(-0.35, 1.3, 0);
  pivot.rotation.y = angle;
  group.add(pivot);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, 1), makeBasicMat(0x141414, 0.95));
  mesh.userData.baseOpacity = 0.95;
  mesh.userData.role = "extendZ";
  mesh.userData.armLength = length;
  mesh.userData.armPeakT = peakT;
  mesh.userData.armHoldT = holdT;
  mesh.userData.armRetractT = retractT;
  pivot.add(mesh);
}

/** 모래 열매 — 원형 범위 스킬 전용: 중심을 빙글빙글 도는 회오리(그리트가 궤도를 그림). */
function addSandVortex(group: THREE.Group, theme: WeaponVfxTheme, count: number, maxRadius: number, ultimate: boolean) {
  for (let i = 0; i < count; i++) {
    const size = 0.05 + Math.random() * 0.08;
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(size, size * 2.2, 4), makeBasicMat(i % 2 === 0 ? theme.core : theme.spark, 0.75));
    const radius0 = maxRadius * (0.1 + Math.random() * 0.35);
    const angle0 = Math.random() * Math.PI * 2;
    const y0 = 0.2 + Math.random() * 2.0;
    mesh.position.set(Math.sin(angle0) * radius0, y0, Math.cos(angle0) * radius0);
    mesh.userData.baseOpacity = 0.75;
    mesh.userData.role = "orbit";
    mesh.userData.orbitAngle = angle0;
    mesh.userData.orbitRadius = radius0;
    mesh.userData.orbitSpeed = (ultimate ? 5 : 4) + Math.random() * 3;
    mesh.userData.orbitGrow = 1.6;
    mesh.userData.orbitY = y0;
    mesh.userData.orbitRise = Math.random() * 0.8;
    group.add(mesh);
  }
  const floor = buildArcMesh(0, maxRadius * 0.9, Math.PI, 32, theme.core, 0.3, 0.03);
  group.add(floor);
}

/** 모래 열매 — 직선/부채꼴형 스킬 전용: 앞으로 흩날리는 모래 그리트 (원뿔 실루엣이라 파편과 결이 다릅니다). */
function addSandGrit(group: THREE.Group, count: number, theme: WeaponVfxTheme, halfAngle: number, range: number) {
  for (let i = 0; i < count; i++) {
    const a = -halfAngle + Math.random() * (2 * halfAngle);
    const r = range * (0.2 + Math.random() * 0.8);
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    const size = 0.04 + Math.random() * 0.07;
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(size, size * 2, 4), makeBasicMat(i % 2 === 0 ? theme.core : theme.spark, 0.75));
    mesh.position.set(sx * r, 0.15 + Math.random() * 0.6, cz * r);
    mesh.userData.baseOpacity = 0.75;
    mesh.userData.role = "shard";
    // 살짝 휘어드는 궤적을 흉내내려고 진행 방향에 약간의 옆바람 성분을 섞습니다.
    const curl = (Math.random() - 0.5) * 0.6;
    mesh.userData.vx = sx * (0.8 + Math.random()) + cz * curl;
    mesh.userData.vz = cz * (0.8 + Math.random()) - sx * curl;
    mesh.userData.vy = 0.2 + Math.random() * 0.3;
    mesh.userData.speed = 1.4 + Math.random() * 1.8;
    group.add(mesh);
  }
}

/**
 * 열매 스킬(Z/X/C/V) 한 번 발동 = 이 함수를 한 번 호출해서 이름에 맞는 전용
 * 이펙트를 만듭니다. 무기 스킬용 buildSkillEffectGroup과 달리 열매마다
 * (그리고 얼리기/토글/자동조준 같은 특수 속성마다) 아예 다른 모양·움직임의
 * 파티클을 씁니다.
 */
export function buildFruitSkillEffectGroup(skill: SkillDef, fruitId: FruitAbilityId): BuiltSkillEffect {
  const theme = FRUIT_VFX_THEMES[fruitId] ?? { core: 0xffffff, glow: 0xbbbbbb, spark: 0xffffff };
  const ultimate = skill.slot === 3;
  const group = new THREE.Group();
  const shape = skill.shape;
  let durationMs = ultimate ? 900 : 600;
  let growTo = 0.2;

  const halfAngle = shape.kind === "cone" ? toRad(shape.halfAngleDeg) : shape.kind === "radial" ? Math.PI : 0.3;
  const range = shape.kind === "cone" || shape.kind === "line" ? shape.range : shape.kind === "radial" ? shape.radius : 4;

  switch (fruitId) {
    case "magma_fist": {
      // 용암 — 땅이 갈라지며 불기둥이 솟구치는 느낌. 화상기는 잉걸불 오버레이가 따로 덧붙습니다.
      const ground = buildArcMesh(0, range * (shape.kind === "line" ? 0.5 : 1), halfAngle, 24, theme.core, ultimate ? 0.5 : 0.4, 0.04);
      if (shape.kind === "line") ground.position.z = range / 2;
      group.add(ground);
      const rim = buildArcMesh(range * 0.85, range * 1.05, halfAngle, 24, theme.glow, ultimate ? 0.6 : 0.48, 0.06);
      if (shape.kind === "line") rim.position.z = range / 2;
      group.add(rim);
      addRadialShards(group, ultimate ? 22 : 13, theme.spark, halfAngle >= Math.PI ? Math.PI : halfAngle, range);
      growTo = 0.25;
      break;
    }
    case "ice_lance": {
      const freeze = !!skill.freezeDurationSec;
      if (skill.toggle) {
        addFrostFloor(group, theme, shape.kind === "radial" ? shape.radius : 5);
        growTo = 0.15;
        durationMs = 550;
      } else {
        addIceSpikes(group, ultimate ? 16 : freeze ? 12 : 8, theme, halfAngle, range, freeze);
        addFrostShards(group, freeze ? 14 : 9, halfAngle, range);
        growTo = freeze ? 0.2 : 0.1;
        durationMs = freeze ? (ultimate ? 1000 : 750) : ultimate ? 850 : 550;
      }
      break;
    }
    case "thunder_strike": {
      if (skill.toggle) {
        addLightningAura(group, theme, ultimate);
        growTo = 0.1;
        durationMs = 550;
      } else if (skill.autoTargetNearest) {
        // 낙뢰: 판정 자체가 바라보는 방향과 무관하게 "가장 가까운 대상"이라 정확한
        // 좌표까지는 렌더러가 알 수 없으니, 사방 임의의 지점에 벼락이 떨어지는
        // 것으로 그립니다(실제 판정은 CombatSystem이 가장 가까운 대상으로 처리).
        const a = Math.random() * Math.PI * 2;
        const r = range * (0.25 + Math.random() * 0.45);
        buildLightningStrike(group, Math.sin(a) * r, Math.cos(a) * r, theme, ultimate);
        growTo = 0;
        durationMs = ultimate ? 550 : 420;
      } else if (shape.kind === "line") {
        buildLightningBolt(group, shape.range, shape.width, theme, ultimate);
        growTo = 0.03;
        durationMs = ultimate ? 550 : 380;
      }
      break;
    }
    case "dark_wave": {
      addVoidCore(group, theme, range, ultimate);
      addInwardVoidShards(group, ultimate ? 20 : 12, theme, halfAngle, range);
      growTo = 0.15;
      durationMs = ultimate ? 950 : 700;
      break;
    }
    case "rubber_barrage": {
      // 사용자가 보내준 실제 영상 참고 결과: 슬롯 배치(로켓=X 돌진, 개틀링=C 제자리
      // 연타)는 지금 그대로 유지, 이펙트는 흰 크레센트+별섬광 스타일을 가져오되
      // 글로우만 고무색으로 물들이고, 돌진 잔상은 하늘색이 아니라 고무 테마색으로.
      if (shape.kind === "self") {
        // 기어 세컨드 — 영상엔 명확한 장면이 없어 기존에 제안한 붉은 오라를 유지합니다.
        addImpactRings(group, theme, ultimate ? 14 : 8, 1.4, Math.PI, ultimate);
        addRadialShards(group, ultimate ? 18 : 10, theme.spark, Math.PI, 1.3);
        growTo = 0.35;
        durationMs = ultimate ? 900 : 600;
      } else if (shape.kind === "line" && skill.dashDistance) {
        // 고무 로켓 — 무장색 팔이 사거리만큼 쭉 뻗어나가 잡아채듯 튕겨나가는 돌진.
        // 경로에 속도선을 남기고, 도착 지점에 크레센트 슬래시+별섬광, 바닥엔 착지 충격 링.
        addStretchArm(group, shape.range, 0, ultimate ? 0.34 : 0.28, 0.3, 0.1, 0.35);
        addRocketStreaks(group, theme, ultimate ? 14 : 9, shape.range, shape.width);
        addPunchImpact(group, theme, 0, 0.9, shape.range, ultimate ? 1.15 : 0.9, 0.3);
        const landingRing = buildArcMesh(0, 1.1, Math.PI, 20, theme.glow, ultimate ? 0.55 : 0.42, 0.04);
        landingRing.position.z = shape.range;
        landingRing.userData.appearAtT = 0.3;
        group.add(landingRing);
        growTo = 0.08;
        durationMs = ultimate ? 550 : 400;
      } else if (shape.kind === "line") {
        // 고무 피스톨 — 무장색 팔이 쭉 뻗어나가는 강타 한 방.
        addStretchArm(group, shape.range * 0.95, 0, ultimate ? 0.3 : 0.24, 0.3, 0.12, 0.35);
        addPunchStreaks(group, theme, ultimate ? 10 : 6, shape.range, shape.width);
        addPunchImpact(group, theme, 0, 0.9, shape.range * 0.92, ultimate ? 1.1 : 0.85, 0.3);
        growTo = 0.06;
        durationMs = ultimate ? 500 : 360;
      } else {
        // 고무 개틀링 — 제자리에서 무장색 팔을 여러 번 빠르게 뻗어 퍼붓는 연타.
        // 팔마다 시작 타이밍(peakT)을 어긋나게 줘서 "다다다닥" 연속으로 뻗는 느낌을 냅니다.
        const hits = ultimate ? 9 : 6;
        for (let i = 0; i < hits; i++) {
          const a = -halfAngle + Math.random() * (2 * halfAngle);
          const r = range * (0.35 + Math.random() * 0.6);
          const peakT = 0.04 + (i / Math.max(1, hits - 1)) * 0.55;
          addStretchArm(group, r, a, 0.16, peakT, 0.04, 0.18);
          addPunchImpact(group, theme, Math.sin(a) * r, 0.6 + Math.random() * 0.8, Math.cos(a) * r, 0.55 + Math.random() * 0.25, peakT);
        }
        growTo = 0.1;
        durationMs = ultimate ? 650 : 480;
      }
      break;
    }
    case "sand_storm": {
      if (shape.kind === "radial") {
        addSandVortex(group, theme, ultimate ? 26 : 16, shape.radius, ultimate);
        growTo = 0.5;
        durationMs = ultimate ? 1000 : 750;
      } else {
        addSandGrit(group, ultimate ? 22 : 14, theme, halfAngle, range);
        growTo = 0.15;
        durationMs = ultimate ? 700 : 500;
      }
      break;
    }
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
