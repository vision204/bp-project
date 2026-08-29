import type { FruitAbilityId, GameState, ItemId, StatBlock } from "../core/GameState";
import { CASH_PAYMENT_NOTICE, CREW_CREATION_COST, FRUIT_CATALOG, ITEM_CATALOG, WEAPON_CATALOG } from "../simulation/ShopSystem";
import { fruitDisplayName, ownsFruit } from "../simulation/FruitInventorySystem";
import type { MultiplayerClient } from "../network/MultiplayerClient";
import { BOAT_TIERS } from "../simulation/BoatSystem";
import { HAKI_DAMAGE_MULTIPLIER, HAKI_PRICE, effectiveMeleeDamage } from "../simulation/HakiSystem";
import { QUEST_KILL_TARGET } from "../simulation/QuestSystem";
import { FACTION_LABELS, ISLANDS, SEA_LABELS, getIsland, hubIsland } from "../world/islands";
import {
  SECOND_SEA_LEVEL,
  levelsUntilSecondSea,
  otherSea,
  seaBlockReason,
} from "../simulation/SeaSystem";
import {
  GACHA_MIN_MONEY,
  formatGachaRemaining,
  gachaBlockReason,
  gachaCost,
  gachaOdds,
  gachaRemainingMs,
} from "../simulation/GachaSystem";
import { nextGoalIsland, recommendedIsland } from "../simulation/GuideSystem";
import {
  FIRST_JUMP_LEVEL,
  JUMP_LEVEL_STEP,
  MAX_JUMPS,
  jumpBlockReason,
  jumpPrice,
  jumpRequiredLevel,
} from "../simulation/TrainerSystem";
import { weaponFor } from "../simulation/WeaponSystem";
import { TELEPORT_PRICE, TELEPORT_REQUIRED_LEVEL, teleportBlockReason } from "../simulation/TeleportSystem";

type StatKey = keyof StatBlock;

/** 다른 사람이 정한 사단 이름이 그대로 HTML로 들어가지 않도록 이스케이프합니다. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

const STAT_LABELS: Record<StatKey, string> = {
  attack: "공격", // 마나 + 공격력을 합친 스텟 — 최대마나와 근접 데미지 둘 다 올립니다
  defense: "방어", // 예전 "체력" 스텟과 같은 역할(최대체력)
  sword: "검", // 도검류(요루·삼도류·엔마) 데미지 배율
  gun: "총", // 새총 등 원거리 무기 데미지 배율
  fruit: "열매",
};

export interface PanelCallbacks {
  onAllocateStat: (stat: StatKey) => void;
  onBuyFruit: (fruitId: FruitAbilityId) => void;
  /** 인벤토리의 열매를 오른손에 들기만 함 — 아직 먹지는 않음(확정은 좌클릭 확인 후) */
  onHoldFruit: (fruitId: FruitAbilityId) => void;
  /** 손에 든(미확정) 열매를 도로 인벤토리에 넣음 */
  onCancelHeldFruit: () => void;
  /** 손에 든 열매를 실제로 장착(먹음) — 좌클릭 확인창에서 "예"를 눌렀을 때만 불립니다 */
  onConfirmHeldFruit: () => void;
  onBuyItem: (itemId: ItemId) => void;
  onUseItem: (itemId: ItemId) => void;
  onLearnHaki: () => void;
  onBuyBoat: (tierId: string) => void;
  onAcceptQuest: (islandId: string, speciesId: string) => void;
  /** 개발자 모드 — 섬 목록에서 클릭하면 그 섬 상공으로 순간이동 */
  onTeleportToIsland: (islandId: string) => void;
  /** 열매 뽑기 실행 (전 재산의 30%, 4시간에 1회) */
  onRollGacha: () => void;
  /** 섬 가이드 — 목적지 지정 (null이면 안내 해제) */
  onSetGuide: (islandId: string | null) => void;
  /** 설인에게 점프 단계 배우기 */
  onLearnJump: () => void;
  /** 설인에게 R키 순간이동 배우기 */
  onLearnTeleport: () => void;
  /** 해적왕에게 부탁해 다른 바다로 건너가기 */
  onTravelSea: () => void;
  /** 해적 사단 패널을 열 때 — 서버에 최신 사단 목록을 요청합니다 */
  onOpenCrew: () => void;
  /** 코인을 낸 뒤(성공 시) 새 사단 생성을 서버에 요청 */
  onCreateCrew: (name: string) => void;
  onJoinCrew: (crewId: string) => void;
  onLeaveCrew: () => void;
}

export type PanelId =
  | "stats"
  | "inventory"
  | "shop"
  | "haki"
  | "quest"
  | "fruit_dealer"
  | "dev"
  | "gacha"
  | "guide"
  | "trainer"
  | "sea"
  | "crew";

/**
 * 캐릭터(스텟) · 인벤토리 · 상점 · 항해, 네 개의 모달형 패널을 관리합니다.
 * 포인터락을 쓰지 않으므로 커서는 항상 보이지만, 패널이 열려 있는 동안에는
 * main.ts가 isBlocking()을 확인해 이동/전투 입력을 막습니다.
 */
export class PanelManager {
  private root: HTMLDivElement;
  private panels: Record<PanelId, HTMLDivElement>;
  private open: PanelId | null = null;
  /**
   * 마지막으로 그린 내용의 "서명".
   *
   * 예전에는 매 프레임 innerHTML을 통째로 교체했는데, 그러면 60fps에서 16ms마다
   * 버튼 DOM이 새로 만들어집니다. 사람이 마우스를 누르고 떼는 데는 보통 50~150ms가
   * 걸리므로 그 사이에 버튼이 사라져 **click 이벤트가 아예 발생하지 않았습니다**
   * (스텟 +버튼, 상점 구매 버튼이 눌리지 않던 원인). 값이 실제로 바뀔 때만
   * 다시 그리도록 해서 DOM을 안정적으로 유지합니다.
   */
  private renderSignature: Partial<Record<PanelId, string>> = {};
  /** 퀘스트 패널을 연 토벌대장이 있는 섬 */
  private questIslandId: string | null = null;
  /** 해적 사단 패널이 접속/사단 정보를 읽어오는 곳 — main.ts가 생성 직후 setMultiplayer로 넘겨줍니다 */
  private multiplayer: MultiplayerClient | null = null;

  constructor(
    container: HTMLElement,
    private readonly callbacks: PanelCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.id = "panels";
    this.root.innerHTML = `
      <div class="panel stats-panel" id="panel-stats" hidden>
        <div class="panel-header">
          <span>캐릭터</span>
          <button class="panel-close" data-close="stats">✕</button>
        </div>
        <div class="panel-body" id="stats-body"></div>
      </div>

      <div class="panel inventory-panel" id="panel-inventory" hidden>
        <div class="panel-header">
          <span>인벤토리</span>
          <button class="panel-close" data-close="inventory">✕</button>
        </div>
        <div class="panel-sub-line">사용 가능한 아이템은 클릭하면 바로 사용됩니다.</div>
        <div class="inv-section-title">🍈 보유 열매</div>
        <div class="inv-fruit-list" id="inventory-fruit-body"></div>
        <div class="inv-section-title">가방</div>
        <div class="panel-body inventory-grid" id="inventory-body"></div>
      </div>

      <div class="panel shop-panel" id="panel-shop" hidden>
        <div class="panel-header">
          <span>떠돌이 상인의 상점</span>
          <button class="panel-close" data-close="shop">✕</button>
        </div>
        <div class="panel-sub-line" id="shop-money"></div>
        <div class="panel-body" id="shop-body"></div>
      </div>

      <div class="panel dialog-panel" id="panel-haki" hidden>
        <div class="panel-header">
          <span>무장색 사범</span>
          <button class="panel-close" data-close="haki">✕</button>
        </div>
        <div class="dialog-body">
          <div class="dialog-portrait">武</div>
          <p class="dialog-line">
            네 몸을 강철처럼 단단하게 만드는 <b>무장색</b>을 가르쳐주마.<br/>
            익히면 <b>J키</b>로 발동할 수 있고, 발동하는 동안 전신이 검게 변하면서
            근접 공격 데미지가 <b>${Math.round((HAKI_DAMAGE_MULTIPLIER - 1) * 100)}%</b> 올라간다.
            대신 마나가 계속 소모되지.
          </p>
          <p class="dialog-question">수업료는 <b>🪙${HAKI_PRICE}</b>. 배우겠나?</p>
          <div class="dialog-money" id="haki-money"></div>
          <div class="dialog-choices">
            <button class="choice-btn yes" id="haki-yes">예, 배우겠습니다</button>
            <button class="choice-btn no" id="haki-no">아니오</button>
          </div>
        </div>
      </div>

      <div class="panel shop-panel" id="panel-fruit_dealer" hidden>
        <div class="panel-header">
          <span>🍈 열매 상인 (중앙 교역섬)</span>
          <button class="panel-close" data-close="fruit_dealer">✕</button>
        </div>
        <div class="panel-sub-line" id="dealer-money"></div>
        <div class="panel-body" id="dealer-body"></div>
      </div>

      <div class="panel gacha-panel" id="panel-gacha" hidden>
        <div class="panel-header">
          <span>🎰 열매 도박사</span>
          <button class="panel-close" data-close="gacha">✕</button>
        </div>
        <div class="panel-sub-line">전 재산의 30%를 걸고 무작위 열매를 뽑습니다. 4시간에 한 번.</div>
        <div class="panel-body" id="gacha-body"></div>
      </div>

      <div class="panel trainer-panel" id="panel-trainer" hidden>
        <div class="panel-header">
          <span>🧊 설인 (얼음 섬)</span>
          <button class="panel-close" data-close="trainer">✕</button>
        </div>
        <div class="panel-sub-line" id="trainer-money"></div>
        <div class="panel-body" id="trainer-body"></div>
      </div>

      <div class="panel sea-panel" id="panel-sea" hidden>
        <div class="panel-header">
          <span>👑 해적왕</span>
          <button class="panel-close" data-close="sea">✕</button>
        </div>
        <div class="panel-sub-line" id="sea-sub"></div>
        <div class="panel-body" id="sea-body"></div>
      </div>

      <div class="panel guide-panel" id="panel-guide" hidden>
        <div class="panel-header">
          <span>🧭 섬 가이드</span>
          <button class="panel-close" data-close="guide">✕</button>
        </div>
        <div class="panel-sub-line">섬을 고르면 화면에 방향 화살표가 뜹니다. 도착하면 자동으로 꺼집니다.</div>
        <div class="panel-body" id="guide-body"></div>
      </div>

      <div class="panel dev-panel" id="panel-dev" hidden>
        <div class="panel-header">
          <span>🛠️ 개발자 모드</span>
          <button class="panel-close" data-close="dev">✕</button>
        </div>
        <div class="panel-sub-line">섬을 클릭하면 그 섬 상공으로 바로 이동합니다.</div>
        <div class="panel-body" id="dev-body"></div>
      </div>

      <div class="panel quest-panel" id="panel-quest" hidden>
        <div class="panel-header">
          <span id="quest-title">토벌 의뢰</span>
          <button class="panel-close" data-close="quest">✕</button>
        </div>
        <div class="panel-sub-line">사냥할 몬스터를 고르세요. 고른 종류만 퀘스트에 카운트됩니다.</div>
        <div class="panel-body" id="quest-body"></div>
      </div>

      <div class="panel crew-panel" id="panel-crew" hidden>
        <div class="panel-header">
          <span>🏴‍☠️ 해적 사단</span>
          <button class="panel-close" data-close="crew">✕</button>
        </div>
        <div class="panel-body" id="crew-body"></div>
      </div>

      <div class="modal-backdrop" id="fruit-swap-backdrop" hidden></div>
      <div class="panel dialog-panel fruit-swap-panel" id="panel-fruit-swap-confirm" hidden>
        <div class="panel-header">
          <span>🍈 열매 교체</span>
        </div>
        <div class="dialog-body">
          <div class="dialog-portrait">⚠️</div>
          <p class="dialog-line" id="fruit-swap-line"></p>
          <p class="dialog-question">정말 열매를 교체 하시겠습니까?<br/>기존의 열매는 삭제되지만 숙련도 레벨은 저장됩니다.</p>
          <div class="dialog-choices">
            <button class="choice-btn yes" id="fruit-swap-yes">예, 교체하겠습니다</button>
            <button class="choice-btn no" id="fruit-swap-no">아니오</button>
          </div>
        </div>
      </div>

    `;
    container.appendChild(this.root);

    this.panels = {
      stats: this.root.querySelector("#panel-stats")!,
      inventory: this.root.querySelector("#panel-inventory")!,
      shop: this.root.querySelector("#panel-shop")!,
      haki: this.root.querySelector("#panel-haki")!,
      quest: this.root.querySelector("#panel-quest")!,
      fruit_dealer: this.root.querySelector("#panel-fruit_dealer")!,
      dev: this.root.querySelector("#panel-dev")!,
      gacha: this.root.querySelector("#panel-gacha")!,
      guide: this.root.querySelector("#panel-guide")!,
      trainer: this.root.querySelector("#panel-trainer")!,
      sea: this.root.querySelector("#panel-sea")!,
      crew: this.root.querySelector("#panel-crew")!,
    };

    // 무장색 대화창의 예/아니오
    this.root.querySelector<HTMLButtonElement>("#haki-yes")!.addEventListener("click", () => {
      this.callbacks.onLearnHaki();
      this.closeAll();
    });
    this.root.querySelector<HTMLButtonElement>("#haki-no")!.addEventListener("click", () => this.closeAll());

    // 열매 교체 확인창의 예/아니오 — 인벤토리 패널 위가 아니라, 손에 든(미확정)
    // 열매를 들고 게임 화면에서 좌클릭했을 때 뜨는 독립 오버레이입니다.
    this.root.querySelector<HTMLButtonElement>("#fruit-swap-yes")!.addEventListener("click", () => {
      this.callbacks.onConfirmHeldFruit();
      this.hideFruitSwapConfirm();
    });
    this.root.querySelector<HTMLButtonElement>("#fruit-swap-no")!.addEventListener("click", () => {
      this.hideFruitSwapConfirm();
    });
    this.root.querySelector<HTMLDivElement>("#fruit-swap-backdrop")!.addEventListener("click", () => {
      this.hideFruitSwapConfirm();
    });

    this.root.querySelectorAll<HTMLButtonElement>(".panel-close").forEach((btn) => {
      btn.addEventListener("click", () => this.closeAll());
    });
  }

  /** main.ts가 MultiplayerClient를 만든 직후 한 번 호출 — 해적 사단 패널이 접속/사단 정보를 읽는 곳입니다. */
  setMultiplayer(mp: MultiplayerClient) {
    this.multiplayer = mp;
  }

  toggle(panel: PanelId) {
    this.open = this.open === panel ? null : panel;
    if (this.open === "crew") this.callbacks.onOpenCrew();
    this.applyVisibility();
  }

  openPanel(panel: PanelId, islandId?: string | null) {
    // 퀘스트 패널은 "어느 섬 토벌대장 앞인지"를 기억해둬야 합니다.
    // (state.questNpcIslandId는 그 프레임에만 유효하기 때문)
    if (panel === "quest") {
      if (!islandId) return;
      this.questIslandId = islandId;
    }
    if (panel === "crew") this.callbacks.onOpenCrew();
    this.open = panel;
    this.applyVisibility();
  }

  closeAll() {
    this.open = null;
    this.hideFruitSwapConfirm();
    this.applyVisibility();
  }

  /**
   * 손에 든(미확정) 열매가 있으면 "정말 열매를 교체 하시겠습니까?" 확인창을
   * 띄웁니다. main.ts가 게임 화면에서의 좌클릭을 가로챌 때 호출합니다 —
   * 손에 든 열매가 없으면 아무 일도 안 합니다. 지금 열려 있는 패널이 있다면
   * (보통 없음 — 좌클릭은 패널이 닫혀 있을 때만 게임 화면으로 전달되므로)
   * 그 위에 겹쳐서 보여줍니다.
   */
  promptFruitConfirm(state: GameState) {
    const p = state.player;
    if (!p.heldFruitCandidate) return;
    this.root.querySelector<HTMLParagraphElement>("#fruit-swap-line")!.innerHTML =
      `현재 <b>${fruitDisplayName(p.equippedFruit)}</b>을(를) 장착 중입니다.<br/>` +
      `대신 <b>${fruitDisplayName(p.heldFruitCandidate)}</b>을(를) 장착할까요?`;
    this.root.querySelector<HTMLDivElement>("#fruit-swap-backdrop")!.hidden = false;
    this.fruitSwapConfirmEl().hidden = false;
  }

  private hideFruitSwapConfirm() {
    this.root.querySelector<HTMLDivElement>("#fruit-swap-backdrop")!.hidden = true;
    this.fruitSwapConfirmEl().hidden = true;
  }

  private fruitSwapConfirmEl(): HTMLDivElement {
    return this.root.querySelector<HTMLDivElement>("#panel-fruit-swap-confirm")!;
  }

  private applyVisibility() {
    (Object.keys(this.panels) as PanelId[]).forEach((id) => {
      this.panels[id].hidden = this.open !== id;
    });
    // 닫혔다 다시 열릴 때는 최신 내용으로 새로 그리도록 서명을 비웁니다.
    this.renderSignature = {};
  }

  /**
   * innerHTML을 교체하면 스크롤이 맨 위로 돌아가 버립니다.
   * 상점처럼 목록이 긴 패널에서 구매할 때마다 위로 튀지 않도록 위치를 보존합니다.
   */
  private setHtml(el: Element, html: string) {
    const scroll = (el as HTMLElement).scrollTop;
    const panelScroll = el.closest(".panel") as HTMLElement | null;
    const panelTop = panelScroll?.scrollTop ?? 0;
    el.innerHTML = html;
    (el as HTMLElement).scrollTop = scroll;
    if (panelScroll) panelScroll.scrollTop = panelTop;
  }

  /** 내용이 바뀌었을 때만 true를 돌려줍니다 (불필요한 DOM 교체 방지) */
  private shouldRender(panel: PanelId, signature: string) {
    if (this.renderSignature[panel] === signature) return false;
    this.renderSignature[panel] = signature;
    return true;
  }

  /** 패널이 열려 있으면 true — main.ts가 이동/전투 입력을 무시하는 데 사용 */
  isBlocking() {
    return this.open !== null;
  }

  update(state: GameState) {
    this.updateScrollHint();
    switch (this.open) {
      case "stats":
        this.renderStats(state);
        break;
      case "inventory":
        this.renderInventory(state);
        break;
      case "shop":
        this.renderShop(state);
        break;
      case "haki":
        this.renderHaki(state);
        break;
      case "quest":
        this.renderQuest(state);
        break;
      case "fruit_dealer":
        this.renderFruitDealer(state);
        break;
      case "dev":
        this.renderDev(state);
        break;
      case "gacha":
        this.renderGacha(state);
        break;
      case "guide":
        this.renderGuide(state);
        break;
      case "trainer":
        this.renderTrainer(state);
        break;
      case "sea":
        this.renderSea(state);
        break;
      case "crew":
        this.renderCrew(state);
        break;
    }
  }

  /**
   * 목록이 화면 밖으로 이어질 때 아래쪽에 그라데이션 + "▾" 힌트를 띄웁니다.
   * 크롬은 오버레이 스크롤바(폭 0px)를 쓰는 경우가 있어서, 스크롤바만 믿으면
   * "더 있는 줄 모르고" 아래 항목을 못 보게 됩니다.
   */
  private updateScrollHint() {
    if (!this.open) return;
    const panel = this.panels[this.open];
    const body = panel.querySelector<HTMLElement>(".panel-body");
    if (!body) return;
    const more = body.scrollHeight - body.clientHeight - body.scrollTop > 8;
    panel.classList.toggle("has-more", more);
  }

  private renderStats(state: GameState) {
    const p = state.player;
    const signature = [
      p.level, p.unspentStatPoints, p.stats.attack, p.stats.defense, p.stats.sword, p.stats.gun, p.stats.fruit,
      p.maxHp, p.maxMana, p.meleeDamage, p.swordDamageMultiplier, p.gunDamageMultiplier, p.abilityDamageMultiplier,
      p.hakiLearned, p.hakiActive, p.fruitLevel, p.fruitExp, p.fruitExpToNext,
    ].join("|");
    if (!this.shouldRender("stats", signature)) return;

    const body = this.panels.stats.querySelector("#stats-body")!;
    const rows = (Object.keys(STAT_LABELS) as StatKey[])
      .map((key) => {
        const canAllocate = p.unspentStatPoints > 0;
        return `
          <div class="stat-row">
            <div class="stat-name">${STAT_LABELS[key]}</div>
            <div class="stat-value">${p.stats[key]}</div>
            <button class="round-btn" data-stat="${key}" ${canAllocate ? "" : "disabled"}>+</button>
          </div>
        `;
      })
      .join("");

    this.setHtml(body, `
      <div class="stats-summary">
        <div>Lv. ${p.level}</div>
        <div>사용 가능 포인트: <b>${p.unspentStatPoints}</b></div>
      </div>
      ${rows}
      <div class="stats-derived">
        <div>최대 체력 (방어): ${p.maxHp}</div>
        <div>최대 마나 / 근접 공격력 (공격): ${p.maxMana} / ${p.meleeDamage}${p.hakiActive ? ` → <b style="color:#d1c4e9">${Math.round(effectiveMeleeDamage(p))}</b>` : ""}</div>
        <div>검 데미지 배율: x${p.swordDamageMultiplier.toFixed(2)}</div>
        <div>총 데미지 배율: x${p.gunDamageMultiplier.toFixed(2)}</div>
        <div>열매 능력 배율: x${p.abilityDamageMultiplier.toFixed(2)}</div>
        <div>무장색: ${p.hakiLearned ? (p.hakiActive ? "발동 중 (J)" : "습득함 (J로 발동)") : "미습득"}</div>
        <div>열매 레벨: Lv.${p.fruitLevel} (${p.fruitExp}/${p.fruitExpToNext})</div>
      </div>
    `);

    body.querySelectorAll<HTMLButtonElement>(".round-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onAllocateStat(btn.dataset.stat as StatKey));
    });
  }

  private renderInventory(state: GameState) {
    const p = state.player;
    const signature = [p.inventory.map((i) => `${i.id}x${i.quantity}`).join(","),
      p.hotbar.join(","), p.activeHotbarSlot,
      p.equippedFruit, p.fruitInventory.join(","), p.heldFruitCandidate].join("|");
    if (!this.shouldRender("inventory", signature)) return;

    // ── 보유 열매 (장착 중인 열매 + 손에 든 미확정 열매 + 인벤토리의 나머지) ──
    const fruitBody = this.panels.inventory.querySelector("#inventory-fruit-body")!;
    const equippedRow = `
      <div class="inv-fruit-card equipped" title="지금 먹어서 항상 적용 중인 열매">
        <div class="inv-fruit-icon">${FRUIT_CATALOG.find((f) => f.id === p.equippedFruit)?.icon ?? "🍈"}</div>
        <div class="inv-fruit-name">${fruitDisplayName(p.equippedFruit)}</div>
        <div class="inv-fruit-badge">장착중 · Lv.${p.fruitLevel}</div>
      </div>
    `;
    const heldRow = p.heldFruitCandidate ? `
      <div class="inv-fruit-card held" title="아직 안 먹었습니다 — 게임 화면에서 좌클릭하면 장착 여부를 물어봅니다">
        <div class="inv-fruit-icon">${FRUIT_CATALOG.find((f) => f.id === p.heldFruitCandidate)?.icon ?? "🍈"}</div>
        <div class="inv-fruit-name">${fruitDisplayName(p.heldFruitCandidate)}</div>
        <div class="inv-fruit-badge">손에 든 상태 (미확정)</div>
        <button class="cancel-held-fruit-btn">도로 넣기</button>
      </div>
    ` : "";
    const invRows = p.fruitInventory.map((fruitId, idx) => {
      const mastery = p.fruitMastery[fruitId];
      const icon = FRUIT_CATALOG.find((f) => f.id === fruitId)?.icon ?? "🍈";
      return `
        <div class="inv-fruit-card" title="클릭하면 오른손에 듭니다 (좌클릭으로 확정해야 실제 장착됩니다)">
          <div class="inv-fruit-icon">${icon}</div>
          <div class="inv-fruit-name">${fruitDisplayName(fruitId)}</div>
          ${mastery ? `<div class="inv-fruit-badge">보유중 · Lv.${mastery.level}</div>` : `<div class="inv-fruit-badge">보유중</div>`}
          <button class="hold-fruit-btn" data-fruit-idx="${idx}" data-fruit="${fruitId}">손에 들기</button>
        </div>
      `;
    }).join("");
    const emptyHint = !p.heldFruitCandidate && invRows === "" ? `<div class="inv-fruit-empty">아직 보유한 열매가 없습니다. 열매 상인이나 뽑기에서 얻어보세요.</div>` : "";
    const confirmHint = p.heldFruitCandidate ? `<div class="inv-fruit-hint">👆 손에 든 열매를 확정하려면 이 창을 닫고 게임 화면을 좌클릭하세요.</div>` : "";
    this.setHtml(fruitBody, equippedRow + heldRow + invRows + emptyHint + confirmHint);

    fruitBody.querySelectorAll<HTMLButtonElement>(".hold-fruit-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onHoldFruit(btn.dataset.fruit as FruitAbilityId));
    });
    fruitBody.querySelector<HTMLButtonElement>(".cancel-held-fruit-btn")?.addEventListener("click", () => {
      this.callbacks.onCancelHeldFruit();
    });

    // ── 일반 아이템 ──
    const body = this.panels.inventory.querySelector("#inventory-body")!;
    const totalSlots = 24;
    const items = p.inventory;
    let html = "";
    for (let i = 0; i < totalSlots; i++) {
      const item = items[i];
      if (item) {
        const onHotbar = p.hotbar.indexOf(item.id);
        const interactive = item.usable || item.equippable;
        const hint = item.equippable
          ? onHotbar >= 0
            ? `단축바 ${onHotbar + 1}번 — 클릭하면 내림`
            : "클릭하면 단축바에 장착"
          : "클릭하면 사용";
        html += `
          <div class="inv-slot filled ${interactive ? "usable" : ""} ${onHotbar >= 0 ? "hotbarred" : ""}"
               data-item="${item.id}" title="${item.name} — ${item.description} (${hint})">
            <div class="inv-icon">${item.icon}</div>
            ${item.quantity > 1 ? `<div class="inv-qty">${item.quantity}</div>` : ""}
            ${onHotbar >= 0 ? `<div class="inv-slot-badge">${onHotbar + 1}</div>` : ""}
          </div>
        `;
      } else {
        html += `<div class="inv-slot"></div>`;
      }
    }
    this.setHtml(body, html);

    body.querySelectorAll<HTMLDivElement>(".inv-slot.usable").forEach((slot) => {
      slot.addEventListener("click", () => this.callbacks.onUseItem(slot.dataset.item as ItemId));
    });
  }

  private renderShop(state: GameState) {
    const signature = [state.player.money, state.player.equippedFruit,
      state.player.inventory.map((i) => i.id).join(","), state.player.ownedBoats.join(","),
      state.currentIslandId].join("|");
    if (!this.shouldRender("shop", signature)) return;

    const moneyLine = this.panels.shop.querySelector("#shop-money")!;
    moneyLine.innerHTML = `보유 코인: <b>🪙 ${state.player.money}</b>`;

    const body = this.panels.shop.querySelector("#shop-body")!;

    const items = ITEM_CATALOG.map((item) => {
      const canAfford = state.player.money >= item.price;
      return `
        <div class="shop-item">
          <div class="shop-item-icon">${item.icon}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${item.name}</div>
            <div class="shop-item-desc">${item.description}</div>
          </div>
          <button class="buy-btn" data-item="${item.id}" ${canAfford ? "" : "disabled"}>구매 · 🪙${item.price}</button>
        </div>
      `;
    }).join("");

    // 화면 상점의 열매 코너는 **현금(원화) 결제** 전용입니다.
    // 결제 연동(PG사) 전이라 실제로 결제되거나 지급되는 코드는 없고, 눌러도 안내만 뜹니다.
    // 코인으로 사고 싶으면 중앙 교역섬의 열매 상인에게 가야 합니다.
    const fruits = FRUIT_CATALOG.map((fruit) => {
      const owned = ownsFruit(state.player, fruit.id);
      const label = owned ? "보유중" : `₩${fruit.cashPrice.toLocaleString()}`;
      return `
        <div class="shop-item cash ${owned ? "equipped" : ""}">
          <div class="shop-item-icon">${fruit.icon}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${fruit.name} <span class="cash-tag">현금</span></div>
            <div class="shop-item-desc">${fruit.description}</div>
            <div class="shop-item-stats">${fruit.style}</div>
          </div>
          <button class="buy-btn cash-btn" data-cash-fruit="${fruit.id}" ${owned ? "disabled" : ""}>${label}</button>
        </div>
      `;
    }).join("");

    // 무기 — 사면 인벤토리로. 거기서 단축바에 올리고 숫자키로 뽑습니다.
    // 일부 무기는 특정 섬에 있을 때만 살 수 있습니다(예: 엔마는 화산 섬 전용) —
    // 목록에서 숨기지 않고 "여기서는 못 산다"는 걸 그대로 보여줍니다.
    const weapons = WEAPON_CATALOG.map((w) => {
      const owned = state.player.inventory.some((i) => i.id === w.id);
      const canAfford = state.player.money >= w.price;
      const lockedIsland = weaponFor(w.id)?.islandLock;
      const isHere = !lockedIsland || state.currentIslandId === lockedIsland;
      const statsLine = lockedIsland
        ? isHere
          ? `<div class="shop-item-stats">🌋 ${getIsland(lockedIsland).name}에서만 살 수 있어요 — 지금 여기입니다!</div>`
          : `<div class="shop-item-stats">🌋 ${getIsland(lockedIsland).name}에서만 구매할 수 있습니다</div>`
        : `<div class="shop-item-stats">구매 후 인벤토리(I) 클릭 → 하단 단축바 → 숫자키로 뽑기</div>`;
      const label = owned ? "보유중" : !isHere ? "여기서 살 수 없음" : `구매 · 🪙${w.price}`;
      return `
        <div class="shop-item ${owned ? "equipped" : ""}">
          <div class="shop-item-icon">${w.icon}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${w.name}</div>
            <div class="shop-item-desc">${w.description}</div>
            ${statsLine}
          </div>
          <button class="buy-btn" data-item="${w.id}" ${owned || !canAfford || !isHere ? "disabled" : ""}>${label}</button>
        </div>
      `;
    }).join("");

    // 배 — 비쌀수록 빠릅니다. 기본 돛단배(가격 0)는 목록에서 제외.
    const boats = BOAT_TIERS.filter((t) => t.price > 0)
      .map((t) => {
        const owned = state.player.ownedBoats.includes(t.id);
        const canAfford = state.player.money >= t.price;
        return `
        <div class="shop-item ${owned ? "equipped" : ""}">
          <div class="shop-item-icon">${t.icon}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${t.name}</div>
            <div class="shop-item-desc">${t.description}</div>
            <div class="shop-item-stats">최고 속도 ${t.maxForwardSpeed} m/s · 선회 ${t.turnRate.toFixed(1)}</div>
          </div>
          <button class="buy-btn" data-boat="${t.id}" ${owned || !canAfford ? "disabled" : ""}>${
            owned ? "보유중" : `구매 · 🪙${t.price}`
          }</button>
        </div>
      `;
      })
      .join("");

    this.setHtml(body, `
      <div class="shop-section-title">소모품</div>
      <div class="shop-list">${items}</div>
      <div class="shop-section-title">
        악마의 열매 <span class="cash-tag">현금 결제</span>
        <span class="shop-section-note">
          코인으로 사려면 <b>중앙 교역섬의 열매 상인</b>에게 가세요 —
          한 번에 하나만 먹을 수 있고, 새로 먹으면 기존 열매는 사라집니다
        </span>
      </div>
      <div class="cash-notice" id="cash-notice">
        💳 실제 결제는 아직 <b>준비 중</b>입니다 (PG사 연동 예정). 지금은 가격만 보여드립니다.
      </div>
      <div class="shop-list">${fruits}</div>
      <div class="shop-section-title">무기</div>
      <div class="shop-list">${weapons}</div>
      <div class="shop-section-title">
        배
        <span class="shop-section-note">더 비싼 배일수록 빠릅니다 — 소환하면 보유 중 가장 좋은 배가 나옵니다</span>
      </div>
      <div class="shop-list">${boats}</div>
    `);

    // 현금 결제 버튼 — 결제 로직 없이 안내만 띄웁니다 (PG사 미연동).
    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-cash-fruit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const notice = body.querySelector("#cash-notice");
        if (!notice) return;
        notice.classList.remove("blink");
        void (notice as HTMLElement).offsetWidth; // 리플로우 강제 → 같은 애니메이션 재시작
        notice.classList.add("blink");
        notice.innerHTML = `💳 <b>${CASH_PAYMENT_NOTICE}</b>`;
      });
    });
    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-item]").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onBuyItem(btn.dataset.item as ItemId));
    });
    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-boat]").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onBuyBoat(btn.dataset.boat!));
    });
  }

  private renderHaki(state: GameState) {
    const signature = `${state.player.money}|${state.player.hakiLearned}`;
    if (!this.shouldRender("haki", signature)) return;

    const moneyEl = this.panels.haki.querySelector("#haki-money")!;
    const canAfford = state.player.money >= HAKI_PRICE;
    moneyEl.innerHTML = `보유 코인: <b>🪙 ${state.player.money}</b>${canAfford ? "" : " — 코인이 부족합니다"}`;
    moneyEl.classList.toggle("insufficient", !canAfford);
    this.panels.haki.querySelector<HTMLButtonElement>("#haki-yes")!.disabled = !canAfford;
  }

  /**
   * 중앙 교역섬의 열매 상인 — **게임 화폐(코인)로** 악마의 열매를 파는 유일한 창구입니다.
   * (화면 우측 상점의 열매 코너는 현금 결제 표시 전용)
   */
  private renderFruitDealer(state: GameState) {
    const p = state.player;
    const signature = `${p.money}|${p.equippedFruit}|${p.fruitInventory.join(",")}`;
    if (!this.shouldRender("fruit_dealer", signature)) return;

    this.panels.fruit_dealer.querySelector("#dealer-money")!.innerHTML =
      `보유 코인: <b>🪙 ${p.money}</b> · 산 열매는 인벤토리(I)에 들어갑니다 — 장착은 직접 골라야 합니다`;

    const body = this.panels.fruit_dealer.querySelector("#dealer-body")!;
    const rows = FRUIT_CATALOG.map((fruit) => {
      const owned = ownsFruit(p, fruit.id);
      const canAfford = p.money >= fruit.price;
      const label = owned ? "보유중" : `구매 · 🪙${fruit.price}`;
      return `
        <div class="shop-item ${owned ? "equipped" : ""}">
          <div class="shop-item-icon">${fruit.icon}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${fruit.name}</div>
            <div class="shop-item-desc">${fruit.description}</div>
            <div class="shop-item-stats">${fruit.style}</div>
          </div>
          <button class="buy-btn" data-fruit="${fruit.id}" ${owned || !canAfford ? "disabled" : ""}>${label}</button>
        </div>
      `;
    }).join("");

    this.setHtml(body, `
      <div class="dealer-intro">
        "여기가 이 바다에서 <b>코인</b>으로 열매를 살 수 있는 유일한 곳이지.
        급하면 상점에서 현금으로 사도 되고… 뭐, 나야 아무래도 좋지만.
        산다고 바로 먹는 건 아니니, 인벤토리에서 마음에 드는 놈으로 직접 장착해."
      </div>
      <div class="shop-list">${rows}</div>
    `);

    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-fruit]").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onBuyFruit(btn.dataset.fruit as FruitAbilityId));
    });
  }

  /**
   * 설인 — 삼도류 · 무장색 · 다단 점프를 한 창에서 처리합니다.
   * 못 배우는 것은 숨기지 않고 "무엇이 모자란지"를 그대로 보여줍니다.
   */
  private renderTrainer(state: GameState) {
    const p = state.player;
    const nextJumps = p.maxJumps + 1;
    const jumpReason = jumpBlockReason(p);
    const teleportReason = teleportBlockReason(p);
    const signature = [p.money, p.level, p.maxJumps, p.hakiLearned, p.teleportLearned,
      p.inventory.some((i) => i.id === "sword_santoryu")].join("|");
    if (!this.shouldRender("trainer", signature)) return;

    this.panels.trainer.querySelector("#trainer-money")!.innerHTML =
      `보유 코인: <b>🪙 ${p.money.toLocaleString()}</b> · 현재 <b>${p.maxJumps}단 점프</b>`;

    // ── 삼도류 ──
    const sword = weaponFor("sword_santoryu")!;
    const ownSword = p.inventory.some((i) => i.id === "sword_santoryu");
    const swordAffordable = p.money >= sword.price;
    const swordBtn = ownSword
      ? `<button class="buy-btn" disabled>보유중</button>`
      : `<button class="buy-btn" data-item="sword_santoryu" ${swordAffordable ? "" : "disabled"}>구매 · 🪙${sword.price.toLocaleString()}</button>`;

    // ── 무장색 ──
    const hakiAffordable = p.money >= HAKI_PRICE;
    const hakiBtn = p.hakiLearned
      ? `<button class="buy-btn" disabled>습득함</button>`
      : `<button class="buy-btn" id="trainer-haki" ${hakiAffordable ? "" : "disabled"}>배우기 · 🪙${HAKI_PRICE}</button>`;

    // ── 점프 ──
    let jumpDesc: string;
    let jumpBtn: string;
    if (jumpReason === "maxed") {
      jumpDesc = `${MAX_JUMPS}단까지 전부 익혔습니다. 더 가르칠 게 없군.`;
      jumpBtn = `<button class="buy-btn" disabled>최대</button>`;
    } else if (jumpReason === "level") {
      const need = jumpRequiredLevel(nextJumps);
      jumpDesc = `<b>${nextJumps}단 점프</b>는 <b>Lv.${need}</b>부터 배울 수 있습니다 (${need - p.level}레벨 남음).`;
      jumpBtn = `<button class="buy-btn" disabled>Lv.${need} 필요</button>`;
    } else {
      jumpDesc = `<b>${nextJumps}단 점프</b> — 공중에서 ${nextJumps - 1}번 더 뛸 수 있게 됩니다.`;
      jumpBtn = `<button class="buy-btn" id="trainer-jump" ${jumpReason === "money" ? "disabled" : ""}>배우기 · 🪙${jumpPrice(nextJumps).toLocaleString()}</button>`;
    }

    // ── 순간이동 ──
    let teleportDesc: string;
    let teleportBtn: string;
    if (teleportReason === "already") {
      teleportDesc = "이미 다 가르쳤다. 다음엔 R키를 잊지 말거라.";
      teleportBtn = `<button class="buy-btn" disabled>습득함</button>`;
    } else if (teleportReason === "level") {
      teleportDesc = `<b>순간이동</b>은 <b>Lv.${TELEPORT_REQUIRED_LEVEL}</b>부터 배울 수 있습니다 (${TELEPORT_REQUIRED_LEVEL - p.level}레벨 남음).`;
      teleportBtn = `<button class="buy-btn" disabled>Lv.${TELEPORT_REQUIRED_LEVEL} 필요</button>`;
    } else {
      teleportDesc = "마우스가 가리키는 곳으로 <b>R키</b>를 눌러 즉시 이동합니다.";
      teleportBtn = `<button class="buy-btn" id="trainer-teleport" ${teleportReason === "money" ? "disabled" : ""}>배우기 · 🪙${TELEPORT_PRICE.toLocaleString()}</button>`;
    }

    const body = this.panels.trainer.querySelector("#trainer-body")!;
    this.setHtml(body, `
      <div class="trainer-intro">
        "이 설산에서 살아남으려면 검도, 패기도, 다리도 필요하지.
        원하는 걸 골라라. 값은… 뭐, 알아서 매기고 있다."
      </div>

      <div class="trainer-row">
        <div class="trainer-icon">${sword.icon}</div>
        <div class="trainer-info">
          <div class="trainer-name">${sword.name}</div>
          <div class="trainer-desc">${sword.description}</div>
          <div class="trainer-stats">
            공격력 ×${sword.damageMultiplier} · 공격속도 ${Math.round((1 - sword.attackSpeedMultiplier) * 100)}% 빠름 ·
            사거리 +${sword.bonusRange}m
          </div>
          <div class="trainer-hint">사면 인벤토리(I) → 클릭해서 단축바 → 숫자키로 뽑기</div>
        </div>
        ${swordBtn}
      </div>

      <div class="trainer-row">
        <div class="trainer-icon">武</div>
        <div class="trainer-info">
          <div class="trainer-name">무장색</div>
          <div class="trainer-desc">전신이 검게 변하며 근접 데미지가 ${Math.round((HAKI_DAMAGE_MULTIPLIER - 1) * 100)}% 올라갑니다. J키로 발동.</div>
          <div class="trainer-stats">발동 중에는 마나가 계속 소모됩니다</div>
        </div>
        ${hakiBtn}
      </div>

      <div class="trainer-row ${jumpReason === "level" ? "locked" : ""}">
        <div class="trainer-icon">🦘</div>
        <div class="trainer-info">
          <div class="trainer-name">점프 훈련 <span class="trainer-tag">현재 ${p.maxJumps}단</span></div>
          <div class="trainer-desc">${jumpDesc}</div>
          <div class="trainer-stats">
            Lv.${FIRST_JUMP_LEVEL}에 2단 · 이후 ${JUMP_LEVEL_STEP}레벨마다 한 단씩 (최대 ${MAX_JUMPS}단)
          </div>
        </div>
        ${jumpBtn}
      </div>

      <div class="trainer-row ${teleportReason === "level" ? "locked" : ""}">
        <div class="trainer-icon">✨</div>
        <div class="trainer-info">
          <div class="trainer-name">순간이동</div>
          <div class="trainer-desc">${teleportDesc}</div>
          <div class="trainer-stats">한 번 쓰면 다시 쓸 때까지 잠깐 쉬어야 합니다</div>
        </div>
        ${teleportBtn}
      </div>
    `);

    body.querySelector<HTMLButtonElement>('.buy-btn[data-item]')
      ?.addEventListener("click", () => this.callbacks.onBuyItem("sword_santoryu"));
    body.querySelector<HTMLButtonElement>("#trainer-haki")
      ?.addEventListener("click", () => this.callbacks.onLearnHaki());
    body.querySelector<HTMLButtonElement>("#trainer-jump")
      ?.addEventListener("click", () => this.callbacks.onLearnJump());
    body.querySelector<HTMLButtonElement>("#trainer-teleport")
      ?.addEventListener("click", () => this.callbacks.onLearnTeleport());
  }

  /**
   * 해적왕 — 두 바다를 오가는 유일한 통로.
   *
   * 조건이 모자라도 창은 엽니다. 설인과 같은 원칙으로, **무엇이 얼마나 모자란지**를
   * 그대로 보여주는 편이 "말을 걸어도 아무 일도 안 일어난다"보다 훨씬 낫습니다.
   */
  private renderSea(state: GameState) {
    const p = state.player;
    const target = otherSea(state.sea);
    const blocked = seaBlockReason(state);
    const need = levelsUntilSecondSea(p);
    const signature = [state.sea, p.level, p.unlockedSecondSea].join("|");
    if (!this.shouldRender("sea", signature)) return;

    this.panels.sea.querySelector("#sea-sub")!.textContent =
      `지금 있는 곳: ${SEA_LABELS[state.sea]} · ${hubIsland(state.sea).name}`;

    const destination = hubIsland(target);
    const lines = ISLANDS.filter((i) => i.sea === 2 && i.kind !== "hub")
      .sort((a, b) => a.requiredLevel - b.requiredLevel)
      .map((i) => `${i.name} <span class="sea-lv">Lv.${i.requiredLevel}</span>`)
      .join(" · ");

    const button = blocked === "level"
      ? `<button class="buy-btn" disabled>Lv.${SECOND_SEA_LEVEL} 필요 (${need}레벨 남음)</button>`
      : `<button class="buy-btn" id="sea-travel">${SEA_LABELS[target]}로 출항</button>`;

    const speech = target === 2
      ? (blocked
          ? `"이 바다는 이제 네게 좁겠지. 하지만 저쪽은 다르다 — <b>Lv.${SECOND_SEA_LEVEL}</b>은 되어야 한다.
             ${need}레벨만 더 올려서 오너라."`
          : `"드디어 이 바다를 다 밟았구나. 배를 내주지 —
             저 너머 <b>${SEA_LABELS[2]}</b>에서 진짜 항해가 시작된다."`)
      : `"돌아가고 싶으냐? 언제든지. <b>${SEA_LABELS[1]}</b>는 늘 그 자리에 있다."`;

    const body = this.panels.sea.querySelector("#sea-body")!;
    this.setHtml(body, `
      <div class="sea-intro">${speech}</div>

      <div class="sea-route">
        <div class="sea-route-from">${SEA_LABELS[state.sea]}</div>
        <div class="sea-route-arrow">⟶</div>
        <div class="sea-route-to">${SEA_LABELS[target]}<span>${destination.name}에 도착</span></div>
      </div>

      <div class="sea-note">
        레벨 · 코인 · 열매 · 무기 · 퀘스트 진행은 <b>전부 그대로</b> 이어집니다.
        오갈 때 드는 비용도 없습니다. 단, <b>배는 두고 갑니다</b> (도착하면 다시 부르세요).
      </div>

      <div class="sea-islands">
        <div class="sea-islands-title">${SEA_LABELS[2]}의 섬</div>
        <div class="sea-islands-list">${lines}</div>
      </div>

      ${button}
    `);

    body.querySelector<HTMLButtonElement>("#sea-travel")?.addEventListener("click", () => {
      this.callbacks.onTravelSea();
      // 도착하면 바로 새 바다를 볼 수 있게 창을 닫습니다.
      this.closeAll();
    });
  }

  /**
   * 열매 도박사 — 전 재산의 30%를 걸고 무작위 열매를 뽑습니다 (4시간에 1회).
   * 확률은 숨기지 않고 그대로 보여줍니다.
   */
  private renderGacha(state: GameState) {
    const p = state.player;
    const remaining = gachaRemainingMs(p, state.nowMs);
    const reason = gachaBlockReason(p, state.nowMs);
    const cost = gachaCost(p);
    // 남은 시간은 분 단위로만 바뀌게 해서 매 프레임 다시 그리지 않도록 합니다.
    const signature = [p.money, p.equippedFruit, p.fruitInventory.join(","), reason, Math.ceil(remaining / 60000)].join("|");
    if (!this.shouldRender("gacha", signature)) return;

    const body = this.panels.gacha.querySelector("#gacha-body")!;
    const odds = gachaOdds()
      .map((o) => {
        const fruit = FRUIT_CATALOG.find((f) => f.id === o.id)!;
        const owned = ownsFruit(p, o.id);
        return `
          <div class="gacha-odd ${owned ? "equipped" : ""}">
            <span class="gacha-odd-icon">${fruit.icon}</span>
            <span class="gacha-odd-name">${fruit.name}${owned ? " (보유중)" : ""}</span>
            <span class="gacha-odd-bar"><i style="width:${(o.chance * 100).toFixed(1)}%"></i></span>
            <span class="gacha-odd-pct">${(o.chance * 100).toFixed(1)}%</span>
          </div>
        `;
      })
      .join("");

    let statusHtml: string;
    if (reason === "cooldown") {
      statusHtml = `
        <div class="gacha-status wait">
          ⏳ 다음 뽑기까지 <b>${formatGachaRemaining(remaining)}</b> 남았습니다.
          <div class="gacha-status-sub">4시간에 한 번만 뽑을 수 있습니다. 새로고침해도 시간은 그대로예요.</div>
        </div>`;
    } else if (reason === "poor") {
      statusHtml = `
        <div class="gacha-status poor">
          💸 코인이 너무 적습니다. 최소 <b>🪙${GACHA_MIN_MONEY}</b> 는 있어야 합니다.
          <div class="gacha-status-sub">현재 보유: 🪙${p.money}</div>
        </div>`;
    } else {
      statusHtml = `
        <div class="gacha-status ready">
          🎲 지금 뽑을 수 있습니다! 참가비 <b>🪙${cost}</b>
          <div class="gacha-status-sub">보유 코인 🪙${p.money} 의 30% · 뽑고 나면 4시간 기다려야 합니다</div>
        </div>`;
    }

    this.setHtml(body, `
      <div class="gacha-intro">
        "운을 시험해 보겠나? 값은 <b>자네 전 재산의 30%</b>일세.
        비싼 열매일수록 잘 안 나오지만… 그게 도박의 맛 아니겠나."
      </div>
      ${statusHtml}
      <div class="gacha-odds-title">확률</div>
      ${odds}
      <button class="gacha-roll-btn" id="gacha-roll" ${reason ? "disabled" : ""}>
        ${reason === "cooldown" ? `⏳ ${formatGachaRemaining(remaining)} 후 가능`
          : reason === "poor" ? "💸 코인 부족"
          : `🎰 뽑기 · 🪙${cost}`}
      </button>
    `);

    const btn = body.querySelector<HTMLButtonElement>("#gacha-roll");
    btn?.addEventListener("click", () => this.callbacks.onRollGacha());
  }

  /**
   * 섬 가이드 — 내 레벨에 맞는 섬을 추천하고, 고른 섬까지 방향을 안내합니다.
   * 목록은 요구 레벨 순서로 정렬해서 "다음에 갈 곳"이 자연스럽게 보이도록 했습니다.
   */
  private renderGuide(state: GameState) {
    const p = state.player;
    // 길안내는 **지금 있는 바다 안에서만** 합니다. 다른 바다는 걸어서도 배로도
    // 갈 수 없어서(해적왕이 유일한 통로), 목록에 띄우면 도달할 수 없는 화살표가 됩니다.
    const recommended = recommendedIsland(p, state.sea);
    const nextGoal = nextGoalIsland(p, state.sea);
    const target = p.guideTargetIslandId;
    const signature = [
      p.level, target, recommended.id, state.sea,
      Math.round(p.position.x / 20), Math.round(p.position.z / 20),
    ].join("|");
    if (!this.shouldRender("guide", signature)) return;

    const body = this.panels.guide.querySelector("#guide-body")!;
    const sorted = ISLANDS
      .filter((i) => i.sea === state.sea)
      .filter((i) => i.kind !== "start" || i.faction === p.faction) // 상대 진영 시작 섬은 목록에서 제외
      .sort((a, b) => a.requiredLevel - b.requiredLevel || a.name.localeCompare(b.name));

    const rows = sorted
      .map((island) => {
        const dist = Math.round(Math.hypot(island.center.x - p.position.x, island.center.z - p.position.z));
        const locked = island.requiredLevel > p.level;
        const isRecommended = island.id === recommended.id;
        const isTarget = island.id === target;
        const tag = island.kind === "hub"
          ? `<span class="guide-tag hub">중립 · 상인</span>`
          : locked
            ? `<span class="guide-tag locked">Lv.${island.requiredLevel} 필요</span>`
            : `<span class="guide-tag ok">Lv.${island.requiredLevel}</span>`;
        return `
          <div class="guide-row ${isRecommended ? "recommended" : ""} ${isTarget ? "targeted" : ""} ${locked ? "locked" : ""}">
            <div class="guide-row-info">
              <div class="guide-row-name">
                ${island.name} ${tag}
                ${isRecommended ? `<span class="guide-badge">지금 여기!</span>` : ""}
              </div>
              <div class="guide-row-sub">여기서 ${dist.toLocaleString()}m ${
                locked ? "· 상륙은 가능하지만 의뢰는 못 받습니다" : ""
              }</div>
            </div>
            <button class="buy-btn ${isTarget ? "cancel" : ""}" data-guide="${island.id}">
              ${isTarget ? "안내 중지" : "길 안내"}
            </button>
          </div>
        `;
      })
      .join("");

    this.setHtml(body, `
      <div class="guide-summary">
        <div><b>Lv.${p.level}</b> 기준 추천 사냥터: <b class="guide-highlight">${recommended.name}</b></div>
        ${nextGoal
          ? `<div class="guide-next">다음 목표: ${nextGoal.name} (Lv.${nextGoal.requiredLevel} · ${nextGoal.requiredLevel - p.level}레벨 남음)</div>`
          : `<div class="guide-next">이 바다의 섬을 전부 열었습니다. 🎉</div>`}
      </div>
      ${rows}
    `);

    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-guide]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.callbacks.onSetGuide(btn.dataset.guide!);
        // 목적지를 골랐으면 바로 화면의 화살표를 볼 수 있게 창을 닫습니다.
        this.closeAll();
      });
    });
  }

  /**
   * 개발자 모드 패널 — 섬을 클릭하면 그 섬 상공으로 순간이동합니다.
   * 여러 섬을 빠르게 돌아보며 피드백하기 위한 도구라, 일반 모드에서는 열리지 않습니다.
   */
  private renderDev(state: GameState) {
    const p = state.player;
    const here = state.currentIslandId ?? "";
    const signature = [here, p.flying, p.level, p.money, Math.round(p.position.x), Math.round(p.position.z)].join("|");
    if (!this.shouldRender("dev", signature)) return;

    const body = this.panels.dev.querySelector("#dev-body")!;
    // 개발자 모드에서는 바다를 가리지 않고 **양쪽 바다를 다 보여줍니다** —
    // 둘러보는 게 목적이라, 여기서 누르면 해적왕 없이도 건너갑니다.
    const rows = ([1, 2] as const).map((sea) => {
      const islandRows = ISLANDS.filter((i) => i.sea === sea).map((island) => {
        const dist = Math.round(Math.hypot(island.center.x - p.position.x, island.center.z - p.position.z));
        const tag =
          island.kind === "hub" ? "중립" : island.kind === "start" ? FACTION_LABELS[island.faction!] : `Lv.${island.requiredLevel}`;
        return `
          <div class="dev-row ${here === island.id ? "here" : ""}">
            <div class="dev-row-info">
              <div class="dev-row-name">${island.name} <span class="dev-tag">${tag}</span></div>
              <div class="dev-row-sub">
                반지름 ${island.radius}m · 몬스터 ${island.species.length}종 · 여기서 ${dist.toLocaleString()}m
              </div>
            </div>
            <button class="buy-btn" data-island="${island.id}">이동</button>
          </div>
        `;
      }).join("");
      return `<div class="dev-sea-label">${SEA_LABELS[sea]}${sea === state.sea ? " · 지금 여기" : ""}</div>${islandRows}`;
    }).join("");

    this.setHtml(body, `
      <div class="dev-status">
        <div>캐릭터: <b>Lv.${p.level.toLocaleString()}</b> · 🪙${p.money.toLocaleString()} · ${p.maxJumps}단 점프</div>
        <div>비행: <b>${p.flying ? "켜짐" : "꺼짐"}</b> (F키) · 피해 무효: <b>켜짐</b></div>
        <div>좌표: ${Math.round(p.position.x)}, ${Math.round(p.position.y)}, ${Math.round(p.position.z)}</div>
        <div class="dev-warn">저장 <b>꺼짐</b> — 여기서 무엇을 해도 내 진짜 캐릭터와 랭킹에는 영향이 없습니다</div>
      </div>
      <div class="dev-help">
        비행 중에는 <b>W/S</b>로 보는 방향으로 날고, <b>Space</b> 상승 · <b>Ctrl</b> 하강 ·
        <b>Shift</b> 가속(3배)입니다. 지형은 통과합니다.
      </div>
      ${rows}
    `);

    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-island]").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onTeleportToIsland(btn.dataset.island!));
    });
  }

  /**
   * 몬스터가 여러 종류인 섬의 퀘스트 — 어떤 종류를 사냥할지 직접 고릅니다.
   * 종류마다 권장 레벨·체력·경험치가 다르므로 그대로 보여주고,
   * 내 레벨보다 한참 높은 종류에는 "위험" 표시를 답니다.
   */
  private renderQuest(state: GameState) {
    const islandId = this.questIslandId;
    if (!islandId) return;
    const island = getIsland(islandId);
    const quest = state.quests.find((q) => q.islandId === islandId);
    const signature = [islandId, state.player.level, quest?.status, quest?.targetSpeciesId].join("|");
    if (!this.shouldRender("quest", signature)) return;

    this.panels.quest.querySelector("#quest-title")!.textContent = `${island.name} 토벌대장`;

    const body = this.panels.quest.querySelector("#quest-body")!;
    const rows = island.species
      .map((s, k) => {
        const risky = state.player.level + 40 < s.tierLevel;
        return `
          <div class="quest-species ${risky ? "risky" : ""}">
            <div class="quest-species-dot" style="background:#${s.color.toString(16).padStart(6, "0")}"></div>
            <div class="quest-species-info">
              <div class="quest-species-name">${k + 1}단계 · ${s.name}</div>
              <div class="quest-species-desc">권장 Lv.${s.tierLevel} · 체력 ${s.hp.toLocaleString()} · 경험치 ${s.exp.toLocaleString()} · 🪙${s.money}</div>
              ${risky ? `<div class="quest-species-warn">내 레벨보다 한참 높습니다 (현재 Lv.${state.player.level})</div>` : ""}
            </div>
            <button class="buy-btn" data-species="${s.id}">이걸로 수락</button>
          </div>
        `;
      })
      .join("");

    this.setHtml(body, `
      <div class="quest-intro">
        ${island.name}에는 몬스터가 <b>${island.species.length}종류</b> 살고 있다.
        어느 쪽을 정리해줄 텐가? 목표는 <b>${QUEST_KILL_TARGET}마리</b>다.
      </div>
      ${rows}
    `);

    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-species]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.callbacks.onAcceptQuest(islandId, btn.dataset.species!);
        this.closeAll();
      });
    });
  }

  /**
   * 해적 사단(길드) — 중앙섬 전용, 해적 진영만 이용할 수 있습니다.
   * 사단 목록·내 사단 정보는 GameState가 아니라 MultiplayerClient(서버)가
   * 들고 있으므로, state 대신 this.multiplayer를 직접 읽습니다.
   */
  private renderCrew(state: GameState) {
    const mp = this.multiplayer;
    const p = state.player;
    const connected = mp?.connected ?? false;
    const myCrew = mp?.myCrew ?? null;
    const list = mp?.crewList ?? [];
    const signature = [
      connected,
      p.faction,
      p.money,
      myCrew?.id,
      myCrew?.totalBounty,
      myCrew?.memberCount,
      list.map((c) => `${c.id}:${c.totalBounty}:${c.memberCount}`).join(","),
    ].join("|");
    if (!this.shouldRender("crew", signature)) return;

    const body = this.panels.crew.querySelector("#crew-body")!;

    if (!connected) {
      this.setHtml(
        body,
        `<div class="crew-intro">해적 사단은 멀티플레이 서버에 접속해 있어야 이용할 수 있습니다. 좌상단 🌐 버튼으로 먼저 접속하세요.</div>`,
      );
      return;
    }
    if (p.faction !== "pirate") {
      this.setHtml(body, `<div class="crew-intro">해적 사단은 해적 진영 전용입니다.</div>`);
      return;
    }

    if (myCrew) {
      this.setHtml(
        body,
        `
        <div class="crew-mine">
          <div class="crew-mine-name">🏴‍☠️ ${escapeHtml(myCrew.name)}</div>
          <div class="crew-mine-stats">사단원 ${myCrew.memberCount}명 · 누적 점수 ${myCrew.totalBounty.toLocaleString()}</div>
          <div class="crew-mine-bonus">PvP로 플레이어를 처치할 때마다 현상금 <b>+${myCrew.perKillBonus}</b> (사단 누적 점수 1만마다 +1씩 늘어납니다)</div>
          <button class="buy-btn cancel" id="crew-leave-btn">사단 탈퇴</button>
        </div>
      `,
      );
      body.querySelector<HTMLButtonElement>("#crew-leave-btn")?.addEventListener("click", () => this.callbacks.onLeaveCrew());
      return;
    }

    const canAfford = p.money >= CREW_CREATION_COST;
    const rows =
      list.length === 0
        ? `<div class="crew-empty">아직 만들어진 사단이 없습니다 — 첫 사단을 만들어보세요!</div>`
        : list
            .map(
              (c) => `
          <div class="crew-row">
            <div class="crew-row-info">
              <div class="crew-row-name">${escapeHtml(c.name)}</div>
              <div class="crew-row-sub">사단원 ${c.memberCount}명 · 누적 점수 ${c.totalBounty.toLocaleString()} · 킬 보너스 +${c.perKillBonus}</div>
            </div>
            <button class="buy-btn" data-join="${c.id}">가입</button>
          </div>
        `,
            )
            .join("");

    this.setHtml(
      body,
      `
      <div class="crew-intro">🪙${CREW_CREATION_COST.toLocaleString()}을 내고 새 사단을 만들거나, 이미 있는 사단에 가입할 수 있습니다.</div>
      <div class="crew-create">
        <input type="text" id="crew-name-input" maxlength="20" placeholder="새 사단 이름" />
        <button class="buy-btn" id="crew-create-btn" ${canAfford ? "" : "disabled"}>만들기 · 🪙${CREW_CREATION_COST.toLocaleString()}</button>
      </div>
      <div class="crew-list">${rows}</div>
    `,
    );

    body.querySelector<HTMLButtonElement>("#crew-create-btn")?.addEventListener("click", () => {
      const input = body.querySelector<HTMLInputElement>("#crew-name-input");
      const name = input?.value.trim() ?? "";
      if (!name) return;
      this.callbacks.onCreateCrew(name);
    });
    body.querySelectorAll<HTMLButtonElement>(".buy-btn[data-join]").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onJoinCrew(btn.dataset.join!));
    });
  }
}
