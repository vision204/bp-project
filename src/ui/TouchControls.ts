// 모바일 터치 조작 레이어 (PHASE 1).
//
// 목표는 단 하나 — InputManager.ts의 InputSnapshot과 "완전히 같은 모양,
// 같은 엣지/레벨 트리거 의미"를 가진 스냅샷을 터치 제스처로 채우는 것입니다.
// PlayerController.ts·CombatSystem.ts는 입력이 키보드/마우스에서 왔는지
// 터치에서 왔는지 전혀 몰라도 되고, 실제로 이 파일이 그 두 파일을 단 한
// 줄도 건드리지 않습니다 — main.ts에서 mergeInputSnapshots()로 두 스냅샷을
// 합쳐서 시뮬레이션에 넘길 뿐입니다.
//
// 화면 구성:
//   · 좌측 = 가상 조이스틱 (이동, W/A/S/D 4개 방향키를 흉내)
//   · 우측 = 어디를 드래그해도 카메라 회전 (기존 우클릭-드래그와 같은 로직,
//     마우스 델타 대신 손가락 델타를 씀)
//   · 우측 하단 = 공격·점프·대쉬(Q)·상호작용(E)·스킬 Z/X/C/V·F 버튼 9개
//   · 두 손가락 핀치 = 카메라 줌 (마우스 휠 zoomDelta와 동일한 필드)
//
// 멀티터치는 각 손가락을 Touch.identifier로 구분해서 추적합니다 — 조이스틱을
// 잡은 손가락과 카메라를 돌리는 손가락, 버튼을 누르는 손가락이 동시에 있어도
// 서로 안 꼬입니다.
//
// 기존 HUD(hud.ts)의 버튼류(상점/인벤토리/단축바 등)는 이 레이어보다 먼저
// 만들어지지만, 이 레이어의 조이스틱/카메라 드래그 존은 화면을 넓게 덮는
// 영역이라 자칫 그 위의 HUD 버튼 터치를 가로챌 수 있습니다. 그래서 터치가
// 시작된 지점에 실제로 어떤 요소가 있는지 elementFromPoint로 먼저 확인해서,
// 버튼/단축바 같은 기존 상호작용 요소 위라면 조이스틱·카메라 로직이 아예
// 관여하지 않고(preventDefault도 안 하고) 그대로 흘려보냅니다.
import type { InputSnapshot } from "../core/InputManager";

// ── 튜닝 상수 ────────────────────────────────────────────────────────────
/** 조이스틱 넙(nub)이 베이스 중심에서 최대 얼마나(px) 벗어날 수 있는지 */
const JOYSTICK_RADIUS = 52;
/** 이 비율(반지름 대비) 이상 벗어나야 그 방향으로 "눌린" 것으로 칩니다 (흔들림 방지) */
const JOYSTICK_DEADZONE_RATIO = 0.32;
/**
 * 손가락 드래그 1px당 mouseDeltaX/Y에 더하는 배율. PlayerController.ts의
 * MOUSE_SENSITIVITY(0.0025)는 그대로 재사용하고, 여기서는 그 앞단에서
 * "터치 드래그가 마우스 움직임보다 화면을 덜 가로지르는 경향"을 보정하는
 * 별도 배율만 곱합니다. 실기기 체감에 따라 조정할 값이라 상수로 분리해뒀습니다.
 */
const TOUCH_LOOK_SENSITIVITY = 1.6;
/** 핀치로 손가락 사이 거리가 이만큼(px) 변할 때마다 휠 "한 칸"에 해당하는 zoomDelta를 냅니다 */
const PINCH_PIXELS_PER_ZOOM_STEP = 45;

/** 버튼이 매핑하는 InputSnapshot상의 논리적 동작 이름 */
type ButtonAction = "attack" | "jump" | "dash" | "interact" | "skill0" | "skill1" | "skill2" | "skill3" | "fskill";

interface ButtonDef {
  action: ButtonAction;
  label: string;
  sub?: string;
  className: string;
}

// hud.ts의 Z/X/C/V 표기(SLOT_KEYS)와 이모지 톤을 그대로 따라갑니다.
const BUTTON_DEFS: ButtonDef[] = [
  { action: "skill0", label: "Z", className: "tc-btn-skill" },
  { action: "skill1", label: "X", className: "tc-btn-skill" },
  { action: "skill2", label: "C", className: "tc-btn-skill" },
  { action: "skill3", label: "V", className: "tc-btn-skill" },
  { action: "fskill", label: "F", sub: "비행", className: "tc-btn-skill tc-btn-f" },
];

const PRIMARY_BUTTON_DEFS: ButtonDef[] = [
  { action: "interact", label: "E", sub: "상호작용", className: "tc-btn-primary tc-btn-interact" },
  { action: "dash", label: "Q", sub: "대쉬", className: "tc-btn-primary tc-btn-dash" },
  { action: "jump", label: "⤒", sub: "점프", className: "tc-btn-primary tc-btn-jump" },
  { action: "attack", label: "⚔", sub: "공격", className: "tc-btn-primary tc-btn-attack" },
];

/**
 * 이 요소(또는 조상)가 이미 기존 UI의 클릭 가능한 부분이면 true — 조이스틱/
 * 카메라 드래그가 가로채면 안 됩니다.
 *
 * 주의: 아래 조이스틱/룩존 요소들은 일부러 pointer-events: none으로 둡니다
 * (CSS는 geometry 계산용으로만 씀). pointer-events: auto인 큰 투명 레이어를
 * 화면에 깔면 그 레이어가 항상 hit-test 최상단을 차지해서, 그 아래 깔린 HUD
 * 버튼(상점/인벤토리/단축바 등)이 실제로는 안 보여도 elementFromPoint가 항상
 * 이 레이어만 돌려주게 되어 "기존 UI 위인지" 판별 자체가 불가능해집니다.
 * pointer-events: none으로 두면 브라우저가 hit-test를 건너뛰어 실제 그 자리에
 * 있는 진짜 요소(캔버스든 HUD 버튼이든)를 touch.target으로 그대로 넘겨주므로,
 * 여기서 그 요소만 보고 안전하게 판단할 수 있습니다.
 */
function isForeignInteractive(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest(
    "button, a, input, select, textarea, .hotbar-slot, [data-tc-button]",
  );
}

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.id = "touch-controls-style";
  style.textContent = `
    #touch-controls {
      position: fixed;
      inset: 0;
      z-index: 40;
      pointer-events: none;
    }
    #touch-controls * {
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
    .tc-joystick-base {
      position: fixed;
      left: calc(env(safe-area-inset-left, 0px) + 26px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 30px);
      width: ${JOYSTICK_RADIUS * 2 + 20}px;
      height: ${JOYSTICK_RADIUS * 2 + 20}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.10);
      border: 2px solid rgba(255, 255, 255, 0.38);
      pointer-events: none;
      touch-action: none;
    }
    .tc-joystick-nub {
      position: fixed;
      left: calc(env(safe-area-inset-left, 0px) + 26px + ${JOYSTICK_RADIUS + 10}px - 30px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 30px + ${JOYSTICK_RADIUS + 10}px - 30px);
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(255, 213, 79, 0.88);
      border: 2px solid rgba(255, 255, 255, 0.65);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
      pointer-events: none;
      touch-action: none;
      will-change: transform;
    }
    .tc-joystick-zone {
      /* 순전히 좌표 계산용 — 화면에 그려지지도, 터치를 가로채지도 않습니다. */
      position: fixed;
      left: 0;
      bottom: 0;
      width: 46vw;
      height: 62vh;
      pointer-events: none;
    }
    /* 룩(카메라) 드래그는 별도 레이어 없이 "조이스틱 존이 아니고 기존 UI도
       아닌 모든 터치"로 판정합니다 — 아래 isForeignInteractive() 참고. */
    canvas {
      touch-action: none;
    }
    .tc-actions {
      position: fixed;
      right: calc(env(safe-area-inset-right, 0px) + 14px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      pointer-events: none;
    }
    .tc-skill-row, .tc-primary-row {
      display: flex;
      flex-direction: row;
      gap: 8px;
      pointer-events: none;
    }
    .tc-btn {
      pointer-events: auto;
      touch-action: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(20, 20, 24, 0.62);
      border: 2px solid rgba(255, 255, 255, 0.45);
      color: #fff;
      font-weight: bold;
      line-height: 1;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }
    .tc-btn-skill {
      width: 46px;
      height: 46px;
      font-size: 15px;
      border-color: rgba(255, 213, 79, 0.6);
    }
    .tc-btn-f {
      border-color: rgba(129, 212, 250, 0.75);
    }
    .tc-btn-primary {
      width: 60px;
      height: 60px;
      font-size: 20px;
    }
    .tc-btn-attack {
      width: 72px;
      height: 72px;
      font-size: 26px;
      background: rgba(211, 47, 47, 0.55);
      border-color: rgba(255, 138, 101, 0.85);
    }
    .tc-btn-jump { border-color: rgba(129, 212, 250, 0.8); }
    .tc-btn-dash { border-color: rgba(77, 208, 225, 0.8); }
    .tc-btn-interact { border-color: rgba(255, 213, 79, 0.8); }
    .tc-btn.tc-active {
      background: rgba(255, 213, 79, 0.55);
      transform: scale(0.92);
    }
    .tc-btn-sub {
      font-size: 8.5px;
      font-weight: normal;
      opacity: 0.85;
      margin-top: 1px;
    }
    .tc-zoom-hint {
      position: fixed;
      left: 50%;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      transform: translateX(-50%);
      font-size: 11px;
      color: rgba(255, 255, 255, 0.55);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

/**
 * 키보드/마우스용 InputManager와 대응되는 터치 전용 입력원. main.ts에서
 * isTouchDevice()가 true일 때만 만들어서 붙이고, consumeFrame()을 매 프레임
 * InputManager.consumeFrame()과 나란히 호출한 뒤 mergeInputSnapshots()로
 * 합쳐서 시뮬레이션에 넘깁니다.
 */
export class TouchInputManager {
  private root: HTMLDivElement;
  private joystickZone: HTMLDivElement;
  private joystickNub: HTMLDivElement;
  private joystickBase: HTMLDivElement;
  private actionsEl: HTMLDivElement;

  private joystickTouchId: number | null = null;
  private joystickDX = 0;
  private joystickDY = 0;

  private lookTouchId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;

  /** 핀치줌에 쓰는 두 손가락 (조이스틱/룩 드래그에 이미 쓰이지 않는 손가락 중) */
  private pinchIds: [number, number] | null = null;
  private pinchLastDist = 0;

  private accMouseDX = 0;
  private accMouseDY = 0;
  private accZoom = 0;

  /** 지금 누르고 있는 중인 버튼/동작 (스킬 차지 등 레벨 트리거용) */
  private held = new Set<ButtonAction>();
  /** 이번 프레임에 새로 눌린 것 (엣지 트리거) — consumeFrame()마다 비웁니다 */
  private justPressed = new Set<ButtonAction>();

  private suppressed = false;

  constructor(container: HTMLElement) {
    injectStyles();

    this.root = document.createElement("div");
    this.root.id = "touch-controls";
    this.root.innerHTML = `
      <div class="tc-joystick-zone" data-tc-joyzone></div>
      <div class="tc-joystick-base"></div>
      <div class="tc-joystick-nub"></div>
      <div class="tc-actions">
        <div class="tc-skill-row"></div>
        <div class="tc-primary-row"></div>
      </div>
    `;
    container.appendChild(this.root);

    this.joystickZone = this.root.querySelector<HTMLDivElement>("[data-tc-joyzone]")!;
    this.joystickBase = this.root.querySelector<HTMLDivElement>(".tc-joystick-base")!;
    this.joystickNub = this.root.querySelector<HTMLDivElement>(".tc-joystick-nub")!;
    this.actionsEl = this.root.querySelector<HTMLDivElement>(".tc-actions")!;

    const skillRow = this.root.querySelector<HTMLDivElement>(".tc-skill-row")!;
    for (const def of BUTTON_DEFS) skillRow.appendChild(this.buildButton(def));
    const primaryRow = this.root.querySelector<HTMLDivElement>(".tc-primary-row")!;
    for (const def of PRIMARY_BUTTON_DEFS) primaryRow.appendChild(this.buildButton(def));

    // 조이스틱/룩존/핀치는 전부 window 레벨의 터치 리스너 하나로 처리합니다
    // (손가락이 화면 어디로 움직이든 identifier로 계속 추적하기 위함).
    // passive:false로 등록해야 preventDefault()로 브라우저 스크롤/핀치줌을 막을 수 있습니다.
    window.addEventListener("touchstart", this.onTouchStart, { passive: false });
    window.addEventListener("touchmove", this.onTouchMove, { passive: false });
    window.addEventListener("touchend", this.onTouchEnd, { passive: false });
    window.addEventListener("touchcancel", this.onTouchEnd, { passive: false });
  }

  private buildButton(def: ButtonDef): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `tc-btn ${def.className}`;
    btn.dataset.tcButton = def.action;
    btn.innerHTML = def.sub
      ? `<span>${def.label}</span><span class="tc-btn-sub">${def.sub}</span>`
      : `<span>${def.label}</span>`;
    // 각 버튼은 자기 터치를 직접 처리하고 stopPropagation으로 window 리스너까지
    // 안 올라가게 막습니다 — 그래야 버튼을 누른 손가락이 핀치줌의 두 번째
    // 손가락으로 잘못 잡히지 않습니다.
    const onDown = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.held.has(def.action)) this.justPressed.add(def.action);
      this.held.add(def.action);
      btn.classList.add("tc-active");
    };
    const onUp = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.held.delete(def.action);
      btn.classList.remove("tc-active");
    };
    btn.addEventListener("touchstart", onDown, { passive: false });
    btn.addEventListener("touchend", onUp, { passive: false });
    btn.addEventListener("touchcancel", onUp, { passive: false });
    return btn;
  }

  /** 패널(상점 등)이 열려 있는 동안 — main.ts가 panels.isBlocking()/tradeUI.isBlocking()과 함께 호출합니다. */
  setSuppressed(v: boolean) {
    if (this.suppressed === v) return;
    this.suppressed = v;
    this.root.style.display = v ? "none" : "";
    if (v) {
      // 패널이 열려 조작부가 숨겨지는 순간, 잡고 있던 터치 상태를 전부
      // 초기화합니다 — 안 그러면 패널을 닫고 돌아왔을 때 조이스틱이 마지막
      // 위치에 "붙박이"로 남아 계속 이동 입력을 낼 수 있습니다.
      this.joystickTouchId = null;
      this.joystickDX = 0;
      this.joystickDY = 0;
      this.lookTouchId = null;
      this.pinchIds = null;
      this.held.clear();
      this.justPressed.clear();
      this.updateJoystickVisual();
    }
  }

  private updateJoystickVisual() {
    this.joystickNub.style.transform = `translate(${this.joystickDX}px, ${this.joystickDY}px)`;
  }

  private onTouchStart = (e: TouchEvent) => {
    if (this.suppressed) return;
    for (const touch of Array.from(e.changedTouches)) {
      // pointer-events:none인 조이스틱 존을 지나쳐, 실제로 그 자리에 있는
      // 요소(캔버스든 HUD 버튼이든)가 target으로 그대로 들어옵니다.
      const el = touch.target instanceof Element ? touch.target : null;
      if (isForeignInteractive(el)) continue; // 기존 HUD 버튼 등 — 관여하지 않음

      const joyRect = this.joystickZone.getBoundingClientRect();
      const inJoyZone =
        touch.clientX >= joyRect.left &&
        touch.clientX <= joyRect.right &&
        touch.clientY >= joyRect.top &&
        touch.clientY <= joyRect.bottom;

      if (inJoyZone && this.joystickTouchId === null) {
        e.preventDefault();
        this.joystickTouchId = touch.identifier;
        this.joystickDX = 0;
        this.joystickDY = 0;
        this.updateJoystickVisual();
        continue;
      }

      if (!inJoyZone) {
        // 조이스틱 존이 아니면 룩/핀치 후보입니다.
        e.preventDefault();
        if (this.lookTouchId === null && this.pinchIds === null) {
          this.lookTouchId = touch.identifier;
          this.lookLastX = touch.clientX;
          this.lookLastY = touch.clientY;
        } else if (this.pinchIds === null && this.lookTouchId !== null && this.lookTouchId !== touch.identifier) {
          // 두 번째 손가락 등장 — 룩 드래그를 멈추고 핀치줌으로 전환합니다.
          const first = Array.from(e.touches).find((t) => t.identifier === this.lookTouchId);
          if (first) {
            this.pinchIds = [this.lookTouchId, touch.identifier];
            this.pinchLastDist = Math.hypot(first.clientX - touch.clientX, first.clientY - touch.clientY);
            this.lookTouchId = null;
          }
        }
      }
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (this.suppressed) return;
    let handled = false;

    if (this.joystickTouchId !== null) {
      const t = Array.from(e.touches).find((x) => x.identifier === this.joystickTouchId);
      if (t) {
        const baseRect = this.joystickBase.getBoundingClientRect();
        const cx = baseRect.left + baseRect.width / 2;
        const cy = baseRect.top + baseRect.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > JOYSTICK_RADIUS) {
          dx = (dx / dist) * JOYSTICK_RADIUS;
          dy = (dy / dist) * JOYSTICK_RADIUS;
        }
        this.joystickDX = dx;
        this.joystickDY = dy;
        this.updateJoystickVisual();
        handled = true;
      }
    }

    if (this.pinchIds) {
      const a = Array.from(e.touches).find((x) => x.identifier === this.pinchIds![0]);
      const b = Array.from(e.touches).find((x) => x.identifier === this.pinchIds![1]);
      if (a && b) {
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const deltaPx = dist - this.pinchLastDist;
        this.pinchLastDist = dist;
        // 손가락이 벌어짐(deltaPx>0) = 확대(카메라 가까이) = zoomDelta 음수.
        // 손가락이 모임 = 축소(카메라 멀어짐) = zoomDelta 양수. (마우스 휠과 부호 통일)
        this.accZoom += -deltaPx / PINCH_PIXELS_PER_ZOOM_STEP;
        handled = true;
      }
    } else if (this.lookTouchId !== null) {
      const t = Array.from(e.touches).find((x) => x.identifier === this.lookTouchId);
      if (t) {
        const dx = t.clientX - this.lookLastX;
        const dy = t.clientY - this.lookLastY;
        this.lookLastX = t.clientX;
        this.lookLastY = t.clientY;
        this.accMouseDX += dx * TOUCH_LOOK_SENSITIVITY;
        this.accMouseDY += dy * TOUCH_LOOK_SENSITIVITY;
        handled = true;
      }
    }

    if (handled) e.preventDefault();
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === this.joystickTouchId) {
        this.joystickTouchId = null;
        this.joystickDX = 0;
        this.joystickDY = 0;
        this.updateJoystickVisual();
      }
      if (touch.identifier === this.lookTouchId) {
        this.lookTouchId = null;
      }
      if (this.pinchIds && (touch.identifier === this.pinchIds[0] || touch.identifier === this.pinchIds[1])) {
        // 핀치 중 손가락 하나를 떼면, 남은 손가락으로 다시 룩 드래그를 이어갑니다.
        const remaining = this.pinchIds.find((id) => id !== touch.identifier) ?? null;
        this.pinchIds = null;
        if (remaining !== null) {
          const t = Array.from(e.touches).find((x) => x.identifier === remaining);
          if (t) {
            this.lookTouchId = remaining;
            this.lookLastX = t.clientX;
            this.lookLastY = t.clientY;
          }
        }
      }
    }
  };

  /**
   * 매 프레임 한 번 호출합니다 (InputManager.consumeFrame()과 같은 자리에서).
   * 조이스틱 방향은 "누르고 있는 동안" 계속 유지되는 레벨 트리거라 여기서
   * 리셋하지 않고, 마우스 델타·줌·엣지 트리거만 소비 후 비웁니다.
   */
  consumeFrame(): InputSnapshot {
    const dead = JOYSTICK_RADIUS * JOYSTICK_DEADZONE_RATIO;
    const moveForward = this.joystickTouchId !== null && this.joystickDY < -dead;
    const moveBackward = this.joystickTouchId !== null && this.joystickDY > dead;
    const moveLeft = this.joystickTouchId !== null && this.joystickDX < -dead;
    const moveRight = this.joystickTouchId !== null && this.joystickDX > dead;

    const skillPressed = [
      this.justPressed.has("skill0"),
      this.justPressed.has("skill1"),
      this.justPressed.has("skill2"),
      this.justPressed.has("skill3"),
    ];
    const skillHeld = [
      this.held.has("skill0"),
      this.held.has("skill1"),
      this.held.has("skill2"),
      this.held.has("skill3"),
    ];

    const snapshot: InputSnapshot = {
      moveForward,
      moveBackward,
      moveLeft,
      moveRight,
      jumpPressed: this.justPressed.has("jump"),
      jumpHeld: this.held.has("jump"),
      sprintToggledOn: false, // 터치 전용 질주 버튼은 이번 페이즈 범위 밖입니다 (조이스틱을 끝까지 미는 것으로 충분히 빠름)
      dashPressed: this.justPressed.has("dash"),
      hotbarPressed: null, // 단축바 조작은 phase 2(hud.ts 터치 대응)에서 다룹니다
      attackPressed: this.justPressed.has("attack"),
      skillPressed,
      skillHeld,
      interactPressed: this.justPressed.has("interact"),
      toggleInventoryPressed: false,
      toggleStatsPressed: false,
      toggleHakiPressed: false,
      mouseDeltaX: this.accMouseDX,
      mouseDeltaY: this.accMouseDY,
      zoomDelta: this.accZoom,
      flyUpHeld: false,
      flyDownHeld: false,
      toggleFlyPressed: false,
      flySkillPressed: this.justPressed.has("fskill"),
      toggleDevPanelPressed: false,
      teleportPressed: false,
      // 마우스 커서 개념이 없으므로, 마우스 위치 타게팅 스킬(용암지대 등)은
      // 화면 중앙을 조준점으로 씁니다 — 다른 다수 모바일 액션 게임의 관행과 동일.
      mouseClientX: window.innerWidth / 2,
      mouseClientY: window.innerHeight / 2,
    };

    this.justPressed.clear();
    this.accMouseDX = 0;
    this.accMouseDY = 0;
    this.accZoom = 0;

    return snapshot;
  }
}

/**
 * 키보드/마우스 스냅샷과 터치 스냅샷을 하나로 합칩니다. 불리언은 OR로(둘 중
 * 하나만 만족해도 발동), 델타류는 합산으로 처리합니다 — 터치 기기에서는 kb
 * 쪽이 항상 전부 false/0이라 사실상 touch 값이 그대로 나가고, 혹시 터치스크린
 * 노트북처럼 키보드까지 동시에 쓰는 경우에도 자연스럽게 같이 반영됩니다.
 */
export function mergeInputSnapshots(kb: InputSnapshot, touch: InputSnapshot): InputSnapshot {
  return {
    moveForward: kb.moveForward || touch.moveForward,
    moveBackward: kb.moveBackward || touch.moveBackward,
    moveLeft: kb.moveLeft || touch.moveLeft,
    moveRight: kb.moveRight || touch.moveRight,
    jumpPressed: kb.jumpPressed || touch.jumpPressed,
    jumpHeld: kb.jumpHeld || touch.jumpHeld,
    sprintToggledOn: kb.sprintToggledOn || touch.sprintToggledOn,
    dashPressed: kb.dashPressed || touch.dashPressed,
    hotbarPressed: kb.hotbarPressed ?? touch.hotbarPressed,
    attackPressed: kb.attackPressed || touch.attackPressed,
    skillPressed: kb.skillPressed.map((v, i) => v || touch.skillPressed[i]),
    skillHeld: kb.skillHeld.map((v, i) => v || touch.skillHeld[i]),
    interactPressed: kb.interactPressed || touch.interactPressed,
    toggleInventoryPressed: kb.toggleInventoryPressed || touch.toggleInventoryPressed,
    toggleStatsPressed: kb.toggleStatsPressed || touch.toggleStatsPressed,
    toggleHakiPressed: kb.toggleHakiPressed || touch.toggleHakiPressed,
    mouseDeltaX: kb.mouseDeltaX + touch.mouseDeltaX,
    mouseDeltaY: kb.mouseDeltaY + touch.mouseDeltaY,
    zoomDelta: kb.zoomDelta + touch.zoomDelta,
    flyUpHeld: kb.flyUpHeld || touch.flyUpHeld,
    flyDownHeld: kb.flyDownHeld || touch.flyDownHeld,
    toggleFlyPressed: kb.toggleFlyPressed || touch.toggleFlyPressed,
    flySkillPressed: kb.flySkillPressed || touch.flySkillPressed,
    toggleDevPanelPressed: kb.toggleDevPanelPressed || touch.toggleDevPanelPressed,
    teleportPressed: kb.teleportPressed || touch.teleportPressed,
    // 터치 레이어가 있는 기기에서는 실제 마우스 커서가 의미 없는 경우가 많으므로
    // 터치의 화면-중앙 조준점을 우선합니다 (터치가 전혀 안 잡혔으면 그래도 화면
    // 중앙이라 데스크톱 커서 좌표(0,0 등 과거값)보다 합리적인 기본값입니다).
    mouseClientX: touch.mouseClientX,
    mouseClientY: touch.mouseClientY,
  };
}
