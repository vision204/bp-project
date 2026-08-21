import type { GameState } from "../core/GameState";
import { formatBuffTime } from "../simulation/BuffSystem";
import { SEA_LABELS, getIsland } from "../world/islands";
import { SLOT_KEYS, isSlotUnlocked, skillsForFruit } from "../simulation/skills";
import { weaponFor } from "../simulation/WeaponSystem";
import { boatTier } from "../simulation/BoatSystem";
import { guideInfo } from "../simulation/GuideSystem";

export class Hud {
  private root: HTMLDivElement;
  private hpFill!: HTMLDivElement;
  private manaFill!: HTMLDivElement;
  private expFill!: HTMLDivElement;
  private levelBadge!: HTMLDivElement;
  private moneyBadge!: HTMLDivElement;
  private statPointsBadge!: HTMLDivElement;
  private buffBadge!: HTMLDivElement;
  private hakiBadge!: HTMLDivElement;
  private islandBadge!: HTMLDivElement;
  private skillRow!: HTMLDivElement;
  private fruitLevelLabel!: HTMLDivElement;
  private fruitExpFill!: HTMLDivElement;
  private questBox!: HTMLDivElement;
  private interactionPrompt!: HTMLDivElement;
  private toastContainer!: HTMLDivElement;
  private damageFlash!: HTMLDivElement;
  private boatHud!: HTMLDivElement;
  private boatSpeed!: HTMLDivElement;
  private dashBadge!: HTMLDivElement;
  /** 스킬바 구조를 마지막으로 만든 조건 (열매/해금 상태). 바뀔 때만 다시 만듭니다 */
  private skillRowSignature = "";
  private hotbarEl!: HTMLDivElement;
  private hotbarSignature = "";
  private drownOverlay!: HTMLDivElement;
  private factionBadge!: HTMLDivElement;
  private seaBadge!: HTMLDivElement;
  private devBadge!: HTMLDivElement;
  private guideHud!: HTMLDivElement;
  private guideArrow!: HTMLDivElement;
  private guideName!: HTMLDivElement;
  private guideDist!: HTMLDivElement;
  private hpText!: HTMLDivElement;
  private manaText!: HTMLDivElement;
  private expText!: HTMLDivElement;
  private fruitText!: HTMLDivElement;
  private jumpBadge!: HTMLDivElement;

  constructor(
    container: HTMLElement,
    buttons: {
      onShop: () => void;
      onInventory: () => void;
      onStats: () => void;
      onGuide: () => void;
      onCancelGuide: () => void;
      onRank: () => void;
    },
  ) {
    this.root = document.createElement("div");
    this.root.id = "hud";
    this.root.innerHTML = `
      <div class="damage-flash" id="hud-damage-flash"></div>
      <div class="drown-overlay" id="hud-drown" hidden>
        <div class="drown-text">숨이 막힙니다! 섬으로 헤엄쳐 돌아가세요</div>
      </div>
      <div class="controls-hint">
        <b>WASD</b> 이동 · <b>Shift</b> 질주 · <b>Space</b> 점프 · <b>Q</b> 대쉬<br/>
        우클릭 드래그 시점 회전 · <b>마우스 휠</b> 카메라 확대/축소 · 좌클릭 근접<br/>
        <b>Z X C V</b> 열매 스킬 · 휠을 끝까지 당기면 1인칭<br/>
        <b>E</b> NPC/배 · <b>I</b> 인벤토리 · <b>K</b> 캐릭터 · <b>H</b> 무장색
      </div>
      <div class="side-buttons">
        <button class="ui-btn shop" id="btn-shop">🏪 상점</button>
        <button class="ui-btn" id="btn-inventory">🎒 인벤토리</button>
        <button class="ui-btn" id="btn-stats">📊 캐릭터</button>
        <button class="ui-btn small guide" id="btn-guide">🧭 섬 가이드</button>
        <button class="ui-btn small rank" id="btn-rank">🏆 랭킹</button>
      </div>
      <div class="guide-hud" id="hud-guide" hidden>
        <div class="guide-hud-arrow" id="hud-guide-arrow">▲</div>
        <div class="guide-hud-text">
          <div class="guide-hud-name" id="hud-guide-name"></div>
          <div class="guide-hud-dist" id="hud-guide-dist"></div>
        </div>
        <button class="guide-hud-cancel" id="hud-guide-cancel">✕</button>
      </div>
      <div class="boat-hud" id="hud-boat" hidden>
        <div class="boat-title">⛵ 항해 중</div>
        <div class="boat-info"><b>W/S</b> 전진·후진 · <b>A/D</b> 선회 · <b>E</b> 내리기</div>
        <div class="boat-speed" id="hud-boat-speed"></div>
      </div>
      <div class="island-badge" id="hud-island">시작 섬</div>
      <div class="sea-badge" id="hud-sea">첫 번째 바다</div>
      <div class="hud-status">
        <!-- 레벨 + 경험치를 한 줄로 합쳐 맨 위에 둡니다 -->
        <div class="level-row">
          <div class="level-chip">Lv.<span id="hud-level">1</span></div>
          <div class="bar-track level-track">
            <div class="bar-fill exp" id="hud-exp" style="width:0%"></div>
            <div class="bar-text" id="hud-exp-text">0 / 0</div>
          </div>
        </div>
        <div class="bar-row">
          <div class="bar-label">HP</div>
          <div class="bar-track">
            <div class="bar-fill hp" id="hud-hp" style="width:100%"></div>
            <div class="bar-text" id="hud-hp-text">0 / 0</div>
          </div>
        </div>
        <div class="bar-row">
          <div class="bar-label">MP</div>
          <div class="bar-track">
            <div class="bar-fill mp" id="hud-mp" style="width:100%"></div>
            <div class="bar-text" id="hud-mp-text">0 / 0</div>
          </div>
        </div>
        <div class="bar-row">
          <div class="bar-label fruit" id="hud-fruit-level">열매 Lv.1</div>
          <div class="bar-track">
            <div class="bar-fill fruit" id="hud-fruit-exp" style="width:0%"></div>
            <div class="bar-text" id="hud-fruit-text">0 / 0</div>
          </div>
        </div>
        <div class="top-badges">
          <div class="faction-badge" id="hud-faction">해적</div>
          <div class="money-badge" id="hud-money">🪙 0</div>
          <div class="jump-badge" id="hud-jump" hidden></div>
          <div class="buff-badge" id="hud-buff" hidden></div>
          <div class="haki-badge" id="hud-haki" hidden>무장색 ON</div>
          <div class="dash-badge" id="hud-dash" hidden></div>
          <div class="stat-points-badge" id="hud-stat-points" hidden></div>
          <div class="dev-badge" id="hud-dev" hidden></div>
        </div>
      </div>
      <div class="skill-row" id="hud-skills"></div>
      <div class="hotbar" id="hud-hotbar"></div>
      <div class="quest-box" id="hud-quest-box" hidden></div>
      <div class="interaction-prompt" id="hud-interaction" hidden></div>
      <div class="toast-container" id="hud-toasts"></div>
    `;
    container.appendChild(this.root);

    this.hpFill = this.root.querySelector("#hud-hp")!;
    this.manaFill = this.root.querySelector("#hud-mp")!;
    this.expFill = this.root.querySelector("#hud-exp")!;
    this.levelBadge = this.root.querySelector("#hud-level")!;
    this.moneyBadge = this.root.querySelector("#hud-money")!;
    this.statPointsBadge = this.root.querySelector("#hud-stat-points")!;
    this.buffBadge = this.root.querySelector("#hud-buff")!;
    this.hakiBadge = this.root.querySelector("#hud-haki")!;
    this.islandBadge = this.root.querySelector("#hud-island")!;
    this.seaBadge = this.root.querySelector("#hud-sea")!;
    this.skillRow = this.root.querySelector("#hud-skills")!;
    this.fruitLevelLabel = this.root.querySelector("#hud-fruit-level")!;
    this.fruitExpFill = this.root.querySelector("#hud-fruit-exp")!;
    this.questBox = this.root.querySelector("#hud-quest-box")!;
    this.interactionPrompt = this.root.querySelector("#hud-interaction")!;
    this.toastContainer = this.root.querySelector("#hud-toasts")!;
    this.damageFlash = this.root.querySelector("#hud-damage-flash")!;
    this.boatHud = this.root.querySelector("#hud-boat")!;
    this.boatSpeed = this.root.querySelector("#hud-boat-speed")!;
    this.dashBadge = this.root.querySelector("#hud-dash")!;
    this.hotbarEl = this.root.querySelector("#hud-hotbar")!;
    this.factionBadge = this.root.querySelector("#hud-faction")!;
    this.hpText = this.root.querySelector("#hud-hp-text")!;
    this.manaText = this.root.querySelector("#hud-mp-text")!;
    this.expText = this.root.querySelector("#hud-exp-text")!;
    this.fruitText = this.root.querySelector("#hud-fruit-text")!;
    this.jumpBadge = this.root.querySelector("#hud-jump")!;
    this.devBadge = this.root.querySelector("#hud-dev")!;

    // 상점은 NPC 없이 화면 버튼으로 언제든 열 수 있습니다.
    this.root.querySelector<HTMLButtonElement>("#btn-shop")!.addEventListener("click", buttons.onShop);
    this.root.querySelector<HTMLButtonElement>("#btn-inventory")!.addEventListener("click", buttons.onInventory);
    this.root.querySelector<HTMLButtonElement>("#btn-stats")!.addEventListener("click", buttons.onStats);
    this.root.querySelector<HTMLButtonElement>("#btn-guide")!.addEventListener("click", buttons.onGuide);
    this.root.querySelector<HTMLButtonElement>("#btn-rank")!.addEventListener("click", buttons.onRank);
    this.guideHud = this.root.querySelector("#hud-guide")!;
    this.guideArrow = this.root.querySelector("#hud-guide-arrow")!;
    this.guideName = this.root.querySelector("#hud-guide-name")!;
    this.guideDist = this.root.querySelector("#hud-guide-dist")!;
    this.root.querySelector<HTMLButtonElement>("#hud-guide-cancel")!
      .addEventListener("click", buttons.onCancelGuide);
    this.drownOverlay = this.root.querySelector("#hud-drown")!;
  }

  private pushToast(text: string, tone: "gold" | "red" | "blue" = "gold") {
    const el = document.createElement("div");
    el.className = `toast toast-${tone}`;
    el.textContent = text;
    this.toastContainer.appendChild(el);
    setTimeout(() => el.classList.add("toast-out"), 2400);
    setTimeout(() => el.remove(), 2900);
  }

  private flashDamage() {
    this.damageFlash.classList.remove("flash-active");
    // 리플로우를 강제해서 같은 클래스를 연속으로 다시 붙여도 애니메이션이 재시작되게 함
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add("flash-active");
  }

  update(state: GameState, panelOpen = false) {
    const p = state.player;

    // 막대는 비율로, 글씨는 실제 숫자로 — 모든 값에 숫자를 함께 보여줍니다.
    const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    const mpRatio = p.maxMana > 0 ? p.mana / p.maxMana : 0;
    const expRatio = p.expToNextLevel > 0 ? p.exp / p.expToNextLevel : 0;
    const fruitRatio = p.fruitExpToNext > 0 ? p.fruitExp / p.fruitExpToNext : 0;

    this.hpFill.style.width = `${Math.max(0, hpRatio * 100)}%`;
    this.manaFill.style.width = `${Math.max(0, mpRatio * 100)}%`;
    this.expFill.style.width = `${Math.min(100, expRatio * 100)}%`;

    this.hpText.textContent = `${Math.ceil(Math.max(0, p.hp)).toLocaleString()} / ${p.maxHp.toLocaleString()}`;
    this.manaText.textContent = `${Math.floor(Math.max(0, p.mana)).toLocaleString()} / ${p.maxMana.toLocaleString()}`;
    this.expText.textContent =
      `${Math.floor(p.exp).toLocaleString()} / ${p.expToNextLevel.toLocaleString()} (${Math.floor(expRatio * 100)}%)`;
    this.fruitText.textContent =
      `${Math.floor(p.fruitExp).toLocaleString()} / ${p.fruitExpToNext.toLocaleString()} (${Math.floor(fruitRatio * 100)}%)`;

    // levelBadge는 "Lv." 뒤의 <span>이므로 숫자만 넣습니다 (예전엔 "Lv. Lv. 1"로 중복 출력됐음)
    this.levelBadge.textContent = p.level.toLocaleString();
    this.moneyBadge.textContent = `🪙 ${p.money.toLocaleString()}`;

    // 다단 점프를 배웠으면 몇 단인지 표시 (기본 1단일 때는 굳이 안 보여줍니다)
    if (p.maxJumps > 1) {
      this.jumpBadge.hidden = false;
      this.jumpBadge.textContent = `🦘 ${p.maxJumps}단 점프`;
    } else {
      this.jumpBadge.hidden = true;
    }

    // 진영 — 시작할 때 고른 뒤로는 바뀌지 않지만, 한눈에 보이도록 항상 표시합니다.
    this.factionBadge.textContent = p.faction === "marine" ? "⚓ 해군" : "🏴‍☠️ 해적";
    this.factionBadge.classList.toggle("marine", p.faction === "marine");

    // 개발자 모드 안내 — 비행 상태와 좌표를 그대로 보여줍니다.
    if (p.devMode) {
      this.devBadge.hidden = false;
      this.devBadge.textContent =
        `🛠️ 만렙 테스트 · 저장 안 됨 · ${p.flying ? "비행 중" : "도보"} (F) · P 섬이동 · ` +
        `${Math.round(p.position.x)}, ${Math.round(p.position.y)}, ${Math.round(p.position.z)}`;
    } else {
      this.devBadge.hidden = true;
    }

    // 현재 위치한 섬 + 어느 바다인지 (두 바다의 섬 이름이 헷갈리지 않도록 같이 표시)
    this.islandBadge.textContent = state.currentIslandId ? getIsland(state.currentIslandId).name : "🌊 바다 위";
    this.islandBadge.classList.toggle("at-sea", state.currentIslandId === null);
    this.seaBadge.textContent = `${state.sea === 2 ? "🌑" : "🌊"} ${SEA_LABELS[state.sea]}`;
    this.seaBadge.classList.toggle("second", state.sea === 2);

    if (p.unspentStatPoints > 0) {
      this.statPointsBadge.hidden = false;
      this.statPointsBadge.textContent = `스텟 포인트 ${p.unspentStatPoints} (K키)`;
    } else {
      this.statPointsBadge.hidden = true;
    }

    if (p.expBuffRemainingSec > 0) {
      this.buffBadge.hidden = false;
      this.buffBadge.textContent = `EXP x2 ${formatBuffTime(p.expBuffRemainingSec)}`;
    } else {
      this.buffBadge.hidden = true;
    }

    this.hakiBadge.hidden = !p.hakiActive;

    // Q 대쉬 쿨다운 / 질주 표시
    if (p.dashCooldownSec > 0) {
      this.dashBadge.hidden = false;
      this.dashBadge.textContent = `대쉬 ${p.dashCooldownSec.toFixed(1)}s`;
      this.dashBadge.classList.add("cooling");
    } else if (p.sprinting) {
      this.dashBadge.hidden = false;
      this.dashBadge.textContent = "질주 중";
      this.dashBadge.classList.remove("cooling");
    } else {
      this.dashBadge.hidden = true;
    }

    // 하단 중앙 단축바 — 인벤토리에서 올린 장비를 숫자키로 뽑습니다.
    // (내용이 바뀔 때만 다시 그려야 클릭·호버가 끊기지 않습니다)
    const hotbarSig = `${p.hotbar.join(",")}|${p.activeHotbarSlot}`;
    if (hotbarSig !== this.hotbarSignature) {
      this.hotbarSignature = hotbarSig;
      this.hotbarEl.innerHTML = p.hotbar
        .map((itemId, slot) => {
          const weapon = weaponFor(itemId);
          const active = p.activeHotbarSlot === slot;
          const cls = ["hotbar-slot", weapon ? "filled" : "empty", active ? "active" : ""].filter(Boolean).join(" ");
          const body = weapon
            ? `<div class="hotbar-icon">${weapon.icon}</div><div class="hotbar-name">${weapon.name}</div>`
            : `<div class="hotbar-empty">비어 있음</div>`;
          return `<div class="${cls}"><div class="hotbar-key">${slot + 1}</div>${body}</div>`;
        })
        .join("");
    }

    // 항해 중 안내
    this.boatHud.hidden = !state.boat.riding;
    if (state.boat.riding) {
      const tier = boatTier(state.boat.tier);
      this.boatSpeed.textContent = `${tier.name} — 속도 ${Math.abs(state.boat.speed).toFixed(1)} / ${tier.maxForwardSpeed} m/s`;
    }
    this.drownOverlay.hidden = !p.inWater;

    // 열매 레벨 바
    this.fruitLevelLabel.textContent = `열매 Lv.${p.fruitLevel}`;
    this.fruitExpFill.style.width = `${Math.min(100, (p.fruitExp / p.fruitExpToNext) * 100)}%`;

    // Z/X/C/V 스킬 슬롯 4개.
    // 매 프레임 innerHTML을 갈아끼우면 레이아웃이 계속 다시 계산되므로,
    // 구조는 열매/해금 상태가 바뀔 때만 만들고 쿨다운 숫자만 따로 갱신합니다.
    const skills = skillsForFruit(p.equippedFruit);
    const structureSig = `${p.equippedFruit}|${skills.map((_, i) => (isSlotUnlocked(i, p.fruitLevel) ? 1 : 0)).join("")}`;
    if (structureSig !== this.skillRowSignature) {
      this.skillRowSignature = structureSig;
      this.skillRow.innerHTML = skills
        .map((skill, slot) => {
          const unlocked = isSlotUnlocked(slot, p.fruitLevel);
          const body = unlocked
            ? `<div class="skill-name">${skill.name}</div><div class="skill-cost">${skill.manaCost} MP</div>` +
              `<div class="cooldown-overlay" hidden></div>`
            : `<div class="skill-lock">🔒</div><div class="skill-lock-req">열매 Lv.${skill.unlockFruitLevel}</div>`;
          return `<div class="skill-slot ${unlocked ? "" : "locked"}"><div class="skill-key">${SLOT_KEYS[slot]}</div>${body}</div>`;
        })
        .join("");
    }

    const slotEls = this.skillRow.querySelectorAll<HTMLDivElement>(".skill-slot");
    skills.forEach((skill, slot) => {
      const el = slotEls[slot];
      if (!el) return;
      const unlocked = isSlotUnlocked(slot, p.fruitLevel);
      const cd = p.skillCooldowns[slot];
      const overlay = el.querySelector<HTMLDivElement>(".cooldown-overlay");
      if (overlay) {
        overlay.hidden = cd <= 0;
        if (cd > 0) overlay.textContent = cd.toFixed(1);
      }
      el.classList.toggle("no-mana", unlocked && cd <= 0 && p.mana < skill.manaCost);
    });

    // 퀘스트 진행 상황 트래커 (활성 상태인 퀘스트가 있을 때만 표시)
    const activeQuest = state.quests.find((q) => q.status === "active");
    if (activeQuest) {
      this.questBox.hidden = false;
      const ready = activeQuest.killProgress >= activeQuest.killTarget;
      const rewardExp = Math.floor(p.expToNextLevel * activeQuest.rewardPercentOfLevel);
      const target = activeQuest.targetSpeciesName ? `${activeQuest.targetSpeciesName} ` : "";
      this.questBox.innerHTML = `
        <div class="quest-title">${activeQuest.title}</div>
        <div class="quest-progress">${target}처치: ${activeQuest.killProgress}/${activeQuest.killTarget}${ready ? " — NPC에게 돌아가세요 (E)" : ""}</div>
        <div class="quest-repeat">보상: 경험치 ${rewardExp.toLocaleString()} (이 레벨의 ${Math.round(activeQuest.rewardPercentOfLevel * 100)}%)</div>
      `;
    } else {
      this.questBox.hidden = true;
    }

    // 섬 가이드 — 목적지 방향으로 화살표를 돌립니다.
    // 화살표는 "카메라가 보는 방향 기준 상대 각도"만큼 회전하므로,
    // 위를 가리키면 지금 바라보는 쪽으로 쭉 가면 됩니다.
    if (p.guideTargetIslandId) {
      const info = guideInfo(state, p.guideTargetIslandId);
      this.guideHud.hidden = false;
      this.guideArrow.style.transform = `rotate(${(info.relativeBearing * 180) / Math.PI}deg)`;
      this.guideName.textContent = info.island.name;
      const arrivedSoon = info.distance < info.island.radius + 60;
      this.guideDist.textContent = arrivedSoon
        ? "거의 다 왔습니다!"
        : `${Math.round(info.distance).toLocaleString()}m · ${
            info.island.kind === "hub" ? "중립 지대" : `권장 Lv.${info.island.requiredLevel}`
          }`;
      this.guideHud.classList.toggle("near", arrivedSoon);
    } else {
      this.guideHud.hidden = true;
    }

    // NPC 상호작용 프롬프트 — 패널(상점·퀘스트 등)이 열려 있으면 가려서
    // 목록 위에 겹쳐 보이지 않게 합니다.
    if (state.interactionPrompt && !panelOpen) {
      this.interactionPrompt.hidden = false;
      this.interactionPrompt.textContent = state.interactionPrompt;
    } else {
      this.interactionPrompt.hidden = true;
    }

    // 토스트 알림
    for (const ev of p.events) {
      switch (ev.type) {
        case "player_leveled_up":
          this.pushToast(`레벨업! Lv.${ev.newLevel} — 스텟 포인트 +${ev.statPointsAwarded} (K키로 배분)`);
          break;
        case "jump_learned":
          this.pushToast(`🦘 ${ev.jumps}단 점프를 익혔습니다!`, "gold");
          break;
        case "sea_changed":
          this.pushToast(`👑 ${ev.seaName}에 도착했습니다 — ${ev.islandName}`, "gold");
          break;
        case "gacha_rolled":
          this.pushToast(`🎰 ${ev.fruitName}이(가) 나왔습니다! (🪙${ev.paid} 지불)`, "gold");
          break;
        case "guide_started":
          this.pushToast(`🧭 ${ev.islandName}(으)로 안내를 시작합니다`, "blue");
          break;
        case "guide_arrived":
          this.pushToast(`🧭 ${ev.islandName}에 도착했습니다!`, "blue");
          break;
        case "quest_accepted":
          this.pushToast(`퀘스트 수락: ${ev.questTitle}`, "blue");
          break;
        case "quest_denied":
          this.pushToast(`Lv.${ev.requiredLevel} 이상이어야 이 섬의 의뢰를 받을 수 있습니다`, "red");
          break;
        case "quest_completed":
          this.pushToast(`${ev.questTitle} 완료! 경험치 +${ev.expAwarded.toLocaleString()} · 코인 +${ev.moneyAwarded}`);
          break;
        case "fruit_leveled_up": {
          const unlocked = [1, 25, 50, 100].indexOf(ev.newFruitLevel);
          const msg = unlocked >= 0
            ? `열매 Lv.${ev.newFruitLevel} — ${["Z", "X", "C", "V"][unlocked]} 스킬 해금!`
            : `열매 레벨업! Lv.${ev.newFruitLevel}`;
          this.pushToast(msg, unlocked >= 0 ? "gold" : "blue");
          break;
        }
        case "skill_locked":
          this.pushToast(`${ev.skillName}은(는) 열매 Lv.${ev.requiredFruitLevel}부터 사용 가능합니다`, "red");
          break;
        case "haki_learned":
          this.pushToast("무장색을 익혔습니다! H키로 발동하세요");
          break;
        case "haki_toggled":
          this.pushToast(ev.active ? "무장색 발동!" : "무장색 해제", "blue");
          break;
        case "fruit_purchased":
          this.pushToast(`${ev.fruitName}를 먹었습니다! 기존 열매는 사라집니다`);
          break;
        case "item_purchased":
          this.pushToast(`${ev.itemName} 구매 완료 (I키에서 사용)`);
          break;
        case "item_used":
          this.pushToast(`${ev.itemName} 사용!`, "blue");
          break;
        case "boat_summoned":
          this.pushToast(`${ev.boatName}이(가) 부두에 도착했습니다! E로 탑승`, "blue");
          break;
        case "boat_bought":
          this.pushToast(`${ev.boatName} 구매 완료! 다음 소환부터 이 배가 나옵니다`);
          break;
        case "item_hotbarred":
          this.pushToast(
            ev.slot < 0
              ? `${ev.itemName}을(를) 단축바에서 내렸습니다`
              : `${ev.itemName} 장착! 숫자키 ${ev.slot + 1}번으로 뽑으세요`,
            "blue",
          );
          break;
        case "weapon_drawn":
          this.pushToast(`${ev.weaponName}을(를) 뽑았습니다`);
          break;
        case "weapon_sheathed":
          this.pushToast(`${ev.weaponName}을(를) 집어넣었습니다`, "blue");
          break;
        case "boat_boarded":
          this.pushToast("항해 시작! WASD로 배를 조종하세요", "blue");
          break;
        case "boat_left":
          this.pushToast(ev.landed ? "상륙했습니다" : "바다에 빠졌습니다!", ev.landed ? "blue" : "red");
          break;
        case "island_entered":
          this.pushToast(`${ev.islandName} (권장 Lv.${ev.recommendedLevel})`, "blue");
          break;
        case "purchase_failed":
          this.pushToast(ev.reason, "red");
          break;
        case "player_damaged":
          this.flashDamage();
          break;
        case "player_respawned":
          this.pushToast("쓰러졌습니다… 가까운 섬에서 부활했습니다", "red");
          break;
      }
    }
  }
}
