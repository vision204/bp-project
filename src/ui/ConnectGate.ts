import type { MultiplayerClient } from "../network/MultiplayerClient";

// ---------------------------------------------------------------------------
// 빠른/그냥 모드는 무조건 멀티플레이 서버에 붙어야만 게임을 시작합니다
// (사용자 요청 — 개발자 모드는 예외, 그쪽은 여전히 싱글플레이 전용입니다).
//
// index.html의 시작 화면 마크업에 기대지 않고(그 마크업이 없는 환경에서도
// 동작해야 하므로 — MultiplayerUI.ts와 같은 이유) 전부 동적으로 DOM을 만들어
// document.body에 붙였다가, 연결에 성공하는 순간 스스로 지웁니다.
//
// 연결에 실패하면(주소가 잘못됐거나 서버가 꺼져 있음) 자동으로 몇 초 뒤 다시
// 시도하고, 안내 문구도 갱신합니다 — 절대 조용히 싱글플레이로 넘어가지 않습니다.
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 3000;

/** MultiplayerUI.ts와 같은 fallback — VITE_MULTIPLAYER_URL이 없으면 로컬 기본 주소를 씁니다. */
export function defaultMultiplayerUrl(): string {
  const env =
    typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, string> }).env : undefined;
  return env?.VITE_MULTIPLAYER_URL || "ws://localhost:8787";
}

/**
 * 연결될 때까지 화면을 덮는 오버레이를 띄우고 기다립니다. 이 Promise가
 * resolve되기 전까지는 호출부(main.ts)가 게임 루프를 시작하지 않으므로,
 * 사실상 "연결 전에는 절대 플레이할 수 없다"는 게이트 역할을 합니다.
 */
export function connectMultiplayerOrWait(mp: MultiplayerClient, url: string, name: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `
      <style>
        .mp-gate-root {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 16px; background: #0b1420; color: #e8f1ff;
          font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          text-align: center; padding: 24px;
        }
        .mp-gate-spinner {
          width: 42px; height: 42px; border-radius: 50%;
          border: 4px solid rgba(255,255,255,0.15); border-top-color: #4fc3f7;
          animation: mp-gate-spin 0.9s linear infinite;
        }
        @keyframes mp-gate-spin { to { transform: rotate(360deg); } }
        .mp-gate-msg { font-size: 17px; font-weight: 600; }
        .mp-gate-sub { opacity: 0.7; font-size: 13px; }
        .mp-gate-retry {
          margin-top: 4px; padding: 8px 18px; border-radius: 8px; border: none;
          background: #4fc3f7; color: #05202e; font-weight: 700; cursor: pointer;
        }
      </style>
      <div class="mp-gate-root">
        <div class="mp-gate-spinner"></div>
        <div class="mp-gate-msg" id="mp-gate-msg">멀티플레이 서버에 연결하는 중…</div>
        <div class="mp-gate-sub" id="mp-gate-sub">${url}</div>
        <button class="mp-gate-retry" id="mp-gate-retry" hidden>지금 다시 시도</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const msgEl = overlay.querySelector<HTMLDivElement>("#mp-gate-msg")!;
    const subEl = overlay.querySelector<HTMLDivElement>("#mp-gate-sub")!;
    const retryBtn = overlay.querySelector<HTMLButtonElement>("#mp-gate-retry")!;

    let settled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryScheduled = false;
    let pollHandle = 0;

    const cleanup = () => {
      if (retryTimer) clearTimeout(retryTimer);
      cancelAnimationFrame(pollHandle);
      overlay.remove();
    };

    const attempt = () => {
      retryScheduled = false;
      msgEl.textContent = "멀티플레이 서버에 연결하는 중…";
      subEl.textContent = url;
      retryBtn.hidden = true;
      mp.connect(url, name);
    };

    const scheduleRetry = () => {
      if (settled || retryScheduled) return;
      retryScheduled = true;
      msgEl.textContent = "서버에 연결하지 못했습니다 — 잠시 후 다시 시도합니다…";
      subEl.textContent = "멀티플레이 서버가 꺼져 있거나 주소가 올바르지 않을 수 있습니다.";
      retryBtn.hidden = false;
      retryTimer = setTimeout(attempt, RETRY_DELAY_MS);
    };

    retryBtn.addEventListener("click", () => {
      if (retryTimer) clearTimeout(retryTimer);
      attempt();
    });

    const poll = () => {
      if (settled) return;
      if (mp.status === "connected") {
        settled = true;
        cleanup();
        resolve();
        return;
      }
      if (mp.status === "disconnected") scheduleRetry();
      pollHandle = requestAnimationFrame(poll);
    };

    attempt();
    pollHandle = requestAnimationFrame(poll);
  });
}
