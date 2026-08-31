import { initPhysics, createWorld } from "./core/PhysicsWorld";
import { InputManager } from "./core/InputManager";
import { isTouchDevice } from "./core/TouchDetect";
import { ensureMobileViewportMeta } from "./ui/ViewportMeta";
import { TouchInputManager, mergeInputSnapshots } from "./ui/TouchControls";
import { createEnvironment, createIslands } from "./world/createIslands";
import { createOcean } from "./world/createOcean";
import * as islandHelpers from "./world/islands";
import { Simulation } from "./simulation/Simulation";
import { SceneRenderer } from "./render/SceneRenderer";
import { Hud } from "./ui/hud";
import { PanelManager } from "./ui/panels";
import { qualityFor, type QualityId, type QualitySettings } from "./core/GraphicsSettings";
import { FACTION_LABELS, type Faction } from "./world/islands";
import { loadLocalSave } from "./core/Persistence";
import { applySaveData, type SaveData } from "./core/SaveData";
import { cloudAvailable, currentUser, loadCloudSave, signInWithGoogle, type CloudUser } from "./firebase/cloud";
import { SaveManager } from "./firebase/SaveManager";
import { islandArrivalPosition, getIsland } from "./world/islands";
import { totalMeleeCooldown, meleeDps } from "./simulation/CombatSystem";
import { devDenyMessage, devDenyReason } from "./core/DevAccess";
import { applyDevLoadout } from "./simulation/DevLoadout";
import { MultiplayerClient } from "./network/MultiplayerClient";
import {
  broadcastDashFx,
  broadcastMeleeFx,
  broadcastSkillFx,
  broadcastSpecialAbilityFx,
  buildCombatStatsSnapshot,
  drawnWeaponId,
  processLightningForm,
  processPvpAttacks,
} from "./network/PvpCombat";
import { MultiplayerUI } from "./ui/MultiplayerUI";
import { connectMultiplayerOrWait, defaultMultiplayerUrl } from "./ui/ConnectGate";
import { TradeUI } from "./ui/TradeUI";
import { canUseTeleport, TELEPORT_MAX_DISTANCE_M } from "./simulation/TeleportSystem";

// 다른 어떤 DOM 작업(시작 화면 조회 등)보다도 먼저 뷰포트 메타 태그를
// 챙겨둡니다 — 모바일 브라우저가 데스크톱 폭 기준으로 렌더링해서 레이아웃이
// 깨지고 확대/축소까지 되는 것을 막습니다. (index.html이 없는 이 프로젝트
// 구조상 정적 <meta> 태그를 넣어둘 곳이 없어 여기서 런타임에 만듭니다.)
ensureMobileViewportMeta();

export interface StartChoice {
  faction: Faction;
  mode: QualityId;
}

/**
 * 0단계: 로그인. Firebase 설정이 있을 때만 물어봅니다.
 * 이미 로그인돼 있으면(새로고침·리다이렉트 복귀) 묻지 않고 그대로 통과합니다.
 *
 * **구글 계정 로그인만 허용합니다 — 게스트로 건너뛰는 버튼은 없습니다.**
 * (예전에는 "로그인 없이 플레이" 버튼이 있었지만, 사용자 요청으로 제거했습니다.
 * 자동 테스트/딥링크(?mode=/?faction=/?guest=1)는 이 화면 자체를 아예
 * 건너뛰므로 그쪽 경로는 그대로 영향이 없습니다 — README 참고.)
 */
async function chooseAccount(): Promise<CloudUser | null> {
  const step = document.getElementById("start-step-login");
  const note = document.getElementById("login-note");
  const status = document.getElementById("start-status");
  const loginBtn = document.getElementById("btn-google-login") as HTMLButtonElement | null;

  if (!cloudAvailable()) {
    // 설정이 없으면 로그인 단계를 통째로 건너뜁니다 (게임은 그대로 됩니다).
    if (note) note.textContent = "";
    return null;
  }
  if (!step || !loginBtn) return null;

  // 딥링크(?mode=fast 등)로 시작 화면을 건너뛸 때는 로그인도 묻지 않고 넘어갑니다.
  // (자동 테스트나 북마크로 바로 들어오는 경우 — 실제 사용자 화면에는 없는 통로입니다)
  const params = new URLSearchParams(location.search);
  if (params.has("mode") || params.has("faction") || params.get("guest") === "1") return null;

  if (status) status.textContent = "불러오는 중…";
  const already = await currentUser();
  if (already) return already;

  step.hidden = false;
  if (status) status.textContent = "구글 계정으로 로그인해야 시작할 수 있습니다";

  return new Promise<CloudUser | null>((resolve) => {
    let settled = false;
    const finish = (user: CloudUser | null) => {
      if (settled) return;
      settled = true;
      step.hidden = true;
      resolve(user);
    };

    loginBtn.addEventListener("click", async () => {
      if (settled) return;
      loginBtn.disabled = true;
      if (note) note.textContent = "구글 로그인 창을 여는 중…";
      const user = await signInWithGoogle();
      loginBtn.disabled = false;
      if (user) {
        finish(user);
      } else if (note) {
        // 팝업을 닫았거나 실패 — 게스트 우회가 없으므로 다시 시도하라고 안내합니다.
        note.textContent = "로그인이 취소됐습니다. 다시 시도해 주세요.";
      }
    });
  });
}

/**
 * 시작 화면 — 2단계로 고릅니다.
 *   1) 진영: 해적 / 해군  (시작 섬만 갈리고, 그 다음 항로는 동일)
 *   2) 모드: 빠른 / 그냥 / 개발자
 *
 * 마크업은 index.html에 직접 들어있어서, 2.5MB짜리 번들이 도착하기 전에도
 * 화면에 바로 보입니다. 여기서는 버튼을 활성화하고 클릭을 기다리기만 합니다.
 * 기다리는 동안 Rapier(WASM) 로딩을 병렬로 돌려서 체감 대기 시간을 줄입니다.
 */
function chooseStart(
  savedFaction: Faction | null,
  resumeLabel: string,
  devAccess: { allowed: boolean; message: string },
): Promise<StartChoice> {
  const screen = document.getElementById("start-screen");
  const status = document.getElementById("start-status");
  const factionStep = document.getElementById("start-step-faction");
  const modeStep = document.getElementById("start-step-mode");
  const chosenLabel = document.getElementById("start-chosen");
  const factionButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".start-btn[data-faction]"),
  );
  const modeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".start-btn[data-mode]"),
  );

  // 시작 화면 마크업이 없는 환경(테스트 하네스 등)에서는 그냥 통과시킵니다.
  // 그런 환경이라도 터치 기기로 감지되면 성능 우선 모드로 시작하는 게 맞습니다.
  if (!screen || factionButtons.length === 0) {
    return Promise.resolve({ faction: "pirate", mode: isTouchDevice() ? "fast" : "normal" });
  }

  // 개발자 모드는 지정된 계정(또는 개발용 localhost)에서만 열립니다.
  // 버튼을 숨기지 않고 **잠긴 채로 이유를 적어두는** 이유: 없어진 줄 알고 찾아
  // 헤매는 것보다, 왜 못 쓰는지 보이는 편이 낫습니다.
  const devButton = document.querySelector<HTMLButtonElement>('.start-btn[data-mode="dev"]');
  if (devButton && !devAccess.allowed) {
    devButton.classList.add("locked");
    devButton.disabled = true;
    const desc = devButton.querySelector(".start-btn-desc");
    if (desc) desc.innerHTML = `🔒 ${devAccess.message}`;
  }

  // 로그인 단계가 끝났으니 이제 진영 선택을 엽니다.
  // (HTML에서는 hidden으로 시작합니다 — 두 단계가 동시에 보이면 안 되므로)
  if (factionStep) factionStep.hidden = false;
  if (status) status.textContent = "진영을 선택하세요";
  for (const btn of factionButtons) btn.disabled = false;

  return new Promise<StartChoice>((resolve) => {
    let faction: Faction | null = null;
    let settled = false;

    // 자동 테스트나 딥링크용 파라미터 — 아래 forcedFaction/forcedMode 처리와
    // 같은 것을 가리키므로 여기서 한 번만 읽어 재사용합니다.
    const params = new URLSearchParams(location.search);
    // 딥링크(?mode=...)가 명시돼 있으면 그 값을 그대로 존중합니다 — 자동
    // 테스트(e2e.mjs)나 북마크 진입 경로라 모바일 자동 선택이 끼어들면 안 됩니다.
    const modeForcedByLink = params.has("mode");
    // 모바일/터치 기기는 "모드"가 그래픽 성능 프리셋일 뿐 실제 게임플레이
    // 선택(진영)과는 성격이 달라서, 사용자 요청대로 빠른 모드로 자동 결정하고
    // 모드 선택 화면 자체를 건너뜁니다. 진영 선택은 그대로 물어봅니다.
    const autoFastForTouch = isTouchDevice() && !modeForcedByLink;

    const pickFaction = (value: Faction) => {
      if (settled || faction) return;
      faction = value;
      if (factionStep) factionStep.hidden = true;
      if (chosenLabel) {
        chosenLabel.textContent = `— ${FACTION_LABELS[value]}로 시작`;
        chosenLabel.classList.add(value);
      }
      if (autoFastForTouch) {
        if (status) status.textContent = "모바일 기기 감지 — 빠른 모드로 바로 시작합니다";
        pickMode("fast");
        return;
      }
      if (modeStep) modeStep.hidden = false;
      if (status) status.textContent = "모드를 선택하면 바로 시작합니다";
    };

    const pickMode = (mode: QualityId) => {
      if (settled || !faction) return;
      // 키보드(3번)·딥링크(?mode=dev)로도 우회할 수 없게 여기서 한 번 더 막습니다.
      if (mode === "dev" && !devAccess.allowed) {
        if (status) status.textContent = devAccess.message;
        return;
      }
      settled = true;
      for (const btn of modeButtons) btn.disabled = true;
      if (status) status.textContent = "세계를 만드는 중…";
      resolve({ faction, mode });
    };

    for (const btn of factionButtons) {
      btn.addEventListener("click", () => pickFaction(btn.dataset.faction as Faction));
    }
    for (const btn of modeButtons) {
      btn.addEventListener("click", () => pickMode((btn.dataset.mode as QualityId) ?? "normal"));
    }

    // 키보드로도 고를 수 있게 (1/2 → 해적/해군, 그 다음 1/2/3 → 빠른/그냥/개발자)
    window.addEventListener("keydown", (e) => {
      if (settled) return;
      if (!faction) {
        if (e.key === "1") pickFaction("pirate");
        else if (e.key === "2") pickFaction("marine");
        return;
      }
      if (e.key === "1") pickMode("fast");
      else if (e.key === "2" || e.key === "Enter") pickMode("normal");
      else if (e.key === "3") pickMode("dev");
    });

    // 이미 세이브가 있으면 진영은 이미 정해져 있으므로 묻지 않고 넘어갑니다.
    if (savedFaction) {
      pickFaction(savedFaction);
      if (chosenLabel && resumeLabel) chosenLabel.textContent = resumeLabel;
    }

    // 자동 테스트나 딥링크용: ?mode=fast&faction=marine 을 붙이면 화면을 건너뜁니다.
    const forcedFaction = params.get("faction");
    const forcedMode = params.get("mode");
    if (forcedFaction === "pirate" || forcedFaction === "marine") pickFaction(forcedFaction);
    if (forcedMode === "fast" || forcedMode === "normal" || forcedMode === "dev") {
      if (!faction) pickFaction("pirate");
      pickMode(forcedMode);
    }
  });
}

/**
 * 저장할 가치가 있는 변화인지 — 몬스터 한 대 때린 것까지 저장하면
 * Firestore 쓰기 요금이 새기 때문에 "결과가 바뀐" 이벤트만 고릅니다.
 */
const SAVE_WORTHY = new Set([
  "player_leveled_up",
  "fruit_leveled_up",
  "quest_completed",
  "fruit_purchased",
  "fruit_equipped",
  "item_purchased",
  "item_used",
  "boat_bought",
  "haki_learned",
  "gacha_rolled",
  "enemy_died",
  "island_entered",
  "sea_changed",
]);

function isSaveWorthy(event: { type: string }) {
  return SAVE_WORTHY.has(event.type);
}

function hideStartScreen() {
  const screen = document.getElementById("start-screen");
  if (screen) screen.remove();
}

async function main() {
  const appEl = document.getElementById("app")!;

  // 사용자가 로그인·진영·모드를 고르는 동안 물리 엔진을 미리 로드합니다.
  const physicsPromise = initPhysics();

  // ① 로그인 (Firebase 설정이 없으면 건너뜀) → ② 세이브 불러오기
  const user = await chooseAccount();
  const cloudSave = user ? await loadCloudSave(user.uid) : null;
  const localSave = loadLocalSave();
  // 클라우드 세이브가 우선이고, 없으면 이 브라우저 저장본을 씁니다.
  const save: SaveData | null = cloudSave ?? localSave;

  const savedFaction = save && (save.faction === "pirate" || save.faction === "marine") ? save.faction : null;
  const resumeLabel = save && typeof save.level === "number"
    ? `— 이어서 플레이 (Lv.${save.level})`
    : "";

  // 개발자 모드 권한 — 허용 목록의 구글 계정이거나, 개발 중인 내 컴퓨터(localhost)일 때만
  const denyReason = devDenyReason(user?.email ?? null, location.hostname);
  const devAccess = { allowed: denyReason === null, message: devDenyMessage(denyReason) };

  // ③ 진영(세이브가 있으면 자동) → ④ 그래픽 모드
  const { faction, mode } = await chooseStart(savedFaction, resumeLabel, devAccess);
  const quality: QualitySettings = qualityFor(mode);
  const devMode = quality.devMode;

  const RAPIER_NS = await physicsPromise;
  const world = createWorld(RAPIER_NS);

  const renderer = new SceneRenderer(appEl, quality);
  renderer.setIslandVisuals(createIslands(renderer.scene, world, RAPIER_NS, quality));
  renderer.setEnvironment(createEnvironment(renderer.scene, quality));
  const ocean = createOcean(renderer.scene, quality);

  const simulation = new Simulation(world, RAPIER_NS, faction, quality.devMode);
  const input = new InputManager(renderer.domElement);
  // 터치 기기에서만 만들어 붙입니다 — 데스크톱에서는 이 레이어 자체가
  // 존재하지 않아서 기존 마우스/키보드 입력 경로에 어떤 영향도 없습니다.
  const touchInput = isTouchDevice() ? new TouchInputManager(appEl) : null;
  const panels = new PanelManager(appEl, {
    onAllocateStat: (stat) => simulation.allocateStat(stat),
    onBuyFruit: (fruitId) => simulation.buyFruit(fruitId),
    onHoldFruit: (fruitId) => simulation.holdFruit(fruitId),
    onCancelHeldFruit: () => simulation.cancelHeldFruit(),
    onConfirmHeldFruit: () => simulation.confirmHeldFruit(),
    onBuyItem: (itemId) => simulation.buyItem(itemId),
    onUseItem: (itemId) => simulation.useItem(itemId),
    onLearnHaki: () => simulation.learnHaki(),
    onBuyBoat: (tierId) => simulation.buyBoat(tierId as never),
    onAcceptQuest: (islandId, speciesId) => simulation.acceptQuest(islandId, speciesId),
    onTeleportToIsland: (islandId) => simulation.teleportToIsland(islandId),
    onRollGacha: () => {
      const result = simulation.rollGacha();
      // 뽑았으면 바로 저장합니다 — 4시간 제한은 로그인 시 서버 시각으로 기록됩니다.
      if (result.ok) {
        saves.markGachaRolled();
        void saves.flush(Date.now());
      }
    },
    onSetGuide: (islandId) => simulation.setGuide(islandId),
    onLearnJump: () => simulation.learnJump(),
    onLearnTeleport: () => simulation.learnTeleport(),
    onTravelSea: () => {
      // 바다를 건너면 되돌릴 수 없는 이동이라, 그 자리에서 바로 저장합니다.
      const moved = simulation.travelSea();
      if (moved) {
        saves.markDirty();
        void saves.flush(Date.now());
      }
    },
    // 해적 사단 — 코인 차감은 여기(싱글플레이 상태)에서 먼저 처리하고,
    // 성공했을 때만 실제 생성 요청을 멀티플레이 서버로 보냅니다.
    onOpenCrew: () => multiplayer.requestCrewList(),
    onCreateCrew: (name) => {
      if (simulation.payCrewCreationFee()) multiplayer.sendCrewCreate(name);
    },
    onJoinCrew: (crewId) => multiplayer.sendCrewJoin(crewId),
    onLeaveCrew: () => multiplayer.sendCrewLeave(),
  });
  // 멀티플레이 — 개발자 모드는 요청에 따라 무조건 싱글플레이로만 동작합니다.
  // 접속 버튼 자체를 HUD에서 숨기고(아래 Hud 생성부), 배포 빌드의 자동 접속도
  // 건너뜁니다 — devMode 인스턴스는 만들어지되 절대 connect()가 호출되지 않습니다.
  //
  // 일반 모드에서는 기본이 선택 사항입니다. 버튼을 눌러 접속하기 전까지는
  // 소켓을 열지 않고, 싱글플레이 동작에 아무 영향도 주지 않습니다.
  //
  // 다만 VITE_MULTIPLAYER_AUTOCONNECT가 설정된 빌드(배포용 Netlify 빌드)에서는
  // 접속 화면을 통과하는 즉시 자동으로 서버에 붙습니다 — 로컬 개발/검증
  // 스위트(verify-logic.mjs·e2e.mjs)는 이 환경변수를 설정하지 않으므로 기존
  // 동작에는 아무 영향이 없습니다.
  const multiplayer = new MultiplayerClient(simulation.state);
  const multiplayerUI = new MultiplayerUI(appEl, multiplayer, simulation.state);
  panels.setMultiplayer(multiplayer);
  // 다른 플레이어에게 마우스를 올리고 짧게 우클릭하면 거래/선물 메뉴가 뜹니다.
  // (InputManager.ts의 우클릭-드래그 카메라 회전은 건드리지 않고, 별도로 판정합니다)
  const tradeUI = new TradeUI(appEl, multiplayer, simulation.state, renderer);
  const env = typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, string> }).env : undefined;
  const autoName = (user?.name?.trim() || "여행자").slice(0, 12);
  if (!devMode) {
    // 빠른/그냥 모드는 무조건 멀티플레이 서버 연결이 필요합니다(사용자 요청) —
    // 연결될 때까지 화면을 덮는 게이트가 여기서 게임 루프 시작을 막습니다.
    // (개발자 모드는 지금까지와 똑같이 절대 connect()를 호출하지 않습니다.)
    const url = env?.VITE_MULTIPLAYER_URL || defaultMultiplayerUrl();
    await connectMultiplayerOrWait(multiplayer, url, autoName);
  }

  const hud = new Hud(appEl, {
    onShop: () => panels.toggle("shop"),
    onInventory: () => panels.toggle("inventory"),
    onStats: () => panels.toggle("stats"),
    onGuide: () => panels.toggle("guide"),
    onCancelGuide: () => simulation.setGuide(null),
    onMultiplayer: () => {
      if (!devMode) multiplayerUI.toggle();
    },
    onHotbarSlotClick: (slot) => simulation.activateHotbarSlot(slot),
    devMode,
  });

  // 개발자 모드는 **세이브를 건드리지 않습니다.** 내 진짜 캐릭터를 만렙 테스트본으로
  // 덮어쓰는 사고를 원천봉쇄하려고, 불러오지도 저장하지도 않습니다.
  if (devMode) {
    const loadout = applyDevLoadout(simulation.state);
    console.log(
      `[dev] 만렙 테스트 캐릭터 — Lv.${loadout.level} · 🪙${loadout.money.toLocaleString()} · ` +
      `최대체력 ${loadout.maxHp.toLocaleString()} · 무기 ${loadout.weapons}종 (저장 안 됨)`,
    );
  }

  // 세이브 복원 — 레벨·코인·열매·퀘스트 횟수·뽑기 제한까지 전부 되돌립니다.
  if (!devMode && save && applySaveData(simulation.state, save)) {
    const island = getIsland(simulation.state.currentIslandId ?? "central");
    const arrival = islandArrivalPosition(island);
    simulation.state.player.position = { ...arrival };
    simulation.playerController.teleport(arrival);
    console.log(
      `[save] 이어서 플레이 — Lv.${simulation.state.player.level} · ${island.name}` +
      (user ? ` (${user.name} 계정)` : " (이 브라우저 저장본)"),
    );
  }

  // 개발자 모드에서는 SaveManager를 통째로 잠급니다 (로컬·클라우드·랭킹 전부).
  const saves = new SaveManager(simulation.state, devMode ? null : user, { readOnly: devMode });

  // 창을 닫거나 탭을 옮길 때 마지막 상태를 저장합니다.
  window.addEventListener("beforeunload", () => void saves.flush(Date.now()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saves.flush(Date.now());
  });

  // 개발/디버깅용: 브라우저 콘솔에서 window.__game.simulation.state 로 현재 상태를 들여다보거나,
  // window.__game.islands 헬퍼로 특정 섬 좌표를 계산해 순간이동시켜 볼 수 있습니다.
  (window as unknown as { __game: unknown }).__game = {
    simulation,
    renderer,
    panels,
    ocean,
    quality,
    faction,
    saves,
    user,
    islands: islandHelpers,
    // 무기에 따라 실제 공격 간격이 얼마나 짧아지는지 콘솔/테스트에서 확인용
    combat: { totalMeleeCooldown, meleeDps },
    multiplayer,
    multiplayerUI,
    tradeUI,
    touchInput,
  };

  hideStartScreen();

  let lastTime = performance.now();

  // 게임 도중에 멀티플레이 연결이 끊기면(서버 재시작, 네트워크 문제 등) 시작 때와
  // 똑같이 전체 화면을 덮는 게이트를 다시 띄우고, 재접속될 때까지 시뮬레이션·
  // 렌더링·입력 전부를 멈춥니다 — "시작할 때만 막고 도중엔 그냥 계속된다"를
  // 막기 위한 사용자 요청입니다. 개발자 모드는 애초에 connect()를 호출하지
  // 않으므로(devMode 분기) 여기서도 완전히 영향이 없습니다.
  let disconnectGateActive = false;
  const midGameUrl = env?.VITE_MULTIPLAYER_URL || defaultMultiplayerUrl();

  function tick() {
    if (!devMode && !multiplayer.connected) {
      if (!disconnectGateActive) {
        disconnectGateActive = true;
        void connectMultiplayerOrWait(multiplayer, midGameUrl, autoName).then(() => {
          disconnectGateActive = false;
        });
      }
      // 게이트가 떠 있는 동안은 이번 프레임의 시뮬레이션·입력·렌더링을 전부
      // 건너뛰고, 루프만 계속 돌려서(다음 프레임에) 재접속 여부를 계속 확인합니다.
      requestAnimationFrame(tick);
      return;
    }

    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000); // 탭 전환 등으로 인한 큰 dt 스파이크 방지
    lastTime = now;

    // 터치 레이어가 있으면(모바일) 키보드/마우스 스냅샷과 합쳐서 하나의
    // InputSnapshot으로 만듭니다 — 그 아래 시뮬레이션/전투 로직은 입력이
    // 어디서 왔는지 전혀 모릅니다. 데스크톱은 touchInput이 애초에 null이라
    // 병합 자체가 일어나지 않고 기존 동작 그대로입니다.
    const kbSnapshot = input.consumeFrame();
    const snapshot = touchInput ? mergeInputSnapshots(kbSnapshot, touchInput.consumeFrame()) : kbSnapshot;

    // I/C는 패널 열림 여부와 상관없이 항상 토글되어야 함 (닫을 때도 같은 키를 씀)
    if (snapshot.toggleInventoryPressed) panels.toggle("inventory");
    if (snapshot.toggleStatsPressed) panels.toggle("stats");
    // P — 개발자 패널 (개발자 모드에서만)
    if (snapshot.toggleDevPanelPressed && quality.devMode) panels.toggle("dev");

    // 패널(상점 등)이나 거래창이 열려 있으면 조작부(조이스틱/카메라 드래그/
    // 액션 버튼)를 숨깁니다 — 안 그러면 패널 위에 겹쳐 보이고, 패널을 만지는
    // 손가락이 뒤에서 캐릭터를 움직이는 조이스틱으로 오인될 수 있습니다.
    touchInput?.setSuppressed(panels.isBlocking() || tradeUI.isBlocking());

    // 패널이 열려 있는 동안은 이동·전투·상호작용 입력을 무시해서
    // 마우스로 버튼을 누르는 도중 캐릭터가 움직이거나 공격이 나가지 않게 함.
    // 거래창·거래 메뉴가 열려 있을 때도 마찬가지입니다.
    let gameplaySnapshot = (panels.isBlocking() || tradeUI.isBlocking())
      ? { ...snapshot, moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
          jumpPressed: false, jumpHeld: false, attackPressed: false, abilityPressed: false,
          interactPressed: false, mouseDeltaX: 0, mouseDeltaY: 0, teleportPressed: false }
      : snapshot;

    // 인벤토리에서 "손에 들기"로 집어든, 아직 안 먹은 열매가 있는 동안 좌클릭하면
    // 평소처럼 공격이 나가는 대신 "정말 교체하시겠습니까?" 확인창이 뜹니다.
    // 이 프레임의 attackPressed는 확인창을 여는 데만 쓰고, 공격으로는 넘기지 않습니다.
    if (gameplaySnapshot.attackPressed && simulation.state.player.heldFruitCandidate) {
      panels.promptFruitConfirm(simulation.state);
      gameplaySnapshot = { ...gameplaySnapshot, attackPressed: false };
    }

    // 마우스 위치 타게팅 스킬(용암 지대·대분화·천벌·낙뢰 등)이 "마우스가 가리키는
    // 지점에서 발생"하려면, 시뮬레이션이 그 프레임을 처리하기 전에 화면 좌표를
    // 3D 지형 지점으로 미리 레이캐스트해둬야 합니다(순수 시뮬레이션 계층은
    // Three.js를 모르므로 카메라/레이캐스트는 항상 여기 렌더러 쪽에서 처리 —
    // R키 순간이동과 같은 이유). 열매를 뽑아 든 동안만 계산합니다.
    if (simulation.state.player.fruitDrawn) {
      const aimHit = renderer.raycastTerrainAt(gameplaySnapshot.mouseClientX, gameplaySnapshot.mouseClientY);
      simulation.state.player.aimGroundPoint = aimHit ? { x: aimHit.x, z: aimHit.z } : null;
    } else {
      simulation.state.player.aimGroundPoint = null;
    }

    simulation.step(dt, gameplaySnapshot);
    world.step();

    // R키 순간이동 — 마우스가 가리키는 화면 지점을 3D 지형에 레이캐스트해서 찾습니다.
    // 카메라를 다루는 건 렌더러뿐이라 시뮬레이션 안이 아니라 여기서 처리합니다.
    if (gameplaySnapshot.teleportPressed && canUseTeleport(simulation.state.player)) {
      const hit = renderer.raycastTerrainAt(gameplaySnapshot.mouseClientX, gameplaySnapshot.mouseClientY);
      if (hit) {
        const p = simulation.state.player.position;
        const dx = hit.x - p.x;
        const dy = hit.y - p.y;
        const dz = hit.z - p.z;
        const dist3D = Math.hypot(dx, dy, dz);
        let dest = hit;
        // 최대 거리보다 멀면 이동 자체를 취소하지 않고, 같은 방향으로 최대
        // 거리까지만 이동합니다 — 클램프된 (x,z) 지점은 지형을 다시
        // 레이캐스트해서 그 위 실제 높이를 찾고, 섬이 없는 빈 자리(먼 바다
        // 등)면 직선 보간 높이로 대신합니다.
        if (dist3D > TELEPORT_MAX_DISTANCE_M) {
          const scale = TELEPORT_MAX_DISTANCE_M / dist3D;
          const clampedX = p.x + dx * scale;
          const clampedZ = p.z + dz * scale;
          const ground = renderer.raycastTerrainDownAt(clampedX, clampedZ);
          dest = ground ?? { x: clampedX, y: p.y + dy * scale, z: clampedZ };
        }
        const teleportDest = { x: dest.x, y: dest.y + 1, z: dest.z };
        simulation.teleportPlayerTo(teleportDest);
        // 순간이동은 순수 연출용 알림으로도 보내서, 같은 방의 다른 사람 화면에도
        // 도착 지점에 이펙트가 뜨고(내 위치는 어차피 다음 state 동기화로 알려짐).
        multiplayer.sendTeleportFx(teleportDest.x, teleportDest.z, teleportDest.y);
      } else {
        simulation.state.player.events.push({ type: "teleport_failed" });
      }
    }

    // 이번 프레임에 근접/스킬 공격이 나갔다면, PvP가 켜진 다른 진영 플레이어가
    // 사거리 안에 있는지 확인해서 서버에 공격 요청을 보냅니다. CombatSystem은
    // 여전히 몬스터만 알기 때문에 이 확인은 시뮬레이션 바깥, 여기서 합니다.
    processPvpAttacks(simulation.state, multiplayer);
    broadcastSkillFx(simulation.state, multiplayer);
    broadcastMeleeFx(simulation.state, multiplayer);
    broadcastDashFx(simulation.state, multiplayer);
    broadcastSpecialAbilityFx(simulation.state, multiplayer);
    // 뇌광 질주(번개 열매 X) — 변신 중이면 접촉 반경 안 다른 플레이어에게 지속 피해 요청
    processLightningForm(simulation.state, multiplayer, Date.now());

    // 상점 NPC 앞이나 배 위에서 E를 누르면 시뮬레이션이 "요청"만 남기고,
    // 실제 패널을 여는 건 UI 레이어인 여기서 처리합니다.
    if (simulation.state.uiRequest) {
      panels.openPanel(simulation.state.uiRequest, simulation.state.questNpcIslandId);
    }

    ocean.update(simulation.state.elapsedSec);

    renderer.sync(
      simulation.state,
      simulation.playerController,
      multiplayer.enemyGhosts,
      multiplayer.players,
      multiplayer.drainSkillFx(),
      multiplayer.drainMeleeFx(),
      multiplayer.drainDashFx(),
      multiplayer.drainTeleportFx(),
      multiplayer.drainSpecialAbilityFx(),
    );
    renderer.render();
    hud.update(simulation.state, panels.isBlocking());
    panels.update(simulation.state);
    // 저장할 만한 변화가 있었으면 표시해둡니다 (실제 저장은 간격을 두고).
    if (simulation.state.player.events.some(isSaveWorthy)) saves.markDirty();

    // HUD가 이벤트(토스트·화면 효과)를 다 읽은 뒤에 비웁니다.
    // 패널 버튼에서 발생한 이벤트도 여기까지 살아남아야 알림이 보입니다.
    simulation.clearEvents();
    saves.tick(Date.now());

    // 멀티플레이 — 접속 중이 아니면 사실상 no-op입니다 (보간할 원격 플레이어가 없음).
    multiplayer.tick(dt, Date.now(), drawnWeaponId(simulation.state), buildCombatStatsSnapshot(simulation.state));
    renderer.syncRemotePlayers(multiplayer.players);
    multiplayerUI.update();
    tradeUI.update();
    // 현상금 랭킹 패널 — 접속 중이 아니면 서버가 보내준 목록이 비어 있으므로 자연히 숨겨집니다.
    hud.updateBounty(multiplayer.bountyEntries, multiplayer.id, multiplayer.connected);

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

main().catch((err) => {
  console.error("게임 초기화 실패:", err);
  document.body.innerHTML = `<pre style="color:#fff;padding:20px;">초기화 오류: ${err instanceof Error ? err.message : err}</pre>`;
});
