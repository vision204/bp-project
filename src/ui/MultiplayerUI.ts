import type { GameState } from "../core/GameState";
import type { MultiplayerClient } from "../network/MultiplayerClient";

/**
 * 멀티플레이 접속 패널.
 *
 * 다른 패널(상점·인벤토리 등)과 달리 PanelManager를 쓰지 않는 독립 위젯입니다.
 * 서버 주소를 입력하는 동안에도 캐릭터가 움직일 수 있어야 자연스럽기 때문에
 * (그리고 열려 있다고 게임 입력을 막을 이유가 딱히 없어서) isBlocking() 흐름에
 * 끼워 넣지 않았습니다 — 항해 HUD·섬 가이드 HUD와 같은 결입니다.
 */
export class MultiplayerUI {
  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private connectBtn: HTMLButtonElement;
  private pvpCheckbox: HTMLInputElement;
  private pvpLabel: HTMLLabelElement;
  private urlInput: HTMLInputElement;
  private nameInput: HTMLInputElement;
  private playersEl: HTMLDivElement;
  private open = false;

  constructor(
    container: HTMLElement,
    private readonly mp: MultiplayerClient,
    private readonly state: GameState,
  ) {
    this.root = document.createElement("div");
    this.root.className = "mp-panel";
    this.root.hidden = true;
    const defaultUrl =
      (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_MULTIPLAYER_URL) ||
      "ws://localhost:8787";

    this.root.innerHTML = `
      <div class="mp-header">🌐 멀티플레이 <button class="mp-close" id="mp-close">✕</button></div>
      <div class="mp-status" id="mp-status">연결 안 됨</div>
      <label class="mp-field">서버 주소
        <input type="text" id="mp-url" value="${defaultUrl}" />
      </label>
      <label class="mp-field">이름
        <input type="text" id="mp-name" maxlength="12" value="여행자" />
      </label>
      <button class="mp-connect-btn" id="mp-connect-btn">접속</button>
      <label class="mp-pvp-toggle" id="mp-pvp-label">
        <input type="checkbox" id="mp-pvp-checkbox" disabled />
        <span>⚔️ PvP 켜기 — 다른 진영만 공격 가능</span>
      </label>
      <div class="mp-players" id="mp-players"><div class="mp-player-empty">아직 접속하지 않았습니다</div></div>
      <p class="mp-note">서버는 따로 실행해야 합니다 (README "멀티플레이 · PvP" 참고).
      로컬/같은 네트워크에서 테스트할 때 기본 주소는 <b>ws://localhost:8787</b>입니다.</p>
    `;
    container.appendChild(this.root);

    this.statusEl = this.root.querySelector("#mp-status")!;
    this.connectBtn = this.root.querySelector("#mp-connect-btn")!;
    this.pvpCheckbox = this.root.querySelector("#mp-pvp-checkbox")!;
    this.pvpLabel = this.root.querySelector("#mp-pvp-label")!;
    this.urlInput = this.root.querySelector("#mp-url")!;
    this.nameInput = this.root.querySelector("#mp-name")!;
    this.playersEl = this.root.querySelector("#mp-players")!;

    this.root.querySelector<HTMLButtonElement>("#mp-close")!.addEventListener("click", () => this.hide());
    this.connectBtn.addEventListener("click", () => {
      if (this.mp.connected || this.mp.status === "connecting") {
        this.mp.disconnect();
      } else {
        const url = this.urlInput.value.trim();
        const name = this.nameInput.value.trim() || "여행자";
        if (url) this.mp.connect(url, name);
      }
    });
    this.pvpCheckbox.addEventListener("change", () => {
      this.mp.setPvpEnabled(this.pvpCheckbox.checked);
    });
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }

  show() {
    this.open = true;
    this.root.hidden = false;
    this.render();
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  isOpen() {
    return this.open;
  }

  /** 매 프레임(패널이 열려 있을 때만) 상태를 갱신합니다. */
  update() {
    if (!this.open) return;
    this.render();
  }

  private render() {
    const status = this.mp.status;
    this.statusEl.textContent =
      status === "connected"
        ? `✅ ${this.mp.roomId ?? "방"} — ${this.mp.players.length + 1}명과 함께 플레이 중`
        : status === "connecting"
          ? "⏳ 접속 중…"
          : "⚪ 연결 안 됨";
    this.statusEl.className = `mp-status ${status}`;

    this.connectBtn.textContent = status === "connected" || status === "connecting" ? "연결 해제" : "접속";
    this.connectBtn.classList.toggle("disconnect", status === "connected" || status === "connecting");
    this.urlInput.disabled = status !== "disconnected";
    this.nameInput.disabled = status !== "disconnected";

    this.pvpCheckbox.disabled = status !== "connected";
    this.pvpCheckbox.checked = this.state.player.pvpEnabled;
    this.pvpLabel.classList.toggle("active", this.state.player.pvpEnabled);

    const p = this.state.player;
    const nearby = [...this.mp.players]
      .sort((a, b) => {
        const da = Math.hypot(a.renderX - p.position.x, a.renderZ - p.position.z);
        const db = Math.hypot(b.renderX - p.position.x, b.renderZ - p.position.z);
        return da - db;
      })
      .slice(0, 10);

    if (nearby.length === 0) {
      this.playersEl.innerHTML = `<div class="mp-player-empty">${
        status === "connected" ? "다른 플레이어가 아직 없습니다" : "아직 접속하지 않았습니다"
      }</div>`;
      return;
    }

    this.playersEl.innerHTML = nearby
      .map((r) => {
        const s = r.snapshot;
        const ratio = s.maxHp > 0 ? Math.max(0, s.hp / s.maxHp) : 0;
        const icon = s.faction === "marine" ? "⚓" : "🏴‍☠️";
        const factionClass = s.faction === "marine" ? "mp-faction-marine" : "mp-faction-pirate";
        const pvpTag = s.pvpEnabled ? "⚔️" : "";
        return `
          <div class="mp-player-row">
            <span class="${factionClass}">${icon}</span>
            <span>${escapeHtml(s.name)} Lv.${s.level} ${pvpTag}</span>
            <div class="mp-hp-track"><div class="mp-hp-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
          </div>`;
      })
      .join("");
  }
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
