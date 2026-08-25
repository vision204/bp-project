import type RAPIER from "@dimforge/rapier3d-compat";
import type { InputSnapshot } from "../core/InputManager";
import type { PlayerState } from "../core/GameState";

const MOVE_SPEED = 8;
const SPRINT_SPEED = 14;
/**
 * Q 대쉬 거리(m). 쿨다운은 없고, 대신 마나를 소모합니다 —
 * 마나가 있는 한 연속으로 계속 쓸 수 있고, 마나가 떨어지면 자연 회복될 때까지 못 씁니다.
 */
const DASH_DISTANCE = 11;
/** Q 대쉬 한 번에 소모하는 마나 — 고정값이 아니라 "최대 마나의 2%" (밸런스 패치) */
export const DASH_MANA_COST_PERCENT = 0.02;
const SWIM_SPEED = 4.5;
const JUMP_SPEED = 9;
const GRAVITY = 20;
const MOUSE_SENSITIVITY = 0.0025;

// ── 마우스 휠 줌 (로블록스 방식) ────────────────────────────────────────────
/** 기본 3인칭 거리 */
export const DEFAULT_CAM_DISTANCE = 6;
/** 이 값까지 당기면 1인칭으로 들어갑니다 (캐릭터 모델을 숨김) */
export const MIN_CAM_DISTANCE = 0;
export const MAX_CAM_DISTANCE = 28;
/** 휠 한 칸이 바꾸는 거리(m). 멀수록 한 칸이 크게 움직이도록 비례 배율도 겁니다. */
const ZOOM_STEP = 1.4;
/** 이 거리보다 가까우면 1인칭으로 봅니다 */
export const FIRST_PERSON_THRESHOLD = 1.2;

// ── 개발자 모드 비행 ────────────────────────────────────────────────────────
/** 기본 비행 속도 (m/s) — 걷기 8, 질주 14와 비교하면 훨씬 빠릅니다 */
export const FLY_SPEED = 60;
/** Shift를 누르면 이 배율만큼 더 빨라집니다 (섬 사이 600m를 몇 초 만에 이동) */
export const FLY_BOOST = 3;
/** 너무 높이 올라가면 아무것도 안 보이므로 고도 상한 */
export const FLY_CEILING = 400;

function applyZoom(current: number, zoomDelta: number) {
  if (zoomDelta === 0) return current;
  // 멀리 있을수록 한 칸당 더 크게 움직여야 체감이 균일합니다.
  const step = ZOOM_STEP * (1 + current / 12);
  const next = current + zoomDelta * step;
  return Math.max(MIN_CAM_DISTANCE, Math.min(MAX_CAM_DISTANCE, next));
}

/**
 * 플레이어의 물리 이동을 담당합니다. Rapier의 KinematicCharacterController를
 * 써서 캡슐 콜라이더 하나로 지면/장애물과 충돌하도록 했습니다.
 * (나중에 서버 권위 이동으로 옮길 때도 이 클래스만 서버 쪽에서 재사용 가능)
 */
export class PlayerController {
  readonly collider: RAPIER.Collider;
  readonly body: RAPIER.RigidBody;
  private controller: RAPIER.KinematicCharacterController;
  private verticalVelocity = 0;
  /**
   * 땅에서 떨어진 뒤 공중에서 몇 번 점프했는지.
   * 착지하면 0으로 돌아갑니다 (다단 점프용).
   */
  private jumpsUsed = 0;
  /** null이 아니면 헤엄치는 중 — 이 높이까지 몸이 떠오릅니다 */
  private swimSurfaceY: number | null = null;
  camYaw = 0; // 카메라(및 캐릭터 정면) 좌우 회전
  camPitch = -0.25; // 카메라 상하 회전 (라디안)
  /** 휠로 조절하는 3인칭 카메라 거리 (m). MIN까지 당기면 1인칭으로 전환됩니다. */
  camDistance = DEFAULT_CAM_DISTANCE;

  constructor(
    private world: RAPIER.World,
    RAPIER_NS: typeof RAPIER,
    startPos: { x: number; y: number; z: number },
  ) {
    this.body = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.kinematicPositionBased().setTranslation(startPos.x, startPos.y, startPos.z),
    );
    this.collider = world.createCollider(
      RAPIER_NS.ColliderDesc.capsule(0.6, 0.4).setTranslation(0, 0.6, 0),
      this.body,
    );

    this.controller = world.createCharacterController(0.05);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.5, 0.2, true);
    this.controller.enableSnapToGround(0.3);
  }

  /** 지금 공중에서 몇 번 더 뛸 수 있는지 (HUD 표시용) */
  remainingJumps(player: PlayerState) {
    return Math.max(0, player.maxJumps - this.jumpsUsed);
  }

  /** 물에 빠졌을 때 호출 — 수면 높이를 주면 그 높이까지 몸이 떠오릅니다. 뭍이면 null. */
  setSwimSurface(surfaceY: number | null) {
    this.swimSurfaceY = surfaceY;
  }

  /**
   * 개발자 모드 비행 — 섬들을 빠르게 둘러보기 위한 자유 비행입니다.
   *
   * 캐릭터 컨트롤러(충돌 판정)를 아예 거치지 않고 위치를 직접 옮겨서
   * 지형·바다를 그대로 통과합니다. 중력도 적용하지 않습니다.
   *   · W/S — 카메라가 보는 방향 그대로(위아래 포함) 전진·후진
   *   · A/D — 수평 좌우 이동
   *   · Space / Ctrl — 수직 상승·하강
   *   · Shift — 가속(3배) 토글
   */
  private stepFlight(dt: number, input: InputSnapshot, player: PlayerState) {
    const speed = FLY_SPEED * (input.sprintToggledOn ? FLY_BOOST : 1);
    player.sprinting = input.sprintToggledOn;

    // 보는 방향(피치 포함) 단위 벡터
    const cosP = Math.cos(this.camPitch);
    const look = {
      x: Math.sin(this.camYaw) * cosP,
      y: Math.sin(this.camPitch),
      z: Math.cos(this.camYaw) * cosP,
    };
    const right = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };

    let mx = 0;
    let my = 0;
    let mz = 0;
    if (input.moveForward) { mx += look.x; my += look.y; mz += look.z; }
    if (input.moveBackward) { mx -= look.x; my -= look.y; mz -= look.z; }
    if (input.moveRight) { mx += right.x; mz += right.z; }
    if (input.moveLeft) { mx -= right.x; mz -= right.z; }
    if (input.flyUpHeld) my += 1;
    if (input.flyDownHeld) my -= 1;

    const len = Math.hypot(mx, my, mz);
    if (len > 0.0001) {
      mx = (mx / len) * speed;
      my = (my / len) * speed;
      mz = (mz / len) * speed;
      player.yaw = Math.atan2(mx, mz);
    }

    const pos = this.body.translation();
    const next = { x: pos.x + mx * dt, y: pos.y + my * dt, z: pos.z + mz * dt };
    // 너무 높이 올라가면 아무것도 안 보이므로 상한만 둡니다.
    next.y = Math.max(-20, Math.min(FLY_CEILING, next.y));

    this.body.setNextKinematicTranslation(next);
    this.verticalVelocity = 0;
    this.jumpsUsed = 0; // 비행 중에는 점프 횟수를 계속 채워둡니다
    player.position = next;
    player.grounded = false;
    player.velocity = { x: mx, y: my, z: mz };
  }

  step(dt: number, input: InputSnapshot, player: PlayerState, nowMs: number = Date.now()) {
    this.camYaw -= input.mouseDeltaX * MOUSE_SENSITIVITY;
    this.camPitch -= input.mouseDeltaY * MOUSE_SENSITIVITY;
    this.camPitch = Math.max(-1.3, Math.min(0.9, this.camPitch));
    this.camDistance = applyZoom(this.camDistance, input.zoomDelta);

    // 부채꼴/직선 스킬은 "카메라가 보는 방향"으로 나갑니다 (이동 방향과 무관).
    player.aimYaw = this.camYaw;

    // 개발자 모드 비행은 물리를 통째로 건너뜁니다.
    if (player.devMode && player.flying) {
      this.stepFlight(dt, input, player);
      return;
    }

    // 빙결 감옥·절대 영도 등에 맞아 얼어붙은 동안은 이동·점프·대쉬 입력을 전부 무시합니다
    // (시점 회전만 됩니다 — 위에서 이미 처리했습니다). 중력/충돌은 그대로 적용해 제자리에 서 있게 합니다.
    if (player.frozenRemainingSec > 0) {
      this.verticalVelocity -= GRAVITY * dt;
      const desiredMovement = { x: 0, y: this.verticalVelocity * dt, z: 0 };
      this.controller.computeColliderMovement(this.collider, desiredMovement);
      const corrected = this.controller.computedMovement();
      const pos = this.body.translation();
      const newPos = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };
      if (this.swimSurfaceY !== null && newPos.y < this.swimSurfaceY) {
        newPos.y = this.swimSurfaceY;
        this.verticalVelocity = 0;
      }
      this.body.setNextKinematicTranslation(newPos);
      if (this.controller.computedGrounded() && this.verticalVelocity < 0) this.verticalVelocity = 0;
      player.position = newPos;
      player.grounded = this.controller.computedGrounded();
      player.velocity = { x: 0, y: this.verticalVelocity, z: 0 };
      player.sprinting = false;
      return;
    }

    // 카메라가 바라보는 수평 방향 기준으로 이동 (카메라 상대 이동)
    const forward = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    // right = forward × up. Three.js 기본 카메라는 -Z를 보고 오른쪽이 +X이므로,
    // +Z를 보는 이 게임에서는 오른쪽이 -X가 되어야 A/D가 정상 동작합니다.
    const right = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };

    const swimming = this.swimSurfaceY !== null;
    // Shift 한 번으로 질주 켜짐/꺼짐 토글 (물속에서는 적용되지 않음)
    const sprinting = input.sprintToggledOn && !swimming;
    player.sprinting = sprinting;
    const speed = swimming ? SWIM_SPEED : sprinting ? SPRINT_SPEED : MOVE_SPEED;

    let moveX = 0;
    let moveZ = 0;
    if (input.moveForward) {
      moveX += forward.x;
      moveZ += forward.z;
    }
    if (input.moveBackward) {
      moveX -= forward.x;
      moveZ -= forward.z;
    }
    if (input.moveRight) {
      moveX += right.x;
      moveZ += right.z;
    }
    if (input.moveLeft) {
      moveX -= right.x;
      moveZ -= right.z;
    }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0.0001) {
      moveX = (moveX / len) * speed;
      moveZ = (moveZ / len) * speed;
      player.yaw = Math.atan2(moveX, moveZ);
    }

    // Q 대쉬 — 바라보는 방향으로 순간 이동. 쿨다운은 없고 마나를 소모해서,
    // 마나가 있는 한 연속으로 계속 쓸 수 있습니다 (다 떨어지면 자연 회복까지 대기).
    // 비용은 고정값이 아니라 최대 마나의 DASH_MANA_COST_PERCENT(2%) — 밸런스 패치.
    const dashManaCost = player.maxMana * DASH_MANA_COST_PERCENT;
    if (input.dashPressed && player.mana >= dashManaCost) {
      player.mana -= dashManaCost;
      player.lastManaSpentAtMs = nowMs;
      const dx = Math.sin(this.camYaw) * DASH_DISTANCE;
      const dz = Math.cos(this.camYaw) * DASH_DISTANCE;
      player.pendingDash = { x: dx, z: dz };
      player.events.push({ type: "player_dashed", dx, dz });
    }

    // 다단 점프.
    //   · 땅에 있으면 언제나 점프 가능 (그리고 사용 횟수 초기화)
    //   · 공중에서는 배운 단수만큼만 추가로 점프 가능
    // 공중 점프는 지금까지의 낙하 속도를 지우고 다시 위로 밀어올려서,
    // 떨어지는 중에 눌러도 확실하게 뜹니다.
    const grounded = this.controller.computedGrounded();
    if (grounded) this.jumpsUsed = 0;

    if (input.jumpPressed) {
      if (grounded) {
        this.verticalVelocity = JUMP_SPEED;
        this.jumpsUsed = 1;
      } else if (this.jumpsUsed < player.maxJumps) {
        this.verticalVelocity = JUMP_SPEED;
        this.jumpsUsed += 1;
      } else {
        this.verticalVelocity -= GRAVITY * dt;
      }
    } else {
      this.verticalVelocity -= GRAVITY * dt;
    }

    const desiredMovement = {
      x: moveX * dt,
      y: this.verticalVelocity * dt,
      z: moveZ * dt,
    };

    this.controller.computeColliderMovement(this.collider, desiredMovement);
    const corrected = this.controller.computedMovement();
    const pos = this.body.translation();
    const newPos = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };

    // 부력: 수면보다 아래로 가라앉으면 수면까지 밀어올립니다. 위로 올라가는 것은
    // 막지 않기 때문에 해변 계단을 밟고 뭍으로 걸어 나올 수 있습니다.
    if (this.swimSurfaceY !== null && newPos.y < this.swimSurfaceY) {
      newPos.y = this.swimSurfaceY;
      this.verticalVelocity = 0;
    }

    this.body.setNextKinematicTranslation(newPos);

    if (this.controller.computedGrounded() && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }

    player.position = newPos;
    player.grounded = this.controller.computedGrounded();
    player.velocity = { x: moveX, y: this.verticalVelocity, z: moveZ };
  }

  /**
   * 배에 타고 있을 때처럼 캐릭터가 직접 걷지 않는 상태에서, 시점 회전만 반영합니다.
   * (이동/중력 계산을 건너뛰어 배 위치에 고정된 채로 카메라만 돌아갑니다)
   */
  updateCameraOnly(input: InputSnapshot, player: PlayerState) {
    this.camYaw -= input.mouseDeltaX * MOUSE_SENSITIVITY;
    this.camPitch -= input.mouseDeltaY * MOUSE_SENSITIVITY;
    this.camPitch = Math.max(-1.3, Math.min(0.9, this.camPitch));
    this.camDistance = applyZoom(this.camDistance, input.zoomDelta);
    player.aimYaw = this.camYaw;
    this.verticalVelocity = 0;
    player.sprinting = false;
  }

  /** 돌진 스킬용 — 현재 위치에서 상대 이동. 지형에 막히면 그만큼만 밀려납니다. */
  dash(dx: number, dz: number) {
    const pos = this.body.translation();
    this.controller.computeColliderMovement(this.collider, { x: dx, y: 0, z: dz });
    const moved = this.controller.computedMovement();
    this.body.setTranslation({ x: pos.x + moved.x, y: pos.y + moved.y, z: pos.z + moved.z }, true);
  }

  /** 즉시 위치를 옮깁니다 (사망 후 부활, 항해 도착 등). */
  teleport(pos: { x: number; y: number; z: number }) {
    this.body.setTranslation(pos, true);
    this.verticalVelocity = 0;
    this.swimSurfaceY = null;
    this.jumpsUsed = 0;
  }
}
