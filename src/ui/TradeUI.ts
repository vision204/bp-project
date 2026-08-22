// ---------------------------------------------------------------------------
// P2P 거래·선물 UI.
//
// 다른 플레이어에게 마우스를 올리고 "짧게" 우클릭하면(누른 채로 드래그하면
// 안 됨) 테두리 효과가 있던 자리에서 거래/선물 메뉴가 뜹니다. 이 파일은
// PanelManager를 쓰지 않는 독립 위젯입니다(MultiplayerUI.ts와 같은 결) —
// 거래창이 열려 있는 동안만 이동/전투 입력을 막도록 isBlocking()을 노출하고,
// main.ts가 panels.isBlocking()과 함께 확인합니다.
//
// ⚠️ 우클릭은 이미 InputManager.ts가 "누르고 있는 동안 카메라 회전"에 쓰고
// 있습니다. 그 파일을 건드리지 않고, 이 파일이 **따로** mousedown/mouseup을
// 들어서 "눌렀다 뗄 때까지 마우스가 거의 안 움직였는지"를 직접 판정합니다
// (일정 픽셀 이상 움직이면 드래그로 보고 메뉴를 띄우지 않음 — 카메라 회전과
// 충돌하지 않습니다). 순간적으로 커서가 깜빡 숨었다 돌아오는 정도는 있을 수
// 있지만, 클릭 자체를 가로막지는 않습니다.
// ---------------------------------------------------------------------------

import type { GameState, InventoryItem, ItemId } from "../core/GameState";
import type { MultiplayerClient } from "../network/MultiplayerClient";
import type { SceneRenderer } from "../render/SceneRenderer";
import { MAX_TRADE_SLOTS, type TradeItem } from "../network/protocol";

/** 우클릭 "클릭"과 "드래그(카메라 회전)"를 가르는 문턱값 (픽셀 누적) */
const DRAG_THRESHOLD_PX = 6;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

function toTradeItem(item: InventoryItem, quantity: number): TradeItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    usable: item.usable,
    equippable: item.equippable,
    quantity,
  };
}

export class TradeUI {
  private menuEl: HTMLDivElement;
  private tradeWindowEl: HTMLDivElement;
  private giftPickerEl: HTMLDivElement;

  private menuTargetId: string | null = null;
  private giftTargetId: string | null = null;

  private hoveredId: string | null = null;
  private rightDown = false;
  private rightDownAt = { x: 0, y: 0 };
  private rightDownHoverId: string | null = null;
  private dragAccumPx = 0;

  /** 화면에 마지막으로 그린 내용 서명 — 값이 바뀔 때만 다시 그립니다 (버튼이 매프레임 사라져 클릭이 씹히는 사고 방지). */
  private lastTradeSig = "";
  private lastGiftSig = "";

  constructor(
    container: HTMLElement,
    private readonly mp: MultiplayerClient,
    private readonly state: GameState,
    private readonly renderer: SceneRenderer,
  ) {
    this.menuEl = document.createElement("div");
    this.menuEl.className = "trade-menu";
    this.menuEl.hidden = true;
    this.menuEl.innerHTML = `
      <button class="trade-menu-btn" id="trade-menu-trade">🤝 거래하기</button>
      <button class="trade-menu-btn" id="trade-menu-gift">🎁 선물 주기</button>
    `;
    container.appendChild(this.menuEl);

    this.tradeWindowEl = document.createElement("div");
    this.tradeWindowEl.className = "trade-window";
    this.tradeWindowEl.hidden = true;
    container.appendChild(this.tradeWindowEl);

    this.giftPickerEl = document.createElement("div");
    this.giftPickerEl.className = "trade-gift-picker";
    this.giftPickerEl.hidden = true;
    container.appendChild(this.giftPickerEl);

    this.menuEl.querySelector<HTMLButtonElement>("#trade-menu-trade")!.addEventListener("click", () => {
      if (this.menuTargetId) this.mp.sendTradeRequest(this.menuTargetId);
      this.closeMenu();
    });
    this.menuEl.querySelector<HTMLButtonElement>("#trade-menu-gift")!.addEventListener("click", () => {
      if (this.menuTargetId) this.openGiftPicker(this.menuTargetId);
      this.closeMenu();
    });

    const dom = renderer.domElement;
    dom.addEventListener("mousemove", this.onHoverMove);
    dom.addEventListener("mousedown", this.onDomMouseDown);
    window.addEventListener("mousemove", this.onDragMove);
    window.addEventListener("mouseup", this.onWindowMouseUp);
    window.addEventListener("mousedown", this.onOutsideMouseDown, true);
  }

  /** main.ts가 매 프레임 확인해서, 열려 있는 동안은 이동/전투 입력을 막습니다. */
  isBlocking(): boolean {
    return !this.menuEl.hidden || !this.tradeWindowEl.hidden || !this.giftPickerEl.hidden;
  }

  /** 매 프레임 호출 — 거래창 내용을 최신 상태로 맞춥니다. */
  update() {
    this.renderTradeWindow();
    if (!this.giftPickerEl.hidden) this.renderGiftPicker();
  }

  private onHoverMove = (e: MouseEvent) => {
    if (this.rightDown) return; // 카메라 회전 중에는 갱신하지 않음 (좌표가 고정되어 있음)
    const id = this.renderer.pickRemotePlayerAt(e.clientX, e.clientY);
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.renderer.setHoverOutline(id);
    }
  };

  private onDomMouseDown = (e: MouseEvent) => {
    if (e.button !== 2) return;
    this.rightDown = true;
    this.rightDownAt = { x: e.clientX, y: e.clientY };
    this.rightDownHoverId = this.hoveredId;
    this.dragAccumPx = 0;
  };

  private onDragMove = (e: MouseEvent) => {
    if (!this.rightDown) return;
    this.dragAccumPx += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
  };

  private onWindowMouseUp = (e: MouseEvent) => {
    if (e.button !== 2 || !this.rightDown) return;
    this.rightDown = false;
    const targetId = this.rightDownHoverId;
    const wasClick = this.dragAccumPx < DRAG_THRESHOLD_PX;
    this.rightDownHoverId = null;
    if (wasClick && targetId) {
      this.openMenu(targetId, this.rightDownAt.x, this.rightDownAt.y);
    }
  };

  private onOutsideMouseDown = (e: MouseEvent) => {
    if (!this.menuEl.hidden && !this.menuEl.contains(e.target as Node)) this.closeMenu();
    if (!this.giftPickerEl.hidden && !this.giftPickerEl.contains(e.target as Node)) this.closeGiftPicker();
  };

  private openMenu(targetId: string, x: number, y: number) {
    this.menuTargetId = targetId;
    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${y}px`;
    this.menuEl.hidden = false;
  }

  private closeMenu() {
    this.menuEl.hidden = true;
    this.menuTargetId = null;
  }

  private openGiftPicker(targetId: string) {
    this.giftTargetId = targetId;
    this.giftPickerEl.hidden = false;
    this.lastGiftSig = ""; // 새로 열 때는 강제로 다시 그림
    this.renderGiftPicker();
  }

  private closeGiftPicker() {
    this.giftPickerEl.hidden = true;
    this.giftTargetId = null;
  }

  private renderGiftPicker() {
    const items = this.state.player.inventory;
    const sig = items.map((i) => `${i.id}x${i.quantity}`).join(",");
    if (sig === this.lastGiftSig) return;
    this.lastGiftSig = sig;

    let html = `<div class="trade-gift-header">🎁 선물 보내기 <button class="trade-close-btn" id="trade-gift-close">✕</button></div>`;
    if (items.length === 0) {
      html += `<div class="trade-empty">보낼 아이템이 없습니다</div>`;
    } else {
      html += items
        .map(
          (item, i) => `
        <div class="trade-gift-row" data-idx="${i}">
          <div class="inv-icon">${item.icon}</div>
          <div class="trade-gift-info">
            <div class="trade-gift-name">${escapeHtml(item.name)}</div>
            <div class="trade-gift-qty">보유 ${item.quantity}개</div>
          </div>
          <input type="number" class="trade-gift-amount" min="1" max="${item.quantity}" value="1" data-idx="${i}" />
          <button class="trade-gift-send-btn" data-idx="${i}">보내기</button>
        </div>`,
        )
        .join("");
    }
    this.giftPickerEl.innerHTML = html;
    this.giftPickerEl.querySelector<HTMLButtonElement>("#trade-gift-close")!.addEventListener("click", () => this.closeGiftPicker());
    this.giftPickerEl.querySelectorAll<HTMLButtonElement>(".trade-gift-send-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const item = items[idx];
        const targetId = this.giftTargetId;
        if (!item || !targetId) return;
        const amountInput = this.giftPickerEl.querySelector<HTMLInputElement>(`.trade-gift-amount[data-idx="${idx}"]`);
        const qty = Math.max(1, Math.min(item.quantity, Math.floor(Number(amountInput?.value) || 1)));
        this.mp.sendGift(targetId, toTradeItem(item, qty));
        this.closeGiftPicker();
      });
    });
  }

  private renderTradeWindow() {
    const session = this.mp.tradeSession;
    if (!session) {
      if (!this.tradeWindowEl.hidden) {
        this.tradeWindowEl.hidden = true;
        this.lastTradeSig = "";
      }
      return;
    }

    const inv = this.state.player.inventory;
    const sig = [
      session.partnerName,
      session.myOffer.map((i) => `${i.id}x${i.quantity}`).join(","),
      session.partnerOffer.map((i) => `${i.id}x${i.quantity}`).join(","),
      session.myAccepted,
      session.partnerAccepted,
      inv.map((i) => `${i.id}x${i.quantity}`).join(","),
    ].join("|");
    if (sig === this.lastTradeSig && !this.tradeWindowEl.hidden) return;
    this.lastTradeSig = sig;
    this.tradeWindowEl.hidden = false;

    const offerSlots = (offer: TradeItem[], removable: boolean) => {
      let html = "";
      for (let i = 0; i < MAX_TRADE_SLOTS; i++) {
        const item = offer[i];
        if (item) {
          html += `
            <div class="inv-slot filled ${removable ? "usable" : ""}" data-slot="${i}" title="${escapeHtml(item.name)} x${item.quantity}">
              <div class="inv-icon">${item.icon}</div>
              ${item.quantity > 1 ? `<div class="inv-qty">${item.quantity}</div>` : ""}
            </div>`;
        } else {
          html += `<div class="inv-slot"></div>`;
        }
      }
      return html;
    };

    const invRows = inv.length
      ? inv
          .map(
            (item, i) => `
        <div class="inv-slot filled usable" data-inv-idx="${i}" title="${escapeHtml(item.name)} — 클릭하면 제안에 추가">
          <div class="inv-icon">${item.icon}</div>
          ${item.quantity > 1 ? `<div class="inv-qty">${item.quantity}</div>` : ""}
        </div>`,
          )
          .join("")
      : `<div class="trade-empty">인벤토리가 비어 있습니다</div>`;

    this.tradeWindowEl.innerHTML = `
      <div class="trade-header">🤝 ${escapeHtml(session.partnerName)}님과 거래 중 <button class="trade-close-btn" id="trade-cancel-btn">✕</button></div>
      <div class="trade-columns">
        <div class="trade-column">
          <div class="trade-col-label">내 제안 ${session.myAccepted ? "✅" : ""}</div>
          <div class="trade-grid" id="trade-my-offer">${offerSlots(session.myOffer, true)}</div>
        </div>
        <div class="trade-column">
          <div class="trade-col-label">상대 제안 ${session.partnerAccepted ? "✅" : ""}</div>
          <div class="trade-grid">${offerSlots(session.partnerOffer, false)}</div>
        </div>
      </div>
      <div class="trade-inv-label">내 인벤토리 — 클릭해서 제안에 담기</div>
      <div class="trade-inv-grid">${invRows}</div>
      <div class="trade-actions">
        <button class="trade-accept-btn ${session.myAccepted ? "accepted" : ""}" id="trade-accept-btn">
          ${session.myAccepted ? "✅ 승낙함 (취소하려면 다시 클릭)" : "승낙"}
        </button>
      </div>
    `;

    this.tradeWindowEl.querySelector<HTMLButtonElement>("#trade-cancel-btn")!.addEventListener("click", () => {
      this.mp.sendTradeCancel();
    });
    this.tradeWindowEl.querySelector<HTMLButtonElement>("#trade-accept-btn")!.addEventListener("click", () => {
      this.mp.sendTradeAccept(!session.myAccepted);
    });
    // 내 제안 칸 클릭 → 제안에서 뺌
    this.tradeWindowEl.querySelectorAll<HTMLDivElement>("#trade-my-offer .inv-slot.filled").forEach((slot) => {
      slot.addEventListener("click", () => {
        const idx = Number(slot.dataset.slot);
        const next = session.myOffer.filter((_, i) => i !== idx);
        this.mp.sendTradeOffer(next);
      });
    });
    // 인벤토리 칸 클릭 → 제안에 담기 (이미 담은 아이템이면 그 항목의 수량만 새로 고침)
    this.tradeWindowEl.querySelectorAll<HTMLDivElement>(".trade-inv-grid .inv-slot.filled").forEach((slot) => {
      slot.addEventListener("click", () => {
        if (session.myOffer.length >= MAX_TRADE_SLOTS && !session.myOffer.some((o) => o.id === inv[Number(slot.dataset.invIdx)]?.id)) return;
        const idx = Number(slot.dataset.invIdx);
        const item = inv[idx];
        if (!item) return;
        const already = session.myOffer.some((o) => o.id === item.id);
        const next = already ? session.myOffer : [...session.myOffer, toTradeItem(item, item.quantity)];
        this.mp.sendTradeOffer(next);
      });
      // 드래그로도 담을 수 있게 (실제 인벤토리 → 거래창 드래그 앤 드롭)
      slot.setAttribute("draggable", "true");
      slot.addEventListener("dragstart", (ev) => {
        const idx = Number(slot.dataset.invIdx);
        ev.dataTransfer?.setData("text/plain", String(idx));
      });
    });
    const myOfferGrid = this.tradeWindowEl.querySelector<HTMLDivElement>("#trade-my-offer")!;
    myOfferGrid.addEventListener("dragover", (ev) => ev.preventDefault());
    myOfferGrid.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const idx = Number(ev.dataTransfer?.getData("text/plain"));
      const item = inv[idx];
      if (!item) return;
      if (session.myOffer.some((o) => o.id === item.id)) return;
      if (session.myOffer.length >= MAX_TRADE_SLOTS) return;
      this.mp.sendTradeOffer([...session.myOffer, toTradeItem(item, item.quantity)]);
    });
  }
}
