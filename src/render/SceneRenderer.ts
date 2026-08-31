import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { EnemyState, FruitAbilityId, GameState, ItemId, NpcKind } from "../core/GameState";
import { FIRST_PERSON_THRESHOLD, type PlayerController } from "../simulation/PlayerController";
import { maxWorldRadius } from "../world/islands";
import { BOAT_DECK_Y, boatTier } from "../simulation/BoatSystem";
import { drawnWeapon } from "../simulation/WeaponSystem";
import { skillsForWeapon } from "../simulation/weaponSkills";
import { skillsForFruit, withCharge, type SkillDef } from "../simulation/skills";
import type { QualitySettings } from "../core/GraphicsSettings";
import type { EnvironmentHandle, IslandVisual } from "../world/createIslands";
import type {
  RemoteDashFx,
  RemoteEnemyGhost,
  RemoteMeleeFx,
  RemotePlayerView,
  RemoteSkillFx,
  RemoteTeleportFx,
} from "../network/MultiplayerClient";
import { dist2D, skillOrigin } from "../simulation/ShapeMath";
import {
  buildEmberOverlayGroup,
  buildFruitSkillEffectGroup,
  buildSkillEffectGroup,
  fruitVfxTheme,
  type ArmStretchPunch,
} from "./SkillEffects";


// ── 열매 3D 모델 (손에 드는 GLB) ──────────────────────────────────────────
// public/models/fruits/ 아래에 열매별로 압축된 glb 하나씩을 둡니다.
// import.meta.env.BASE_URL을 붙이는 이유: vite.config.ts의 base: "./" 설정을
// 그대로 존중해야 서브경로 배포(Netlify 등)에서도 경로가 깨지지 않습니다.
const FRUIT_MODEL_PATHS: Record<FruitAbilityId, string> = {
  magma_fist: "models/fruits/magma_fist.glb",
  ice_lance: "models/fruits/ice_lance.glb",
  thunder_strike: "models/fruits/thunder_strike.glb",
  dark_wave: "models/fruits/dark_wave.glb",
  rubber_barrage: "models/fruits/rubber_barrage.glb",
  sand_storm: "models/fruits/sand_storm.glb",
  light_light: "models/fruits/light_light.glb",
  dragon_dragon: "models/fruits/dragon_dragon.glb",
};

// ── 열매 스킬 이펙트 3D 모델 (GLB) ────────────────────────────────────────
// public/models/skills/ 아래에 24개(열매 6종 × Z/X/C/V) 스킬 이펙트 glb를
// 스킬 id로 이름 붙여뒀습니다. 스킬을 쓰면 이 모델이 판정 모양(shape)에 맞춰
// 앞으로 발사되거나(line/cone) 조준한 자리에 나타났다 사라지며(radial/self),
// 기존의 도형 기반 이펙트(SkillEffects.ts) 위에 덧씌워집니다 — 기존 이펙트는
// 하나도 건드리지 않고, 실제 3D 모델을 더해서 더 생동감 있게 만드는 방식입니다.
const SKILL_MODEL_IDS = [
  "magma_z", "magma_x", "magma_c", "magma_v",
  "ice_z", "ice_x", "ice_c", "ice_v",
  "thunder_z", "thunder_x", "thunder_c", "thunder_v",
  "dark_z", "dark_x", "dark_c", "dark_v",
  "rubber_z", "rubber_x", "rubber_c", "rubber_v",
  "sand_z", "sand_x", "sand_c", "sand_v",
  // 빛빛(Z/X/C/V + F 특수 능력)·용용(Z/X/C/V + F 특수 능력) —
  // light_f/dragon_f는 일반 슬롯 스킬이 아니지만(skills.ts의 slot: -1 참고),
  // 이펙트/변신 GLB 로딩은 다른 스킬 GLB와 완전히 같은 방식(스킬 id로 파일명
  // 결정)이라 이 목록에 함께 둡니다.
  "light_z", "light_x", "light_c", "light_v", "light_f",
  // dragon_v는 이제 진짜 슬롯3 스킬(용으로 변신)입니다 — 발동 순간 다른
  // 토글 스킬(sand_v·thunder_x)과 같은 "켤 때 한 번 재생되는 버스트" 이펙트를
  // 위해 여기 목록에도 둡니다. 지속되는 변신 시각 자체는 이 목록과 무관하게
  // dragonFormVisual(전용 독립 인스턴스, sync() 참고)이 담당합니다 —
  // SKILL_AURA_IDS에는 넣지 않았습니다(그쪽은 playerVisual에 붙는 작은
  // 오라용 메커니즘이라, "캐릭터 전체를 대신"해야 하는 이 변신에는 맞지
  // 않습니다).
  "dragon_z", "dragon_x", "dragon_c", "dragon_v", "dragon_f",
] as const;
function skillModelPath(skillId: string): string {
  return `models/skills/${skillId}.glb`;
}
/**
 * "자기 강화형(self)" 또는 토글 스킬 중, 발동 중인 동안 캐릭터에 계속 붙어
 * 있어야 하는 3종 — 서리 발판(발밑 얼음판), 뇌광 질주(번개 오라),
 * 사막의 대검(손에 든 대검). 나머지 21개는 순간적으로 스폰했다 사라지는
 * 1회성 이펙트로만 씁니다.
 */
// light_f/dragon_f도 "발동 중인 동안 캐릭터에 계속 붙어 있어야 하는" 변신형
// 능력이라 같은 오라 메커니즘을 씁니다 — 빛의 비행은 아주 잠깐(순간 돌진 직후
// lightFormRemainingSec 동안만), 용의 비행은 dragonFlightActive인 동안 내내.
const SKILL_AURA_IDS = new Set(["ice_x", "thunder_x", "sand_v", "light_f", "dragon_f"]);

// 빛의 포격(light_c)·광속 일격(light_v) — 사용자 요청: "하늘에서 빛이 마우스
// 위치로 떨어지는" 연출. 기존 radial 이펙트(그 자리에서 부풀었다 사라짐) 대신
// 높은 곳에서 착지 지점까지 낙하하는 travel을 씁니다(투사체형과 같은
// travel 메커니즘을 재사용 — spawnSkillModelEffect 참고).
const SKY_FALL_SKILL_IDS = new Set(["light_c", "light_v"]);

/**
 * 일부 GLB는 모델러가 "뾰족한 앞부분"을 로컬 Z축이 아니라 X축(또는 반대
 * 방향)에 맞춰 만들어서, aimYaw 그대로 회전시키면 진행 방향과 어긋나 보입니다
 * (아이스 랜스가 가로로 누운 채 날아가는 문제 — 사용자 피드백). 스킬 id별로
 * 이 보정 각도(라디안)를 추가로 더해 "뾰족한 부분이 진행 방향을 보도록"
 * 바로잡습니다.
 */
const SKILL_MODEL_YAW_OFFSET: Record<string, number> = {
  ice_z: Math.PI / 2,
  // 사용자 피드백: 빛의 탄환/빛의 검/용의 발톱/용의 포효/용의 화염 모델도
  // 뾰족한/날카로운 끝이 진행 방향을 보지 않고 옆을 보고 있다고 함 —
  // 기존에 확인된 유일한 실제 원인(ice_z)이 90도(Math.PI/2) 어긋남이었으므로,
  // 같은 보정을 우선 적용합니다. 시각 확인이 불가능한 최선의 추정치이며,
  // "여전히 반대/90도 더 틀어짐" 피드백을 받으면 부호를 바꾸거나 값을
  // 조정해야 할 수 있습니다.
  light_z: Math.PI / 2,
  light_x: Math.PI / 2,
  dragon_z: Math.PI / 2,
  dragon_x: Math.PI / 2,
  dragon_c: Math.PI / 2,
};

/**
 * 뇌광 질주(thunder_x)는 원래 "제자리 자기 강화형"(shape.kind === "self")이라
 * 판정 범위 개념이 없지만, 사용자 요청("미사일 형식으로 사정거리 길게")에 따라
 * 켜지는 순간 전방으로 길게 날아가는 번개 미사일을 시각 연출로 추가합니다.
 * 실제 접촉 판정(lightningFormContactRadius)은 그대로 몸 주변에 남아있고,
 * 이건 순수 연출용 사거리입니다.
 */
const THUNDER_X_MISSILE_RANGE = 30;

/**
 * 블록형 캐릭터(플레이어/몬스터 공용) 전체 높이 — buildBlockyCharacterParts()의
 * 머리 꼭대기(y = 1.9 + 반지름 0.4 = 2.3)를 기준으로 잡았습니다.
 */
const NPC_HEIGHT_APPROX = 2.3;
/**
 * 열매 스킬 GLB 이펙트 크기 — "몬스터 키의 최소 3배, 만화처럼 비현실적으로
 * 크게" 요청에 따라 몬스터 키의 3.6배로 잡습니다(정확히 3배가 아니라 여유를
 * 더 둔 값 — 어떤 종은 자체 배율이 1보다 작아서 여유가 필요합니다). 템플릿은
 * normalizeAndCenterModel(gltf.scene, 1)로 "가장 긴 변 = 1"이 되도록 정규화돼
 * 있으므로, 이 값을 그대로 스케일 배율로 곱하면 최종 크기가 됩니다.
 */
const SKILL_MODEL_SCALE = NPC_HEIGHT_APPROX * 3.6;
/**
 * 사막의 대검(sand_v)만 전용으로 쓰는 더 작은 크기 — 다른 스킬들과 같은
 * SKILL_MODEL_SCALE을 쓰니 손에 든 대검이 몸통보다 훨씬 커서 우스꽝스럽다는
 * 사용자 피드백(ㅋㅋㅋ)에 따라 "손에 든 큰 검" 정도의 크기로 줄였습니다.
 */
const SAND_BLADE_SCALE = NPC_HEIGHT_APPROX * 1.15;

// ── 용의 비행(dragon_dragon, F 능력) 전용 — 실제 몸 전체를 용 모델로 바꿔치기 ──
// 사용자 피드백: 기존 dragon_f 오라(몸을 감싸는 연출)는 "날아다니는 자세"가
// 아니라 그냥 공중에 뜬 모습이었다고 함. 한동안 public/models/skills/dragon_v.glb
// (V 변신 능력용 모델)를 F 비행에서도 임시로 빌려 썼지만, 사용자 요청으로
// "예전에 쓰던 GLB로 다시" 되돌려서 이제 다시 원래의 전용 파일
// public/models/skills/dragon_f.glb를 씁니다(V 변신은 여전히 dragon_v.glb를
// 그대로 씁니다 — 이 파일 아래쪽의 DRAGON_FORM_* 상수/dragonFormVisual 참고).
// 비행 중에는 캐릭터를 완전히 숨기고 이 GLB를 몸 대신 직접 씬에 띄워 "몸을
// 쭉 펴고 하늘을 헤엄치는" 모습을 냅니다.
const DRAGON_FLIGHT_MODEL_PATH = "models/skills/dragon_f.glb";
/**
 * dragon_f.glb의 로컬 바운딩 박스를 실제로 재보니(스크립트로 GLB의 JSON
 * 청크 accessor min/max를 직접 파싱, POSITION accessor 기준) X≈0.979
 * (가장 긴 축), Y≈0.713, Z≈0.446(가장 얇은 축)이었습니다. dragon_v.glb와는
 * 축 배치가 다릅니다 — dragon_v.glb는 "가만히 서 있는" 자세라 Y(키)가 가장
 * 길었지만, dragon_f.glb는 이미 로컬 X축(몸통 길이 방향)이 가장 긴 걸 보면
 * 애초에 "누워서/날아가는" 자세로 모델링된 것으로 보입니다. 스켈레톤/
 * 애니메이션은 없는 정적 메시(skins/animations 필드가 비어 있음을 확인)라
 * 이번에도 뼈대 애니메이션이 아니라 그룹 전체를 절차적으로 회전/이동시킵니다.
 *
 * 가장 긴 축이 로컬 X(몸통 길이)이므로, 눕히는 피치 회전(로컬 X축 기준
 * 회전)은 필요 없고, 대신 로컬 X축이 이동 방향(+Z)을 보도록 로컬 Y축
 * 기준으로 요(yaw) 회전만 주면 됩니다. Three.js의 Y축 회전 공식
 * (x'=x·cosθ, z'=-x·sinθ)으로 로컬 +X(코 방향으로 가정)를 월드 +Z로
 * 보내려면 θ=-90°(-Math.PI/2)가 필요합니다 — 직접 미리보기가 불가능한
 * 상태에서의 최선의 추정치이며, "거꾸로(꼬리부터) 난다"는 피드백을 받으면
 * +Math.PI/2로 부호를 반대로 바꿔야 할 수 있습니다.
 */
const DRAGON_FLIGHT_BASE_YAW = -Math.PI / 2;
/** 캐릭터를 완전히 대신하는 몸이므로, 기존 오라들과 같은 "만화처럼 거대한" 스케일을 그대로 씁니다. */
const DRAGON_FLIGHT_MODEL_SCALE = SKILL_MODEL_SCALE;

// ── 용으로 변신(dragon_dragon, V 슬롯3) 전용 — dragon_v.glb를 독립적으로 사용 ──
// F(용의 비행)는 이제 별도 전용 파일 dragon_f.glb를 쓰지만(위 DRAGON_FLIGHT_MODEL_PATH
// 참고), V 변신은 처음부터 그랬듯 그대로 dragon_v.glb를 씁니다 — 두 파일은
// 완전히 다른 모델이라 자세 보정 상수도 서로 공유하지 않습니다.
// 사용자 피드백: "용 머리가 좌표 위를 향해야 하는데 옆으로 누워있어" — 즉
// 변신 포즈에서는 F 비행처럼 눕히는 회전을 주면 안 되고, 모델이 원래
// 만들어진 자세(dragon_v.glb는 가장 긴 축인 로컬 Y가 그대로 위를 향하는,
// "가만히 떠 있는" 자세) 그대로 세워둬야 합니다. 그래서 피치/롤 보정은 아예
// 주지 않고(항등 회전), 캐릭터가 보는 방향(yaw)만 반영합니다 — 모델의
// "정면"이 이미 로컬 -Z(이 코드베이스의 전방 축과 일치한다고 가정)를 보고
// 있지 않다면 요(yaw) 보정만 추가하면 되므로, 그 여지를 위해 별도 상수로
// 분리해뒀습니다(0=보정 없음 — 실제로 화면에서 확인하기 전까지는 최선의
// 추정치입니다).
const DRAGON_FORM_MODEL_PATH = "models/skills/dragon_v.glb";
const DRAGON_FORM_YAW_OFFSET = 0;
/**
 * 사용자 요청("변신했을 때 크기를 지금보다 5배 더 키워줘")에 따라, 기존
 * 캐릭터-대신 스케일(SKILL_MODEL_SCALE, F 비행과 같았던 기준값)에 5배를
 * 추가로 곱합니다. normalizeAndCenterModel(gltf.scene, 1)이 이미 "가장 긴
 * 변 = 1"로 정규화해두므로, 이 배율을 그대로 최종 크기로 곱하면 됩니다.
 */
const DRAGON_FORM_SCALE_MULTIPLIER = 5;
const DRAGON_FORM_MODEL_SCALE = SKILL_MODEL_SCALE * DRAGON_FORM_SCALE_MULTIPLIER;
/** 헤엄치듯 상하로 일렁이는 피치 진동 진폭(라디안) — 사용자 요청 범위(8~12도) 중간값. */
const DRAGON_SWIM_PITCH_AMPLITUDE = (10 * Math.PI) / 180;
/** 피치 진동 주파수(Hz) — 사용자 요청 범위(1.2~1.8Hz) 중간값. */
const DRAGON_SWIM_FREQUENCY_HZ = 1.5;
/** 살짝 위아래로 출렁이는 수직 이동(m) — 사용자 요청 범위(0.15~0.3m) 중간값. */
const DRAGON_SWIM_BOB_AMPLITUDE = 0.22;
/** 수직 이동을 피치 진동과 살짝 어긋나게(1/4 주기) 둬서 "일렁이는 헤엄" 느낌을 냅니다. */
const DRAGON_SWIM_BOB_PHASE_OFFSET = Math.PI / 2;

/**
 * 로드된 GLB는 크기와 원점이 제각각이라(모델러/AI 생성 파이프라인이 서로
 * 다름), 그대로 붙이면 손 크기에 안 맞거나 손 밖으로 삐져나옵니다.
 * 바운딩 박스를 재서 중심을 원점으로 옮기고, 가장 긴 변이 targetSize가
 * 되도록 균일하게 스케일해 6종 열매가 손 안에서 일관된 크기로 보이게 합니다.
 */
function normalizeAndCenterModel(root: THREE.Object3D, targetSize: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const inner = new THREE.Group();
  inner.add(root);
  root.position.sub(center);

  const wrapper = new THREE.Group();
  wrapper.add(inner);
  inner.scale.setScalar(targetSize / maxDim);
  return wrapper;
}

/**
 * 스킬 이펙트 템플릿을 화면에 띄울 인스턴스 하나로 복제합니다. THREE.Object3D.clone()은
 * 지오메트리/머티리얼을 원본과 "공유"하는데, 스킬 이펙트는 동시에 여러 개가
 * 떠 있을 수 있고(연타) 끝나면 각자 dispose되므로 공유했다간 먼저 끝난 것이
 * dispose한 머티리얼을 나중 것이 계속 쓰다가 깨집니다. 그래서 메시마다
 * 지오메트리는 공유하되(어차피 안 바뀜) 머티리얼만 각자 clone합니다.
 *
 * fadeOut=true(순간 스폰됐다 사라지는 1회성 이펙트)면 transparent를 켜서
 * skillEffects 갱신 루프가 매 프레임 opacity를 줄여나갈 수 있게 합니다.
 * fadeOut=false(서리 발판·뇌광 질주·사막의 대검처럼 계속 붙어 있는 인스턴스)면
 * 평소처럼 불투명하게 둡니다 — 안 그러면 depthWrite 문제로 다른 물체와
 * 겹칠 때 렌더링이 이상해집니다.
 */
function cloneSkillModelInstance(template: THREE.Group, fadeOut: boolean): THREE.Group {
  const clone = template.clone(true);
  clone.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const cloned = mat.clone();
    if (fadeOut) {
      cloned.transparent = true;
      cloned.depthWrite = false;
      obj.userData.baseOpacity = 1;
    }
    obj.material = cloned;
  });
  return clone;
}

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
/** Z를 누르고 있는 동안(차지) 팔을 뒤로 당기는 회전(라디안) — 어깨 위/뒤쪽으로 접힙니다. */
const RUBBER_ARM_WINDUP_PITCH = 1.15;
/** 다 뻗었을 때 팔이 얼마나 두꺼워지는지 — 힘을 잔뜩 준 두꺼운 주먹 느낌(1보다 크면 두꺼워짐). */
const RUBBER_ARM_THICKNESS_FACTOR = 1.65;

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
 * 원격(다른 플레이어) 캐릭터에 붙일 무기 모델 인스턴스를 새로 만듭니다.
 * registerWeaponVisual(로컬 전용)이 하나의 THREE.Object3D를 만들어 그대로
 * playerVisual에 붙이는 것과 달리, 원격 플레이어는 여러 명이 동시에 같은
 * 무기를 들 수 있어 Object3D를 공유할 수 없으므로(부모가 하나뿐) 호출할
 * 때마다 새 지오메트리/머티리얼로 다시 빌드합니다 — 위치·회전·크기는
 * 로컬 등록부(constructor의 registerWeaponVisual 호출들)와 정확히 맞춥니다.
 */
function buildWeaponVisualInstance(id: string): THREE.Group | null {
  switch (id) {
    case "sword_yoru": {
      const g = buildYoru();
      g.scale.setScalar(0.6);
      g.position.set(-0.7, 0.78, 0.05);
      g.rotation.set(0.22, 0, 0.5);
      return g;
    }
    case "sword_wood": {
      const g = buildWoodenSword();
      g.scale.setScalar(0.6);
      g.position.set(-0.7, 0.78, 0.05);
      g.rotation.set(0.22, 0, 0.5);
      return g;
    }
    case "sword_santoryu": {
      const g = buildSantoryu();
      g.scale.setScalar(0.62);
      return g;
    }
    case "sword_enma": {
      const g = buildEnma();
      g.scale.setScalar(0.6);
      g.position.set(-0.7, 0.78, 0.05);
      g.rotation.set(0.22, 0, 0.5);
      return g;
    }
    case "gun_slingshot": {
      const g = buildSlingshot();
      g.scale.setScalar(0.75);
      g.position.set(-0.7, 0.78, 0.05);
      g.rotation.set(0.22, 0, 0.5);
      return g;
    }
    default:
      return null;
  }
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
 * 나무 검 — 시작할 때 기본으로 쥐고 있는 무기(사용자 요청: 더 이상 맨주먹으로
 * 평타를 치지 않게). 요루와 같은 실루엣(넓적한 외날 + 십자 가드 + 손잡이)이지만
 * 훨씬 작고 투박한 목재 재질로, "이제 막 시작한 초보자의 목검" 느낌을 냅니다.
 */
function buildWoodenSword(): THREE.Group {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc9a066, roughness: 0.85 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8c68a, roughness: 0.75 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });

  // 투박한 나무 날
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.7, 0.1), bladeMat);
  blade.position.y = 1.1;
  blade.castShadow = true;
  group.add(blade);

  // 뭉툭한 칼끝 (진짜 검보다 훨씬 둔함)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.32, 4), bladeMat);
  tip.position.y = 2.0;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  group.add(tip);

  // 결 무늬처럼 보이는 옅은 세로줄
  const grain = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.6, 0.11), edgeMat);
  grain.position.y = 1.1;
  group.add(grain);

  // 작은 십자 가드 + 손잡이
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.16), gripMat);
  guard.position.y = 0.28;
  group.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.5, 8), gripMat);
  grip.position.y = -0.02;
  group.add(grip);

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

/**
 * R 순간이동 플래시 — 출발/도착 지점에 잠깐 뜨는 확장하며 옅어지는 고리.
 * SceneRenderer.sync()가 이 그룹의 스케일/투명도를 ~0.3초에 걸쳐 갱신하고 지웁니다.
 */
function buildTeleportFlashGroup(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xbfe9ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 24), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  group.add(ring);
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
  /** 걷기/스윙 애니메이션용 팔다리 피벗 — 로컬 플레이어(playerParts)와 같은 구조. */
  parts: BlockyCharacter;
  /** 지금 이 원격 플레이어의 손에 붙어 있는 무기 모델의 id(없으면 null). */
  weaponId: string | null;
  /** weaponId에 대응하는 실제로 붙어 있는 무기 인스턴스(없으면 null). */
  weaponVisual: THREE.Group | null;
  /** 이 원격 플레이어가 배를 타고 있을 때만 만들어지는 배 모델(없으면 null, buildBoat()로 지연 생성). */
  boat: BoatVisual | null;
  /** boat를 마지막으로 어느 등급 색으로 칠했는지 — 등급이 바뀔 때만 다시 칠합니다. */
  lastBoatTier: string;
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
  /** 고무가 아닌 열매를 차지하는 동안 손끝에 띄우는 에너지 구슬. */
  private chargeGlowMesh!: THREE.Mesh;
  private playerBaseBodyColor = new THREE.Color(0xffcc66);
  private playerBaseLegColor = new THREE.Color(0x2b3a67);
  private hakiWasActive = false;
  private boatParts: BoatVisual;
  private boatVisual: THREE.Group;
  private lastBoatTier = "";
  /** 무기 id별 3D 모델 — 손에 든 것만 보이게 토글합니다 */
  private weaponVisuals = new Map<string, THREE.Group>();
  /**
   * 열매 id별 3D 모델(GLB) — 비동기로 로드되므로 로드가 끝난 것만 이 맵에
   * 들어옵니다. 열매를 뽑았을 때(fruitDrawn) 오른손 자리에 보여줍니다.
   */
  private fruitVisuals = new Map<FruitAbilityId, THREE.Group>();
  /**
   * 스킬 이펙트 GLB 원본(템플릿) — 실제로 화면에 스폰할 때는 이걸 clone해서
   * 씁니다(재질도 따로 clone해서, 여러 개가 동시에 떠 있어도 서로의 페이드에
   * 영향을 주지 않고 각자 안전하게 dispose됩니다). 씬에는 직접 추가되지 않습니다.
   */
  private skillModelTemplates = new Map<string, THREE.Group>();
  /**
   * SKILL_AURA_IDS(서리 발판·뇌광 질주·사막의 대검) 전용 — 캐릭터에 계속
   * 붙어 있다가 해당 상태가 켜져 있는 동안만 보이는 인스턴스입니다.
   */
  private skillAuraVisuals = new Map<string, THREE.Group>();
  /**
   * 용의 비행(dragon_f.glb) 전용 — 다른 스킬 오라들과 달리 playerVisual의
   * 자식이 아니라 씬에 직접 붙입니다. 캐릭터 몸 전체를 "대신"해야 하므로
   * (playerVisual은 비행 중 통째로 숨김), 자체적으로 매 프레임 위치·회전을
   * 계산해서 따라다니게 합니다(sync() 참고).
   */
  private dragonFlightVisual: THREE.Group | null = null;
  /**
   * 용으로 변신(V, dragon_v)의 dragonFlightVisual과는 별개인 독립 인스턴스이자
   * 별개 모델 파일(dragon_v.glb, dragonFlightVisual은 dragon_f.glb)입니다 —
   * F 비행과 V 변신은 게이팅상 동시에 켜질 수 있으므로(둘 다 fruitDrawn &&
   * dragon_dragon 조건만 봄) sync()가 두 상태가 동시에 켜져 있으면 비행
   * 시각을 우선(dragonFlightVisual만 보이고 이건 숨김)합니다.
   */
  private dragonFormVisual: THREE.Group | null = null;
  private readonly gltfLoader: GLTFLoader;
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

  // ── 다른 플레이어의 PvP 시각 동기화 ────────────────────────────────────────
  /** 다른 플레이어가 기본 공격을 낸 시각(performance.now() 기준) — 팔 스윙 애니메이션에 씁니다. */
  private remoteAttackSwingAtMs = new Map<string, number>();
  /** R 순간이동 순간에 뜨는, 출발/도착 지점의 짧은 링 플래시. */
  private teleportFlashes: { group: THREE.Group; startedAtMs: number }[] = [];

  // ── 기본 공격(좌클릭) 검 휘두르기 모션 ────────────────────────────────────
  /** 각 무기 모델의 "쥐고 있을 때" 기본 회전값 — 휘두르는 동안 여기서부터 튀어나갔다 돌아옵니다 */
  private weaponBaseRotationX = new Map<string, number>();
  private attackSwingStartedAtMs = -Infinity;

  // ── 요루/삼도류/엔마 스킬 이펙트 (내 것 + 다른 플레이어 것 공용) ─────────────
  private skillEffects: {
    group: THREE.Group;
    startedAtMs: number;
    durationMs: number;
    growTo: number;
    /** line/cone(투사체형) GLB 이펙트 전용 — 있으면 시작~끝 지점을 이 시간 동안 이동합니다. */
    travel?: { from: THREE.Vector3; to: THREE.Vector3 };
    /**
     * GLB 이펙트 전용 — 있으면 growTo 배율을 "1 + t*growTo"가 아니라
     * "baseScale * (1 + t*growTo)"로 계산해서, 애니메이션 내내 이 크기를
     * 기준으로 삼습니다(만화처럼 거대한 GLB 이펙트를 처음부터 그 크기로
     * 보여주기 위함 — 기존 도형 이펙트는 이 필드가 없어서 그대로 1을 씁니다).
     */
    baseScale?: number;
  }[] = [];

  // ── 고무 열매 — 내(로컬 플레이어)가 뻗을 때만 진짜 오른팔을 늘였다 되감습니다
  // (다른 플레이어는 팔 관절이 노출돼 있지 않아 지금은 로컬 전용입니다).
  private rubberArmStartedAtMs = -Infinity;
  private rubberArmTotalDurationMs = 0;
  private rubberArmPunches: ArmStretchPunch[] = [];
  /** 손을 뗀(발동) 순간의 팔 회전값 — 차지로 뒤로 당겨져 있던 자세에서 그대로 이어서 앞으로 뻗어야 자연스럽습니다. */
  private rubberArmReleaseRotX = 0;

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

    // 고무가 아닌 열매를 차지하는 동안 손끝에 띄우는 에너지 구슬 — 오른팔
    // 피벗의 자식으로 둬서 걷기/스윙/차지 자세를 따라 자연스럽게 함께 움직입니다.
    this.chargeGlowMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.chargeGlowMesh.position.set(0, -0.85, 0.2);
    this.chargeGlowMesh.visible = false;
    this.playerParts.rightArmPivot.add(this.chargeGlowMesh);

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

    // 나무 검 — 시작할 때 기본으로 손에 들려 있는 무기(같은 오른손 자리).
    const woodenSword = buildWoodenSword();
    woodenSword.scale.setScalar(0.6);
    woodenSword.position.set(-0.7, 0.78, 0.05);
    woodenSword.rotation.set(0.22, 0, 0.5);
    this.registerWeaponVisual("sword_wood", woodenSword);

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

    // 열매 — 인벤토리에서 장착한 열매를 뽑으면(4번 키) 무기와 같은 오른손
    // 자리에 실제로 손에 든 모습으로 보여줍니다. GLB는 비동기 로드라 로드가
    // 끝나는 대로 하나씩 등록되고, 그 전까지는 그냥 안 보일 뿐입니다(에러는
    // 콘솔 경고로만 남기고 게임 진행에는 지장이 없게 합니다).
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);
    for (const fruitId of Object.keys(FRUIT_MODEL_PATHS) as FruitAbilityId[]) {
      this.loadFruitVisual(fruitId);
    }
    for (const skillId of SKILL_MODEL_IDS) {
      this.loadSkillModel(skillId);
    }
    this.loadDragonFlightVisual();
    this.loadDragonFormVisual();

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

  /** 열매 GLB 하나를 비동기로 불러와 무기와 같은 오른손 자리에 등록합니다. */
  private loadFruitVisual(fruitId: FruitAbilityId) {
    const url = `${import.meta.env.BASE_URL}${FRUIT_MODEL_PATHS[fruitId]}`;
    this.gltfLoader.load(
      url,
      (gltf) => {
        const normalized = normalizeAndCenterModel(gltf.scene, 0.42);
        // 무기와 같은 "쥐는 자리" — 손 위치에 살짝 얹힌 것처럼 보이도록
        // 무기 기본 좌표(-0.7, 0.78, 0.05)에서 살짝 앞으로 당겨둡니다.
        normalized.position.set(-0.62, 0.72, 0.12);
        normalized.visible = false;
        this.playerVisual.add(normalized);
        this.fruitVisuals.set(fruitId, normalized);
      },
      undefined,
      (err) => {
        console.warn(`열매 모델을 불러오지 못했습니다 (${fruitId}):`, err);
      },
    );
  }

  /**
   * 스킬 이펙트 GLB 하나를 비동기로 불러와 템플릿으로 저장합니다. 서리
   * 발판·뇌광 질주·사막의 대검(SKILL_AURA_IDS)이면, 로드가 끝나는 대로
   * 캐릭터에 계속 붙어 있는 인스턴스도 하나 만들어 둡니다(처음엔 안 보임 —
   * 실제로 켜져 있을 때만 sync()가 visible을 켭니다).
   */
  private loadSkillModel(skillId: string) {
    const url = `${import.meta.env.BASE_URL}${skillModelPath(skillId)}`;
    this.gltfLoader.load(
      url,
      (gltf) => {
        const template = normalizeAndCenterModel(gltf.scene, 1);
        this.skillModelTemplates.set(skillId, template);

        if (SKILL_AURA_IDS.has(skillId)) {
          // 캐릭터에 계속 붙어 있는 오라도 다른 GLB 이펙트와 똑같이
          // SKILL_MODEL_SCALE(몬스터 키의 3배 이상) 기준으로 잡습니다 — 손에
          // 든 대검이든 몸을 감싸는 번개 오라든, 만화처럼 비현실적으로 크게
          // 보이는 게 목적입니다.
          const aura = cloneSkillModelInstance(template, false);
          if (skillId === "sand_v") {
            // 손에 든 대검 — 자루는 오른손 자리에 두고, 사용자 피드백에 따라
            // 다른 스킬들보다 훨씬 작은 SAND_BLADE_SCALE을 씁니다. z축 회전을
            // 45도(Math.PI/4)로 잡아 대검을 몸에 걸쳐 비스듬히 든 자세로
            // 보이게 합니다(사용자 요청).
            aura.scale.setScalar(SAND_BLADE_SCALE);
            aura.position.set(-0.7, 0.78, 0.05);
            aura.rotation.set(0.22, 0, Math.PI / 4);
          } else if (skillId === "ice_x") {
            // 발밑 얼음판 — 납작하게 눕혀두되, 반경 자체는 거대한 빙판이 되도록.
            aura.scale.set(SKILL_MODEL_SCALE, 0.12, SKILL_MODEL_SCALE);
            aura.position.set(0, 0.03, 0);
          } else {
            // 뇌광 질주 — 몸을 완전히 집어삼키는 거대한 번개 오라.
            aura.scale.setScalar(SKILL_MODEL_SCALE);
            aura.position.set(0, NPC_HEIGHT_APPROX / 2, 0);
          }
          aura.visible = false;
          this.playerVisual.add(aura);
          this.skillAuraVisuals.set(skillId, aura);
        }
      },
      undefined,
      (err) => {
        console.warn(`스킬 이펙트 모델을 불러오지 못했습니다 (${skillId}):`, err);
      },
    );
  }

  /**
   * 용의 비행 전용 dragon_f.glb를 불러와 씬에 직접(playerVisual의 자식이
   * 아니라) 추가합니다. skillAuraVisuals와 달리 이 모델은 캐릭터를 완전히
   * "대신"해야 해서, 걷기 애니메이션 등 playerVisual에 걸린 다른 자식
   * 트랜스폼과 얽히지 않도록 독립된 그룹으로 둡니다. 로드 전까지는
   * dragonFlightVisual이 null이라 sync()가 조용히 건너뜁니다.
   */
  private loadDragonFlightVisual() {
    const url = `${import.meta.env.BASE_URL}${DRAGON_FLIGHT_MODEL_PATH}`;
    this.gltfLoader.load(
      url,
      (gltf) => {
        const normalized = normalizeAndCenterModel(gltf.scene, 1);
        normalized.scale.setScalar(DRAGON_FLIGHT_MODEL_SCALE);
        normalized.visible = false;
        this.scene.add(normalized);
        this.dragonFlightVisual = normalized;
      },
      undefined,
      (err) => {
        console.warn("용의 비행 모델을 불러오지 못했습니다 (dragon_f):", err);
      },
    );
  }

  /**
   * 용으로 변신(V) 전용 dragon_v.glb 인스턴스 — dragonFlightVisual(dragon_f.glb)과는
   * 파일도 자세도 완전히 다른 별개 인스턴스입니다.
   */
  private loadDragonFormVisual() {
    const url = `${import.meta.env.BASE_URL}${DRAGON_FORM_MODEL_PATH}`;
    this.gltfLoader.load(
      url,
      (gltf) => {
        const normalized = normalizeAndCenterModel(gltf.scene, 1);
        normalized.scale.setScalar(DRAGON_FORM_MODEL_SCALE);
        normalized.visible = false;
        this.scene.add(normalized);
        this.dragonFormVisual = normalized;
      },
      undefined,
      (err) => {
        console.warn("용으로 변신 모델을 불러오지 못했습니다 (dragon_v):", err);
      },
    );
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
    chargeFrac?: number,
    aimGroundPoint?: { x: number; z: number } | null,
  ) {
    const weaponSkill = skillsForWeapon(sourceId as ItemId)[slot];
    let skill = weaponSkill ?? skillsForFruit(sourceId as FruitAbilityId)[slot];
    if (!skill) return;

    // 차지 스킬(고무 피스톨)이면, 실제로 발동됐던 사거리(chargeFrac만큼 늘어난
    // 값)로 스킬을 다시 만들어서 이펙트가 CombatSystem이 실제로 판정한 범위와
    // 정확히 같은 모양으로 보이게 합니다 — withCharge는 CombatSystem이
    // 판정에 쓰는 것과 똑같은 함수입니다.
    if (skill.chargeable && typeof chargeFrac === "number") {
      skill = withCharge(skill, chargeFrac);
    }

    // originAtAim/originAtMouse 스킬(낙뢰·빙결 감옥·절대 영도·중력정·용암 지대 등)은
    // 판정도 이펙트도 발밑이 아니라 조준/마우스 지점에서 나야 합니다 —
    // CombatSystem.ts의 isInShape과 정확히 같은 계산(skillOrigin)을 그대로
    // 재사용해서 판정과 눈에 보이는 위치·방향이 어긋나지 않게 합니다.
    // aimGroundPoint는 로컬 플레이어가 쓴 스킬일 때만 있고(원격 중계분은
    // 마우스 정보가 없어 originAtAim 폴백으로 자연스럽게 넘어갑니다).
    const origin = skillOrigin({ x, z }, aimYaw, skill, aimGroundPoint);
    x = origin.x;
    z = origin.z;
    aimYaw = origin.aimYaw;

    // 무기(검) 스킬은 GLB 모델이 없어서 기존 도형 기반 이펙트를 그대로 씁니다.
    // 열매 스킬은 이제 기존 도형 이펙트(SkillEffects.ts)를 화면에 띄우지 않고
    // GLB 모델로 완전히 대체합니다(사용자 요청) — 다만 buildFruitSkillEffectGroup은
    // 고무 열매의 실제 팔 늘리기 타이밍(armStretch)도 함께 계산해주므로, 그
    // 메타데이터만 가져오고 group 자체는 씬에 추가하지 않습니다.
    const main = weaponSkill
      ? buildSkillEffectGroup(skill, sourceId as ItemId)
      : buildFruitSkillEffectGroup(skill, sourceId as FruitAbilityId);
    if (weaponSkill) {
      main.group.position.set(x, y, z);
      main.group.rotation.y = aimYaw;
      this.scene.add(main.group);
      this.skillEffects.push({ group: main.group, startedAtMs: nowMs, durationMs: main.durationMs, growTo: main.growTo });
    }

    // GLB 이펙트(열매 스킬만 — 무기 스킬용 GLB는 없습니다). 이제 기존 도형
    // 이펙트를 대체하는 유일한 열매 스킬 이펙트입니다.
    if (!weaponSkill) this.spawnSkillModelEffect(skill, x, y, z, aimYaw, nowMs);

    // 고무 열매고, 내(로컬 플레이어)가 쓴 거면 진짜 오른팔을 이 타이밍표대로
    // 늘였다 되감습니다 — 다른 플레이어/원격 중계분은 팔 관절 모델이 따로
    // 없어서(ensureRemotePlayerVisual은 단순 그룹) 지금은 로컬 전용입니다.
    if (isLocalPlayer && main.armStretch && main.armStretch.length > 0) {
      // 차지로 뒤로 당겨져 있던 자세를 그대로 이어받아, 그 자세에서부터
      // 앞으로 튕겨나가는 것처럼 보이게 합니다(sync()의 rubberFrac 계산 참고).
      this.rubberArmReleaseRotX = this.playerParts.rightArmPivot.rotation.x;
      this.rubberArmStartedAtMs = nowMs;
      this.rubberArmTotalDurationMs = main.durationMs;
      this.rubberArmPunches = main.armStretch;
    }

    // 화상 잉걸불(ember) 오버레이도 열매 스킬의 "기존 이펙트"에 속하므로 함께
    // 뺍니다 — 무기(검) 스킬의 화상(엔마 등)에는 그대로 남겨둡니다.
    if (weaponSkill) {
      const ember = buildEmberOverlayGroup(skill);
      if (ember) {
        ember.group.position.set(x, y, z);
        ember.group.rotation.y = aimYaw;
        this.scene.add(ember.group);
        this.skillEffects.push({ group: ember.group, startedAtMs: nowMs, durationMs: ember.durationMs, growTo: ember.growTo });
      }
    }
  }

  /**
   * 열매 스킬용 GLB 이펙트를 스폰합니다 — 기존 도형 이펙트(main) 위에 덧씌우는
   * "진짜 모델" 연출입니다. 아직 로드가 안 끝났으면(비동기라 스킬을 먼저 쓸 수도
   * 있습니다) 조용히 아무것도 안 합니다.
   *
   * shape.kind에 따라 두 갈래로 나뉩니다:
   * - "line"/"cone" (다크 슬래시처럼 앞으로 뻗어나가는 스킬): 시전 지점에서
   *   조준 방향으로 사거리만큼 날아가는 투사체처럼 travel을 채워 넣습니다.
   * - "radial"/"self" (낙뢰·빙결 감옥처럼 한 자리를 때리는 스킬): 그 자리에서
   *   커졌다 여운을 남기며 사라지는 버스트로 재생합니다(사용자가 "좀 더
   *   여운있게"를 선택해서 0.6~1.2초 사이로 잡았습니다).
   *
   * 크기는 어느 쪽이든 SKILL_MODEL_SCALE(몬스터 키의 3배 이상, 만화처럼
   * 과장된 크기)을 기준으로 잡습니다 — baseScale로 넘겨서 skillEffects
   * 갱신 루프가 그 크기를 기준으로 성장/유지하게 합니다.
   */
  private spawnSkillModelEffect(skill: SkillDef, x: number, y: number, z: number, aimYaw: number, nowMs: number) {
    const template = this.skillModelTemplates.get(skill.id);
    if (!template) return;

    const clone = cloneSkillModelInstance(template, true);
    const fx = Math.sin(aimYaw);
    const fz = Math.cos(aimYaw);
    clone.rotation.y = aimYaw + (SKILL_MODEL_YAW_OFFSET[skill.id] ?? 0);
    clone.scale.setScalar(SKILL_MODEL_SCALE);

    if (skill.shape.kind === "line" || skill.shape.kind === "cone" || skill.id === "thunder_x") {
      // 투사체형 — 시전 지점에서 조준 방향으로 사거리만큼 날아갑니다.
      // 뇌광 질주(thunder_x)는 self 판정이라 shape.range가 없으므로 연출
      // 전용 THUNDER_X_MISSILE_RANGE를 대신 씁니다.
      const range = skill.shape.kind === "line" || skill.shape.kind === "cone" ? skill.shape.range : THUNDER_X_MISSILE_RANGE;
      const from = new THREE.Vector3(x, y + 1, z);
      const to = new THREE.Vector3(x + fx * range, y + 1, z + fz * range);
      clone.position.copy(from);
      this.scene.add(clone);
      this.skillEffects.push({
        group: clone,
        startedAtMs: nowMs,
        durationMs: 800,
        growTo: 0,
        baseScale: SKILL_MODEL_SCALE,
        travel: { from, to },
      });
    } else if (SKY_FALL_SKILL_IDS.has(skill.id)) {
      // 하늘에서 마우스 지점으로 빛이 떨어지는 낙하형 — thunder_c와 같은
      // radial 판정이지만, 그 자리에서 바로 나타나는 대신 높은 곳에서
      // 착지 지점까지 travel로 떨어집니다(앞 70% 구간 동안 낙하).
      const FALL_HEIGHT = 42;
      const from = new THREE.Vector3(x, y + FALL_HEIGHT, z);
      const to = new THREE.Vector3(x, y + 0.05, z);
      clone.position.copy(from);
      this.scene.add(clone);
      this.skillEffects.push({
        group: clone,
        startedAtMs: nowMs,
        durationMs: 950,
        growTo: 0.25,
        baseScale: SKILL_MODEL_SCALE,
        travel: { from, to },
      });
    } else {
      // 제자리형(radial/self) — 판정 지점에서 이미 거대한 크기로 나타나
      // 살짝 더 부풀었다가(growTo) 여운을 남기며 사라집니다.
      clone.position.set(x, y + 0.05, z);
      this.scene.add(clone);
      this.skillEffects.push({
        group: clone,
        startedAtMs: nowMs,
        durationMs: 1000,
        growTo: 0.25,
        baseScale: SKILL_MODEL_SCALE,
      });
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
      // buildBlockyCharacter(간편 버전) 대신 buildBlockyCharacterParts를 써서
      // 로컬 플레이어와 동일하게 팔다리 피벗을 갖게 합니다 — 걷기 모션과
      // 무기 부착, 기본 공격 스윙 애니메이션을 다른 사람 화면에도 재생하려면
      // 이 피벗들이 필요합니다 (playerParts와 같은 구조).
      const parts = buildBlockyCharacterParts(REMOTE_FACTION_COLORS[faction] ?? 0xcccccc);
      const group = parts.group;
      // 거래하려고 마우스로 이 플레이어를 가리켰는지 판정할 때, 레이캐스트가 맞힌
      // 메시에서 그룹까지 부모를 타고 올라가며 이 id를 찾습니다.
      group.traverse((obj) => {
        obj.userData.remotePlayerId = id;
      });
      const nameTag = buildCanvasSprite(220, 46, [2.4, 0.55]);
      nameTag.sprite.position.y = 2.7;
      group.add(nameTag.sprite);
      this.scene.add(group);
      visual = { group, nameTag, lastLabel: "", parts, weaponId: null, weaponVisual: null, boat: null, lastBoatTier: "" };
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
    const nowMs = performance.now();
    for (const r of remotePlayers) {
      seen.add(r.snapshot.id);
      const visual = this.ensureRemotePlayerVisual(r.snapshot.id, r.snapshot.faction);
      visual.group.visible = true;
      visual.group.position.set(r.renderX, r.renderY, r.renderZ);
      visual.group.rotation.y = r.renderYaw;

      // 배를 타고 있으면 캐릭터 발밑에 배 모델을 붙입니다. 캐릭터 자체는 이미
      // (서버가 그대로 중계하는) 배 갑판 위치/방향으로 렌더링되고 있으므로,
      // 로컬 boatVisual과 똑같은 상대 오프셋으로 캐릭터 그룹의 자식으로 붙여두면
      // 별도 위치 계산 없이 캐릭터를 따라 자동으로 움직입니다.
      if (r.snapshot.boatTier) {
        if (!visual.boat) {
          visual.boat = buildBoat();
          visual.boat.group.position.set(0, -BOAT_DECK_Y, 0);
          visual.boat.group.rotation.y = -Math.PI / 2;
          visual.group.add(visual.boat.group);
        }
        if (r.snapshot.boatTier !== visual.lastBoatTier) {
          visual.lastBoatTier = r.snapshot.boatTier;
          const tier = boatTier(r.snapshot.boatTier);
          visual.boat.hullMat.color.setHex(tier.hullColor);
          visual.boat.sailMat.color.setHex(tier.sailColor);
        }
        visual.boat.group.visible = true;
      } else if (visual.boat) {
        visual.boat.group.visible = false;
      }

      // 손에 든 무기 — drawnWeaponId가 바뀌었을 때만 떼고 새로 답니다.
      if (r.snapshot.drawnWeaponId !== visual.weaponId) {
        if (visual.weaponVisual) {
          visual.group.remove(visual.weaponVisual);
          visual.weaponVisual.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              (obj.material as THREE.Material).dispose();
            }
          });
        }
        visual.weaponId = r.snapshot.drawnWeaponId;
        visual.weaponVisual = visual.weaponId ? buildWeaponVisualInstance(visual.weaponId) : null;
        if (visual.weaponVisual) visual.group.add(visual.weaponVisual);
      }

      // 기본 공격(좌클릭) 휘두르기 — player_melee_fx를 받은 시각부터 로컬과
      // 같은 커브(사인 곡선)로 오른팔/무기를 튀어나갔다 되돌아오게 합니다.
      const swingAt = this.remoteAttackSwingAtMs.get(r.snapshot.id) ?? -Infinity;
      const swingT = (nowMs - swingAt) / ATTACK_SWING_DURATION_MS;
      const swingArc = swingT >= 0 && swingT < 1 ? Math.sin(swingT * Math.PI) : 0;
      visual.parts.rightArmPivot.rotation.x = -swingArc * ATTACK_SWING_ARM_AMPLITUDE;
      if (visual.weaponVisual) {
        const baseRotX = visual.weaponId ? this.weaponBaseRotationX.get(visual.weaponId) ?? 0 : 0;
        visual.weaponVisual.rotation.x = baseRotX - swingArc * ATTACK_SWING_WEAPON_AMPLITUDE;
      }

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
      if (visual.boat) {
        visual.boat.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
      }
      this.scene.remove(visual.group); // visual.group의 자식(배 모델 포함)도 함께 씬에서 빠집니다.
      this.remotePlayerVisuals.delete(id);
      this.remoteAttackSwingAtMs.delete(id);
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
    remoteMeleeFx?: RemoteMeleeFx[],
    remoteDashFx?: RemoteDashFx[],
    remoteTeleportFx?: RemoteTeleportFx[],
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

    // 차지 스킬 공통(열매 6종 중 19개가 이제 차지형입니다) — 지금 어떤 슬롯이든
    // 차지 중이면(놓기 전) 누른 시간에 비례해 팔을 뒤로 당겨 "힘을 모으는"
    // 자세를 보여줍니다. 실제 발동(사거리/데미지 계산)은 CombatSystem이 손을
    // 뗄 때 처리하고, 여기서는 순수 연출만 합니다 — 고무 전용이 아니라 모든
    // 차지 스킬에 공통으로 적용됩니다.
    let chargeWindupFrac = 0;
    if (state.player.chargingSkillSlot !== null && state.player.fruitDrawn) {
      const chargingSkill = skillsForFruit(state.player.equippedFruit)[state.player.chargingSkillSlot];
      if (chargingSkill?.chargeable) {
        const maxMs = Math.max(1, (chargingSkill.maxChargeSec ?? 1) * 1000);
        chargeWindupFrac = Math.min(1, (nowMs - state.player.chargingSkillStartedAtMs) / maxMs);
      }
    }
    if (chargeWindupFrac > 0.0005) {
      const baseRotX = this.playerParts.rightArmPivot.rotation.x;
      this.playerParts.rightArmPivot.rotation.x = baseRotX + chargeWindupFrac * (RUBBER_ARM_WINDUP_PITCH - baseRotX);
    }

    // 고무가 아닌 열매(마그마·얼음·번개·어둠·모래)는 실제로 팔이 늘어나진
    // 않으니, 그 대신 손끝에 열매 테마색 에너지 구슬을 띄워 차지가 얼마나
    // 찼는지 눈으로 보이게 합니다. 놓는 순간(발동) 함께 사라집니다.
    if (chargeWindupFrac > 0.0005 && state.player.equippedFruit !== "rubber_barrage") {
      const theme = fruitVfxTheme(state.player.equippedFruit);
      this.chargeGlowMesh.visible = true;
      (this.chargeGlowMesh.material as THREE.MeshBasicMaterial).color.setHex(theme.glow);
      const s = 0.12 + chargeWindupFrac * 0.34;
      this.chargeGlowMesh.scale.setScalar(s);
      (this.chargeGlowMesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + chargeWindupFrac * 0.35;
    } else {
      this.chargeGlowMesh.visible = false;
    }

    // 고무 열매 펀치 — 이번 프레임에 예약된 스트레치 구간이 있으면 진짜 오른팔
    // 메시(rightArmMesh)를 그 길이만큼 늘이고, 팔 피벗을 정면으로 접어 펀치
    // 자세를 만듭니다. 차지 중이었다면(위) 뒤로 당겨진 자세(rubberArmReleaseRotX)
    // 에서 이어받아 앞으로 튕겨나가고, 그렇지 않았다면(즉발 스킬) 걷기/공격
    // 스윙으로 이미 정해진 현재 회전값에서 정면 자세로 보간합니다.
    {
      const rubberT = (nowMs - this.rubberArmStartedAtMs) / Math.max(1, this.rubberArmTotalDurationMs);
      let rubberFrac = 0;
      let rubberLength = 0;
      let inBuildupOrHold = false;
      if (rubberT >= 0 && rubberT < 1) {
        for (const punch of this.rubberArmPunches) {
          if (rubberT < punch.startT || rubberT > punch.endT) continue;
          const span = Math.max(0.0001, punch.endT - punch.startT);
          const localT = (rubberT - punch.startT) / span;
          const holdEnd = punch.peakFrac + punch.holdFrac;
          if (localT < punch.peakFrac) {
            rubberFrac = punch.peakFrac > 0 ? localT / punch.peakFrac : 1;
            inBuildupOrHold = true;
          } else if (localT < holdEnd) {
            rubberFrac = 1;
            inBuildupOrHold = true;
          } else {
            const retractFrac = Math.max(0.0001, 1 - holdEnd);
            rubberFrac = Math.max(0, 1 - (localT - holdEnd) / retractFrac);
            inBuildupOrHold = false;
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
        const thickness = 1 + rubberFrac * (RUBBER_ARM_THICKNESS_FACTOR - 1);
        armMesh.scale.x = thickness;
        armMesh.scale.z = thickness;
        // 뻗는(+버티는) 동안은 차지로 당겨져 있던 자세에서 정면으로, 되감는
        // 동안은 지금의 걷기/공격 스윙 자세로 되돌아갑니다 — 경계(holdEnd)에서
        // 양쪽 다 rubberFrac=1이라 값이 정확히 이어집니다.
        const rotStart = inBuildupOrHold ? this.rubberArmReleaseRotX : this.playerParts.rightArmPivot.rotation.x;
        this.playerParts.rightArmPivot.rotation.x = rotStart + rubberFrac * (RUBBER_ARM_FORWARD_PITCH - rotStart);
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

    // 다른 플레이어의 기본 공격 — 팔/무기 스윙 애니메이션은 syncRemotePlayers()가
    // remoteAttackSwingAtMs를 읽어서 재생하므로, 여기서는 그 시각만 기록해둡니다.
    if (remoteMeleeFx) {
      for (const fx of remoteMeleeFx) {
        this.remoteAttackSwingAtMs.set(fx.fromId, nowMs);
      }
    }

    // 다른 플레이어의 Q 대쉬 — 그 사람의 지금 렌더 위치에 같은 바람 이펙트를 띄웁니다.
    if (remoteDashFx && remotePlayers) {
      for (const fx of remoteDashFx) {
        const view = remotePlayers.find((r) => r.snapshot.id === fx.fromId);
        if (!view) continue;
        const trail = buildWindTrailGroup();
        trail.position.set(view.renderX, view.renderY + 1.0, view.renderZ);
        trail.rotation.y = Math.atan2(fx.dx, fx.dz);
        this.scene.add(trail);
        this.dashTrails.push({ group: trail, startedAtMs: nowMs });
      }
    }

    // 다른 플레이어의 R 순간이동 — 출발/도착 지점 둘 다에 짧은 링 플래시를 띄웁니다.
    // 렌더 위치 자체는 MultiplayerClient.RemotePlayerView.snapTo()가 이미
    // 보간 없이 즉시 옮겨뒀으므로, 여기서는 시각 효과만 담당합니다.
    if (remoteTeleportFx) {
      for (const fx of remoteTeleportFx) {
        for (const point of [fx.from, fx.to]) {
          const flash = buildTeleportFlashGroup();
          flash.position.set(point.x, point.y + 0.05, point.z);
          this.scene.add(flash);
          this.teleportFlashes.push({ group: flash, startedAtMs: nowMs });
        }
      }
    }
    for (let i = this.teleportFlashes.length - 1; i >= 0; i--) {
      const flash = this.teleportFlashes[i];
      const t = (nowMs - flash.startedAtMs) / 300;
      if (t >= 1) {
        this.scene.remove(flash.group);
        flash.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.teleportFlashes.splice(i, 1);
        continue;
      }
      flash.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
          obj.material.opacity = 0.85 * (1 - t);
        }
      });
      flash.group.scale.setScalar(1 + t * 2.5);
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
            ev.chargeFrac,
            state.player.aimGroundPoint,
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
      // 사용자 요청: 이펙트가 재생되는 내내 서서히 투명해지지 않고, 끝날 때만
      // 자연스럽게 사라지도록 — 수명의 앞 75%는 완전히 불투명하게 유지하다가
      // 나머지 25% 구간에서만 opacity를 0까지 줄입니다.
      const FADE_START_T = 0.75;
      const fade = t < FADE_START_T ? 1 : 1 - (t - FADE_START_T) / (1 - FADE_START_T);
      if (eff.growTo > 0 || eff.baseScale) {
        const base = eff.baseScale ?? 1;
        eff.group.scale.setScalar(base * (1 + t * eff.growTo));
      }
      if (eff.travel) {
        // 투사체형 GLB 이펙트 — 앞 70%는 날아가고, 나머지는 도착 지점에서 여운을 남기며 사라집니다.
        const flyT = Math.min(1, t / 0.7);
        eff.group.position.lerpVectors(eff.travel.from, eff.travel.to, flyT);
      }
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
        } else if (obj.userData.role === "growScale") {
          // 열매 스킬 공통 — "쑥 자라났다가(다 자란 채로 버티다가) 사그라드는"
          // 모션. 얼음 결정이 바닥에서 솟거나, 용암 기둥이 치솟거나, 어둠의
          // 구멍이 벌어지는 등 "가만히 떠 있다 페이드"가 아니라 실제로
          // 자라나는 느낌을 줄 때 씁니다(고무 팔의 extendZ와 같은 원리를
          // 크기 전체에 적용한 버전).
          const peakT = (obj.userData.scalePeakT as number) ?? 0.3;
          const holdT = (obj.userData.scaleHoldT as number) ?? 0.3;
          const retractT = (obj.userData.scaleRetractT as number) ?? 0.4;
          const from = (obj.userData.scaleFrom as number) ?? 0;
          const to = (obj.userData.scaleTo as number) ?? 1;
          let frac: number;
          if (t < peakT) frac = peakT > 0 ? t / peakT : 1;
          else if (t < peakT + holdT) frac = 1;
          else if (t < peakT + holdT + retractT) frac = retractT > 0 ? 1 - (t - peakT - holdT) / retractT : 0;
          else frac = 0;
          obj.scale.setScalar(Math.max(0.0005, from + (to - from) * frac));
        } else if (obj.userData.role === "collapseIn") {
          // 열매 스킬 공통 — 입자가 먼저 중심으로 빨려들었다가(collapseT까지)
          // 그 다음 바깥으로 터져나가는 "모으고 터뜨리기" 모션. 차지 스킬의
          // "힘을 모았다 놓는다"는 느낌과 맞춰, 용암 분출·어둠의 구멍 붕괴·
          // 번개 응축·모래 소용돌이 등 여러 열매의 공통 시그니처로 씁니다.
          const collapseT = (obj.userData.collapseT as number) ?? 0.35;
          const dirX = (obj.userData.dirX as number) ?? 1;
          const dirZ = (obj.userData.dirZ as number) ?? 0;
          const outerR = (obj.userData.outerR as number) ?? 2;
          const innerR = (obj.userData.innerR as number) ?? 0.15;
          const burstR = (obj.userData.burstR as number) ?? outerR * 1.6;
          let r: number;
          if (t < collapseT) {
            const p = collapseT > 0 ? t / collapseT : 1;
            r = outerR + (innerR - outerR) * p;
          } else {
            const p = (t - collapseT) / Math.max(0.0001, 1 - collapseT);
            r = innerR + (burstR - innerR) * p;
          }
          obj.position.x = dirX * r;
          obj.position.z = dirZ * r;
        } else if (obj.userData.role === "spin") {
          // 회전하며 형성되는 결정/파편 — 정지된 파티클보다 훨씬 "마법 같은" 느낌을 줍니다.
          const spinSpeed = (obj.userData.spinSpeed as number) ?? 6;
          obj.rotation.y += spinSpeed * animDt;
        }
        // spin은 위의 "role"과 별개로 아무 롤에나 얹을 수 있는 보조 회전입니다 —
        // 예를 들어 growScale로 쑥 자라나는 얼음 결정이 동시에 빙글빙글 돌게도 합니다.
        if (obj.userData.spin) {
          obj.rotation.y += ((obj.userData.spinSpeed as number) ?? 6) * animDt;
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

    // 인벤토리에서 "손에 들기"로 집어든, 아직 안 먹은(미확정) 열매만 실제
    // 모델로 보여줍니다. 이미 먹어서 equippedFruit이 된 열매는 능력일 뿐
    // 손에 들고 다니는 물건이 아니므로 모델을 띄우지 않습니다 — 뽑아서 쓰는
    // 동안의 시각 피드백은 위의 차지 이펙트/글로우가 대신합니다.
    for (const [id, visual] of this.fruitVisuals) {
      visual.visible = state.player.heldFruitCandidate === id;
    }

    // 캐릭터에 계속 붙어 있는 스킬 오라(GLB) — 실제로 그 상태가 켜져 있을 때만 보입니다.
    for (const [skillId, aura] of this.skillAuraVisuals) {
      if (skillId === "ice_x") {
        aura.visible = state.player.iceWalkActive;
      } else if (skillId === "thunder_x") {
        aura.visible = state.player.lightningFormRemainingSec > 0;
      } else if (skillId === "sand_v") {
        aura.visible = state.player.sandBladeActive && state.player.fruitDrawn;
      } else if (skillId === "light_f") {
        // 빛의 비행 — 순간 돌진 직후 lightFormRemainingSec 동안만 잠깐 보입니다.
        aura.visible = state.player.lightFormRemainingSec > 0 && state.player.fruitDrawn;
      } else if (skillId === "dragon_f") {
        // 용의 비행 — 사용자 피드백으로 "몸을 감싸는 오라"가 아니라
        // dragon_f.glb를 몸 대신 직접 보여주는 방식(아래 dragonFlightVisual,
        // SKILL_AURA_IDS의 이 GLB 인스턴스와는 별개의 독립 로딩)으로 완전히
        // 대체됐습니다. 이 오라 인스턴스 자체는 다른 용도가 없어서(활성화
        // 순간의 별도 버스트 연출 없음) 이제 항상 숨깁니다 — GLB 로딩/등록은
        // 그대로 둬서(파일 삭제·참조 제거는 안 함) 다른 곳에 영향이 없게 합니다.
        aura.visible = false;
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
    // 용의 비행 중에는 평소 블록형 캐릭터 대신 dragon_f.glb를 몸으로 보여주므로,
    // 평소 캐릭터는 통째로 숨깁니다(예전 dragon_f 오라 방식은 캐릭터를 숨기지
    // 않고 위에 덧씌우기만 했지만, "실제 몸을 대신"하라는 요청에 따라 바꿨습니다).
    const dragonFlying = state.player.dragonFlightActive && state.player.fruitDrawn;
    // 용으로 변신(V) — F(비행)와 게이팅이 같아(둘 다 fruitDrawn && dragon_dragon만
    // 봄) 이론상 동시에 켜질 수 있습니다. 가장 단순하고 안전한 우선순위로,
    // 둘 다 켜져 있으면 비행 시각(dragonFlying)을 우선해서 보여주고 변신
    // 시각은 숨깁니다.
    const dragonFormOn = state.player.dragonFormActive && state.player.fruitDrawn && !dragonFlying;
    this.playerVisual.visible = !firstPerson && !dragonFlying && !dragonFormOn;
    if (this.dragonFormVisual) {
      this.dragonFormVisual.visible = dragonFormOn && !firstPerson;
      if (dragonFormOn) {
        // 눕히는 회전 보정 없이, 모델이 원래 만들어진 자세(가장 긴 축인
        // 로컬 Y가 위를 향함) 그대로 세워두고 yaw(보는 방향)만 반영합니다 —
        // "머리가 옆으로 누워있다"는 피드백의 원인이었던 F 비행용 회전
        // (DRAGON_FLIGHT_BASE_YAW, dragon_f.glb 전용)을 여기서는 절대
        // 재사용하지 않습니다.
        const formYawQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          state.player.yaw + DRAGON_FORM_YAW_OFFSET,
        );
        this.dragonFormVisual.quaternion.copy(formYawQuat);
        this.dragonFormVisual.position.set(
          state.player.position.x,
          // 5배로 커진 모델이 절반쯤 땅에 파묻혀 보이지 않도록, 앵커를 고정된
          // NPC_HEIGHT_APPROX/2 대신 실제 모델 높이(가장 긴 축=1로 정규화된 뒤
          // DRAGON_FORM_MODEL_SCALE배 된 세로 크기)의 절반만큼 띄웁니다 —
          // dragon_v.glb는 로컬 Y가 가장 긴 축이라 world 높이 ≈ DRAGON_FORM_MODEL_SCALE.
          state.player.position.y + DRAGON_FORM_MODEL_SCALE / 2,
          state.player.position.z,
        );
      }
    }
    if (this.dragonFlightVisual) {
      this.dragonFlightVisual.visible = dragonFlying && !firstPerson;
      if (dragonFlying) {
        // 헤엄치듯 몸을 일렁이게 하는 절차적 애니메이션 — 뼈대가 없는 정적
        // 메시라 그룹 전체의 회전/위치만 사인파로 흔듭니다(피치 진동 + 살짝
        // 어긋난 위상의 수직 bob). dragon_f.glb는 dragon_v.glb와 축 배치가
        // 달라(로컬 X가 몸통 길이, Z가 가장 얇은 폭) 기본 자세 보정은
        // 피치(X축 회전)가 아니라 요(Y축, DRAGON_FLIGHT_BASE_YAW) 회전이고,
        // "코가 위아래로 까딱이는" 헤엄 진동은 로컬 Z축(요 보정 후 좌우 폭
        // 축이 되는) 기준 회전으로 줍니다.
        const phase = (nowMs / 1000) * DRAGON_SWIM_FREQUENCY_HZ * Math.PI * 2;
        const oscPitch = DRAGON_SWIM_PITCH_AMPLITUDE * Math.sin(phase);
        const bobY = DRAGON_SWIM_BOB_AMPLITUDE * Math.sin(phase + DRAGON_SWIM_BOB_PHASE_OFFSET);
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), oscPitch);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          state.player.yaw + DRAGON_FLIGHT_BASE_YAW,
        );
        // 로컬(모델 좌표계) 피치 진동을 먼저 적용하고, 그 결과를 월드 Y축 기준
        // 진행 방향(yaw + 기본 자세 보정)으로 돌립니다 — 자식(피치)이 부모(요)를
        // 따라가는 합성 순서라 쿼터니언 곱셈은 yaw * pitch 순서여야 합니다.
        this.dragonFlightVisual.quaternion.copy(yawQuat).multiply(pitchQuat);
        this.dragonFlightVisual.position.set(
          state.player.position.x,
          state.player.position.y + NPC_HEIGHT_APPROX / 2 + bobY,
          state.player.position.z,
        );
      }
    }
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
