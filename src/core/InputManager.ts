// 키보드/마우스 입력을 모아서 시뮬레이션이 매 프레임 읽을 수 있는
// 스냅샷 형태로 제공합니다.
//
// 카메라 회전은 "마우스 우클릭을 누른 채로 드래그"할 때만 반영됩니다. 예전에는
// 포인터락(클릭 시 커서 숨김)을 썼지만, 커서가 계속 안 보이는 게 불편하다는
// 요청으로 제거했습니다 — 이제 커서는 항상 보이고, UI 패널도 언제든 자유롭게
// 클릭할 수 있습니다.

export interface InputSnapshot {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  jumpPressed: boolean; // 이번 프레임에 새로 눌림
  jumpHeld: boolean;
  /** Shift — 한 번 누를 때마다 질주 켜짐/꺼짐이 토글됩니다 (누르고 있는 것과 무관) */
  sprintToggledOn: boolean;
  /** Q — 전방 대쉬 */
  dashPressed: boolean;
  /**
   * 숫자키 1~3 — 무기 단축바 장착/해제, 숫자키 4 — 열매 장착/해제
   * (눌린 칸 번호. 무기는 0~2, 열매는 3. 없으면 null)
   */
  hotbarPressed: number | null;
  attackPressed: boolean; // 좌클릭
  /** Z/X/C/V 4개 스킬 슬롯이 이번 프레임에 눌렸는지 */
  skillPressed: boolean[];
  /** Z/X/C/V 4개 스킬 슬롯이 지금 누르고 있는 중인지 — 차지 스킬(고무 피스톨)이 계속 차는 중인지 볼 때 씁니다. */
  skillHeld: boolean[];
  interactPressed: boolean; // 'E' — NPC 상호작용
  toggleInventoryPressed: boolean; // 'I'
  toggleStatsPressed: boolean; // 'K' — 캐릭터창 (C는 3번째 스킬로 옮겨감)
  toggleHakiPressed: boolean; // 'J' — 무장색 발동/해제 (H는 예전 키, V는 4번째 스킬로 옮겨감)
  mouseDeltaX: number;
  mouseDeltaY: number;
  /** 마우스 휠 — 양수면 줌아웃(카메라가 멀어짐), 음수면 줌인 */
  zoomDelta: number;
  /** Space — 비행 중 상승 (평소에는 점프) */
  flyUpHeld: boolean;
  /** Ctrl — 비행 중 하강 */
  flyDownHeld: boolean;
  /** F — 비행 켜기/끄기 (개발자 모드에서만 의미 있음) */
  toggleFlyPressed: boolean;
  /**
   * F — 빛빛/용용 열매의 F 전용 특수 능력(빛의 비행/용의 비행) 발동.
   * toggleFlyPressed와 물리 키(KeyF)를 공유하지만 별개의 엣지 트리거 필드입니다 —
   * 개발자 모드 비행 토글과 이 두 열매의 F 능력은 서로 다른 로직(Simulation.ts의
   * devMode 분기, CombatSystem.ts의 stepFruitSpecialAbility)이 각자 소비합니다.
   */
  flySkillPressed: boolean;
  /** P — 개발자 패널 열기/닫기 */
  toggleDevPanelPressed: boolean;
  /** R — 순간이동 (마우스가 가리키는 지점으로). 배우지 않았으면 무시됩니다 */
  teleportPressed: boolean;
  /** 지금 마우스 커서의 화면 좌표(clientX/Y) — R키 순간이동 레이캐스트에 씁니다 */
  mouseClientX: number;
  mouseClientY: number;
}

export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private zoomDelta = 0;
  private attackQueued = false;
  private rightMouseHeld = false;
  /** Shift 토글 상태 — 누르고 있는 게 아니라 "한 번 누를 때마다 뒤집힘"을 기억합니다 */
  private sprintOn = false;
  /** 마지막으로 확인된 마우스 커서의 화면 좌표 — 우클릭 여부와 무관하게 항상 갱신됩니다 */
  private lastMouseClientX = 0;
  private lastMouseClientY = 0;
  /** 포인터락을 원하는 상태인지 (요청은 비동기라 실제 잠금과 시점이 어긋날 수 있음) */
  private wantPointerLock = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.target.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    // 휠로 카메라 거리 조절 (로블록스식). passive:false로 등록해야 페이지 스크롤을 막을 수 있습니다.
    this.target.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.target.addEventListener("contextmenu", (e) => e.preventDefault());
    // 포커스를 잃으면 눌린 키/버튼 상태가 남지 않도록 초기화
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.rightMouseHeld = false;
      this.wantPointerLock = false;
      this.target.classList.remove("hide-cursor");
      if (document.pointerLockElement === this.target) document.exitPointerLock();
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keys.has(e.code)) {
      this.justPressed.add(e.code);
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.attackQueued = true;
    if (e.button === 2) {
      this.rightMouseHeld = true;
      // 우클릭하고 있는 동안에는 포인터락으로 커서를 감추고 화면 중앙에 고정합니다.
      // 덕분에 마우스를 아무리 돌려도 커서가 창 밖으로 나가지 않습니다.
      // (버튼을 놓으면 잠금이 풀리고 커서가 원래대로 돌아옵니다)
      this.wantPointerLock = true;
      this.target.classList.add("hide-cursor");
      if (document.pointerLockElement !== this.target) {
        // 일부 브라우저는 Promise를 돌려주고, 연속 요청 시 거부될 수 있어 무시합니다.
        void Promise.resolve(this.target.requestPointerLock()).catch(() => {});
      }
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      this.rightMouseHeld = false;
      this.wantPointerLock = false;
      this.target.classList.remove("hide-cursor");
      if (document.pointerLockElement === this.target) document.exitPointerLock();
    }
  };

  /** 잠금이 늦게 걸렸는데 이미 버튼을 뗀 경우, 곧바로 해제합니다. */
  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.target && !this.wantPointerLock) {
      document.exitPointerLock();
    }
  };

  /**
   * 휠 한 칸의 크기는 브라우저·OS마다 제각각(픽셀/줄/페이지 단위)이라
   * 부호만 취해서 "한 칸 = 한 단계"로 정규화합니다. 그래야 어느 환경에서도
   * 로블록스처럼 또각또각 줌이 됩니다.
   */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    this.zoomDelta += Math.sign(e.deltaY);
  };

  private onMouseMove = (e: MouseEvent) => {
    // 포인터락 상태에서도 movementX/Y는 그대로 들어옵니다.
    if (this.rightMouseHeld || document.pointerLockElement === this.target) {
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    }
    // R키 순간이동 레이캐스트용 — 우클릭 여부와 무관하게 항상 최신 위치를 기억해둡니다.
    this.lastMouseClientX = e.clientX;
    this.lastMouseClientY = e.clientY;
  };

  /** 매 프레임 한 번 호출: 현재 프레임 입력 스냅샷을 만들고 1프레임짜리 상태(justPressed 등)를 리셋합니다. */
  consumeFrame(): InputSnapshot {
    // Shift는 누르고 있는 동안이 아니라, "이번 프레임에 새로 눌렸을 때" 딱 한 번만 토글을 뒤집습니다.
    if (this.justPressed.has("ShiftLeft") || this.justPressed.has("ShiftRight")) {
      this.sprintOn = !this.sprintOn;
    }

    const snapshot: InputSnapshot = {
      moveForward: this.keys.has("KeyW"),
      moveBackward: this.keys.has("KeyS"),
      moveLeft: this.keys.has("KeyA"),
      moveRight: this.keys.has("KeyD"),
      jumpPressed: this.justPressed.has("Space"),
      jumpHeld: this.keys.has("Space"),
      sprintToggledOn: this.sprintOn,
      dashPressed: this.justPressed.has("KeyQ"),
      hotbarPressed: this.justPressed.has("Digit1")
        ? 0
        : this.justPressed.has("Digit2")
          ? 1
          : this.justPressed.has("Digit3")
            ? 2
            : this.justPressed.has("Digit4")
              ? 3
              : null,
      attackPressed: this.attackQueued,
      skillPressed: [
        this.justPressed.has("KeyZ"),
        this.justPressed.has("KeyX"),
        this.justPressed.has("KeyC"),
        this.justPressed.has("KeyV"),
      ],
      skillHeld: [this.keys.has("KeyZ"), this.keys.has("KeyX"), this.keys.has("KeyC"), this.keys.has("KeyV")],
      interactPressed: this.justPressed.has("KeyE"),
      toggleInventoryPressed: this.justPressed.has("KeyI"),
      toggleStatsPressed: this.justPressed.has("KeyK"),
      toggleHakiPressed: this.justPressed.has("KeyJ"),
      flyUpHeld: this.keys.has("Space"),
      flyDownHeld: this.keys.has("ControlLeft") || this.keys.has("ControlRight"),
      toggleFlyPressed: this.justPressed.has("KeyF"),
      flySkillPressed: this.justPressed.has("KeyF"),
      toggleDevPanelPressed: this.justPressed.has("KeyP"),
      teleportPressed: this.justPressed.has("KeyR"),
      mouseClientX: this.lastMouseClientX,
      mouseClientY: this.lastMouseClientY,
      mouseDeltaX: this.mouseDeltaX,
      mouseDeltaY: this.mouseDeltaY,
      zoomDelta: this.zoomDelta,
    };

    this.justPressed.clear();
    this.attackQueued = false;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.zoomDelta = 0;

    return snapshot;
  }
}
