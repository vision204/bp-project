// ---------------------------------------------------------------------------
// 멀티플레이 서버 — 다른 플레이어 위치 동기화 + PvP 피격 판정.
//
// Netlify는 정적 사이트만 올라가므로(빌드해서 dist를 CDN에 올리는 방식),
// 계속 열려 있어야 하는 WebSocket 서버는 따로 띄워야 합니다. 로컬/LAN에서
// 같이 테스트할 때는 그냥
//
//   npm run server
//
// 로 켜두고, 클라이언트에서 멀티플레이 패널에 그 주소(기본 ws://localhost:8787)를
// 넣고 접속하면 됩니다. 실제로 인터넷 너머 친구와 같이 하려면 이 서버를
// Render/Fly.io/Railway 같은 곳이나 직접 가진 VPS에 올리고, 클라이언트의
// 접속 주소를 그 서버 주소(wss://...)로 바꾸면 됩니다. 자세한 내용과 한계는
// README "멀티플레이 · PvP" 절에 정리했습니다.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { World } from "./state";
import { DEFAULT_MULTIPLAYER_PORT, type ClientMessage } from "../src/network/protocol";

const PORT = Number(process.env.PORT) || DEFAULT_MULTIPLAYER_PORT;

const world = new World();

// 헬스체크용 아주 작은 HTTP 서버 — Render/Fly 같은 호스팅은 대부분
// "HTTP로 살아있는지 확인"을 요구하므로 WebSocket 서버만으로는 부족합니다.
const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    const rooms = world.roomSummary();
    const roomsText = Object.entries(rooms)
      .map(([id, n]) => `${id}:${n}`)
      .join(", ") || "없음";
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`ok — ${world.count()} players (${roomsText})`);
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  // hello 메시지가 오기 전까지는 이름/진영을 모르므로 기본값으로 방에 넣고,
  // hello가 도착하면 handleMessage 안에서 즉시 갱신합니다.
  const conn = world.join(ws, "여행자", "pirate");
  console.log(`[mp] 접속: ${conn.id} → ${conn.roomId} (전체 ${world.count()}명)`);

  ws.on("message", (data) => {
    world.handleMessage(conn, data.toString());
  });

  ws.on("close", () => {
    world.leave(conn.id);
    console.log(`[mp] 퇴장: ${conn.id} (현재 ${world.count()}명)`);
  });

  ws.on("error", () => {
    // 연결이 지저분하게 끊기는 경우 — close 이벤트가 뒤따라 정리를 마저 합니다.
  });
});

// 25초 이상 아무 메시지도 없는 연결(탭이 강제 종료된 경우 등)을 주기적으로 청소합니다.
setInterval(() => world.reapStale(Date.now()), 10_000);

httpServer.listen(PORT, () => {
  console.log(`[mp] 블록스프루츠 멀티플레이 서버 — ws://localhost:${PORT} (헬스체크: /healthz)`);
});

// 타입만 참조해도 tsx가 이 모듈이 실제로 쓰인다는 걸 알 수 있도록 no-op export.
export type { ClientMessage };
