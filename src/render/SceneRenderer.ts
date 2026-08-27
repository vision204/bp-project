import * as THREE from "three";
import type { EnemyState, FruitAbilityId, GameState, ItemId, NpcKind } from "../core/GameState";
import { FIRST_PERSON_THRESHOLD, type PlayerController } from "../simulation/PlayerController";
import { maxWorldRadius } from "../world/islands";
import { boatTier } from "../simulation/BoatSystem";
import { drawnWeapon } from "../simulation/WeaponSystem";
import { skillsForWeapon } from "../simulation/weaponSkills";
import { skillsForFruit } from "../simulation/skills";
import type { QualitySettings } from "../core/GraphicsSettings";
import type { EnvironmentHandle, IslandVisual } from "../world/createIslands";
import type { RemoteEnemyGhost, RemotePlayerView, RemoteSkillFx } from "../network/MultiplayerClient";
import { dist2D } from "../simulation/ShapeMath";
import { buildEmberOverlayGroup, buildFruitSkillEffectGroup, buildSkillEffectGroup, type ArmStretchPunch } from "./SkillEffects";


const CAMERA_DISTANCE = 6;
const CAMERA_HEIGHT_OFFSET = 1.6;
// 배를 탈 때는 배 전체가 보이도록 카메라를 뒤로 빼고 높입니다.
// (그러지 않으면 카메라가 선체·돛 안쪽에 들어가 화면이 가려집니다)
const BOAT_CAMERA_DISTANCE = 13;
const BOAT_CAMERA_HEIGHT_OFFSET = 5;

// 기본 공격(좌클릭) 검 휘두르기 — 짧고 빠르게 한 번 쳤다가 되돌아옵니다.
const ATTACK_SWING_DURATION_MS = 220;
/** 오른팔이 추가로 더 접히는 최대 각도(라디안) — 걷기 모션과 더해집니다 */
const ATTACK_SWING_ARM_AMPLITUDE = 1.3;
/** 무기 자체가 추가로 더 휘두르는 최대 각도(라디안) */
const ATTACK_SWING_WEAPON_AMPLITUDE = 1.9;

// 고무 열매 — 캐릭터의 진짜 오른팔이 뻗어나가는 펀치. 팔 메시(BoxGeometry)의
// 원래 세로 길이/오프셋과 정확히 맞아야 어깨에 붙은 채로 늘어나 보입니다
// (buildBlockyCharacterParts의 arm BoxGeometry(0.28, 0.85, 0.3) 참고).
const RUBBER_ARM_BASE_LENGTH = 0.85;
const RUBBER_ARM_BASE_OFFSET_Y = -RUBBER_ARM_BASE_LENGTH / 2;
/** 다 뻗었을 때 팔 피벗의 회전(라디안) — 0이면 어깨에서 아래로 늘어진 기본자세, -PI/2면 정면(+Z)으로 수평 스트레이트. */
const RUBBER_ARM_FORWARD_PITCH = -Math.PI / 2;
/** 다 뻗었을 때 팔이 얼마나 가늘어지는지(고무줄처럼 늘어난 느낌) */
const RUBBER_ARM_THIN_FACTOR = 0.5;

interface BlockyCharacter {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  legMat: THREE.MeshStandardMaterial;
  /** 걷기/달리기 모션용 — 엉덩이/어깨 관절에서 흔들리도록 다리·팔을 이 피벗의 자식으로 둡니다 */
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  /** 오른팔의 실제 박스 메시 — 고무 열매 펀치 때 이 메시 자체를 늘였다 줄입니다. */
  rightArmMesh: THREE.Mesh;
}

/** 아트가 준비되기 전까지, 로블록스 특유의 "블록형" 실루엣을 흉내낸 플레이스홀더 캐릭터. */
function buildBlockyCharacterParts(color: number): BlockyCharacter {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), mat);
  torso.position.y = 1.1;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), mat);
  head.position.y = 1.9;
  head.castShadow = true;
  group.add(head);

  // 다리는 엉덩이(hipY=0.9, 다리 박스의 원래 윗변) 높이에, 팔은 어깨(shoulderY=1.575,
  // 팔 박스의 원래 윗변) 높이에 피벗을 두고, 메시는 그 피벗 아래로 절반만큼 내려 붙입니다 —
  // 이렇게 하면 피벗을 회전시켰을 때 다리·팔이 관절에서 진짜로 흔들리는 것처럼 보입니다
  // (메시 중심을 그대로 돌리면 몸통을 뚫고 앞뒤로 미끄러지듯 움직여 부자연스럽습니다).
  const hipY = 0.9;
  const shoulderY = 1.575;
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b3a67 });
  let leftLegPivot!: THREE.Group;
  let rightLegPivot!: THREE.Group;
  let leftArmPivot!: THREE.Group;
  let rightArmPivot!: THREE.Group;
  let rightArmMesh!: THREE.Mesh;
  for (const side of [-1, 1]) {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.22, hipY, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.35), legMat);
    leg.position.y = -0.45;
    leg.castShadow = true;
    legPivot.add(leg);
    group.add(legPivot);

    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.56, shoulderY, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 0.3), mat);
    arm.position.y = -0.425;
    arm.castShadow = true;
    armPivot.add(arm);
    group.add(armPivot);

    // 이 게임은 카메라가 캐릭터 뒤에서 같은 방향을 보는 3인칭 시점이라
    // (PlayerController의 A/D 이동 주석과 동일한 규칙), yaw=0일 때 로컬 -X가
    // 화면상 "오른쪽"이 됩니다. side=1(로컬 +X)은 그래서 실제로는 캐릭터의
    // 왼쪽입니다 — 오른손잡이로 보이도록 side===-1을 오른쪽에 배정합니다.
    if (side === -1) {
      rightLegPivot = legPivot;
      rightArmPivot = armPivot;
      rightArmMesh = arm;
    } else {
      leftLegPivot = legPivot;
      leftArmPivot = armPivot;
    }
  }

  return { group, bodyMat: mat, legMat, leftLegPivot, rightLegPivot, leftArmPivot, rightArmPivot, rightArmMesh };
}

/** 머티리얼 참조가 필요 없는 곳(적·NPC)에서 쓰는 간편 버전 */
function buildBlockyCharacter(color: number): THREE.Group {
  return buildBlockyCharacterParts(color).group;
}

/**
 * 흑도 "요루" — 등에 메지 않고 손에 든 상태로 표현합니다.
 * 숫자키로 뽑았을 때만 보이도록 visible을 토글해 씁니다.
 */
function buildYoru(): THREE.Group {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.25, metalness: 0.75 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.2, metalness: 0.9 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x2b1d16, roughness: 0.9 });

  // 거대한 칠흑 칼날
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.1, 0.11), bladeMat);
  blade.position.y = 1.95;
  blade.castShadow = true;
  group.add(blade);

  // 칼끝 (뾰족하게)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 4), bladeMat);
  tip.position.y = 3.85;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  group.add(tip);

  // 칼날 중앙의 옅은 광택선
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.0, 0.13), edgeMat);
  shine.position.y = 1.95;
  group.add(shine);

  // 십자 가드 + 손잡이
  const guard = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.16, 0.22), edgeMat);
  guard.position.y = 0.36;
  group.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.78, 8), gripMat);
  grip.position.y = -0.05;
  group.add(grip);

  return group;
}

/**
 * 삼도류 — 양손에 한 자루씩, 입에 한 자루.
 * 요루가 거대한 한 자루라면 이쪽은 세 자루라 실루엣이 확실히 다릅니다.
 */
function buildSantoryu(): THREE.Group {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.2, metalness: 0.85 });
  const gripMats = [
    new THREE.MeshStandardMaterial({ color: 0x1f4f3a, roughness: 0.9 }), // 초록
    new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.9 }), // 붉은색
    new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.9 }), // 검정
  ];
  const guardMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 });

  /** 칼 한 자루 (아래가 손잡이, 위가 칼날) */
  function katana(gripMat: THREE.MeshStandardMaterial) {
    const sword = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.2, 0.05), bladeMat);
    blade.position.y = 1.35;
    blade.castShadow = true;
    sword.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 4), bladeMat);
    tip.position.y = 2.6;
    tip.rotation.y = Math.PI / 4;
    sword.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.16), guardMat);
    guard.position.y = 0.24;
    sword.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 8), gripMat);
    grip.position.y = -0.05;
    sword.add(grip);
    return sword;
  }

  // 오른손 — 살짝 바깥으로 눕힘 (이 게임은 로컬 -X가 화면상 오른쪽입니다)
  const right = katana(gripMats[0]);
  right.position.set(-0.62, 0.75, 0.08);
  right.rotation.set(0.16, 0, 0.42);
  group.add(right);

  // 왼손 — 반대쪽 대칭
  const left = katana(gripMats[1]);
  left.position.set(0.62, 0.75, 0.08);
  left.rotation.set(0.16, 0, -0.42);
  group.add(left);

  // 입에 문 칼 — 얼굴 앞에서 가로로
  const mouth = katana(gripMats[2]);
  mouth.position.set(-0.42, 1.72, 0.42);
  mouth.rotation.set(0, 0, Math.PI / 2);
  group.add(mouth);

  return group;
}

/**
 * 엔마 — 화산 섬 전용 무기. 요루와 같은 자리(오른손 한 자루)에 들지만,
 * 훨씬 얇고 긴 붉은 칼날이라 실루엣만 봐도 구분이 됩니다.
 */
function buildEnma(): THREE.Group {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc21f1f, roughness: 0.3, metalness: 0.55 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xffdca0, roughness: 0.25, metalness: 0.8 });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x241010, roughness: 0.4, metalness: 0.7 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x180a0a, roughness: 0.9 });

  // 얇고 긴 붉은 칼날 (요루보다 폭은 좁고 길이는 더 깁니다)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.9, 0.07), bladeMat);
  blade.position.y = 2.15;
  blade.castShadow = true;
  group.add(blade);

  // 칼끝 — 길고 뾰족하게
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.55, 4), bladeMat);
  tip.position.y = 4.35;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  group.add(tip);

  // 칼날 중앙의 금빛 광택선 — 얇고 긴 실루엣을 한 번 더 강조합니다
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 3.8, 0.085), edgeMat);
  shine.position.y = 2.15;
  group.add(shine);

  // 작은 십자 가드 + 손잡이
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.14), guardMat);
  guard.position.y = 0.16;
  group.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.7, 8), gripMat);
  grip.position.y = -0.22;
  group.add(grip);

  return group;
}

/**
 * 새총 — 첫 원거리 무기. 도검류와 실루엣이 확실히 다르도록 Y자 나무 틀 +
 * 고무줄 형태로 표현합니다. 오른손에 쥔 것처럼 요루/엔마와 같은 자리에 둡니다.
 */
function buildSlingshot(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.8 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.6 });

  // 손잡이
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.55, 8), woodMat);
  handle.position.y = 0;
  group.add(handle);

  // Y자 갈래 (양쪽으로 벌어진 두 가지)
  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.42, 8), woodMat);
    fork.position.set(side * 0.14, 0.42, 0);
    fork.rotation.z = side * -0.5;
    fork.castShadow = true;
    group.add(fork);
  }

  // 고무줄 (양쪽 갈래를 잇는 얇은 띠)
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), bandMat);
    band.position.set(side * 0.22, 0.5, 0.08);
    band.rotation.z = side * 0.28;
    group.add(band);
  }

  return group;
}

/**
 * Q 대쉬 이펙트 — 대쉬 방향으로 짧게 흩날리는 "바람" 줄무늬 몇 가닥.
 * 그룹째로 위치·회전을 잡아 씌운 뒤, 1초에 걸쳐 옅어지다 사라지도록
 * SceneRenderer.sync()에서 매 프레임 투명도/크기를 갱신합니다.
 */
function buildWindTrailGroup(): THREE.Group {
  const group = new THREE.Group();
  const streakCount = 7;
  for (let i = 0; i < streakCount; i++) {
    const len = 1.3 + Math.random() * 1.3;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdff6ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), mat);
    const angle = (Math.random() - 0.5) * 1.1; // 대쉬 방향을 중심으로 살짝 부채꼴로 흩어짐
    const radius = 0.2 + Math.random() * 0.4;
    mesh.position.set(Math.sin(angle) * radius, 0.7 + Math.random() * 1.0, -len * 0.15);
    group.add(mesh);
  }
  return group;
}

/** 부두에 정박하는 작은 배 (플레이스홀더 지오메트리) */
interface BoatVisual {
  group: THREE.Group;
  hullMat: THREE.MeshStandardMaterial;
  sailMat: THREE.MeshStandardMaterial;
}

function buildBoat(): BoatVisual {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.8 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 2.0), hullMat);
  hull.position.y = 0.45;
  hull.castShadow = true;
  group.add(hull);

  // 뱃머리 (앞쪽 뾰족하게)
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.6, 4), hullMat);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(2.6, 0.45, 0);
  bow.castShadow = true;
  group.add(bow);

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x6d4c33 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6), mastMat);
  mast.position.set(-0.2, 2.5, 0);
  mast.castShadow = true;
  group.add(mast);

  const sailMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e1, side: THREE.DoubleSide, roughness: 1 });
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), sailMat);
  sail.position.set(-0.2, 2.7, 0);
  sail.rotation.y = Math.PI / 2;
  sail.castShadow = true;
  group.add(sail);

  return { group, hullMat, sailMat };
}

function buildCanvasSprite(
  width: number,
  height: number,
  scale: [number, number],
): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale[0], scale[1], 1);
  return { sprite, canvas, ctx };
}

/**
 * 몬스터 머리 위 라벨 — 이름 + 체력바.
 * 한 섬에 여러 종류가 살게 되면서, 퀘스트에서 고른 몬스터를 눈으로 바로
 * 구분할 수 있어야 해서 이름을 함께 그립니다.
 */
function drawEnemyLabel(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ratio: number,
  name: string,
) {
  const w = canvas.width;
  const h = canvas.height;
  const barH = 14;
  const barY = h - barH;
  ctx.clearRect(0, 0, w, h);

  ctx.font = "bold 22px 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 5;
  ctx.strokeText(name, w / 2, (h - barH) / 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(name, w / 2, (h - barH) / 2);

  ctx.fillStyle = "#222";
  ctx.fillRect(0, barY, w, barH);
  ctx.fillStyle = ratio > 0.3 ? "#4caf50" : "#e53935";
  ctx.fillRect(2, barY + 2, (w - 4) * Math.max(0, ratio), barH - 4);
}

/** 다른 플레이어 머리 위 이름표 — 이름 + 레벨 + 체력바 (PvP를 켰으면 ⚔️ 표시) */
function drawPlayerLabel(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ratio: number,
  label: string,
) {
  const w = canvas.width;
  const h = canvas.height;
  const barH = 14;
  const barY = h - barH;
  ctx.clearRect(0, 0, w, h);

  ctx.font = "bold 22px 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 5;
  ctx.strokeText(label, w / 2, (h - barH) / 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, w / 2, (h - barH) / 2);

  ctx.fillStyle = "#222";
  ctx.fillRect(0, barY, w, barH);
  ctx.fillStyle = "#ef5350";
  ctx.fillRect(2, barY + 2, (w - 4) * Math.max(0, ratio), barH - 4);
}

function drawMarker(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, symbol: string | null, color: string) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!symbol) return;
  ctx.font = "bold 44px sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 5;
  ctx.strokeText(symbol, canvas.width / 2, canvas.height / 2);
  ctx.fillText(symbol, canvas.width / 2, canvas.height / 2);
}

interface EnemyVisual {
  group: THREE.Group;
  healthBar: ReturnType<typeof buildCanvasSprite>;
  /** 마지막으로 캔버스에 그린 체력 비율 — 값이 바뀔 때만 다시 그려서 텍스처 업로드를 줄입니다 */
  lastRatio: number;
  name: string;
}

interface NpcVisual {
  group: THREE.Group;
  marker: ReturnType<typeof buildCanvasSprite>;
  lastSymbol: string | null;
}

interface RemotePlayerVisual {
  group: THREE.Group;
  nameTag: ReturnType<typeof buildCanvasSprite>;
  lastLabel: string;
}

/** 다른 플레이어의 색은 진영으로 정합니다 — 몬스터·NPC와는 다른 배색이라 한눈에 구분됩니다. */
const REMOTE_FACTION_COLORS: Record<string, number> = {
  pirate: 0xd98b3f,
  marine: 0x4f83b8,
};

// 몬스터·NPC를 그리는 거리는 그래픽 품질 설정에서 가져옵니다.
// (섬 11개에 몬스터가 94마리라, 매 프레임 전부 갱신하면 캔버스 텍스처
//  업로드만으로도 프레임이 크게 떨어집니다)

const NPC_COLORS = {
  quest: 0x4fc3f7, // 파랑
  shop: 0xffb300, // 금색
  dock: 0x66bb6a, // 초록
  haki: 0x9575cd, // 보라 — 무장색 사범
  fruit_dealer: 0xef6c9a, // 분홍 — 중앙 교역섬 열매 상인
  gacha: 0x8bc34a, // 연두 — 정글 섬 열매 도박사
  trainer: 0xe0f7fa, // 설백색 — 얼음 섬 설인
  pirate_king: 0xffd54f, // 황금색 — 두 바다를 잇는 해적왕
  pirate_crew: 0xff5252, // 붉은색 — 중앙섬 해적 사단 접수처
} as const;

// 마커는 캔버스에 텍스트로 그립니다. 이모지(⛵ 등)를 쓰면 실사풍 컬러 글리프로
// 렌더링돼서 블록형 캐릭터와 따로 놀기 때문에, 평면 글자로 통일했습니다.
const NPC_SYMBOLS: Partial<Record<NpcKind, string>> = {
  shop: "$",
  dock: "배",
  haki: "武",
  fruit_dealer: "열매",
  gacha: "뽑기",
  trainer: "설인",
  pirate_king: "해적왕",
  pirate_crew: "사단",
};

export class SceneRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private playerParts: BlockyCharacter;
  private playerVisual: THREE.Group;
  private playerBaseBodyColor = new THREE.Color(0xffcc66);
  private playerBaseLegColor = new THREE.Color(0x2b3a67);
  private hakiWasActive = false;
  private boatParts: BoatVisual;
  private boatVisual: THREE.Group;
  private lastBoatTier = "";
  /** 무기 id별 3D 모델 — 손에 든 것만 보이게 토글합니다 */
  private weaponVisuals = new Map<string, THREE.Group>();
  private enemyVisuals = new Map<string, EnemyVisual>();
  private npcVisuals = new Map<string, NpcVisual>();
  private remotePlayerVisuals = new Map<string, RemotePlayerVisual>();
  /** 거래 대상 고르기용 — 다른 플레이어 위에 마우스를 올렸는지 판정할 때만 씁니다. */
  private readonly raycaster = new THREE.Raycaster();
  private hoverOutline: THREE.BoxHelper | null = null;
  private hoverOutlineId: string | null = null;

  private islandVisuals: IslandVisual[] = [];
  private environment: EnvironmentHandle | null = null;

  // ── 걷기/달리기 다리·팔 모션 ────────────────────────────────────────────
  /** 사인파 위상 — 매 프레임 실제 경과 시간만큼 진행시킵니다 (sync()에 dt가 안 들어와서 직접 잽니다) */
  private walkPhase = 0;
  /** 지금 다리를 얼마나 흔들고 있는지 (목표치로 서서히 다가갑니다 — 멈출 때 뚝 끊기지 않도록) */
  private legSwingAmount = 0;
  private lastAnimTimeMs = performance.now();

  // ── Q 대쉬 바람 이펙트 ──────────────────────────────────────────────────
  private dashTrails: { group: THREE.Group; startedAtMs: number }[] = [];

  // ── 기본 공격(좌클릭) 검 휘두르기 모션 ────────────────────────────────────
  /** 각 무기 모델의 "쥐고 있을 때" 기본 회전값 — 휘두르는 동안 여기서부터 튀어나갔다 돌아옵니다 */
  private weaponBaseRotationX = new Map<string, number>();
  private attackSwingStartedAtMs = -Infinity;

  // ── 요루/삼도류/엔마 스킬 이펙트 (내 것 + 다른 플레이어 것 공용) ─────────────
  private skillEffects: { group: THREE.Group; startedAtMs: number; durationMs: number; growTo: number }[] = [];

  // ── 고무 열매 — 내(로컬 플레이어)가 뻗을 때만 진짜 오른팔을 늘였다 되감습니다
  // (다른 플레이어는 팔 관절이 노출돼 있지 않아 지금은 로컬 전용입니다).
  private rubberArmStartedAtMs = -Infinity;
  private rubberArmTotalDurationMs = 0;
  private rubberArmPunches: ArmStretchPunch[] = [];

  constructor(container: HTMLElement, private readonly quality: QualitySettings) {
    // 섬들이 수백 미터 떨어져 있으므로 far plane을 넉넉하게 잡습니다.
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, maxWorldRadius() * 5);
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias });
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.playerParts = buildBlockyCharacterParts(0xffcc66);
    this.playerVisual = this.playerParts.group;
    this.scene.add(this.playerVisual);

    this.boatParts = buildBoat();
    this.boatVisual = this.boatParts.group;
    this.boatVisual.visible = false;
    this.scene.add(this.boatVisual);

    // 무기는 플레이어에 붙여두고, 숫자키로 뽑은 것만 보이게 합니다.
    // 요루: 오른손에 한 자루, 어깨 뒤로 살짝 눕혀 "들고 있는" 느낌
    // (원래 크기 그대로면 캐릭터 키의 두 배가 넘어 공중에 떠 보였습니다)
    // (이 게임은 로컬 -X가 화면상 오른쪽입니다 — PlayerController의 A/D 주석과 동일 규칙)
    const yoru = buildYoru();
    yoru.scale.setScalar(0.6);
    yoru.position.set(-0.7, 0.78, 0.05);
    yoru.rotation.set(0.22, 0, 0.5);
    this.registerWeaponVisual("sword_yoru", yoru);

    // 삼도류: 이미 양손·입 위치가 모델 안에 잡혀 있어서 그대로 붙입니다.
    const santoryu = buildSantoryu();
    santoryu.scale.setScalar(0.62);
    this.registerWeaponVisual("sword_santoryu", santoryu);

    // 엔마: 요루와 같은 자리(오른손)에 들지만, 훨씬 얇고 긴 붉은 칼날입니다.
    const enma = buildEnma();
    enma.scale.setScalar(0.6);
    enma.position.set(-0.7, 0.78, 0.05);
    enma.rotation.set(0.22, 0, 0.5);
    this.registerWeaponVisual("sword_enma", enma);

    // 새총 — 요루·엔마와 같은 오른손 자리에 쥡니다.
    const slingshot = buildSlingshot();
    slingshot.scale.setScalar(0.75);
    slingshot.position.set(-0.7, 0.78, 0.05);
    slingshot.rotation.set(0.22, 0, 0.5);
    this.registerWeaponVisual("gun_slingshot", slingshot);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private registerWeaponVisual(id: string, visual: THREE.Group) {
    visual.visible = false;
    this.playerVisual.add(visual);
    this.weaponVisuals.set(id, visual);
    // 휘두르기 모션이 여기서부터 튀어나갔다 되돌아올 수 있게 "쥐고 있을 때" 기본 회전을 기억해둡니다.
    this.weaponBaseRotationX.set(id, visual.rotation.x);
  }

  get domElement() {
    return this.renderer.domElement;
  }

  /** 1인칭(휠을 끝까지 당긴 상태)에서는 내 캐릭터를 숨깁니다 — 검증용으로도 노출 */
  get playerVisible() {
    return this.playerVisual.visible;
  }

  /**
   * 지금 손에 보이는 무기 모델인지 — 검증용으로 노출합니다.
   * (무기가 여러 자루가 되면서 예전의 yoruVisual 하나로는 확인할 수 없게 됐습니다)
   */
  weaponVisible(id: string) {
    return this.weaponVisuals.get(id)?.visible === true;
  }

  /** 지금 걷기/달리기 다리 모션이 실제로 흔들리고 있는지 — 검증용으로 노출합니다. */
  get legSwingActive() {
    return this.legSwingAmount > 0.05;
  }

  /** 오른쪽 다리 피벗의 현재 회전 각도(라디안) — 검증용. 0이면 중립(정지) 자세입니다. */
  get playerLegAngle() {
    return this.playerParts.rightLegPivot.rotation.x;
  }

  /** 지금 화면에 떠 있는 Q 대쉬 바람 이펙트 개수 — 검증용으로 노출합니다. */
  get dashTrailCount() {
    return this.dashTrails.length;
  }

  /** 기본 공격 휘두르기 모션이 지금 재생 중인지 — 검증용으로 노출합니다. */
  get attackSwingActive() {
    return performance.now() - this.attackSwingStartedAtMs < ATTACK_SWING_DURATION_MS;
  }

  /** 지금 화면에 떠 있는 무기/열매 스킬 이펙트 개수(화상 잉걸불 포함) — 검증용으로 노출합니다. */
  get activeSkillEffectCount() {
    return this.skillEffects.length;
  }

  /**
   * 스킬 이펙트 하나를 그 자리(x,y,z)에서 aimYaw 방향으로 스폰합니다.
   * 내 스킬(로컬)이든 다른 플레이어가 쓴 스킬(멀티플레이 중계)이든 이 함수
   * 하나로 처리합니다 — 판정 도형(shape)만 맞으면 누가 쐈는지는 상관없습니다.
   * id는 무기 id일 수도, 열매 id일 수도 있습니다(둘의 id 네임스페이스가
   * 겹치지 않아서 skillsForWeapon → skillsForFruit 순으로 시도하면 됩니다).
   * 어느 쪽에도 등록되지 않은 id(예: 새총)는 둘 다 빈 배열을 돌려주므로
   * 자연히 아무 것도 스폰되지 않습니다.
   */
  private spawnSkillEffect(
    sourceId: string,
    slot: number,
    x: number,
    y: number,
    z: number,
    aimYaw: number,
    nowMs: number,
    isLocalPlayer = false,
  ) {
    const weaponSkill = skillsForWeapon(sourceId as ItemId)[slot];
    const skill = weaponSkill ?? skillsForFruit(sourceId as FruitAbilityId)[slot];
    if (!skill) return;

    // 무기(검) 스킬은 기존 도형 기반 이펙트 그대로, 열매 스킬은 이름/속성에 맞춘
    // 전용 이펙트(FRUIT_SKILL_EFFECT_BUILDERS)를 씁니다 — 검과 열매가 똑같이
    // "판정 도형에 색만 입힌" 모양으로 보이지 않도록 갈라둡니다.
    const main = weaponSkill
      ? buildSkillEffectGroup(skill, sourceId as ItemId)
      : buildFruitSkillEffectGroup(skill, sourceId as FruitAbilityId);
    main.group.position.set(x, y, z);
    main.group.rotation.y = aimYaw;
    this.scene.add(main.group);
    this.skillEffects.push({ group: main.group, startedAtMs: nowMs, durationMs: main.durationMs, growTo: main.growTo });

    // 고무 열매고, 내(로컬 플레이어)가 쓴 거면 진짜 오른팔을 이 타이밍표대로
    // 늘였다 되감습니다 — 다른 플레이어/원격 중계분은 팔 관절 모델이 따로
    // 없어서(ensureRemotePlayerVisual은 단순 그룹) 지금은 로컬 전용입니다.
    if (isLocalPlayer && main.armStretch && main.armStretch.length > 0) {
      this.rubberArmStartedAtMs = nowMs;
      this.rubberArmTotalDurationMs = main.durationMs;
      this.rubberArmPunches = main.armStretch;
    }

    const ember = buildEmberOverlayGroup(skill);
    if (ember) {
      ember.group.position.set(x, y, z);
      ember.group.rotation.y = aimYaw;
      this.scene.add(ember.group);
      this.skillEffects.push({ group: ember.group, startedAtMs: nowMs, durationMs: ember.durationMs, growTo: ember.growTo });
    }
  }

  /** 멀리 있는 섬을 숨기기 위해 섬 핸들을 등록합니다 (빠른 모드에서만 사용). */
  setIslandVisuals(visuals: IslandVisual[]) {
    this.islandVisuals = visuals;
  }

  /** 조명·하늘·안개 핸들 — 태양이 플레이어를 따라다니고, 바다마다 하늘색이 바뀝니다. */
  setEnvironment(environment: EnvironmentHandle) {
    this.environment = environment;
  }

  private ensureEnemyVisual(enemy: EnemyState): EnemyVisual {
    let visual = this.enemyVisuals.get(enemy.id);
    if (!visual) {
      // 종류마다 색과 크기가 다릅니다 (한 섬에 여러 종류가 살기 때문)
      const group = buildBlockyCharacter(enemy.color);
      group.scale.setScalar(0.95 * enemy.scale);
      const healthBar = buildCanvasSprite(200, 46, [2.4, 0.55]);
      healthBar.sprite.position.y = 2.7;
      group.add(healthBar.sprite);
      this.scene.add(group);
      visual = { group, healthBar, lastRatio: -1, name: enemy.speciesName };
      this.enemyVisuals.set(enemy.id, visual);
    }
    return visual;
  }

  private ensureNpcVisual(id: string, color: number): NpcVisual {
    let visual = this.npcVisuals.get(id);
    if (!visual) {
      const group = buildBlockyCharacter(color);
      const marker = buildCanvasSprite(64, 64, [0.55, 0.55]);
      marker.sprite.position.y = 2.7;
      group.add(marker.sprite);
      this.scene.add(group);
      visual = { group, marker, lastSymbol: undefined as unknown as string | null };
      this.npcVisuals.set(id, visual);
    }
    return visual;
  }

  private ensureRemotePlayerVisual(id: string, faction: string): RemotePlayerVisual {
    let visual = this.remotePlayerVisuals.get(id);
    if (!visual) {
      const group = buildBlockyCharacter(REMOTE_FACTION_COLORS[faction] ?? 0xcccccc);
      // 거래하려고 마우스로 이 플레이어를 가리켰는지 판정할 때, 레이캐스트가 맞힌
      // 메시에서 그룹까지 부모를 타고 올라가며 이 id를 찾습니다.
      group.traverse((obj) => {
        obj.userData.remotePlayerId = id;
      });
      const nameTag = buildCanvasSprite(220, 46, [2.4, 0.55]);
      nameTag.sprite.position.y = 2.7;
      group.add(nameTag.sprite);
      this.scene.add(group);
      visual = { group, nameTag, lastLabel: "" };
      this.remotePlayerVisuals.set(id, visual);
    }
    return visual;
  }

  /**
   * 다른 플레이어들을 렌더링합니다. main.ts가 매 프레임 별도로 호출합니다
   * (sync()와 분리해둔 이유: 멀티플레이는 완전히 선택 사항이라, 접속하지
   * 않았으면 이 함수는 빈 목록으로 호출되어 사실상 아무 일도 하지 않습니다).
   */
  syncRemotePlayers(remotePlayers: RemotePlayerView[]) {
    const seen = new Set<string>();
    for (const r of remotePlayers) {
      seen.add(r.snapshot.id);
      const visual = this.ensureRemotePlayerVisual(r.snapshot.id, r.snapshot.faction);
      visual.group.visible = true;
      visual.group.position.set(r.renderX, r.renderY, r.renderZ);
      visual.group.rotation.y = r.renderYaw;

      const icon = r.snapshot.faction === "marine" ? "⚓" : "🏴‍☠️";
      const pvpTag = r.snapshot.pvpEnabled ? " ⚔️" : "";
      const label = `${icon} ${r.snapshot.name} Lv.${r.snapshot.level}${pvpTag}`;
      const ratio = r.snapshot.maxHp > 0 ? r.snapshot.hp / r.snapshot.maxHp : 0;
      const sig = `${label}|${ratio.toFixed(2)}`;
      if (sig !== visual.lastLabel) {
        visual.lastLabel = sig;
        drawPlayerLabel(visual.nameTag.ctx, visual.nameTag.canvas, ratio, label);
        visual.nameTag.sprite.material.map!.needsUpdate = true;
      }
      visual.nameTag.sprite.lookAt(this.camera.position);
    }

    // 테두리도 매 프레임 위치를 따라가야 합니다 (플레이어가 움직이므로).
    if (this.hoverOutline && this.hoverOutlineId && seen.has(this.hoverOutlineId)) {
      this.hoverOutline.update();
    }

    // 접속이 끊긴 플레이어는 지웁니다.
    for (const [id, visual] of this.remotePlayerVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(visual.group);
      this.remotePlayerVisuals.delete(id);
      if (this.hoverOutlineId === id) this.setHoverOutline(null);
    }
  }

  /**
   * 화면 좌표(clientX/Y, 캔버스 기준) 아래에 있는 다른 플레이어를 찾습니다.
   * 거래 상대를 고르는 "마우스 올리고 우클릭" 판정에만 씁니다 — 없으면 null.
   */
  pickRemotePlayerAt(clientX: number, clientY: number): string | null {
    if (this.remotePlayerVisuals.size === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const groups = [...this.remotePlayerVisuals.values()].map((v) => v.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj) {
      const id = obj.userData.remotePlayerId as string | undefined;
      if (id) return id;
      obj = obj.parent;
    }
    return null;
  }

  /**
   * 화면 좌표(clientX/Y) 아래에 있는 "땅"(섬 지형·소품·바위) 위의 한 점을 찾습니다.
   * R키 순간이동이 씁니다 — 섬 그룹들만 대상으로 하기 때문에 바다·하늘·플레이어는
   * 걸리지 않고, 맞은 지점이 없으면(먼 바다 등) null을 돌려줍니다.
   */
  raycastTerrainAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (this.islandVisuals.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const groups = this.islandVisuals.map((v) => v.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    return { x: p.x, y: p.y, z: p.z };
  }

  /**
   * 특정 (x,z) 지점 바로 위 높은 곳에서 수직으로 아래를 향해 레이캐스트해서
   * 그 자리의 실제 지형 높이를 찾습니다. R 순간이동이 최대 거리를 넘는
   * 지점을 "그 방향으로 최대 거리까지만" 클램프할 때, 클램프된 (x,z)가
   * 지형 굴곡 위 어디쯤인지 다시 구하기 위해 씁니다 — 그러지 않고 플레이어와
   * 원래 목표점을 잇는 직선을 그대로 잘라 쓰면 경사·계단 지형에서 땅에
   * 파묻히거나 공중에 뜰 수 있습니다. 그 자리 위에 섬 지형이 없으면(먼
   * 바다 등) null을 돌려줍니다.
   */
  raycastTerrainDownAt(x: number, z: number): { x: number; y: number; z: number } | null {
    if (this.islandVisuals.length === 0) return null;
    this.raycaster.set(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
    const groups = this.islandVisuals.map((v) => v.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** 마우스가 올라간 플레이어 둘레에 테두리를 그리거나(id) 지웁니다(null). */
  setHoverOutline(id: string | null) {
    if (id === this.hoverOutlineId) return;
    if (this.hoverOutline) {
      this.scene.remove(this.hoverOutline);
      this.hoverOutline.dispose();
      this.hoverOutline = null;
    }
    this.hoverOutlineId = id;
    if (!id) return;
    const visual = this.remotePlayerVisuals.get(id);
    if (!visual) {
      this.hoverOutlineId = null;
      return;
    }
    this.hoverOutline = new THREE.BoxHelper(visual.group, 0xffd54a);
    this.scene.add(this.hoverOutline);
  }

  /** 검증용 — 지금 테두리가 표시된 플레이어 id. */
  get hoveredRemotePlayerId(): string | null {
    return this.hoverOutlineId;
  }

  /**
   * 3D 좌표를 화면 픽셀 좌표로 투영합니다 — 카메라 뒤에 있으면 null.
   * TradeUI가 아니라 검증(e2e.mjs)이 "정확히 그 플레이어가 그려진 자리"를
   * 클릭하기 위해 씁니다 (화면 중앙 고정 좌표 대신, 카메라가 어느 쪽을
   * 보고 있든 항상 정확한 픽셀을 계산할 수 있도록).
   */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z);
    v.project(this.camera);
    if (v.z > 1) return null; // 카메라 뒤
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
    };
  }

  sync(
    state: GameState,
    playerController: PlayerController,
    enemyGhosts?: ReadonlyMap<string, RemoteEnemyGhost>,
    remotePlayers?: RemotePlayerView[],
    remoteSkillFx?: RemoteSkillFx[],
  ) {
    // 조명과 안개 — 태양은 플레이어를 따라다니고(어느 바다에서든 그림자가 나오도록),
    // 하늘·안개는 지금 있는 바다의 것을 씁니다.
    if (this.environment) {
      this.environment.follow(state.player.position.x, state.player.position.z);
      this.environment.setSea(state.sea);
    }

    // 플레이어
    this.playerVisual.position.set(state.player.position.x, state.player.position.y, state.player.position.z);
    this.playerVisual.rotation.y = state.player.yaw;

    // 걷기/달리기 모션 — 이건 순수 연출이라 시뮬레이션 dt에 얽맬 필요 없이, 여기서
    // 직접 실제 경과 시간을 재서 다리·팔을 흔듭니다. 질주 중이면 더 빠르고 크게 흔들어
    // "달리는 모션"이 되고, 멈추면 목표 진폭이 0이 되어 서서히 가라앉습니다.
    const nowMs = performance.now();
    const animDt = Math.min(0.1, (nowMs - this.lastAnimTimeMs) / 1000);
    this.lastAnimTimeMs = nowMs;

    const flying = state.player.devMode && state.player.flying;
    const horizSpeed = Math.hypot(state.player.velocity.x, state.player.velocity.z);
    const targetSwing =
      !flying && !state.boat.riding && horizSpeed > 0.15 ? (state.player.sprinting ? 0.85 : 0.55) : 0;
    this.legSwingAmount += (targetSwing - this.legSwingAmount) * Math.min(1, animDt * 10);
    if (this.legSwingAmount > 0.001) {
      this.walkPhase += animDt * (state.player.sprinting ? 11 : 7);
    }
    const swing = Math.sin(this.walkPhase) * this.legSwingAmount;
    this.playerParts.leftLegPivot.rotation.x = swing;
    this.playerParts.rightLegPivot.rotation.x = -swing;
    this.playerParts.leftArmPivot.rotation.x = -swing * 0.75;
    this.playerParts.rightArmPivot.rotation.x = swing * 0.75;

    // 기본 공격(좌클릭) 검 휘두르기 — 짧게 한 번 앞으로 쳤다가 사인 곡선을 그리며 되돌아옵니다.
    // 걷기 모션 위에 "더해지는" 값이라 걷거나 뛰면서 공격해도 자연스럽게 겹칩니다.
    const attackSwingT = (nowMs - this.attackSwingStartedAtMs) / ATTACK_SWING_DURATION_MS;
    const attackSwingArc = attackSwingT >= 0 && attackSwingT < 1 ? Math.sin(attackSwingT * Math.PI) : 0;
    this.playerParts.rightArmPivot.rotation.x -= attackSwingArc * ATTACK_SWING_ARM_AMPLITUDE;

    // 고무 열매 펀치 — 이번 프레임에 예약된 스트레치 구간이 있으면 진짜 오른팔
    // 메시(rightArmMesh)를 그 길이만큼 늘이고, 팔 피벗을 정면으로 접어 편치
    // 자세를 만듭니다. 걷기/공격 스윙으로 이미 정해진 현재 회전값에서
    // 정면 자세로 보간해, 걸으면서/베면서 뻗어도 툭 끊기지 않습니다.
    {
      const rubberT = (nowMs - this.rubberArmStartedAtMs) / Math.max(1, this.rubberArmTotalDurationMs);
      let rubberFrac = 0;
      let rubberLength = 0;
      if (rubberT >= 0 && rubberT < 1) {
        for (const punch of this.rubberArmPunches) {
          if (rubberT < punch.startT || rubberT > punch.endT) continue;
          const span = Math.max(0.0001, punch.endT - punch.startT);
          const localT = (rubberT - punch.startT) / span;
          if (localT < punch.peakFrac) {
            rubberFrac = punch.peakFrac > 0 ? localT / punch.peakFrac : 1;
          } else if (localT < punch.peakFrac + punch.holdFrac) {
            rubberFrac = 1;
          } else {
            const retractFrac = Math.max(0.0001, 1 - punch.peakFrac - punch.holdFrac);
            rubberFrac = Math.max(0, 1 - (localT - punch.peakFrac - punch.holdFrac) / retractFrac);
          }
          rubberLength = punch.length;
          break;
        }
      }
      const armMesh = this.playerParts.rightArmMesh;
      if (rubberFrac > 0.0005) {
        const stretch = 1 + rubberFrac * (rubberLength / RUBBER_ARM_BASE_LENGTH - 1);
        armMesh.scale.y = stretch;
        armMesh.position.y = RUBBER_ARM_BASE_OFFSET_Y * stretch;
        const thin = 1 - rubberFrac * (1 - RUBBER_ARM_THIN_FACTOR);
        armMesh.scale.x = thin;
        armMesh.scale.z = thin;
        const baseRotX = this.playerParts.rightArmPivot.rotation.x;
        this.playerParts.rightArmPivot.rotation.x = baseRotX + rubberFrac * (RUBBER_ARM_FORWARD_PITCH - baseRotX);
      } else if (armMesh.scale.y !== 1) {
        armMesh.scale.set(1, 1, 1);
        armMesh.position.y = RUBBER_ARM_BASE_OFFSET_Y;
      }
    }

    // Q 대쉬 — 이번 프레임에 대쉬가 나갔으면 그 방향으로 바람 이펙트를 새로 띄우고,
    // 떠 있는 이펙트들은 1초에 걸쳐 옅어지다 사라지게 합니다.
    for (const ev of state.player.events) {
      if (ev.type === "player_dashed") {
        const trail = buildWindTrailGroup();
        trail.position.set(state.player.position.x, state.player.position.y + 1.0, state.player.position.z);
        trail.rotation.y = Math.atan2(ev.dx, ev.dz);
        this.scene.add(trail);
        this.dashTrails.push({ group: trail, startedAtMs: nowMs });
      } else if (ev.type === "melee_attack_fired") {
        this.attackSwingStartedAtMs = nowMs;
      }
    }
    for (let i = this.dashTrails.length - 1; i >= 0; i--) {
      const trail = this.dashTrails[i];
      const t = (nowMs - trail.startedAtMs) / 1000;
      if (t >= 1) {
        this.scene.remove(trail.group);
        trail.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.dashTrails.splice(i, 1);
        continue;
      }
      const fade = 1 - t;
      trail.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
          obj.material.opacity = 0.55 * fade;
        }
      });
      trail.group.scale.setScalar(1 + t * 0.6);
    }

    // 요루/삼도류/엔마 스킬 이펙트 — 내가 이번 프레임에 스킬을 썼으면 지금
    // 손에 든 무기 기준으로, 다른 플레이어가 썼다고 서버가 알려준 게 있으면
    // 그 사람이 보고한 자리에 그대로 스폰합니다.
    // 뽑아 든 게 열매면 열매 스킬, 무기면 무기 스킬 — CombatSystem.ts의 판정과 같은 규칙.
    const heldForSkill = drawnWeapon(state.player);
    const skillFxSourceId = state.player.fruitDrawn ? state.player.equippedFruit : heldForSkill?.id;
    if (skillFxSourceId) {
      for (const ev of state.player.events) {
        if (ev.type === "skill_fired") {
          this.spawnSkillEffect(
            skillFxSourceId,
            ev.slot,
            state.player.position.x,
            state.player.position.y,
            state.player.position.z,
            state.player.aimYaw,
            nowMs,
            true,
          );
        }
      }
    }
    if (remoteSkillFx) {
      for (const fx of remoteSkillFx) {
        if (!fx.weaponId) continue;
        this.spawnSkillEffect(fx.weaponId, fx.slot, fx.position.x, fx.position.y, fx.position.z, fx.aimYaw, nowMs);
      }
    }
    for (let i = this.skillEffects.length - 1; i >= 0; i--) {
      const eff = this.skillEffects[i];
      const t = (nowMs - eff.startedAtMs) / eff.durationMs;
      if (t >= 1) {
        this.scene.remove(eff.group);
        eff.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.skillEffects.splice(i, 1);
        continue;
      }
      const fade = 1 - t;
      if (eff.growTo > 0) eff.group.scale.setScalar(1 + t * eff.growTo);
      eff.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material as THREE.MeshBasicMaterial;
        if (typeof obj.userData.baseOpacity === "number") mat.opacity = obj.userData.baseOpacity * fade;
        // appearAtT가 있으면 그 시점 전까지는 안 보이게 — 늘어나는 팔이 다 뻗은
        // 다음에야 타격 섬광이 뜨도록(팔보다 먼저 번쩍이지 않도록) 맞출 때 씁니다.
        const appearAtT = obj.userData.appearAtT as number | undefined;
        if (typeof appearAtT === "number" && t < appearAtT) mat.opacity = 0;
        if (obj.userData.role === "shard") {
          const speed = (obj.userData.speed as number) ?? 1;
          obj.position.x += (obj.userData.vx as number) * animDt * speed;
          obj.position.y += ((obj.userData.vy as number) ?? 0) * animDt * speed;
          obj.position.z += (obj.userData.vz as number) * animDt * speed;
        } else if (obj.userData.role === "orbit") {
          // 모래 열매 등 소용돌이형 이펙트 — 중심 주위를 빙글빙글 돌면서
          // 반지름이 서서히 벌어져(orbitGrow) 회오리 실루엣을 만듭니다.
          const angleSpeed = (obj.userData.orbitSpeed as number) ?? 3;
          obj.userData.orbitAngle = ((obj.userData.orbitAngle as number) ?? 0) + angleSpeed * animDt;
          const grow = (obj.userData.orbitGrow as number) ?? 0;
          const radius = ((obj.userData.orbitRadius as number) ?? 1) * (1 + t * grow);
          const angle = obj.userData.orbitAngle as number;
          obj.position.x = Math.sin(angle) * radius;
          obj.position.z = Math.cos(angle) * radius;
          obj.position.y = ((obj.userData.orbitY as number) ?? 0.5) + t * ((obj.userData.orbitRise as number) ?? 0);
        } else if (obj.userData.role === "flicker" && !(typeof appearAtT === "number" && t < appearAtT)) {
          // 번개 열매 등 — 지지직 깜빡이는 섬광. 페이드 위에 곱해서 불규칙하게 껌뻑입니다.
          const freq = (obj.userData.flickerSpeed as number) ?? 18;
          const seed = (obj.userData.flickerSeed as number) ?? 0;
          const flicker = 0.35 + 0.65 * Math.abs(Math.sin(nowMs * 0.001 * freq + seed));
          mat.opacity = (obj.userData.baseOpacity as number) * fade * flicker;
        } else if (obj.userData.role === "extendZ") {
          // 고무 열매 — 무장색으로 검어진 팔이 늘어나며 뻗어나갔다가 되감기는 모션.
          // 어깨(로컬 원점)에 고정된 채 z(길이) 방향으로만 늘었다 줄었다 합니다.
          const armLength = (obj.userData.armLength as number) ?? 1;
          const peakT = (obj.userData.armPeakT as number) ?? 0.3;
          const holdT = (obj.userData.armHoldT as number) ?? 0.15;
          const retractT = (obj.userData.armRetractT as number) ?? 0.25;
          let frac: number;
          if (t < peakT) frac = peakT > 0 ? t / peakT : 1;
          else if (t < peakT + holdT) frac = 1;
          else if (t < peakT + holdT + retractT) frac = retractT > 0 ? 1 - (t - peakT - holdT) / retractT : 0;
          else frac = 0;
          const len = Math.max(0.0005, armLength * frac);
          obj.scale.z = len;
          obj.position.z = len / 2;
        }
      });
    }

    // 손에 든 무기만 보이게 (요루 / 삼도류 / 엔마)
    const held = drawnWeapon(state.player);
    for (const [id, visual] of this.weaponVisuals) {
      visual.visible = held?.id === id;
    }
    // 지금 손에 든 무기도 팔과 같은 타이밍으로 휘둘러 "검을 휘두르는" 느낌을 냅니다.
    if (held) {
      const weaponVisual = this.weaponVisuals.get(held.id);
      const baseRotationX = this.weaponBaseRotationX.get(held.id) ?? 0;
      if (weaponVisual) {
        weaponVisual.rotation.x = baseRotationX - attackSwingArc * ATTACK_SWING_WEAPON_AMPLITUDE;
      }
    }

    // 무장색 발동 → 전신이 검게 변합니다. 상태가 바뀔 때만 머티리얼을 건드립니다.
    if (state.player.hakiActive !== this.hakiWasActive) {
      this.hakiWasActive = state.player.hakiActive;
      if (state.player.hakiActive) {
        this.playerParts.bodyMat.color.setHex(0x141414);
        this.playerParts.legMat.color.setHex(0x0d0d0d);
        this.playerParts.bodyMat.roughness = 0.25;
        this.playerParts.bodyMat.metalness = 0.6;
      } else {
        this.playerParts.bodyMat.color.copy(this.playerBaseBodyColor);
        this.playerParts.legMat.color.copy(this.playerBaseLegColor);
        this.playerParts.bodyMat.roughness = 0.6;
        this.playerParts.bodyMat.metalness = 0;
      }
    }

    // 3인칭 카메라: 캐릭터 뒤쪽, camYaw/camPitch를 따라 궤도.
    // 거리는 마우스 휠로 조절하며(로블록스식), 끝까지 당기면 1인칭이 됩니다.
    const riding = state.boat.riding;
    const zoom = playerController.camDistance;
    // 배를 탔을 때는 배가 커서 기본 거리가 더 멀어야 합니다 (휠 조절은 그대로 반영).
    const camDist = riding ? Math.max(4, zoom + BOAT_CAMERA_DISTANCE - CAMERA_DISTANCE) : zoom;
    const camHeight = riding ? BOAT_CAMERA_HEIGHT_OFFSET : CAMERA_HEIGHT_OFFSET;

    // 1인칭: 내 캐릭터가 시야를 가리지 않도록 숨깁니다.
    const firstPerson = !riding && zoom <= FIRST_PERSON_THRESHOLD;
    this.playerVisual.visible = !firstPerson;
    const yaw = playerController.camYaw;
    const pitch = playerController.camPitch;
    // 카메라를 눈높이보다 조금 더 올려주는 보정은 거리에 비례하게 둡니다.
    // (1인칭까지 당겼을 때 머리 위로 붕 뜨지 않고 정확히 눈높이에 오도록)
    const heightBoost = camHeight * Math.min(1, camDist / CAMERA_DISTANCE);
    const camOffset = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch) * -camDist,
      Math.sin(pitch) * -camDist + heightBoost,
      Math.cos(yaw) * Math.cos(pitch) * -camDist,
    );
    const target = new THREE.Vector3(
      state.player.position.x,
      state.player.position.y + camHeight,
      state.player.position.z,
    );
    this.camera.position.copy(target).add(camOffset);
    this.camera.lookAt(target);

    // 정박한 배 (구매했을 때만 표시, 부두 방향을 향하도록 회전)
    if (state.boat.spawned) {
      // 등급이 바뀌었을 때만 색을 갈아끼웁니다
      if (state.boat.tier !== this.lastBoatTier) {
        this.lastBoatTier = state.boat.tier;
        const tier = boatTier(state.boat.tier);
        this.boatParts.hullMat.color.setHex(tier.hullColor);
        this.boatParts.sailMat.color.setHex(tier.sailColor);
      }
      this.boatVisual.visible = true;
      this.boatVisual.position.set(state.boat.position.x, state.boat.position.y, state.boat.position.z);
      // 배 모델은 +X를 뱃머리로 만들었고, yaw는 +Z 기준이라 90도 보정합니다.
      this.boatVisual.rotation.y = state.boat.yaw - Math.PI / 2;
    } else {
      this.boatVisual.visible = false;
    }

    const px = state.player.position.x;
    const pz = state.player.position.z;
    const nearPlayer = (x: number, z: number) => Math.hypot(x - px, z - pz) <= this.quality.visibleDistance;

    // 빠른 모드: 멀리 있는 섬은 통째로 숨겨서 드로우콜을 줄입니다.
    const cull = this.quality.islandCullDistance;
    if (cull !== null) {
      for (const visual of this.islandVisuals) {
        visual.group.visible = Math.hypot(visual.center.x - px, visual.center.z - pz) <= cull;
      }
    }

    // 다른 사람이 지금 쫓기고 있다고 보고한 몬스터 위치를 찾을 때 씁니다 (그쪽을 바라보게 하려고).
    const remotePlayerPos = new Map<string, { x: number; z: number }>();
    if (remotePlayers) for (const r of remotePlayers) remotePlayerPos.set(r.snapshot.id, { x: r.renderX, z: r.renderZ });

    // 적들 (쫓아올 때 플레이어 쪽을 바라보도록 회전도 같이 갱신)
    for (const enemy of state.enemies) {
      // 내가 지금 직접 어그로를 끌고 있으면 내 시뮬레이션을 그대로 신뢰합니다 —
      // 다른 사람의 보고(유령)는 "나와 무관하게 다른 사람을 쫓고 있는" 경우에만 씁니다.
      const iAmAggroing = enemy.alive && dist2D(enemy.position.x, enemy.position.z, px, pz) <= enemy.aggroRange;
      const ghost = !iAmAggroing ? enemyGhosts?.get(enemy.id) : undefined;
      const useGhost = !!ghost && ghost.alive;

      const ex = useGhost ? ghost!.x : enemy.position.x;
      const ez = useGhost ? ghost!.z : enemy.position.z;
      const alive = useGhost ? ghost!.alive : enemy.alive;
      const hp = useGhost ? ghost!.hp : enemy.hp;
      const maxHp = useGhost ? ghost!.maxHp : enemy.maxHp;

      const visible = alive && nearPlayer(ex, ez);
      // 몬스터가 180마리가 넘으므로, 한 번도 보이지 않은 개체는 아예 만들지 않습니다.
      const existing = this.enemyVisuals.get(enemy.id);
      if (!visible && !existing) continue;
      const visual = existing ?? this.ensureEnemyVisual(enemy);
      visual.group.visible = visible;
      if (!visible) continue;

      visual.group.position.set(ex, enemy.position.y, ez);
      const lookTarget = (useGhost && remotePlayerPos.get(ghost!.fromId)) || { x: px, z: pz };
      visual.group.lookAt(lookTarget.x, enemy.position.y, lookTarget.z);

      // 체력이 변했을 때만 캔버스를 다시 그리고 텍스처를 업로드
      const ratio = maxHp > 0 ? hp / maxHp : 0;
      if (ratio !== visual.lastRatio) {
        visual.lastRatio = ratio;
        drawEnemyLabel(visual.healthBar.ctx, visual.healthBar.canvas, ratio, visual.name);
        visual.healthBar.sprite.material.map!.needsUpdate = true;
      }
      visual.healthBar.sprite.lookAt(this.camera.position);
    }

    // NPC들: 퀘스트(파랑, "!"/"?") · 상점(금색, "$") · 뱃사공(초록, "⛵")
    for (const npc of state.npcs) {
      const visible = nearPlayer(npc.position.x, npc.position.z);
      const visual = this.ensureNpcVisual(npc.id, NPC_COLORS[npc.kind]);
      visual.group.visible = visible;
      if (!visible) continue;

      visual.group.position.set(npc.position.x, npc.position.y, npc.position.z);

      let symbol: string | null = null;
      let markerColor = "#ffd54f";
      if (npc.kind !== "quest") {
        symbol = NPC_SYMBOLS[npc.kind] ?? null;
        markerColor =
          npc.kind === "dock" ? "#a5d6a7"
          : npc.kind === "haki" ? "#d1c4e9"
          : npc.kind === "fruit_dealer" ? "#ffb3d1"
          : npc.kind === "gacha" ? "#c5e1a5"
          : npc.kind === "trainer" ? "#e0f7fa"
          : "#ffd54f";
      } else if (npc.questId) {
        const quest = state.quests.find((q) => q.id === npc.questId);
        if (quest?.status === "available") {
          symbol = "!";
          markerColor = "#ffd54f";
        } else if (quest && quest.status === "active" && quest.killProgress >= quest.killTarget) {
          symbol = "?";
          markerColor = "#ffee58";
        }
      }
      // 마커가 바뀔 때만 다시 그림
      if (symbol !== visual.lastSymbol) {
        visual.lastSymbol = symbol;
        drawMarker(visual.marker.ctx, visual.marker.canvas, symbol, markerColor);
        visual.marker.sprite.material.map!.needsUpdate = true;
      }
      visual.marker.sprite.lookAt(this.camera.position);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
