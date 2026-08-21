import * as THREE from "three";
import type { EnemyState, GameState, NpcKind } from "../core/GameState";
import { FIRST_PERSON_THRESHOLD, type PlayerController } from "../simulation/PlayerController";
import { maxWorldRadius } from "../world/islands";
import { boatTier } from "../simulation/BoatSystem";
import { drawnWeapon } from "../simulation/WeaponSystem";
import type { QualitySettings } from "../core/GraphicsSettings";
import type { EnvironmentHandle, IslandVisual } from "../world/createIslands";


const CAMERA_DISTANCE = 6;
const CAMERA_HEIGHT_OFFSET = 1.6;
// 배를 탈 때는 배 전체가 보이도록 카메라를 뒤로 빼고 높입니다.
// (그러지 않으면 카메라가 선체·돛 안쪽에 들어가 화면이 가려집니다)
const BOAT_CAMERA_DISTANCE = 13;
const BOAT_CAMERA_HEIGHT_OFFSET = 5;

interface BlockyCharacter {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  legMat: THREE.MeshStandardMaterial;
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

  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b3a67 });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.35), legMat);
    leg.position.set(side * 0.22, 0.45, 0);
    leg.castShadow = true;
    group.add(leg);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 0.3), mat);
    arm.position.set(side * 0.56, 1.15, 0);
    arm.castShadow = true;
    group.add(arm);
  }

  return { group, bodyMat: mat, legMat };
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

  // 오른손 — 살짝 바깥으로 눕힘
  const right = katana(gripMats[0]);
  right.position.set(0.62, 0.75, 0.08);
  right.rotation.set(0.16, 0, -0.42);
  group.add(right);

  // 왼손 — 반대쪽 대칭
  const left = katana(gripMats[1]);
  left.position.set(-0.62, 0.75, 0.08);
  left.rotation.set(0.16, 0, 0.42);
  group.add(left);

  // 입에 문 칼 — 얼굴 앞에서 가로로
  const mouth = katana(gripMats[2]);
  mouth.position.set(-0.42, 1.72, 0.42);
  mouth.rotation.set(0, 0, Math.PI / 2);
  group.add(mouth);

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

  private islandVisuals: IslandVisual[] = [];
  private environment: EnvironmentHandle | null = null;

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
    const yoru = buildYoru();
    yoru.scale.setScalar(0.6);
    yoru.position.set(0.7, 0.78, 0.05);
    yoru.rotation.set(0.22, 0, -0.5);
    this.registerWeaponVisual("sword_yoru", yoru);

    // 삼도류: 이미 양손·입 위치가 모델 안에 잡혀 있어서 그대로 붙입니다.
    const santoryu = buildSantoryu();
    santoryu.scale.setScalar(0.62);
    this.registerWeaponVisual("sword_santoryu", santoryu);

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

  sync(state: GameState, playerController: PlayerController) {
    // 조명과 안개 — 태양은 플레이어를 따라다니고(어느 바다에서든 그림자가 나오도록),
    // 하늘·안개는 지금 있는 바다의 것을 씁니다.
    if (this.environment) {
      this.environment.follow(state.player.position.x, state.player.position.z);
      this.environment.setSea(state.sea);
    }

    // 플레이어
    this.playerVisual.position.set(state.player.position.x, state.player.position.y, state.player.position.z);
    this.playerVisual.rotation.y = state.player.yaw;

    // 손에 든 무기만 보이게 (요루 / 삼도류)
    const held = drawnWeapon(state.player);
    for (const [id, visual] of this.weaponVisuals) {
      visual.visible = held?.id === id;
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

    // 적들 (쫓아올 때 플레이어 쪽을 바라보도록 회전도 같이 갱신)
    for (const enemy of state.enemies) {
      const visible = enemy.alive && nearPlayer(enemy.position.x, enemy.position.z);
      // 몬스터가 180마리가 넘으므로, 한 번도 보이지 않은 개체는 아예 만들지 않습니다.
      const existing = this.enemyVisuals.get(enemy.id);
      if (!visible && !existing) continue;
      const visual = existing ?? this.ensureEnemyVisual(enemy);
      visual.group.visible = visible;
      if (!visible) continue;

      visual.group.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
      visual.group.lookAt(px, enemy.position.y, pz);

      // 체력이 변했을 때만 캔버스를 다시 그리고 텍스처를 업로드
      const ratio = enemy.hp / enemy.maxHp;
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
