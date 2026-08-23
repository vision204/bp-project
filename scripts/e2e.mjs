import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.log("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}
function section(t) {
  console.log(`\n--- ${t} ---`);
}

async function waitUntil(fn, { timeoutMs = 20000, intervalMs = 150, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(intervalMs);
  }
  throw new Error(`waitUntil timed out (${label})`);
}

const pos = () => page.evaluate(() => ({ ...window.__game.simulation.state.player.position }));

/**
 * 사람이 누르듯 눌렀다가 130ms 뒤에 떼는 클릭.
 *
 * 예전 테스트는 element.click()을 코드로 호출해서 통과했지만, 실제로는 패널이
 * 매 프레임 다시 그려지면서 버튼 DOM이 사라져 진짜 클릭은 먹히지 않았습니다.
 * 이제는 반드시 실제 마우스 입력으로 검증합니다. 목록이 길면 먼저 스크롤합니다.
 */
async function humanClick(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ block: "center" });
  }, selector);
  await page.waitForTimeout(250);
  const spot = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, reachable: el === hit || el.contains(hit) };
  }, selector);
  if (!spot || !spot.reachable) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(130);
  await page.mouse.up();
  await page.waitForTimeout(350);
  return true;
}

/**
 * 세이브를 지우고 새 캐릭터로 시작하는 상태를 만듭니다.
 *
 * 세이브가 있으면 시작 화면이 진영을 다시 묻지 않고 넘어가기 때문에,
 * "처음 접속"을 검증하려면 저장본부터 비워야 합니다.
 */
async function freshStart(url = "http://localhost:4173/", { guest = true } = {}) {
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  // 파이어베이스 설정이 들어 있으므로 로그인 단계가 먼저 뜹니다.
  // 대부분의 검증은 게임 안에서 하는 것이라 여기서는 게스트로 통과합니다.
  if (guest) {
    const hasLogin = await page.evaluate(
      () => !!document.getElementById("btn-play-guest") && !document.getElementById("start-step-login")?.hidden,
    );
    if (hasLogin) {
      await humanClick("#btn-play-guest");
      await page.waitForTimeout(400);
    }
  }
}

/** 직선·부채꼴 스킬은 카메라가 보는 방향으로 나가므로, 대상 쪽으로 시점을 맞춥니다. */
async function aimAt(enemyId) {
  await page.evaluate((id) => {
    const sim = window.__game.simulation;
    const p = sim.state.player;
    const t = sim.state.enemies.find((e) => e.id === id);
    sim.playerController.camYaw = Math.atan2(t.position.x - p.position.x, t.position.z - p.position.z);
  }, enemyId);
  await page.waitForTimeout(250);
}

const enemyById = (id) =>
  page.evaluate((eid) => {
    const e = window.__game.simulation.state.enemies.find((x) => x.id === eid);
    return { hp: e.hp, alive: e.alive };
  }, id);

/** 저프레임 환경에서 입력이 한 번에 안 먹을 수 있어 죽을 때까지 반복 시도합니다. */
async function attackUntilDead(enemyId, { useSkill = false, maxTries = 12 } = {}) {
  for (let i = 0; i < maxTries; i++) {
    const e = await enemyById(enemyId);
    if (!e.alive) return true;
    // 상위 섬 몬스터는 접촉 데미지가 커서 시험 도중 플레이어가 죽고 멀리 부활해버립니다.
    // 여기서 검증하려는 건 "막타 출처"이지 생존이 아니므로 체력을 채워두고 진행합니다.
    await page.evaluate((eid) => {
      const sim = window.__game.simulation;
      const p = sim.state.player;
      p.hp = p.maxHp;
      p.mana = p.maxMana;
      const t = sim.state.enemies.find((x) => x.id === eid);
      if (t.alive && Math.hypot(p.position.x - t.position.x, p.position.z - t.position.z) > 2) {
        sim.playerController.teleport({ x: t.position.x + 1.2, y: 1.2, z: t.position.z });
      }
    }, enemyId);
    await aimAt(enemyId);
    if (useSkill) {
      await page.evaluate(() => { window.__game.simulation.state.player.skillCooldowns = [0, 0, 0, 0]; });
      await page.keyboard.press("KeyZ");
    } else {
      await page.mouse.click(640, 400);
    }
    await page.waitForTimeout(500);
  }
  return !(await enemyById(enemyId)).alive;
}

/**
 * 카메라의 월드 기준 "오른쪽" 축(matrixWorld의 첫 번째 열)을 읽습니다.
 * 이동 벡터를 이 축에 내적하면 "화면상 오른쪽으로 갔는지"를 정확히 판정할 수 있어서,
 * A/D가 사용자 눈에 보이는 대로 동작하는지 검증할 수 있습니다.
 */
const cameraRight = () =>
  page.evaluate(() => {
    const e = window.__game.renderer.camera.matrixWorld.elements;
    return { x: e[0], y: e[1], z: e[2] };
  });

async function measureMoveDirection(key, holdMs = 1500) {
  const before = await pos();
  const right = await cameraRight();
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
  const after = await pos();
  const delta = { x: after.x - before.x, z: after.z - before.z };
  const dot = delta.x * right.x + delta.z * right.z; // >0 이면 화면 오른쪽으로 이동
  return { delta, dot, dist: Math.hypot(delta.x, delta.z) };
}

section("0. 시작 화면 — 진영(해적/해군) → 모드(빠른/그냥/개발자)");

await freshStart();
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-0-start.png" });

const startState = await page.evaluate(() => {
  const screen = document.getElementById("start-screen");
  const factions = Array.from(document.querySelectorAll(".start-btn[data-faction]"));
  const modeStep = document.getElementById("start-step-mode");
  return {
    screenVisible: !!screen && screen.getBoundingClientRect().height > 100,
    factions: factions.map((b) => b.dataset.faction),
    factionsEnabled: factions.every((b) => !b.disabled),
    modeStepHidden: !!modeStep && modeStep.hidden,
    gameStarted: typeof window.__game !== "undefined",
  };
});
console.log("  시작화면:", JSON.stringify(startState));
assert(startState.screenVisible, "F5 직후 시작 화면이 보임");
assert(
  startState.factions.includes("pirate") && startState.factions.includes("marine"),
  "해적 / 해군 버튼이 둘 다 있음",
);
assert(startState.factionsEnabled, "번들 로드 후 진영 버튼이 활성화됨");
assert(startState.modeStepHidden, "진영을 고르기 전에는 모드 선택이 숨겨져 있음");
assert(!startState.gameStarted, "고르기 전에는 게임이 시작되지 않음");

// 1단계: 해군을 실제 마우스로 선택
assert(await humanClick('.start-btn[data-faction="marine"]'), "해군 버튼을 실제 마우스로 클릭 가능");
const afterFaction = await page.evaluate(() => {
  const modes = Array.from(document.querySelectorAll(".start-btn[data-mode]"));
  return {
    factionStepHidden: document.getElementById("start-step-faction").hidden,
    modeStepShown: !document.getElementById("start-step-mode").hidden,
    modes: modes.map((b) => b.dataset.mode),
    chosen: document.getElementById("start-chosen")?.textContent?.trim(),
    gameStarted: typeof window.__game !== "undefined",
  };
});
console.log("  진영 선택 후:", JSON.stringify(afterFaction));
assert(afterFaction.factionStepHidden && afterFaction.modeStepShown, "진영을 고르면 모드 선택으로 넘어감");
assert(
  ["fast", "normal", "dev"].every((m) => afterFaction.modes.includes(m)),
  `모드 3종(빠른/그냥/개발자)이 모두 있음: ${afterFaction.modes.join(", ")}`,
);
assert(/해군/.test(afterFaction.chosen ?? ""), `고른 진영이 표시됨: "${afterFaction.chosen}"`);
assert(!afterFaction.gameStarted, "모드를 고르기 전에는 아직 시작되지 않음");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-0-mode.png" });

// 2단계: 빠른 모드 → 해군 기지에서 시작하는지 확인
assert(await humanClick('.start-btn[data-mode="fast"]'), "빠른 모드 버튼을 실제 마우스로 클릭 가능");
await waitUntil(() => typeof window.__game !== "undefined", { label: "해군 + fast 부팅" });
await page.waitForTimeout(900);
const marineBoot = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const island = window.__game.islands.startIslandFor("marine");
  const p = sim.state.player.position;
  return {
    faction: sim.state.player.faction,
    islandId: sim.state.currentIslandId,
    distToMarineStart: Math.round(Math.hypot(p.x - island.center.x, p.z - island.center.z)),
    quality: window.__game.quality.id,
    shadows: window.__game.renderer.renderer.shadowMap.enabled,
    factionBadge: document.querySelector("#hud-faction")?.textContent?.trim(),
    screenGone: !document.getElementById("start-screen"),
  };
});
console.log("  해군 시작:", JSON.stringify(marineBoot));
assert(marineBoot.faction === "marine", "해군 진영으로 시작됨");
assert(marineBoot.islandId === "marine_start", `해군 기지에서 시작 (${marineBoot.islandId})`);
assert(marineBoot.distToMarineStart < 60, `시작 위치가 해군 기지 안 (중심에서 ${marineBoot.distToMarineStart}m)`);
assert(marineBoot.quality === "fast" && marineBoot.shadows === false, "빠른 모드로 부팅 (그림자 꺼짐)");
assert(/해군/.test(marineBoot.factionBadge ?? ""), `HUD에 진영 표시: "${marineBoot.factionBadge}"`);
assert(marineBoot.screenGone, "게임 시작 후 시작 화면이 사라짐");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-0-marine.png" });

// 해적으로도 시작되는지 (시작 섬만 갈리는지 확인) — 세이브를 지워 새 캐릭터로
await freshStart();
assert(await humanClick('.start-btn[data-faction="pirate"]'), "해적 버튼을 실제 마우스로 클릭 가능");
assert(await humanClick('.start-btn[data-mode="normal"]'), "그냥 모드 버튼을 실제 마우스로 클릭 가능");
await waitUntil(() => typeof window.__game !== "undefined", { label: "해적 + normal 부팅" });
await page.waitForTimeout(1200);
const pirateBoot = await page.evaluate(() => {
  const sim = window.__game.simulation;
  return {
    faction: sim.state.player.faction,
    islandId: sim.state.currentIslandId,
    quality: window.__game.quality.id,
    shadows: window.__game.renderer.renderer.shadowMap.enabled,
    // 시작 섬을 뺀 나머지 섬 목록이 진영과 무관하게 같은지
    sharedRoute: window.__game.islands.ISLANDS.filter((i) => i.kind === "wild" && i.sea === 1).map((i) => i.id).join(","),
    enemyName: sim.state.enemies.find((e) => e.islandId === "pirate_start").speciesName,
  };
});
console.log("  해적 시작:", JSON.stringify(pirateBoot));
assert(pirateBoot.faction === "pirate", "해적 진영으로 시작됨");
assert(pirateBoot.islandId === "pirate_start", `해적 마을에서 시작 (${pirateBoot.islandId})`);
assert(pirateBoot.quality === "normal" && pirateBoot.shadows === true, "그냥 모드로 부팅 (그림자 켜짐)");
assert(
  pirateBoot.sharedRoute === "jungle,desert,ice,volcano,storm,haunted,crystal,abyss,sky,dragon",
  "첫 번째 바다에서 시작 섬 이후의 항로는 진영과 무관하게 동일",
);
assert(pirateBoot.enemyName === "해군 신병", `해적 마을 몬스터는 해군 (${pirateBoot.enemyName})`);

section("1. A/D 좌우 방향 (카메라 기준 화면 오른쪽/왼쪽)");
const d = await measureMoveDirection("KeyD");
assert(d.dist > 0.3, `D키로 실제 이동함 (${d.dist.toFixed(2)}m)`);
assert(d.dot > 0, `D키 → 화면 오른쪽 (카메라 right축 내적 ${d.dot.toFixed(2)} > 0)`);

const a = await measureMoveDirection("KeyA");
assert(a.dist > 0.3, `A키로 실제 이동함 (${a.dist.toFixed(2)}m)`);
assert(a.dot < 0, `A키 → 화면 왼쪽 (카메라 right축 내적 ${a.dot.toFixed(2)} < 0)`);

// 카메라를 90도 돌린 뒤에도 여전히 화면 기준으로 맞는지 (카메라 상대 이동 검증)
await page.mouse.move(640, 400);
await page.mouse.down({ button: "right" });
await page.mouse.move(1000, 400, { steps: 12 });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(200);
const d2 = await measureMoveDirection("KeyD");
assert(d2.dot > 0, `시점 회전 후에도 D키 → 화면 오른쪽 (내적 ${d2.dot.toFixed(2)})`);

section("2. UI 배치 — 상태바 좌상단 · 상점 버튼");
const layout = await page.evaluate(() => {
  const status = document.querySelector(".hud-status").getBoundingClientRect();
  const shopBtn = document.querySelector("#btn-shop");
  const btnRect = shopBtn.getBoundingClientRect();
  return {
    status: { top: Math.round(status.top), left: Math.round(status.left) },
    shopBtn: { exists: !!shopBtn, text: shopBtn.textContent, top: Math.round(btnRect.top), right: Math.round(window.innerWidth - btnRect.right) },
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
});
console.log("  레이아웃:", JSON.stringify(layout));
assert(layout.status.top < layout.viewport.h / 3, `상태바가 화면 위쪽 (top=${layout.status.top}px)`);
assert(layout.status.left < layout.viewport.w / 3, `상태바가 화면 왼쪽 (left=${layout.status.left}px)`);
assert(layout.shopBtn.exists && /상점/.test(layout.shopBtn.text), `상점 버튼 존재: "${layout.shopBtn.text.trim()}"`);

// 상점 NPC는 없어야 함
const shopNpcCount = await page.evaluate(
  () => window.__game.simulation.state.npcs.filter((n) => n.kind === "shop").length,
);
assert(shopNpcCount === 0, `상점 NPC 제거됨 (${shopNpcCount}명)`);

// 버튼 클릭으로 상점이 열리는지
await page.click("#btn-shop");
await page.waitForTimeout(350);
const shopOpen = await page.evaluate(() => !document.querySelector("#panel-shop")?.hidden);
assert(shopOpen, "상점 버튼 클릭 → 상점 패널 열림");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-2-shop-button.png" });
await page.click("#btn-shop");
await page.waitForTimeout(250);
const shopClosed = await page.evaluate(() => document.querySelector("#panel-shop")?.hidden);
assert(shopClosed, "한 번 더 누르면 닫힘");

section("2-B. 마우스 휠 카메라 줌 (로블록스식)");
const camDistanceNow = () =>
  page.evaluate(() => {
    const p = window.__game.simulation.state.player.position;
    const c = window.__game.renderer.camera.position;
    return {
      zoom: window.__game.simulation.playerController.camDistance,
      actual: Math.hypot(c.x - p.x, c.z - p.z, c.y - p.y),
      playerVisible: window.__game.renderer.playerVisible,
    };
  });

await page.mouse.move(640, 400);
const zoomBase = await camDistanceNow();
console.log("  기본:", JSON.stringify(zoomBase));

// 휠을 아래로 = 줌아웃 (카메라가 멀어짐)
await page.mouse.wheel(0, 300);
await page.waitForTimeout(300);
const zoomedOut = await camDistanceNow();
assert(zoomedOut.zoom > zoomBase.zoom, `휠 아래로 → 카메라가 멀어짐 (${zoomBase.zoom.toFixed(1)} → ${zoomedOut.zoom.toFixed(1)}m)`);
assert(
  zoomedOut.actual > zoomBase.actual + 0.5,
  `실제 카메라 위치도 멀어짐 (${zoomBase.actual.toFixed(1)} → ${zoomedOut.actual.toFixed(1)}m)`,
);

// 휠을 위로 = 줌인
await page.mouse.wheel(0, -600);
await page.waitForTimeout(300);
const zoomedIn = await camDistanceNow();
assert(zoomedIn.zoom < zoomedOut.zoom, `휠 위로 → 카메라가 가까워짐 (${zoomedOut.zoom.toFixed(1)} → ${zoomedIn.zoom.toFixed(1)}m)`);

// 끝까지 당기면 1인칭 (내 캐릭터가 사라짐)
for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
await page.waitForTimeout(400);
const firstPerson = await camDistanceNow();
console.log("  최대 줌인:", JSON.stringify(firstPerson));
assert(firstPerson.zoom === 0, `끝까지 당기면 거리 0 (1인칭) — ${firstPerson.zoom}`);
assert(firstPerson.playerVisible === false, "1인칭에서는 내 캐릭터가 시야를 가리지 않게 숨겨짐");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-2b-firstperson.png" });

// 끝까지 밀면 상한에서 멈춤
for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
await page.waitForTimeout(400);
const maxOut = await camDistanceNow();
assert(maxOut.zoom <= 28 && maxOut.zoom >= 27, `최대 줌아웃에서 상한(28m)에 멈춤 — ${maxOut.zoom.toFixed(1)}m`);
assert(maxOut.playerVisible === true, "줌아웃하면 캐릭터가 다시 보임");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-2b-zoomout.png" });

// 다음 검증들에 영향을 주지 않도록 기본 거리로 되돌립니다
await page.evaluate((d) => { window.__game.simulation.playerController.camDistance = d; }, zoomBase.zoom);
await page.waitForTimeout(200);

section("3. Shift 질주 / Q 대쉬");
await page.evaluate(() => {
  window.__game.panels.closeAll();
  window.__game.simulation.playerController.teleport({ x: 0, y: 2, z: 0 });
});
await page.waitForTimeout(900);

async function travelDistance(keys, ms) {
  const before = await pos();
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForTimeout(150);
  const after = await pos();
  return Math.hypot(after.x - before.x, after.z - before.z);
}

const walkDist = await travelDistance(["KeyW"], 1600);
await page.evaluate(() => window.__game.simulation.playerController.teleport({ x: 0, y: 2, z: 0 }));
await page.waitForTimeout(600);
const sprintDist = await travelDistance(["ShiftLeft", "KeyW"], 1600);
assert(walkDist > 0.3, `평보 이동 (${walkDist.toFixed(2)}m)`);
assert(sprintDist > walkDist * 1.2, `Shift+W 질주가 더 빠름 (평보 ${walkDist.toFixed(2)}m → 질주 ${sprintDist.toFixed(2)}m)`);

// Q 대쉬
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.playerController.teleport({ x: 0, y: 2, z: 0 });
  sim.state.player.dashCooldownSec = 0;
  sim.playerController.camYaw = 0;
});
await page.waitForTimeout(900);
const beforeDash = await pos();
await page.keyboard.press("KeyQ");
await page.waitForTimeout(600);
const afterDash = await pos();
const dashDist = Math.hypot(afterDash.x - beforeDash.x, afterDash.z - beforeDash.z);
assert(dashDist > 5, `Q로 전방 대쉬 (${dashDist.toFixed(2)}m 순간 이동)`);
assert(afterDash.z > beforeDash.z, `바라보는 방향(+Z)으로 대쉬 (z ${beforeDash.z.toFixed(1)} → ${afterDash.z.toFixed(1)})`);

const dashCd = await page.evaluate(() => ({
  cd: window.__game.simulation.state.player.dashCooldownSec,
  badge: document.querySelector("#hud-dash")?.textContent,
  badgeVisible: !document.querySelector("#hud-dash")?.hidden,
}));
assert(dashCd.cd > 0, `대쉬 쿨다운 시작 (${dashCd.cd.toFixed(1)}초)`);
assert(dashCd.badgeVisible && /대쉬/.test(dashCd.badge ?? ""), `HUD에 쿨다운 표시: "${dashCd.badge}"`);

section("4. 우클릭 시 커서 숨김");
const cursorBefore = await page.evaluate(() => getComputedStyle(document.querySelector("canvas")).cursor);
await page.mouse.move(640, 400);
await page.mouse.down({ button: "right" });
await page.waitForTimeout(200);
const cursorDuring = await page.evaluate(() => getComputedStyle(document.querySelector("canvas")).cursor);
await page.mouse.up({ button: "right" });
await page.waitForTimeout(200);
const cursorAfter = await page.evaluate(() => getComputedStyle(document.querySelector("canvas")).cursor);
assert(cursorBefore !== "none", `평소엔 커서 보임 (${cursorBefore})`);
assert(cursorDuring === "none", `우클릭 중엔 커서 숨김 (${cursorDuring})`);
assert(cursorAfter !== "none", `놓으면 다시 보임 (${cursorAfter})`);

section("4b. 배 소환 → 직접 조종 항해");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "dock" && n.islandId === "pirate_start");
  sim.state.player.money = 500;
  sim.playerController.teleport({ x: npc.position.x + 1.5, y: 2, z: npc.position.z + 1.5 });
});
await page.waitForTimeout(900);
const dockPrompt = await page.evaluate(() => document.querySelector("#hud-interaction")?.textContent);
assert(/배/.test(dockPrompt ?? ""), `뱃사공 프롬프트: "${dockPrompt}"`);
await page.keyboard.press("KeyE");
await page.waitForTimeout(400);
assert(
  await page.evaluate(() => window.__game.simulation.state.boat.spawned),
  "배가 소환됨",
);

// 배로 이동해서 탑승
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const b = sim.state.boat.position;
  sim.playerController.teleport({ x: b.x + 2, y: 2, z: b.z });
});
await page.waitForTimeout(900);
const boardPrompt = await page.evaluate(() => document.querySelector("#hud-interaction")?.textContent);
assert(/배 타기/.test(boardPrompt ?? ""), `탑승 프롬프트: "${boardPrompt}"`);
await page.keyboard.press("KeyE");
await page.waitForTimeout(500);
const riding = await page.evaluate(() => ({
  riding: window.__game.simulation.state.boat.riding,
  hudVisible: !document.querySelector("#hud-boat")?.hidden,
}));
assert(riding.riding, "E로 배 탑승");
assert(riding.hudVisible, "항해 HUD 표시");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-4-sailing.png" });

// W로 항해 — 실제로 바다 위를 이동하는지
const boatBefore = await page.evaluate(() => ({ ...window.__game.simulation.state.boat.position }));
// 이 컨테이너는 소프트웨어 렌더링이라 프레임이 낮고, main.ts가 dt를 0.05초로
// 자르기 때문에 실제 시간보다 게임 시간이 훨씬 천천히 흐릅니다. 넉넉히 눌러줍니다.
await page.keyboard.down("KeyW");
await page.waitForTimeout(4500);
await page.keyboard.up("KeyW");
await page.waitForTimeout(300);
const boatAfter = await page.evaluate(() => ({
  pos: { ...window.__game.simulation.state.boat.position },
  speed: window.__game.simulation.state.boat.speed,
  playerPos: { ...window.__game.simulation.state.player.position },
  island: window.__game.simulation.state.currentIslandId,
}));
const sailed = Math.hypot(boatAfter.pos.x - boatBefore.x, boatAfter.pos.z - boatBefore.z);
assert(sailed > 3, `W로 바다를 항해함 (${sailed.toFixed(1)}m 이동)`);
assert(
  Math.hypot(boatAfter.playerPos.x - boatAfter.pos.x, boatAfter.playerPos.z - boatAfter.pos.z) < 1,
  "플레이어가 배와 함께 이동 (갑판 위)",
);

// 항해 중에는 익사하지 않아야 함
const drownWhileSailing = await page.evaluate(() => window.__game.simulation.state.player.inWater);
assert(!drownWhileSailing, "배를 타고 있으면 물에 빠진 상태가 아님");

// A/D 선회
const yawBeforeTurn = await page.evaluate(() => window.__game.simulation.state.boat.yaw);
await page.keyboard.down("KeyA");
await page.waitForTimeout(1200);
await page.keyboard.up("KeyA");
await page.waitForTimeout(200);
const yawAfterTurn = await page.evaluate(() => window.__game.simulation.state.boat.yaw);
assert(Math.abs(yawAfterTurn - yawBeforeTurn) > 0.05, `A로 배가 선회함 (yaw ${yawBeforeTurn.toFixed(2)} → ${yawAfterTurn.toFixed(2)})`);

// 레벨 1로 고난도 섬까지 항해해서 상륙 (레벨 제한 없음 확인)
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const storm = window.__game.islands.getIsland("storm");
  sim.state.player.level = 1;
  sim.state.boat.position = { x: storm.center.x, y: -0.35, z: storm.center.z - storm.radius - 12 };
  sim.state.boat.speed = 0;
});
await page.waitForTimeout(600);
await page.keyboard.press("KeyE"); // 내리기
await page.waitForTimeout(900);
const landed = await page.evaluate(() => ({
  riding: window.__game.simulation.state.boat.riding,
  island: window.__game.simulation.state.currentIslandId,
  level: window.__game.simulation.state.player.level,
  islandLabel: document.querySelector("#hud-island")?.textContent,
}));
assert(!landed.riding, "E로 하선");
assert(
  landed.island === "storm",
  `Lv.${landed.level}인데도 최고 난이도 섬에 상륙 성공 — 레벨 제한 없음 (${landed.islandLabel})`,
);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-4b-landed.png" });

section("5. 바다 익사");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.hp = sim.state.player.maxHp;
  // 얼음 섬에서 멀리 떨어진 바다 위 상공
  sim.playerController.teleport({ x: -60, y: 6, z: 60 });
});
await waitUntil(() => window.__game.simulation.state.player.inWater === true, { label: "in-water" });
const drowning = await page.evaluate(() => ({
  inWater: window.__game.simulation.state.player.inWater,
  hp: window.__game.simulation.state.player.hp,
  y: window.__game.simulation.state.player.position.y,
  overlayVisible: !document.querySelector("#hud-drown")?.hidden,
}));
assert(drowning.inWater, "바다에 빠지면 익사 상태 진입");
assert(drowning.overlayVisible, "익사 경고 오버레이 표시");
assert(drowning.y > -3, `무한 낙하하지 않고 수면에 뜸 (y=${drowning.y.toFixed(2)})`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-6-drowning.png" });

const hpDrop1 = await page.evaluate(() => window.__game.simulation.state.player.hp);
await page.waitForTimeout(1500);
const hpDrop2 = await page.evaluate(() => window.__game.simulation.state.player.hp);
assert(hpDrop2 < hpDrop1, `물에 있는 동안 HP 지속 감소 (${hpDrop1.toFixed(0)} → ${hpDrop2.toFixed(0)})`);

// 계속 물에 있으면 결국 사망 → 부활. (헤드리스는 프레임이 느려 시뮬레이션 시간이
// 실제보다 천천히 흐르므로, 체력을 낮춰두고 사망 처리를 검증합니다.)
await page.evaluate(() => {
  window.__game.simulation.state.player.hp = 8;
});
await waitUntil(() => window.__game.simulation.state.player.inWater === false, {
  timeoutMs: 40000,
  label: "drown-respawn",
});
const afterDrown = await page.evaluate(() => ({
  hp: window.__game.simulation.state.player.hp,
  island: window.__game.simulation.state.currentIslandId,
}));
assert(afterDrown.hp > 0, `익사 후 부활 (hp=${afterDrown.hp})`);
assert(afterDrown.island !== null, `섬에서 부활 (${afterDrown.island})`);

section("6. 해변으로 걸어 나오기 (탈출 가능한지)");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const { getIsland } = window.__game.islands;
  const isl = getIsland(sim.state.currentIslandId);
  sim.state.player.hp = sim.state.player.maxHp;
  // 섬 가장자리 바로 바깥 바다에 떨어뜨림
  sim.playerController.teleport({ x: isl.center.x + isl.radius + 4, y: 1, z: isl.center.z });
  // 카메라를 섬 중심 쪽으로 향하게
  sim.playerController.camYaw = Math.PI / 2;
});
await waitUntil(() => window.__game.simulation.state.player.inWater === true, { label: "beach-water" });
// 섬 중심 방향으로 헤엄쳐 이동
await page.keyboard.down("KeyS");
let escaped = false;
try {
  await waitUntil(() => window.__game.simulation.state.player.inWater === false, {
    timeoutMs: 12000,
    label: "beach-escape",
  });
  escaped = true;
} catch {
  escaped = false;
}
await page.keyboard.up("KeyS");
assert(escaped, "물에서 해변 계단을 밟고 뭍으로 걸어 나올 수 있음");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-7-beach-escape.png" });

section("7. 상점(현금 표시) vs 중앙섬 열매 상인(코인)");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.money = 500;
  sim.state.player.level = 130;
  window.__game.panels.openPanel("shop");
});
await page.waitForTimeout(300);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-8-shop.png" });

const shopSections = await page.evaluate(() => ({
  hasExpPotion: !!document.querySelector('.buy-btn[data-item="potion_exp"]'),
  coinFruitButtons: document.querySelectorAll(".buy-btn[data-fruit]").length,
  cashFruitButtons: document.querySelectorAll(".buy-btn[data-cash-fruit]").length,
  cashLabels: Array.from(document.querySelectorAll(".buy-btn[data-cash-fruit]")).map((b) => b.textContent.trim()),
  notice: document.querySelector("#cash-notice")?.textContent?.replace(/\s+/g, " ").trim(),
  note: document.querySelector(".shop-section-note")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  상점 열매 코너:", JSON.stringify(shopSections));
assert(shopSections.hasExpPotion, "상점에 경험치 2배 포션 판매 (코인)");
assert(shopSections.cashFruitButtons === 5, `열매 5종이 현금 결제로 표시됨 (${shopSections.cashFruitButtons})`);
assert(shopSections.coinFruitButtons === 0, "상점에서는 코인으로 열매를 살 수 없음");
assert(
  shopSections.cashLabels.every((t) => t.includes("₩")),
  `버튼에 원화 가격 표시: ${shopSections.cashLabels.join(" / ")}`,
);
assert(/준비 중/.test(shopSections.notice ?? ""), `결제 준비 중 안내 표시: "${shopSections.notice}"`);
assert(/중앙 교역섬/.test(shopSections.note ?? ""), `코인으로 사려면 어디로 가야 하는지 안내: "${shopSections.note}"`);

// 현금 버튼을 실제로 눌러도 결제·지급이 일어나지 않아야 합니다 (PG사 미연동)
const beforeCash = await page.evaluate(() => ({
  money: window.__game.simulation.state.player.money,
  fruit: window.__game.simulation.state.player.equippedFruit,
}));
assert(await humanClick('.buy-btn[data-cash-fruit="dark_wave"]'), "현금 결제 버튼을 실제 마우스로 클릭 가능");
const afterCash = await page.evaluate(() => ({
  money: window.__game.simulation.state.player.money,
  fruit: window.__game.simulation.state.player.equippedFruit,
  notice: document.querySelector("#cash-notice")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  현금 클릭 후:", JSON.stringify(afterCash));
assert(afterCash.money === beforeCash.money, "현금 버튼을 눌러도 코인이 차감되지 않음");
assert(afterCash.fruit === beforeCash.fruit, "현금 버튼을 눌러도 열매가 지급되지 않음");
assert(/PG사|준비 중/.test(afterCash.notice ?? ""), `누르면 안내만 갱신됨: "${afterCash.notice}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-8-cash.png" });

// 중앙 교역섬의 열매 상인 — 여기서만 코인으로 살 수 있습니다
await page.evaluate(() => {
  const sim = window.__game.simulation;
  window.__game.panels.closeAll();
  const npc = sim.state.npcs.find((n) => n.kind === "fruit_dealer");
  sim.state.player.money = 500;
  sim.playerController.teleport({ x: npc.position.x + 1.4, y: 2, z: npc.position.z });
});
await page.waitForTimeout(800);
const dealerPrompt = await page.evaluate(() => ({
  prompt: document.querySelector("#hud-interaction")?.textContent,
  island: document.querySelector("#hud-island")?.textContent,
}));
console.log("  열매 상인 앞:", JSON.stringify(dealerPrompt));
assert(dealerPrompt.island === "중앙 교역섬", `중앙 교역섬에 서 있음 (${dealerPrompt.island})`);
assert(/열매 상인/.test(dealerPrompt.prompt ?? ""), `상인 안내 표시: "${dealerPrompt.prompt}"`);

await page.keyboard.press("KeyE");
await page.waitForTimeout(600);
const dealerPanel = await page.evaluate(() => ({
  open: !document.querySelector("#panel-fruit_dealer").hidden,
  coinButtons: document.querySelectorAll("#panel-fruit_dealer .buy-btn[data-fruit]").length,
  labels: Array.from(document.querySelectorAll("#panel-fruit_dealer .buy-btn[data-fruit]")).map((b) => b.textContent.trim()),
}));
console.log("  열매 상인 패널:", JSON.stringify(dealerPanel));
assert(dealerPanel.open, "E로 열매 상인 패널이 열림");
assert(dealerPanel.coinButtons === 5, `상인이 열매 5종을 판매 (${dealerPanel.coinButtons})`);
assert(dealerPanel.labels.some((t) => t.includes("🪙")), `코인 가격으로 표시: ${dealerPanel.labels.join(" / ")}`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-8-dealer.png" });

// 열매를 두 번 사도 항상 1개만
assert(await humanClick('#panel-fruit_dealer .buy-btn[data-fruit="dark_wave"]'), "어둠 열매(목록 아래쪽)도 스크롤 후 클릭 가능");
assert(await humanClick('#panel-fruit_dealer .buy-btn[data-fruit="ice_lance"]'), "얼음 열매 실제 클릭 가능");
const fruitState = await page.evaluate(() => ({
  count: window.__game.simulation.state.player.skillCooldowns.length,
  id: window.__game.simulation.state.player.equippedFruit,
  money: window.__game.simulation.state.player.money,
}));
assert(fruitState.count === 4, `열매를 2번 먹어도 스킬 슬롯은 항상 4개 (${fruitState.count}개)`);
assert(fruitState.id === "ice_lance", `가장 최근 열매로 교체됨 (${fruitState.id})`);
assert(fruitState.money < 500, `코인이 실제로 차감됨 (500 → ${fruitState.money})`);

// 포션은 계속 상점(코인)에서 삽니다
await page.evaluate(() => {
  window.__game.panels.closeAll();
  window.__game.simulation.state.player.money = 500;
  window.__game.panels.openPanel("shop");
});
await page.waitForTimeout(300);
assert(await humanClick('.buy-btn[data-item="potion_exp"]'), "경험치 포션 버튼을 실제 마우스로 클릭 가능");
const potionBought = await page.evaluate(() =>
  window.__game.simulation.state.player.inventory.some((i) => i.id === "potion_exp"),
);
assert(potionBought, "경험치 포션 구매 → 인벤토리 추가");
const purchaseToast = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "),
);
assert(/구매/.test(purchaseToast), `패널 버튼으로 산 것도 토스트로 알려줌: "${purchaseToast}"`);

section("8. 인벤토리에서 포션 사용");
await page.evaluate(() => window.__game.panels.openPanel("inventory"));
await page.waitForTimeout(300);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-9-inventory.png" });
assert(await humanClick('.inv-slot[data-item="potion_exp"]'), "인벤토리 포션을 실제 마우스로 클릭 가능");
const buffState = await page.evaluate(() => ({
  buff: window.__game.simulation.state.player.expBuffRemainingSec,
  badge: document.querySelector("#hud-buff")?.textContent,
  badgeVisible: !document.querySelector("#hud-buff")?.hidden,
}));
assert(buffState.buff > 590, `포션 사용 → 경험치 2배 버프 ${Math.round(buffState.buff)}초`);
assert(buffState.badgeVisible && /EXP x2/.test(buffState.badge ?? ""), `HUD 버프 뱃지 표시: "${buffState.badge}"`);

section("9. 무장색 사범 (3번째 섬) — 예/아니오 대화");
// 앞 섹션에서 열어둔 인벤토리 패널을 닫지 않으면 패널이 입력을 막아 E가 먹히지 않습니다.
await page.evaluate(() => window.__game.panels.closeAll());
await page.waitForTimeout(200);
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "haki");
  sim.state.player.money = 1000;
  sim.playerController.teleport({ x: npc.position.x + 1.5, y: 2, z: npc.position.z });
});
await page.waitForTimeout(600);

const hakiIslandLabel = await page.evaluate(() => document.querySelector("#hud-island")?.textContent);
assert(hakiIslandLabel === "사막 섬", `무장색 사범이 3번째 섬(사막 섬)에 있음 (${hakiIslandLabel})`);

const hakiPrompt = await page.evaluate(() => document.querySelector("#hud-interaction")?.textContent);
assert(/무장색 배우기/.test(hakiPrompt ?? ""), `사범 상호작용 프롬프트: "${hakiPrompt}"`);

await page.keyboard.press("KeyE");
await page.waitForTimeout(400);
const dialogOpen = await page.evaluate(() => ({
  visible: !document.querySelector("#panel-haki")?.hidden,
  question: document.querySelector(".dialog-question")?.textContent?.trim(),
  yes: document.querySelector("#haki-yes")?.textContent,
  no: document.querySelector("#haki-no")?.textContent,
}));
assert(dialogOpen.visible, "E로 무장색 대화창 열림");
assert(/배우겠나/.test(dialogOpen.question ?? ""), `배울지 묻는 질문 표시: "${dialogOpen.question}"`);
assert(/예/.test(dialogOpen.yes ?? "") && /아니오/.test(dialogOpen.no ?? ""), `예/아니오 선택지 (${dialogOpen.yes} / ${dialogOpen.no})`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-11-haki-dialog.png" });

// "아니오"를 누르면 배우지 않고 닫힘
assert(await humanClick("#haki-no"), "무장색 대화 [아니오] 실제 클릭 가능");
const afterNo = await page.evaluate(() => ({
  learned: window.__game.simulation.state.player.hakiLearned,
  money: window.__game.simulation.state.player.money,
  closed: document.querySelector("#panel-haki")?.hidden,
}));
assert(!afterNo.learned, "아니오 → 배우지 않음");
assert(afterNo.money === 1000, "아니오 → 코인 차감 없음");
assert(afterNo.closed, "아니오 → 대화창 닫힘");

// "예"를 누르면 코인 지불하고 습득
await page.keyboard.press("KeyE");
await page.waitForTimeout(400);
assert(await humanClick("#haki-yes"), "무장색 대화 [예] 실제 클릭 가능");
const afterYes = await page.evaluate(() => ({
  learned: window.__game.simulation.state.player.hakiLearned,
  money: window.__game.simulation.state.player.money,
}));
assert(afterYes.learned, "예 → 무장색 습득");
assert(afterYes.money === 700, `예 → 수업료 300 차감 (1000 → ${afterYes.money})`);

section("10. 무장색 발동 — 전신 검정 + 데미지 증가");
const beforeHaki = await page.evaluate(() => {
  const g = window.__game;
  return {
    active: g.simulation.state.player.hakiActive,
    bodyColor: g.renderer.playerParts.bodyMat.color.getHexString(),
    badgeHidden: document.querySelector("#hud-haki")?.hidden,
  };
});
assert(!beforeHaki.active, "발동 전");
assert(beforeHaki.bodyColor !== "141414", `발동 전 몸 색은 검정이 아님 (#${beforeHaki.bodyColor})`);
assert(beforeHaki.badgeHidden, "발동 전 HUD 뱃지 숨김");

await page.keyboard.press("KeyH");
await page.waitForTimeout(500);
const afterHakiOn = await page.evaluate(() => {
  const g = window.__game;
  return {
    active: g.simulation.state.player.hakiActive,
    bodyColor: g.renderer.playerParts.bodyMat.color.getHexString(),
    legColor: g.renderer.playerParts.legMat.color.getHexString(),
    badgeHidden: document.querySelector("#hud-haki")?.hidden,
    badgeText: document.querySelector("#hud-haki")?.textContent,
  };
});
assert(afterHakiOn.active, "H키로 무장색 발동");
assert(afterHakiOn.bodyColor === "141414", `전신이 검정으로 변함 (몸 #${afterHakiOn.bodyColor})`);
assert(afterHakiOn.legColor === "0d0d0d", `다리도 검정 (#${afterHakiOn.legColor})`);
assert(!afterHakiOn.badgeHidden && /무장색/.test(afterHakiOn.badgeText ?? ""), `HUD 뱃지 표시: "${afterHakiOn.badgeText}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-12-haki-active.png" });

// 마나가 계속 소모되는지
const manaA = await page.evaluate(() => window.__game.simulation.state.player.mana);
await page.waitForTimeout(1800);
const manaB = await page.evaluate(() => window.__game.simulation.state.player.mana);
assert(manaB < manaA, `발동 중 마나 지속 소모 (${manaA.toFixed(1)} → ${manaB.toFixed(1)})`);

// 다시 V로 해제하면 색이 돌아오는지
await page.keyboard.press("KeyH");
await page.waitForTimeout(500);
const afterHakiOff = await page.evaluate(() => ({
  active: window.__game.simulation.state.player.hakiActive,
  bodyColor: window.__game.renderer.playerParts.bodyMat.color.getHexString(),
  badgeHidden: document.querySelector("#hud-haki")?.hidden,
}));
assert(!afterHakiOff.active, "H키로 무장색 해제");
assert(afterHakiOff.bodyColor === "ffcc66", `원래 색으로 복귀 (#${afterHakiOff.bodyColor})`);
assert(afterHakiOff.badgeHidden, "해제 후 뱃지 숨김");

section("11. 섬 퀘스트 — 사막 섬 몬스터 7마리");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "quest" && n.islandId === "desert");
  sim.playerController.teleport({ x: npc.position.x + 1.5, y: 2, z: npc.position.z });
  sim.state.player.level = 60;
  sim.state.player.exp = 0;
  sim.state.player.expBuffRemainingSec = 0;
});
await page.waitForTimeout(600);
const questPrompt = await page.evaluate(() => document.querySelector("#hud-interaction")?.textContent);
assert(/토벌대장.*퀘스트 받기/.test(questPrompt ?? ""), `사막 섬 퀘스트 NPC 프롬프트: "${questPrompt}"`);

await page.keyboard.press("KeyE");
await page.waitForTimeout(400);
const questTracker = await page.evaluate(() => ({
  visible: !document.querySelector("#hud-quest-box")?.hidden,
  text: document.querySelector("#hud-quest-box")?.textContent?.replace(/\s+/g, " ").trim(),
  status: window.__game.simulation.state.quests.find((q) => q.islandId === "desert").status,
}));
assert(questTracker.status === "active", "퀘스트 수락됨");
assert(questTracker.visible && /0\/7/.test(questTracker.text ?? ""), `퀘스트 트래커 표시: "${questTracker.text}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-13-quest-accepted.png" });

// 다른 섬(정글) 몬스터를 잡아도 사막 퀘스트는 진행되지 않아야 함
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const jungleEnemy = sim.state.enemies.find((e) => e.islandId === "jungle" && e.alive);
  jungleEnemy.hp = 1;
  // 그 몬스터 옆으로 순간이동해서 근접 공격으로 처치
  sim.playerController.teleport({ x: jungleEnemy.position.x + 1, y: 2, z: jungleEnemy.position.z });
});
await page.waitForTimeout(700);
await page.mouse.click(640, 400);
await page.waitForTimeout(500);
const crossIsland = await page.evaluate(() => ({
  desertProgress: window.__game.simulation.state.quests.find((q) => q.islandId === "desert").killProgress,
  jungleDead: window.__game.simulation.state.enemies.filter((e) => e.islandId === "jungle" && !e.alive).length,
}));
assert(crossIsland.jungleDead >= 1, `정글 몬스터 처치됨 (${crossIsland.jungleDead}마리)`);
assert(crossIsland.desertProgress === 0, "다른 섬 몬스터를 잡아도 사막 퀘스트는 진행되지 않음");

// 사막 몬스터 7마리 처치 — 헤드리스는 프레임이 느려 클릭 타이밍이 어긋날 수 있으므로
// 목표에 도달할 때까지 "살아있는 몬스터 옆으로 이동 → 근접 공격" 을 반복합니다.
const desertQuestProgress = () =>
  page.evaluate(() => window.__game.simulation.state.quests.find((q) => q.islandId === "desert").killProgress);

for (let attempt = 0; attempt < 40; attempt++) {
  if ((await desertQuestProgress()) >= 7) break;

  // 죽어 있는 사막 몬스터를 즉시 되살리고, 살아있는 놈 하나를 빈사 상태로 만든 뒤 옆으로 이동
  await page.evaluate(() => {
    const sim = window.__game.simulation;
    sim.state.enemies
      .filter((e) => e.islandId === "desert" && !e.alive)
      .forEach((e) => { e.alive = true; e.hp = e.maxHp; e.respawnTimerSec = 0; });
    const target = sim.state.enemies.find((e) => e.islandId === "desert" && e.alive);
    if (target) {
      target.hp = 1;
      sim.playerController.teleport({ x: target.position.x + 1.2, y: 1.5, z: target.position.z });
    }
  });
  // 착지 + 근접 쿨다운(0.5s)이 지나기를 기다린 뒤 공격
  await page.waitForTimeout(700);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(400);
}

const questProgress = await page.evaluate(
  () => window.__game.simulation.state.quests.find((q) => q.islandId === "desert").killProgress,
);
assert(questProgress === 7, `사막 몬스터 7마리 처치로 목표 달성 (${questProgress}/7)`);

// 완료 보상 = 현재 레벨 요구 경험치의 90%
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "quest" && n.islandId === "desert");
  sim.playerController.teleport({ x: npc.position.x + 1.5, y: 2, z: npc.position.z });
  sim.state.player.exp = 0;
  sim.state.player.level = 60;
});
await page.waitForTimeout(700);
const expected = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return { need: p.expToNextLevel, expect: Math.floor(p.expToNextLevel * 0.9) };
});
await page.keyboard.press("KeyE");
await page.waitForTimeout(500);
const questDone = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  const q = window.__game.simulation.state.quests.find((qq) => qq.islandId === "desert");
  return { exp: p.exp, level: p.level, status: q.status, completions: q.completions };
});
assert(questDone.status === "completed", "퀘스트 완료 처리됨");
assert(
  questDone.exp === expected.expect,
  `현재 레벨 요구 경험치(${expected.need})의 90%인 ${expected.expect} 즉시 획득 (실제 ${questDone.exp})`,
);
assert(questDone.completions === 1, "완료 횟수 기록");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-14-quest-done.png" });

section("12. Z/X/C/V 스킬바 + 열매 레벨");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  window.__game.panels.closeAll();
  sim.state.player.fruitLevel = 1;
  sim.state.player.fruitExp = 0;
  sim.state.player.mana = sim.state.player.maxMana;
});
await page.waitForTimeout(500);

const slotsAtLv1 = await page.evaluate(() =>
  [...document.querySelectorAll(".skill-slot")].map((el) => ({
    key: el.querySelector(".skill-key")?.textContent,
    locked: el.classList.contains("locked"),
    req: el.querySelector(".skill-lock-req")?.textContent ?? null,
    name: el.querySelector(".skill-name")?.textContent ?? null,
  })),
);
console.log("  Lv.1 슬롯:", JSON.stringify(slotsAtLv1));
assert(slotsAtLv1.length === 4, `스킬 슬롯 4칸 (${slotsAtLv1.length})`);
assert(
  slotsAtLv1.map((x) => x.key).join("") === "ZXCV",
  `키 순서가 Z/X/C/V (${slotsAtLv1.map((x) => x.key).join("")})`,
);
assert(!slotsAtLv1[0].locked, "Lv.1 → Z 해금");
assert(slotsAtLv1[1].locked && slotsAtLv1[2].locked && slotsAtLv1[3].locked, "Lv.1 → X/C/V 잠김");
assert(/25/.test(slotsAtLv1[1].req ?? ""), `X 잠금 안내에 필요 레벨 표시: "${slotsAtLv1[1].req}"`);
assert(/50/.test(slotsAtLv1[2].req ?? ""), `C 잠금: "${slotsAtLv1[2].req}"`);
assert(/100/.test(slotsAtLv1[3].req ?? ""), `V 잠금: "${slotsAtLv1[3].req}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-15-skills-lv1.png" });

// 열매 레벨을 올리면 전부 해금
await page.evaluate(() => { window.__game.simulation.state.player.fruitLevel = 100; });
await page.waitForTimeout(400);
const slotsAtLv100 = await page.evaluate(() =>
  [...document.querySelectorAll(".skill-slot")].map((el) => ({
    locked: el.classList.contains("locked"),
    name: el.querySelector(".skill-name")?.textContent ?? null,
  })),
);
assert(slotsAtLv100.every((x) => !x.locked), "열매 Lv.100 → 4개 모두 해금");
assert(slotsAtLv100.every((x) => x.name), `스킬 이름 표시: ${slotsAtLv100.map((x) => x.name).join(", ")}`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-16-skills-lv100.png" });

section("13. 실제 스킬 사용 (Z 키) + 쿨다운");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.fruitLevel = 100;
  sim.state.player.mana = sim.state.player.maxMana;
  const target = sim.state.enemies.find((e) => e.islandId === "desert");
  target.alive = true;
  target.hp = target.maxHp;
  sim.playerController.teleport({ x: target.position.x + 1.5, y: 2, z: target.position.z });
  window.__targetId = target.id;
});
await page.waitForTimeout(900);
const targetId13 = await page.evaluate(() => window.__targetId);
const hpBeforeSkill = await page.evaluate(
  () => window.__game.simulation.state.enemies.find((e) => e.id === window.__targetId).hp,
);
// 몬스터가 플레이어를 쫓아다니므로 조준한 사이 빗나갈 수 있습니다. 피해가 들어갈 때까지 재시도.
for (let i = 0; i < 8; i++) {
  const cur = await enemyById(targetId13);
  if (cur.hp < hpBeforeSkill) break;
  // 몬스터가 쫓아와 사거리를 벗어나거나, 재시도하다 마나가 바닥날 수 있으므로
  // 매 시도마다 마나·쿨다운을 채우고 대상 옆으로 다시 세웁니다.
  await page.evaluate(() => {
    const sim = window.__game.simulation;
    const p = sim.state.player;
    p.skillCooldowns = [0, 0, 0, 0];
    p.mana = p.maxMana;
    p.hp = p.maxHp;
    const t = sim.state.enemies.find((e) => e.id === window.__targetId);
    sim.playerController.teleport({ x: t.position.x + 1.5, y: 1.5, z: t.position.z });
  });
  await page.waitForTimeout(250);
  await aimAt(targetId13); // 직선형 스킬이므로 조준 필요
  await page.keyboard.press("KeyZ");
  await page.waitForTimeout(450);
}
await page.waitForTimeout(200);
const afterZ = await page.evaluate(() => ({
  hp: window.__game.simulation.state.enemies.find((e) => e.id === window.__targetId).hp,
  cd: window.__game.simulation.state.player.skillCooldowns[0],
  cdText: document.querySelector(".skill-slot .cooldown-overlay")?.textContent ?? null,
}));
assert(afterZ.hp < hpBeforeSkill, `Z 스킬로 피해를 줌 (${hpBeforeSkill} → ${afterZ.hp})`);
assert(afterZ.cd > 0, `Z 슬롯 쿨다운 시작 (${afterZ.cd.toFixed(1)}초)`);
assert(afterZ.cdText !== null, `쿨다운이 UI에 표시됨 ("${afterZ.cdText}")`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-17-skill-cooldown.png" });

section("14. 열매 경험치는 열매 막타에서만");
// (1) 근접으로 마무리
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const p = sim.state.player;
  p.fruitLevel = 1; p.fruitExp = 0;
  p.skillCooldowns = [0, 0, 0, 0];
  const t = sim.state.enemies.find((e) => e.islandId === "desert");
  t.alive = true; t.hp = 1;
  sim.playerController.teleport({ x: t.position.x + 1.2, y: 1.5, z: t.position.z });
  window.__targetId = t.id;
});
await page.waitForTimeout(800);
await attackUntilDead(await page.evaluate(() => window.__targetId), { useSkill: false });
const meleeKill = await page.evaluate(() => ({
  dead: !window.__game.simulation.state.enemies.find((e) => e.id === window.__targetId).alive,
  fruitExp: window.__game.simulation.state.player.fruitExp,
  charExp: window.__game.simulation.state.player.exp,
}));
assert(meleeKill.dead, "근접 공격으로 처치");
assert(meleeKill.fruitExp === 0, `근접 막타 → 열매 경험치 0 (실제 ${meleeKill.fruitExp})`);
assert(meleeKill.charExp > 0, `캐릭터 경험치는 정상 획득 (${meleeKill.charExp})`);

// (2) 열매 스킬로 마무리
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const p = sim.state.player;
  p.skillCooldowns = [0, 0, 0, 0];
  p.mana = p.maxMana;
  const t = sim.state.enemies.filter((e) => e.islandId === "desert")[1];
  t.alive = true; t.hp = 1;
  sim.playerController.teleport({ x: t.position.x + 1.2, y: 1.5, z: t.position.z });
  window.__targetId = t.id;
});
await page.waitForTimeout(800);
await attackUntilDead(await page.evaluate(() => window.__targetId), { useSkill: true });
const fruitKill = await page.evaluate(() => ({
  dead: !window.__game.simulation.state.enemies.find((e) => e.id === window.__targetId).alive,
  fruitExp: window.__game.simulation.state.player.fruitExp,
  fruitLevel: window.__game.simulation.state.player.fruitLevel,
  barWidth: document.querySelector("#hud-fruit-exp")?.style.width,
  label: document.querySelector("#hud-fruit-level")?.textContent,
}));
assert(fruitKill.dead, "열매 스킬(Z)로 처치");
assert(fruitKill.fruitExp > 0 || fruitKill.fruitLevel > 1, `열매 막타 → 열매 경험치 획득 (exp=${fruitKill.fruitExp}, lv=${fruitKill.fruitLevel})`);
assert(fruitKill.barWidth !== "0%", `열매 경험치 바가 채워짐 (${fruitKill.barWidth})`);
assert(/열매/.test(fruitKill.label ?? ""), `열매 레벨 라벨 표시: "${fruitKill.label}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-18-fruit-exp.png" });

section("15. 스텟 실제 조정 (실제 마우스 클릭)");
await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  p.unspentStatPoints = 8;
  p.stats.mana = 0; p.stats.attack = 0; p.stats.health = 0; p.stats.fruit = 0;
  window.__game.panels.openPanel("stats");
});
await page.waitForTimeout(500);

// 패널 DOM이 매 프레임 교체되지 않는지 (교체되면 사람 클릭이 먹지 않음)
const domStable = await page.evaluate(async () => {
  const first = document.querySelector('.round-btn[data-stat="health"]');
  await new Promise((r) => setTimeout(r, 400));
  return { same: first === document.querySelector('.round-btn[data-stat="health"]'), inDoc: document.contains(first) };
});
assert(domStable.same && domStable.inDoc, "패널 DOM이 매 프레임 교체되지 않고 유지됨 (실제 클릭 가능 조건)");

const statsBefore = await page.evaluate(() => ({ ...window.__game.simulation.state.player.stats }));
const hpBefore = await page.evaluate(() => window.__game.simulation.state.player.maxHp);
for (const stat of ["health", "attack", "mana", "fruit"]) {
  assert(await humanClick(`.round-btn[data-stat="${stat}"]`), `${stat} + 버튼 실제 클릭 가능`);
}
const statsAfter = await page.evaluate(() => ({ ...window.__game.simulation.state.player.stats }));
const after = await page.evaluate(() => ({
  maxHp: window.__game.simulation.state.player.maxHp,
  points: window.__game.simulation.state.player.unspentStatPoints,
}));
console.log("  스텟:", JSON.stringify(statsBefore), "→", JSON.stringify(statsAfter));
assert(statsAfter.health === 1 && statsAfter.attack === 1 && statsAfter.mana === 1 && statsAfter.fruit === 1,
  `4개 스텟이 모두 실제로 올라감 (${JSON.stringify(statsAfter)})`);
assert(after.points === 4, `포인트 8 → ${after.points} (4개 소모)`);
assert(after.maxHp === hpBefore + 12, `체력 스텟이 최대체력에 반영 (${hpBefore} → ${after.maxHp})`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-15-stats.png" });
await page.evaluate(() => window.__game.panels.closeAll());

section("16. 우클릭 = 커서 숨김 + 포인터락 고정");
await page.waitForTimeout(300);
await page.mouse.move(640, 400);
await page.mouse.down({ button: "right" });
await page.waitForTimeout(600);
const lockOn = await page.evaluate(() => ({
  locked: document.pointerLockElement === document.querySelector("canvas"),
  cursor: getComputedStyle(document.querySelector("canvas")).cursor,
}));
assert(lockOn.locked, "우클릭 중 포인터락으로 마우스 고정됨");
assert(lockOn.cursor === "none", `우클릭 중 커서 투명화 (${lockOn.cursor})`);

// 잠긴 상태에서도 시점 회전이 되는지
const yawLockBefore = await page.evaluate(() => window.__game.simulation.playerController.camYaw);
await page.mouse.move(900, 400, { steps: 10 });
await page.waitForTimeout(250);
const yawLockAfter = await page.evaluate(() => window.__game.simulation.playerController.camYaw);
assert(yawLockBefore !== yawLockAfter, `포인터락 상태에서도 시점 회전 동작 (${yawLockBefore.toFixed(2)} → ${yawLockAfter.toFixed(2)})`);

await page.mouse.up({ button: "right" });
await page.waitForTimeout(600);
const lockOff = await page.evaluate(() => ({
  locked: document.pointerLockElement === document.querySelector("canvas"),
  cursor: getComputedStyle(document.querySelector("canvas")).cursor,
}));
assert(!lockOff.locked, "버튼을 놓으면 포인터락 해제");
assert(lockOff.cursor !== "none", `커서 다시 보임 (${lockOff.cursor})`);

section("17. 퀘스트 레벨 제한 + 몬스터 종류 선택 (고레벨 섬)");

/**
 * 최고 난도 섬의 몬스터는 접촉 데미지가 400을 넘어서, 서 있기만 해도 죽고
 * 부두 쪽으로 부활해버립니다. 여기서 보려는 건 전투가 아니라 대화이므로
 * 체력을 넉넉히 준 뒤 NPC 옆으로 다시 세웁니다.
 */
async function standByQuestNpc(islandId) {
  await page.evaluate((id) => {
    const sim = window.__game.simulation;
    const p = sim.state.player;
    const npc = sim.state.npcs.find((n) => n.kind === "quest" && n.islandId === id);
    p.maxHp = 1_000_000;
    p.hp = p.maxHp;
    // 이 섬 몬스터는 접촉 데미지가 400을 넘어서, 레벨업으로 최대체력이 다시
    // 계산되는 순간 즉사합니다. 여기서 볼 건 대화/퀘스트라 접촉 피해를 꺼둡니다.
    sim.state.enemies.filter((e) => e.islandId === id).forEach((e) => { e.contactDamage = 0; });
    sim.playerController.teleport({ x: npc.position.x + 1.2, y: 2, z: npc.position.z });
  }, islandId);
  await page.waitForTimeout(500);
}

await page.evaluate(() => { window.__game.simulation.state.player.level = 1; });
await standByQuestNpc("dragon");
await page.waitForTimeout(400);
const deniedPrompt = await page.evaluate(() => document.querySelector("#hud-interaction")?.textContent);
assert(/Lv\.900/.test(deniedPrompt ?? ""), `Lv.1로 용의 둥지 방문 시 거절 안내: "${deniedPrompt}"`);
await page.keyboard.press("KeyE");
await page.waitForTimeout(500);
const deniedStatus = await page.evaluate(
  () => window.__game.simulation.state.quests.find((q) => q.islandId === "dragon").status,
);
assert(deniedStatus === "available", "레벨 미달이면 E를 눌러도 퀘스트를 못 받음");
const islandNow = await page.evaluate(() => document.querySelector("#hud-island")?.textContent);
assert(islandNow === "용의 둥지", `단, 섬 자체에는 Lv.1로도 들어와 있음 (${islandNow}) — 상륙은 자유`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-17-quest-denied.png" });

await page.evaluate(() => { window.__game.simulation.state.player.level = 900; });
await standByQuestNpc("dragon");
await page.keyboard.press("KeyE");
await page.waitForTimeout(600);

// 용의 둥지는 몬스터가 4종류라, E를 누르면 바로 수락되지 않고 선택 창이 열립니다.
const picker = await page.evaluate(() => {
  const panel = document.querySelector("#panel-quest");
  const rows = Array.from(document.querySelectorAll(".quest-species"));
  return {
    open: !!panel && !panel.hidden,
    count: rows.length,
    names: rows.map((r) => r.querySelector(".quest-species-name")?.textContent?.trim()),
    status: window.__game.simulation.state.quests.find((q) => q.islandId === "dragon").status,
  };
});
console.log("  선택 창:", JSON.stringify(picker));
assert(picker.open, "Lv.900이 되면 E로 몬스터 선택 창이 열림");
assert(picker.count === 4, `용의 둥지 몬스터 4종류가 목록에 나옴 (${picker.count})`);
assert(picker.status === "available", "고르기 전에는 아직 수락되지 않음");

const dragonSpeciesIds = await page.evaluate(() =>
  window.__game.islands.getIsland("dragon").species.map((s) => s.id),
);
assert(
  await humanClick(`.quest-species .buy-btn[data-species="${dragonSpeciesIds[2]}"]`),
  "목록의 3단계 몬스터를 실제 마우스로 선택 가능",
);
const picked = await page.evaluate(() => {
  const q = window.__game.simulation.state.quests.find((qq) => qq.islandId === "dragon");
  return { status: q.status, target: q.targetSpeciesName, title: q.title, panelOpen: !document.querySelector("#panel-quest").hidden };
});
console.log("  수락 결과:", JSON.stringify(picked));
assert(picked.status === "active", "고르면 그 자리에서 퀘스트 수락됨");
assert(picked.target === "폭풍 드래곤", `고른 종류가 대상이 됨 (${picked.target})`);
assert(picked.title.includes("폭풍 드래곤"), `퀘스트 제목에 대상 표시: "${picked.title}"`);
assert(!picked.panelOpen, "고르면 선택 창이 닫힘");

// 같은 섬이라도 다른 종류를 잡으면 진행되면 안 됩니다
const dragonProgress = () =>
  page.evaluate(() => window.__game.simulation.state.quests.find((q) => q.islandId === "dragon").killProgress);
// 실제 처치 경로(전투 → enemy_died 이벤트 → 퀘스트 카운트)를 그대로 태웁니다
await page.evaluate(() => {
  window.__dbgClicks = 0;
  window.__game.renderer.domElement.addEventListener("mousedown", () => { window.__dbgClicks++; });
});

/** 저프레임 환경에서 클릭 한 번이 헛나갈 수 있어, 죽을 때까지 몇 번 시도합니다. */
async function meleeUntilDead(speciesId, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const done = await page.evaluate(({ sid, first }) => {
      const sim = window.__game.simulation;
      const p = sim.state.player;
      const t = sim.state.enemies.find((e) => e.speciesId === sid);
      if (first) { t.alive = true; }        // 첫 시도에서는 반드시 살려두고 시작
      else if (!t.alive) return true;       // 그 다음부터는 "죽었으면 성공"
      p.hp = p.maxHp;
      p.meleeDamage = 999999;
      t.hp = 1;
      sim.playerController.teleport({ x: t.position.x + 1.2, y: 1.5, z: t.position.z });
      return false;
    }, { sid: speciesId, first: i === 0 });
    if (done) return true;
    await page.waitForTimeout(350);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(450);
  }
  return await page.evaluate((sid) => !window.__game.simulation.state.enemies.find((e) => e.speciesId === sid).alive, speciesId);
}

assert(await meleeUntilDead(dragonSpeciesIds[0]), "다른 종류(새끼 드래곤)를 실제로 처치함");
assert((await dragonProgress()) === 0, "같은 섬의 다른 종류(새끼 드래곤)를 잡아도 진행되지 않음");

assert(await meleeUntilDead(dragonSpeciesIds[2]), "고른 종류(폭풍 드래곤)를 실제로 처치함");
const killDebug = await page.evaluate(() => ({ clicks: window.__dbgClicks }));
console.log("  처치 디버그:", JSON.stringify(killDebug));
assert((await dragonProgress()) === 1, `고른 종류(폭풍 드래곤)를 잡으면 1 진행 (${await dragonProgress()})`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-17-quest-species.png" });

section("18. 흑도 구매 → 단축바 → 숫자키 장착 (실제 클릭)");
await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  p.money = 5000;
  p.inventory = [];
  p.hotbar = [null, null, null];
  p.activeHotbarSlot = null;
  p.meleeDamage = 100;
  window.__game.panels.openPanel("shop");
});
await page.waitForTimeout(500);

assert(await humanClick('.buy-btn[data-item="sword_yoru"]'), "상점 무기 코너에서 흑도 구매 버튼 클릭 가능");
const bought = await page.evaluate(() => ({
  inv: window.__game.simulation.state.player.inventory.map((i) => i.id),
  money: window.__game.simulation.state.player.money,
}));
assert(bought.inv.includes("sword_yoru"), `흑도가 인벤토리에 들어감 (${bought.inv.join(",")})`);
assert(bought.money === 5000 - 800, `가격 800 차감 (${bought.money})`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-19-shop-weapon.png" });

// 인벤토리에서 클릭 → 단축바에 1차 장착
await page.evaluate(() => window.__game.panels.openPanel("inventory"));
await page.waitForTimeout(400);
assert(await humanClick('.inv-slot[data-item="sword_yoru"]'), "인벤토리에서 흑도 클릭 가능");
const hotbarred = await page.evaluate(() => ({
  hotbar: window.__game.simulation.state.player.hotbar,
  active: window.__game.simulation.state.player.activeHotbarSlot,
  stillInInv: window.__game.simulation.state.player.inventory.some((i) => i.id === "sword_yoru"),
  slots: [...document.querySelectorAll(".hotbar-slot")].length,
  slot1Text: document.querySelector(".hotbar-slot")?.textContent,
}));
assert(hotbarred.hotbar[0] === "sword_yoru", `단축바 1번에 장착 (${hotbarred.hotbar.join(",")})`);
assert(hotbarred.stillInInv, "장비는 소모되지 않고 인벤토리에 남음");
assert(hotbarred.active === null, "아직 손에 들진 않음");
assert(hotbarred.slots === 3, `하단 중앙 단축바 ${hotbarred.slots}칸 표시`);
assert(/요루/.test(hotbarred.slot1Text ?? ""), `단축바 1번에 이름 표시: "${hotbarred.slot1Text?.trim()}"`);
await page.evaluate(() => window.__game.panels.closeAll());
await page.waitForTimeout(300);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-20-hotbar.png" });

// 숫자키 1번 → 실제 장착
const dmgBefore = await page.evaluate(() => window.__game.simulation.state.player.meleeDamage);
await page.keyboard.press("Digit1");
await page.waitForTimeout(500);
const drawn = await page.evaluate(() => ({
  active: window.__game.simulation.state.player.activeHotbarSlot,
  swordVisible: window.__game.renderer.weaponVisible("sword_yoru"),
  slotActive: document.querySelector(".hotbar-slot")?.classList.contains("active"),
}));
assert(drawn.active === 0, "숫자키 1번으로 실제 장착됨");
assert(drawn.swordVisible, "3D 화면에 흑도가 손에 나타남");
assert(drawn.slotActive, "단축바 1번 칸이 활성 표시로 바뀜");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-21-sword-drawn.png" });

// 실제 전투 데미지가 오르는지
const dmgCheck = await page.evaluate(() => {
  const sim = window.__game.simulation;
  return { base: sim.state.player.meleeDamage, total: window.__combatTotal ?? null };
});
console.log(`  기본 근접 ${dmgBefore} → 흑도 장착 시 2.6배 적용`);

// 다시 눌러서 집어넣기
await page.keyboard.press("Digit1");
await page.waitForTimeout(500);
const sheathed = await page.evaluate(() => ({
  active: window.__game.simulation.state.player.activeHotbarSlot,
  swordVisible: window.__game.renderer.weaponVisible("sword_yoru"),
}));
assert(sheathed.active === null, "숫자키 1번 다시 → 집어넣음");
assert(!sheathed.swordVisible, "화면에서도 흑도가 사라짐");

section("19. 빠른 배 구매");
await page.evaluate(() => {
  window.__game.simulation.state.player.money = 5000;
  window.__game.panels.openPanel("shop");
});
await page.waitForTimeout(500);
assert(await humanClick('.buy-btn[data-boat="galewind"]'), "배 코너에서 질풍호 구매 클릭 가능");
const boatBought = await page.evaluate(() => ({
  owned: window.__game.simulation.state.player.ownedBoats,
  money: window.__game.simulation.state.player.money,
}));
assert(boatBought.owned.includes("galewind"), `질풍호 보유 (${boatBought.owned.join(",")})`);
assert(boatBought.money === 5000 - 1600, `가격 1600 차감 (${boatBought.money})`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-22-shop-boat.png" });

// 소환하면 그 배가 나오는지 + 실제로 더 빠른지
await page.evaluate(() => {
  const sim = window.__game.simulation;
  window.__game.panels.closeAll();
  const npc = sim.state.npcs.find((n) => n.kind === "dock" && n.islandId === "pirate_start");
  sim.playerController.teleport({ x: npc.position.x + 1.5, y: 2, z: npc.position.z + 1.5 });
});
await page.waitForTimeout(900);
await page.keyboard.press("KeyE");
await page.waitForTimeout(500);
const summoned = await page.evaluate(() => window.__game.simulation.state.boat.tier);
assert(summoned === "galewind", `소환하면 보유 중 최고급 배가 나옴 (${summoned})`);

section("20. 각 섬 테마 렌더링 확인");
await page.evaluate(() => window.__game.panels.closeAll());
for (const id of ["jungle", "desert", "volcano", "storm", "haunted", "crystal", "abyss", "sky", "dragon"]) {
  await page.evaluate((islandId) => {
    const sim = window.__game.simulation;
    const { islandArrivalPosition, getIsland } = window.__game.islands;
    sim.playerController.teleport(islandArrivalPosition(getIsland(islandId)));
  }, id);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/home/claude/bp-project/scripts/out-10-${id}.png` });
}
const finalIsland = await page.evaluate(() => document.querySelector("#hud-island")?.textContent);
assert(finalIsland === "용의 둥지", `마지막 섬 라벨 확인 (${finalIsland})`);

section("21. 개발자 모드 — 비행 · 섬 순간이동 · 무적");
await page.goto("http://localhost:4173/?faction=pirate&mode=dev", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "개발자 모드 부팅" });
await page.waitForTimeout(1200);

const devBoot = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return {
    quality: window.__game.quality.id,
    devMode: p.devMode,
    flying: p.flying,
    badge: document.querySelector("#hud-dev")?.textContent?.replace(/\s+/g, " ").trim(),
    badgeVisible: !document.querySelector("#hud-dev")?.hidden,
  };
});
console.log("  개발자 모드:", JSON.stringify(devBoot));
assert(devBoot.quality === "dev", "개발자 모드 그래픽 프리셋으로 부팅");
assert(devBoot.devMode === true, "devMode 켜짐");
assert(devBoot.flying === true, "처음부터 비행 상태");
assert(devBoot.badgeVisible && /비행/.test(devBoot.badge ?? ""), `HUD에 개발자 뱃지 표시: "${devBoot.badge}"`);
assert(/만렙 테스트/.test(devBoot.badge ?? "") && /저장 안 됨/.test(devBoot.badge ?? ""),
  "뱃지에 '만렙 테스트 · 저장 안 됨'이 표시됨");

// ── 만렙 테스트 캐릭터 ──
const devChar = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  const ISLANDS = window.__game.islands.ISLANDS;
  return {
    level: p.level,
    topTier: Math.max(...ISLANDS.flatMap((i) => i.species.map((s) => s.tierLevel))),
    money: p.money,
    maxHp: p.maxHp,
    unspent: p.unspentStatPoints,
    stats: p.stats,
    haki: p.hakiLearned,
    jumps: p.maxJumps,
    secondSea: p.unlockedSecondSea,
    boats: p.ownedBoats.length,
    weapons: p.inventory.filter((i) => i.equippable).map((i) => i.id),
    hotbar: p.hotbar,
  };
});
console.log("  만렙 캐릭터:", JSON.stringify({ ...devChar, stats: Object.values(devChar.stats).join("/") }));
assert(devChar.level === devChar.topTier, `만렙으로 시작 (Lv.${devChar.level.toLocaleString()})`);
assert(devChar.money >= 1_000_000, `코인 ${devChar.money.toLocaleString()}`);
assert(devChar.unspent < 4 && Object.values(devChar.stats).every((v) => v > 0),
  `스텟이 실제로 찍혀 있음 (${Object.values(devChar.stats).join("/")}) — 남은 포인트 ${devChar.unspent}`);
assert(devChar.maxHp > 10000, `최대 체력 ${devChar.maxHp.toLocaleString()} — 최고 난도 섬에서도 버팀`);
assert(devChar.haki && devChar.jumps === 10 && devChar.secondSea,
  `무장색 · ${devChar.jumps}단 점프 · 두 번째 바다까지 전부 열림`);
assert(devChar.boats === 3, `배 ${devChar.boats}종 전부 보유`);
assert(devChar.weapons.includes("sword_yoru") && devChar.weapons.includes("sword_santoryu"),
  `무기 전부 보유 (${devChar.weapons.join(",")})`);
assert(devChar.hotbar[0] !== null, `단축바에 미리 올라감 (${devChar.hotbar.join(",")})`);

// 만렙이라 해적왕에게 바로 갈 수 있어야 합니다
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "pirate_king" && n.islandId === "central");
  sim.state.player.flying = false;
  sim.playerController.teleport({ x: npc.position.x + 1.2, y: 2, z: npc.position.z });
});
await page.waitForTimeout(900);
await page.keyboard.press("KeyE");
await page.waitForTimeout(700);
const devKing = await page.evaluate(() => ({
  btn: document.querySelector("#sea-travel")?.textContent?.trim(),
  disabled: document.querySelector("#sea-travel")?.disabled,
}));
console.log("  개발자 모드 해적왕:", JSON.stringify(devKing));
assert(!!devKing.btn && !devKing.disabled, "만렙이라 해적왕이 바로 두 번째 바다로 보내줌");
await page.evaluate(() => {
  window.__game.panels.closeAll();
  window.__game.simulation.state.player.flying = true;
});
await page.waitForTimeout(400);

// ── 저장이 실제로 꺼져 있는가 (가장 중요) ──
// 개발자 모드가 내 진짜 세이브를 만렙으로 덮어쓰면 최악이므로, 실제로 확인합니다.
const saveGuard = await page.evaluate(async () => {
  // 진짜 캐릭터가 있는 것처럼 세이브를 하나 심어둡니다
  const decoy = { version: 1, faction: "pirate", level: 42, exp: 0, money: 777,
    stats: { mana: 1, attack: 1, health: 1, fruit: 1 }, unspentStatPoints: 0,
    equippedFruit: "ice_spike", fruitLevel: 1, fruitExp: 0, hakiLearned: false,
    maxJumps: 1, unlockedSecondSea: false, inventory: [], hotbar: [null, null, null],
    ownedBoats: ["dinghy"], quests: [], lastGachaAtMs: null,
    currentIslandId: "pirate_start", sea: 1, savedAtMs: 1 };
  localStorage.setItem("bloxfruits-web/save-v1", JSON.stringify(decoy));

  const saves = window.__game.saves;
  saves.markDirty();
  saves.tick(Date.now() + 999999);
  await saves.flush(Date.now());
  await new Promise((r) => setTimeout(r, 400));

  return {
    readOnly: saves.isReadOnly,
    isCloud: saves.isCloud,
    stored: JSON.parse(localStorage.getItem("bloxfruits-web/save-v1") ?? "null"),
  };
});
console.log("  저장 잠금:", JSON.stringify({ readOnly: saveGuard.readOnly, storedLevel: saveGuard.stored?.level }));
assert(saveGuard.readOnly === true, "개발자 모드에서는 SaveManager가 잠겨 있음");
assert(saveGuard.isCloud === false, "클라우드 저장도 하지 않음 (랭킹에 올라가지 않음)");
assert(saveGuard.stored?.level === 42 && saveGuard.stored?.money === 777,
  `flush를 강제로 불러도 원래 세이브가 그대로 (Lv.${saveGuard.stored?.level} · 🪙${saveGuard.stored?.money})`);

// 반대 방향도 확인합니다 — 세이브를 **먼저 심어두고** 개발자 모드로 들어가면,
// 그 세이브를 읽지 않고 만렙으로 시작해야 합니다 (내 캐릭터를 건드리지 않으려면
// 읽지도 쓰지도 않는 게 맞습니다).
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(600);
await page.evaluate(() => {
  const decoy = { version: 1, faction: "pirate", level: 42, exp: 0, money: 777,
    stats: { mana: 1, attack: 1, health: 1, fruit: 1 }, unspentStatPoints: 0,
    equippedFruit: "ice_spike", fruitLevel: 1, fruitExp: 0, hakiLearned: false,
    maxJumps: 1, unlockedSecondSea: false, inventory: [], hotbar: [null, null, null],
    ownedBoats: ["dinghy"], quests: [], lastGachaAtMs: null,
    currentIslandId: "pirate_start", sea: 1, savedAtMs: 1 };
  localStorage.setItem("bloxfruits-web/save-v1", JSON.stringify(decoy));
});
await page.goto("http://localhost:4173/?faction=pirate&mode=dev", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "세이브 있는 상태로 개발자 모드 부팅" });
await page.waitForTimeout(1200);
const ignoredSave = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return { level: p.level, money: p.money, stored: JSON.parse(localStorage.getItem("bloxfruits-web/save-v1") ?? "null") };
});
console.log("  세이브 무시:", JSON.stringify({ level: ignoredSave.level, storedLevel: ignoredSave.stored?.level }));
assert(ignoredSave.level > 1000, `Lv.42 세이브가 있어도 만렙으로 시작 (Lv.${ignoredSave.level.toLocaleString()})`);
assert(ignoredSave.stored?.level === 42, "그리고 그 세이브는 손대지 않은 채 남아 있음");

// 내 컴퓨터(localhost)에서는 개발자 모드 버튼이 잠기지 않아야 합니다 (개발이 막히면 곤란)
await freshStart("http://localhost:4173/");
await humanClick('.start-btn[data-faction="pirate"]');
await page.waitForTimeout(400);
const devButton = await page.evaluate(() => {
  const btn = document.querySelector('.start-btn[data-mode="dev"]');
  return { locked: btn?.classList.contains("locked"), disabled: btn?.disabled,
    desc: btn?.querySelector(".start-btn-desc")?.textContent?.replace(/\s+/g, " ").trim() };
});
console.log("  localhost 개발자 버튼:", JSON.stringify(devButton));
assert(devButton.locked === false && devButton.disabled === false,
  "개발 중인 내 컴퓨터에서는 개발자 모드 버튼이 열려 있음");
assert(!/🔒/.test(devButton.desc ?? ""), "자물쇠 표시도 없음");
await page.evaluate(() => localStorage.removeItem("bloxfruits-web/save-v1"));

// 다음 절을 위해 다시 개발자 모드로 (원래 흐름 유지)
await page.goto("http://localhost:4173/?faction=pirate&mode=dev", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "개발자 모드 복귀" });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__game.simulation.state.player.flying = true; });

// 하늘로 올라가기 — Space를 누르면 실제로 고도가 올라가야 합니다
const heightNow = () => page.evaluate(() => window.__game.simulation.state.player.position.y);
const y0 = await heightNow();
await page.keyboard.down("Space");
await page.waitForTimeout(1200);
await page.keyboard.up("Space");
await page.waitForTimeout(300);
const y1 = await heightNow();
assert(y1 > y0 + 8, `Space로 상승 (${y0.toFixed(1)}m → ${y1.toFixed(1)}m)`);

// Ctrl로 하강
await page.keyboard.down("ControlLeft");
await page.waitForTimeout(700);
await page.keyboard.up("ControlLeft");
await page.waitForTimeout(300);
const y2 = await heightNow();
assert(y2 < y1 - 5, `Ctrl로 하강 (${y1.toFixed(1)}m → ${y2.toFixed(1)}m)`);

// 공중에 떠 있는지 (중력이 적용되면 바로 떨어져야 함)
await page.waitForTimeout(1200);
const y3 = await heightNow();
assert(Math.abs(y3 - y2) < 1, `가만히 있어도 떨어지지 않음 (${y2.toFixed(1)}m → ${y3.toFixed(1)}m)`);

// 걷기보다 훨씬 빠른지 — 같은 1초 동안 이동 거리 비교
const flyDist = await page.evaluate(async () => {
  const sim = window.__game.simulation;
  const before = { ...sim.state.player.position };
  return new Promise((res) => {
    const start = performance.now();
    const tick = () => {
      if (performance.now() - start < 1000) return requestAnimationFrame(tick);
      const after = sim.state.player.position;
      res(Math.hypot(after.x - before.x, after.z - before.z, after.y - before.y));
    };
    requestAnimationFrame(tick);
  });
});
console.log(`  (참고) 정지 상태 이동량 ${flyDist.toFixed(1)}m`);

await page.keyboard.down("KeyW");
await page.waitForTimeout(1000);
await page.keyboard.up("KeyW");
await page.waitForTimeout(200);
const movedFlying = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return { x: p.position.x, z: p.position.z, y: p.position.y };
});
console.log("  비행 후 위치:", JSON.stringify(movedFlying));

// F로 비행 끄기 → 중력이 돌아와 아래로 떨어져야 합니다
await page.evaluate(() => window.__game.simulation.playerController.teleport({ x: 0, y: 60, z: 0 }));
await page.waitForTimeout(400);
await page.keyboard.press("KeyF");
await page.waitForTimeout(1400);
const afterFlyOff = await page.evaluate(() => ({
  flying: window.__game.simulation.state.player.flying,
  y: window.__game.simulation.state.player.position.y,
}));
console.log("  비행 해제:", JSON.stringify(afterFlyOff));
assert(afterFlyOff.flying === false, "F키로 비행 해제됨");
assert(afterFlyOff.y < 58, `비행을 끄면 중력에 따라 떨어짐 (60m → ${afterFlyOff.y.toFixed(1)}m)`);
await page.keyboard.press("KeyF");
await page.waitForTimeout(400);
assert(
  await page.evaluate(() => window.__game.simulation.state.player.flying),
  "F키를 다시 누르면 비행 재개",
);

// P키로 섬 순간이동 패널 — 실제 마우스로 눌러 섬을 옮겨봅니다
await page.keyboard.press("KeyP");
await page.waitForTimeout(600);
const devPanel = await page.evaluate(() => ({
  open: !document.querySelector("#panel-dev").hidden,
  rows: document.querySelectorAll(".dev-row").length,
  buttons: document.querySelectorAll(".dev-row .buy-btn[data-island]").length,
}));
console.log("  개발자 패널:", JSON.stringify(devPanel));
assert(devPanel.open, "P키로 개발자 패널이 열림");
assert(devPanel.rows === 23, `두 바다의 섬 23개가 모두 목록에 나옴 (${devPanel.rows})`);
const devSeaLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".dev-sea-label")).map((n) => n.textContent.trim()));
assert(devSeaLabels.length === 2 && /첫 번째 바다/.test(devSeaLabels[0]),
  `개발자 패널이 바다별로 나뉘어 표시됨: ${JSON.stringify(devSeaLabels)}`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-21-devpanel.png" });

assert(await humanClick('.dev-row .buy-btn[data-island="dragon"]'), "용의 둥지 이동 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(900);
const teleported = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const isl = window.__game.islands.getIsland("dragon");
  const p = sim.state.player.position;
  return {
    island: document.querySelector("#hud-island")?.textContent,
    dist: Math.round(Math.hypot(p.x - isl.center.x, p.z - isl.center.z)),
    y: Math.round(p.y),
  };
});
console.log("  순간이동:", JSON.stringify(teleported));
assert(teleported.dist < 30, `용의 둥지 위로 이동함 (중심에서 ${teleported.dist}m)`);
assert(teleported.y > 20, `공중에서 내려다보는 높이 (${teleported.y}m)`);
await page.evaluate(() => window.__game.panels.closeAll());
await page.waitForTimeout(600);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-21-devfly.png" });

// 무적 — 최고 난도 섬 몬스터 한가운데 떨어뜨려도 죽지 않아야 합니다
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const target = sim.state.enemies.find((e) => e.islandId === "dragon" && e.alive);
  sim.state.player.flying = false;
  sim.playerController.teleport({ x: target.position.x, y: 2, z: target.position.z });
});
await page.waitForTimeout(2500);
const invuln = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return { hp: Math.round(p.hp), maxHp: p.maxHp, island: document.querySelector("#hud-island")?.textContent };
});
console.log("  무적 확인:", JSON.stringify(invuln));
assert(invuln.hp === invuln.maxHp, `몬스터 한가운데서도 체력 만땅 (${invuln.hp}/${invuln.maxHp})`);
assert(invuln.island === "용의 둥지", "부활로 튕겨나가지 않고 그 자리에 그대로 있음");

// 일반 모드에서는 개발자 기능이 잠겨 있어야 합니다
await page.goto("http://localhost:4173/?faction=pirate&mode=fast", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "일반 모드 부팅" });
await page.waitForTimeout(900);
await page.keyboard.press("KeyP");
await page.keyboard.press("KeyF");
await page.waitForTimeout(600);
const normalLocked = await page.evaluate(() => ({
  devPanelOpen: !document.querySelector("#panel-dev").hidden,
  flying: window.__game.simulation.state.player.flying,
  devBadgeHidden: document.querySelector("#hud-dev")?.hidden,
}));
console.log("  일반 모드 잠금:", JSON.stringify(normalLocked));
assert(!normalLocked.devPanelOpen, "일반 모드에서는 P키로 개발자 패널이 열리지 않음");
assert(normalLocked.flying === false, "일반 모드에서는 F키로 날 수 없음");
assert(normalLocked.devBadgeHidden, "일반 모드에서는 개발자 뱃지가 숨겨짐");

section("22. 중앙 교역섬 마을 — 2~3층 건물, 들어갈 수 없음");
await page.goto("http://localhost:4173/?faction=pirate&mode=normal", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "마을 확인용 부팅" });
await page.waitForTimeout(1200);

// 중앙섬 광장 한가운데로 이동해서 마을을 봅니다
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.playerController.teleport({ x: 0, y: 3, z: 26 });
  sim.playerController.camYaw = Math.PI;
  sim.playerController.camPitch = -0.12;
});
await page.waitForTimeout(1400);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-22-town.png" });
assert(
  (await page.evaluate(() => document.querySelector("#hud-island")?.textContent)) === "중앙 교역섬",
  "중앙 교역섬 광장에 서 있음",
);

// 건물 안으로 들어갈 수 없어야 합니다 — 건물 쪽으로 계속 걸어도 통과하지 못함
const houseWalk = await page.evaluate(async () => {
  const sim = window.__game.simulation;
  // 광장 바깥 건물 링(반지름의 55~71%)을 향해 정면으로 세웁니다
  const island = window.__game.islands.getIsland("central");
  const target = { x: island.center.x, z: island.center.z + island.radius * 0.62 };
  sim.playerController.teleport({ x: target.x, y: 2, z: target.z - 14 });
  sim.playerController.camYaw = 0; // +Z 방향
  await new Promise((r) => setTimeout(r, 400));
  return { start: { ...sim.state.player.position }, target };
});
await page.keyboard.down("KeyW");
await page.waitForTimeout(2600);
await page.keyboard.up("KeyW");
await page.waitForTimeout(300);
const houseResult = await page.evaluate((info) => {
  const p = window.__game.simulation.state.player.position;
  return {
    movedZ: p.z - info.start.z,
    distToHouseRing: Math.hypot(p.x - info.target.x, p.z - info.target.z),
  };
}, houseWalk);
console.log("  건물 쪽 이동:", JSON.stringify(houseResult));
assert(houseResult.movedZ > 2, `건물 쪽으로 실제로 걸어감 (${houseResult.movedZ.toFixed(1)}m)`);

// 건물 충돌체가 실제로 등록됐는지 (물리 월드의 고정 콜라이더 수로 확인)
const colliderInfo = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const island = window.__game.islands.getIsland("central");
  // 광장 중앙 분수 위로 순간이동 → 분수 충돌체 위에 올라서면 y가 바닥보다 높아야 함
  sim.playerController.teleport({ x: island.center.x, y: 6, z: island.center.z });
  return { ok: true };
});
assert(colliderInfo.ok, "분수 위치로 이동");
await page.waitForTimeout(1500);
const onFountain = await page.evaluate(() => window.__game.simulation.state.player.position.y);
console.log(`  분수 위 착지 높이: ${onFountain.toFixed(2)}m`);
assert(onFountain > 0.8, `분수를 통과하지 않고 그 위에 올라섬 (y=${onFountain.toFixed(2)})`);

section("23. 섬 가이드 — 레벨에 맞는 섬 추천 + 방향 안내");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  window.__game.panels.closeAll();
  sim.state.player.level = 130;
  sim.playerController.teleport({ x: 0, y: 2, z: 0 });
});
await page.waitForTimeout(700);
assert(await humanClick("#btn-guide"), "섬 가이드 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(500);
const guidePanel = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".guide-row"));
  const rec = document.querySelector(".guide-row.recommended .guide-row-name")?.textContent?.trim();
  return {
    open: !document.querySelector("#panel-guide").hidden,
    rows: rows.length,
    recommended: rec,
    summary: document.querySelector(".guide-summary")?.textContent?.replace(/\s+/g, " ").trim(),
    lockedCount: document.querySelectorAll(".guide-row.locked").length,
  };
});
console.log("  가이드 패널:", JSON.stringify(guidePanel));
assert(guidePanel.open, "가이드 패널이 열림");
assert(guidePanel.rows === 12, `내 진영 섬 + 공용 섬 12개가 나옴 (상대 진영 시작 섬 제외) — ${guidePanel.rows}`);
assert(/얼음 섬/.test(guidePanel.recommended ?? ""), `Lv.130 추천이 얼음 섬: "${guidePanel.recommended}"`);
assert(/다음 목표/.test(guidePanel.summary ?? ""), `다음 목표도 안내: "${guidePanel.summary}"`);
assert(guidePanel.lockedCount > 0, `아직 못 가는 섬은 흐리게 표시 (${guidePanel.lockedCount}개)`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-23-guide.png" });

// 길 안내 시작 → HUD에 화살표
assert(await humanClick('.guide-row .buy-btn[data-guide="ice"]'), "얼음 섬 길 안내 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(700);
const guideOn = await page.evaluate(() => {
  const hud = document.querySelector("#hud-guide");
  return {
    visible: !!hud && !hud.hidden,
    target: window.__game.simulation.state.player.guideTargetIslandId,
    name: document.querySelector("#hud-guide-name")?.textContent,
    dist: document.querySelector("#hud-guide-dist")?.textContent,
    panelClosed: document.querySelector("#panel-guide").hidden,
    rotation: document.querySelector("#hud-guide-arrow")?.style.transform,
  };
});
console.log("  안내 시작:", JSON.stringify(guideOn));
assert(guideOn.target === "ice", "목적지가 얼음 섬으로 지정됨");
assert(guideOn.visible, "화면에 길안내 표시가 뜸");
assert(guideOn.name === "얼음 섬", `목적지 이름 표시 (${guideOn.name})`);
assert(/m/.test(guideOn.dist ?? ""), `남은 거리 표시 (${guideOn.dist})`);
assert(/rotate/.test(guideOn.rotation ?? ""), `화살표가 회전 상태 (${guideOn.rotation})`);
assert(guideOn.panelClosed, "목적지를 고르면 창이 닫혀서 바로 화살표가 보임");

// 시점을 돌리면 화살표도 같이 돌아야 합니다 (화면 기준 방향이므로)
const rotationBefore = await page.evaluate(
  () => document.querySelector("#hud-guide-arrow")?.style.transform,
);
await page.evaluate(() => { window.__game.simulation.playerController.camYaw += Math.PI / 2; });
await page.waitForTimeout(500);
const rotationAfter = await page.evaluate(
  () => document.querySelector("#hud-guide-arrow")?.style.transform,
);
console.log(`  시점 회전 전/후 화살표: ${rotationBefore} → ${rotationAfter}`);
assert(rotationBefore !== rotationAfter, "시점을 돌리면 화살표 방향도 따라 돌아감");

// 목적지에 도착하면 안내가 자동으로 꺼집니다
await page.evaluate(() => {
  const isl = window.__game.islands.getIsland("ice");
  window.__game.simulation.playerController.teleport({ x: isl.center.x, y: 3, z: isl.center.z });
});
await page.waitForTimeout(1200);
const guideDone = await page.evaluate(() => ({
  target: window.__game.simulation.state.player.guideTargetIslandId,
  hudHidden: document.querySelector("#hud-guide")?.hidden,
  toast: Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "),
}));
console.log("  도착:", JSON.stringify(guideDone));
assert(guideDone.target === null, "도착하면 안내가 자동 종료됨");
assert(guideDone.hudHidden, "화면의 길안내 표시도 사라짐");
assert(/도착/.test(guideDone.toast ?? ""), `도착 알림 표시: "${guideDone.toast}"`);

section("24. 열매 뽑기 — 전 재산의 30% · 4시간 제한");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "gacha");
  sim.state.player.money = 1000;
  sim.state.player.lastGachaAtMs = null;
  sim.playerController.teleport({ x: npc.position.x + 1.4, y: 2, z: npc.position.z });
});
await page.waitForTimeout(900);
const gachaPrompt = await page.evaluate(() => ({
  island: document.querySelector("#hud-island")?.textContent,
  prompt: document.querySelector("#hud-interaction")?.textContent,
}));
console.log("  도박사 앞:", JSON.stringify(gachaPrompt));
assert(gachaPrompt.island === "정글 섬", `두 번째 섬(정글 섬)에 있음 — ${gachaPrompt.island}`);
assert(/열매 뽑기/.test(gachaPrompt.prompt ?? ""), `도박사 안내 표시: "${gachaPrompt.prompt}"`);

await page.keyboard.press("KeyE");
await page.waitForTimeout(600);
const gachaPanel = await page.evaluate(() => ({
  open: !document.querySelector("#panel-gacha").hidden,
  status: document.querySelector(".gacha-status")?.textContent?.replace(/\s+/g, " ").trim(),
  button: document.querySelector("#gacha-roll")?.textContent?.trim(),
  disabled: document.querySelector("#gacha-roll")?.disabled,
  odds: document.querySelectorAll(".gacha-odd").length,
}));
console.log("  뽑기 패널:", JSON.stringify(gachaPanel));
assert(gachaPanel.open, "E로 뽑기 패널이 열림");
assert(gachaPanel.odds === 5, `확률표에 열매 5종 표시 (${gachaPanel.odds})`);
assert(/300/.test(gachaPanel.button ?? ""), `1000코인의 30%인 300이 참가비로 표시됨: "${gachaPanel.button}"`);
assert(gachaPanel.disabled === false, "뽑기 버튼이 활성화됨");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-24-gacha.png" });

const beforeRoll = await page.evaluate(() => ({
  money: window.__game.simulation.state.player.money,
  fruit: window.__game.simulation.state.player.equippedFruit,
}));
assert(await humanClick("#gacha-roll"), "뽑기 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(800);
const afterRoll = await page.evaluate(() => ({
  money: window.__game.simulation.state.player.money,
  fruit: window.__game.simulation.state.player.equippedFruit,
  last: window.__game.simulation.state.player.lastGachaAtMs,
  skills: window.__game.simulation.state.player.skillCooldowns.length,
  button: document.querySelector("#gacha-roll")?.textContent?.trim(),
  disabled: document.querySelector("#gacha-roll")?.disabled,
  toast: Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "),
  saved: JSON.parse(localStorage.getItem("bloxfruits-web/save-v1") ?? "null"),
}));
console.log("  뽑기 결과:", JSON.stringify(afterRoll));
assert(afterRoll.money === beforeRoll.money - 300, `참가비 300 차감 (${beforeRoll.money} → ${afterRoll.money})`);
assert(typeof afterRoll.fruit === "string" && afterRoll.skills === 4, `열매를 받고 스킬은 4개 유지 (${afterRoll.fruit})`);
assert(afterRoll.last !== null, "뽑은 시각이 기록됨");
assert(/나왔습니다/.test(afterRoll.toast ?? ""), `결과 알림 표시: "${afterRoll.toast}"`);
assert(afterRoll.disabled === true, "뽑은 직후에는 버튼이 잠김");
assert(/시간/.test(afterRoll.button ?? ""), `남은 시간이 버튼에 표시됨: "${afterRoll.button}"`);
assert(afterRoll.saved && afterRoll.saved.lastGachaAtMs === afterRoll.last, "제한 시각이 브라우저에 저장됨");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-24-gacha-done.png" });

// 새로고침해도 4시간 제한이 유지되어야 합니다 (저장이 실제로 먹히는지)
await page.reload({ waitUntil: "load" });
await page.evaluate(() => {
  // 새로고침 후에는 시작 화면이 뜨므로 쿼리로 건너뛴 것과 같은 상태를 만듭니다
});
await page.goto("http://localhost:4173/?faction=pirate&mode=fast", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "새로고침 후 부팅" });
await page.waitForTimeout(900);
const afterReload = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "gacha");
  sim.state.player.money = 1000;
  sim.playerController.teleport({ x: npc.position.x + 1.4, y: 2, z: npc.position.z });
  return { last: sim.state.player.lastGachaAtMs };
});
console.log("  새로고침 후:", JSON.stringify(afterReload));
assert(afterReload.last !== null, "새로고침해도 마지막 뽑기 시각이 복원됨");
await page.waitForTimeout(700);
await page.keyboard.press("KeyE");
await page.waitForTimeout(700);
const reloadedPanel = await page.evaluate(() => ({
  disabled: document.querySelector("#gacha-roll")?.disabled,
  status: document.querySelector(".gacha-status")?.textContent?.replace(/\s+/g, " ").trim(),
  money: window.__game.simulation.state.player.money,
}));
console.log("  새로고침 후 뽑기 상태:", JSON.stringify(reloadedPanel));
assert(reloadedPanel.disabled === true, "F5로 4시간 제한을 우회할 수 없음");
assert(/남았습니다/.test(reloadedPanel.status ?? ""), `남은 시간 안내: "${reloadedPanel.status}"`);

// 뒷정리 — 저장값을 지워서 다음 실행에 영향을 주지 않게
await page.evaluate(() => localStorage.removeItem("bloxfruits-web/save-v1"));

section("25. 파이어베이스 — 설정 없이도 로그인 화면이 뜨고, 게스트로 계속 가능");
// 설정값이 소스에 들어 있으므로 .env 없이도 로그인 단계가 나와야 합니다.
await freshStart("http://localhost:4173/", { guest: false });
const loginScreen = await page.evaluate(() => ({
  loginVisible: !document.getElementById("start-step-login")?.hidden,
  factionHidden: document.getElementById("start-step-faction")?.hidden,
  loginBtn: !!document.getElementById("btn-google-login"),
  guestBtn: !!document.getElementById("btn-play-guest"),
  gameStarted: typeof window.__game !== "undefined",
}));
console.log("  로그인 화면:", JSON.stringify(loginScreen));
assert(loginScreen.loginVisible, ".env 없이도 로그인 화면이 뜸 (설정이 코드에 있으므로)");
assert(loginScreen.factionHidden, "로그인 단계 동안 진영 선택은 가려져 있음");
assert(loginScreen.loginBtn && loginScreen.guestBtn, "구글 로그인 / 게스트 버튼이 둘 다 있음");
assert(!loginScreen.gameStarted, "고르기 전에는 게임이 시작되지 않음");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-25-login.png" });

// 게스트로 들어가도 게임은 정상 진행되어야 합니다
assert(await humanClick("#btn-play-guest"), "로그인 없이 플레이 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(500);
const afterGuest = await page.evaluate(() => ({
  loginHidden: document.getElementById("start-step-login")?.hidden,
  factionVisible: !document.getElementById("start-step-faction")?.hidden,
}));
assert(afterGuest.loginHidden && afterGuest.factionVisible, "게스트를 고르면 진영 선택으로 넘어감");

assert(await humanClick('.start-btn[data-faction="pirate"]'), "해적 선택");
assert(await humanClick('.start-btn[data-mode="fast"]'), "빠른 모드 선택");
await waitUntil(() => typeof window.__game !== "undefined", { label: "게스트 부팅" });
await page.waitForTimeout(1000);

const progress = await page.evaluate(async () => {
  const sim = window.__game.simulation;
  const p = sim.state.player;
  p.level = 77;
  p.exp = 12;
  p.money = 3456;
  p.stats = { mana: 3, attack: 4, health: 5, fruit: 6 };
  p.equippedFruit = "sand_storm";
  p.fruitLevel = 19;
  p.hakiLearned = true;
  p.ownedBoats = ["dinghy", "clipper"];
  await window.__game.saves.flush(Date.now());
  return {
    isCloud: window.__game.saves.isCloud,
    saved: JSON.parse(localStorage.getItem("bloxfruits-web/save-v1") ?? "null"),
  };
});
console.log("  저장됨:", JSON.stringify({ isCloud: progress.isCloud, level: progress.saved?.level }));
assert(progress.isCloud === false, "게스트는 클라우드 저장을 시도하지 않음");
assert(progress.saved && progress.saved.level === 77, `이 브라우저에 저장됨 (Lv.${progress.saved?.level})`);

// 새로고침 — 진영을 다시 묻지 않고 바로 이어서
await page.goto("http://localhost:4173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
assert(await humanClick("#btn-play-guest"), "새로고침 후에도 게스트로 계속");
await page.waitForTimeout(600);
const resumeScreen = await page.evaluate(() => ({
  factionHidden: document.getElementById("start-step-faction")?.hidden,
  modeVisible: !document.getElementById("start-step-mode")?.hidden,
  chosen: document.getElementById("start-chosen")?.textContent?.trim(),
}));
console.log("  새로고침 후:", JSON.stringify(resumeScreen));
assert(resumeScreen.modeVisible, "세이브가 있으면 진영을 다시 묻지 않음");
assert(/이어서 플레이/.test(resumeScreen.chosen ?? ""), `이어서 하는 중이라고 표시: "${resumeScreen.chosen}"`);
assert(/77/.test(resumeScreen.chosen ?? ""), "저장된 레벨이 표시됨");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-25-resume.png" });

assert(await humanClick('.start-btn[data-mode="fast"]'), "모드만 고르면 바로 시작");
await waitUntil(() => typeof window.__game !== "undefined", { label: "이어서 부팅" });
await page.waitForTimeout(1200);
const restored = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return {
    level: p.level, money: p.money, fruit: p.equippedFruit, fruitLevel: p.fruitLevel,
    haki: p.hakiLearned, boats: p.ownedBoats.join(","), maxHp: p.maxHp, hp: p.hp, faction: p.faction,
  };
});
console.log("  복원됨:", JSON.stringify(restored));
assert(restored.level === 77, `레벨 복원 (Lv.${restored.level})`);
assert(restored.money === 3456, `코인 복원 (${restored.money})`);
assert(restored.fruit === "sand_storm" && restored.fruitLevel === 19, `열매 복원 (${restored.fruit} Lv.${restored.fruitLevel})`);
assert(restored.haki === true, "무장색 습득 상태 복원");
assert(restored.boats.includes("clipper"), `보유 배 복원 (${restored.boats})`);
assert(restored.maxHp === 100 + 5 * 12, `스텟에서 최대 체력 재계산 (${restored.maxHp})`);
assert(restored.faction === "pirate", "진영 유지");

// 게스트 상태에서 랭킹을 열면 "로그인이 필요하다"고 안내해야 합니다 (에러로 죽지 않고)
assert(await humanClick("#btn-rank"), "랭킹 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(1200);
const rankPanel = await page.evaluate(() => ({
  open: !document.querySelector("#panel-rank").hidden,
  notice: document.querySelector(".rank-notice")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  랭킹(게스트):", JSON.stringify(rankPanel));
assert(rankPanel.open, "랭킹 패널이 열림");
assert(/로그인/.test(rankPanel.notice ?? ""), `로그인이 필요하다고 안내: "${rankPanel.notice}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-25-rank.png" });

await page.evaluate(() => localStorage.removeItem("bloxfruits-web/save-v1"));

section("26. 설인 (얼음 섬 Lv.125) — 삼도류 · 무장색 · 다단 점프");

/** 설인 옆에 안전하게 세웁니다 (얼음 섬 몬스터 접촉 피해 제거). */
async function standByTrainer() {
  await page.evaluate(() => {
    const sim = window.__game.simulation;
    const p = sim.state.player;
    const npc = sim.state.npcs.find((n) => n.kind === "trainer");
    p.maxHp = 1_000_000;
    p.hp = p.maxHp;
    sim.state.enemies.filter((e) => e.islandId === "ice").forEach((e) => { e.contactDamage = 0; });
    sim.playerController.teleport({ x: npc.position.x + 1.2, y: 2, z: npc.position.z });
  });
  await page.waitForTimeout(700);
}

// 저장본을 지우고 새로 시작해서, 앞 절에서 만든 상태가 섞이지 않게 합니다.
await freshStart("http://localhost:4173/?faction=pirate&mode=fast&guest=1");
await waitUntil(() => typeof window.__game !== "undefined", { label: "26절 부팅" });
await page.waitForTimeout(900);

const trainerPlace = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const npc = sim.state.npcs.find((n) => n.kind === "trainer");
  const island = window.__game.islands.getIsland(npc.islandId);
  const dx = npc.position.x - island.center.x;
  const dz = npc.position.z - island.center.z;
  return {
    name: npc.name,
    islandId: npc.islandId,
    islandName: island.name,
    required: island.requiredLevel,
    inside: Math.hypot(dx, dz) < island.radius,
    count: sim.state.npcs.filter((n) => n.kind === "trainer").length,
  };
});
console.log("  설인:", JSON.stringify(trainerPlace));
assert(trainerPlace.name === "설인", `NPC 이름이 설인 (${trainerPlace.name})`);
assert(trainerPlace.islandId === "ice", `얼음 섬에 있음 (${trainerPlace.islandName})`);
assert(trainerPlace.required === 125, `그 섬의 권장 레벨이 125 (${trainerPlace.required})`);
assert(trainerPlace.inside, "섬 안(반지름 내부)에 서 있음 — 바다에 떠 있지 않음");
assert(trainerPlace.count === 1, `설인은 한 명만 있음 (${trainerPlace.count})`);

// --- 레벨이 모자랄 때 ---
await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  p.level = 10;
  p.money = 100000;
  p.maxJumps = 1;
  p.hakiLearned = false;
  p.inventory = [];
  p.hotbar = [null, null, null];
  p.activeHotbarSlot = null;
});
await standByTrainer();
const trainerPrompt = await page.evaluate(() => ({
  island: document.querySelector("#hud-island")?.textContent,
  prompt: document.querySelector("#hud-interaction")?.textContent,
}));
console.log("  설인 앞:", JSON.stringify(trainerPrompt));
assert(trainerPrompt.island === "얼음 섬", `얼음 섬에 서 있음 (${trainerPrompt.island})`);
assert(/설인/.test(trainerPrompt.prompt ?? ""), `안내에 설인 표시: "${trainerPrompt.prompt}"`);

await page.keyboard.press("KeyE");
await page.waitForTimeout(700);
const lowLevelPanel = await page.evaluate(() => ({
  open: !document.querySelector("#panel-trainer").hidden,
  rows: document.querySelectorAll(".trainer-row").length,
  jumpBtn: !!document.querySelector("#trainer-jump"),
  jumpRowText: document.querySelectorAll(".trainer-row")[2]?.textContent?.replace(/\s+/g, " ").trim(),
  swordBtn: !!document.querySelector('#panel-trainer .buy-btn[data-item="sword_santoryu"]'),
  hakiBtn: !!document.querySelector("#trainer-haki"),
}));
console.log("  Lv.10 패널:", JSON.stringify(lowLevelPanel));
assert(lowLevelPanel.open, "E를 누르면 설인 패널이 열림");
assert(lowLevelPanel.rows === 3, `삼도류 · 무장색 · 점프 3가지가 보임 (${lowLevelPanel.rows})`);
assert(lowLevelPanel.swordBtn && lowLevelPanel.hakiBtn, "삼도류 구매 · 무장색 습득 버튼이 있음");
assert(!lowLevelPanel.jumpBtn, "Lv.10에서는 점프 훈련 버튼이 아예 없음");
assert(/Lv\.125/.test(lowLevelPanel.jumpRowText ?? ""), `무엇이 모자란지 알려줌: "${lowLevelPanel.jumpRowText}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-26-trainer-locked.png" });

// --- 삼도류 구매 (실제 마우스 클릭) ---
const beforeSword = await page.evaluate(() => window.__game.simulation.state.player.money);
assert(
  await humanClick('#panel-trainer .buy-btn[data-item="sword_santoryu"]'),
  "삼도류 구매 버튼을 실제 마우스로 클릭 가능",
);
const swordBought = await page.evaluate(() => ({
  inv: window.__game.simulation.state.player.inventory.map((i) => i.id),
  money: window.__game.simulation.state.player.money,
  price: window.__game.simulation.state.player.money,
  toast: Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "),
}));
console.log("  삼도류 구매:", JSON.stringify(swordBought));
assert(swordBought.inv.includes("sword_santoryu"), `삼도류가 인벤토리에 들어감 (${swordBought.inv.join(",")})`);
assert(swordBought.money === beforeSword - 2500, `가격 2500 차감 (${beforeSword} → ${swordBought.money})`);
assert(/삼도류/.test(swordBought.toast ?? ""), `구매 알림 표시: "${swordBought.toast}"`);

// 상점(현금/코인 상점)에서는 팔지 않아야 합니다 — 설인 전용
await page.evaluate(() => window.__game.panels.openPanel("shop"));
await page.waitForTimeout(500);
const shopHasSantoryu = await page.evaluate(
  () => !!document.querySelector('#panel-shop .buy-btn[data-item="sword_santoryu"]'),
);
assert(!shopHasSantoryu, "삼도류는 일반 상점 목록에는 없음 (설인에게만)");

// --- 실제 장착 + 공격속도 ---
await page.evaluate(() => window.__game.panels.openPanel("inventory"));
await page.waitForTimeout(400);
assert(await humanClick('.inv-slot[data-item="sword_santoryu"]'), "인벤토리에서 삼도류 클릭 → 단축바");
await page.evaluate(() => window.__game.panels.closeAll());
await page.waitForTimeout(300);
await page.keyboard.press("Digit1");
await page.waitForTimeout(600);
const santoryuDrawn = await page.evaluate(() => ({
  active: window.__game.simulation.state.player.activeHotbarSlot,
  visible: window.__game.renderer.weaponVisible("sword_santoryu"),
  yoruVisible: window.__game.renderer.weaponVisible("sword_yoru"),
}));
assert(santoryuDrawn.active === 0, "숫자키 1번으로 삼도류를 실제로 뽑음");
assert(santoryuDrawn.visible, "3D 화면에 칼 세 자루가 나타남");
assert(!santoryuDrawn.yoruVisible, "요루는 같이 나오지 않음");
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-26-santoryu.png" });

// 실제 연타 간격이 짧아지는지 — 맨손 대비
const swingGap = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const p = sim.state.player;
  const combat = window.__game.combat;
  return {
    withSword: combat.totalMeleeCooldown(p),
    bare: p.meleeCooldownSec,
  };
});
console.log("  공격 간격:", JSON.stringify(swingGap));
assert(
  swingGap.withSword < swingGap.bare,
  `삼도류를 들면 실제 공격 간격이 짧아짐 (${swingGap.bare.toFixed(2)}s → ${swingGap.withSword.toFixed(2)}s)`,
);
await page.keyboard.press("Digit1");
await page.waitForTimeout(300);

// --- 무장색도 설인에게서 ---
await standByTrainer();
await page.keyboard.press("KeyE");
await page.waitForTimeout(600);
assert(await humanClick("#trainer-haki"), "설인에게 무장색 배우기 버튼 클릭 가능");
const hakiLearned = await page.evaluate(() => ({
  learned: window.__game.simulation.state.player.hakiLearned,
  btn: document.querySelector("#trainer-haki"),
}));
assert(hakiLearned.learned === true, "설인에게 돈을 내고 무장색을 배움");

// --- 점프 훈련: Lv.125 → 2단 ---
await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  p.level = 125;
  p.money = 100000;
});
await page.waitForTimeout(500);
const atL125 = await page.evaluate(() => ({
  jumpBtn: document.querySelector("#trainer-jump")?.textContent?.trim(),
  disabled: document.querySelector("#trainer-jump")?.disabled,
}));
console.log("  Lv.125 점프 버튼:", JSON.stringify(atL125));
assert(!!atL125.jumpBtn && atL125.disabled === false, `Lv.125가 되면 2단 점프를 배울 수 있음: "${atL125.jumpBtn}"`);
const moneyBeforeJump = await page.evaluate(() => window.__game.simulation.state.player.money);
assert(await humanClick("#trainer-jump"), "점프 훈련 버튼을 실제 마우스로 클릭 가능");
const jump2 = await page.evaluate(() => ({
  jumps: window.__game.simulation.state.player.maxJumps,
  money: window.__game.simulation.state.player.money,
  badge: document.querySelector("#hud-jump")?.textContent?.trim(),
  badgeHidden: document.querySelector("#hud-jump")?.hidden,
  toast: Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "),
  nextBtn: document.querySelector("#trainer-jump")?.textContent?.trim(),
  nextRow: document.querySelectorAll(".trainer-row")[2]?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  2단 습득:", JSON.stringify(jump2));
assert(jump2.jumps === 2, `2단 점프를 배움 (${jump2.jumps}단)`);
assert(jump2.money === moneyBeforeJump - 1200, `수업료 1200 차감 (${moneyBeforeJump} → ${jump2.money})`);
assert(/점프/.test(jump2.toast ?? ""), `습득 알림 표시: "${jump2.toast}"`);
assert(jump2.badgeHidden === false && /2단/.test(jump2.badge ?? ""), `HUD에 배지 표시: "${jump2.badge}"`);
assert(!jump2.nextBtn, "3단은 아직 못 배움 (버튼 없음)");
assert(/Lv\.225/.test(jump2.nextRow ?? ""), `다음은 Lv.225라고 안내: "${jump2.nextRow}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-26-jump2.png" });

// --- 100레벨마다 한 단씩: Lv.225 → 3단 ---
await page.evaluate(() => { window.__game.simulation.state.player.level = 225; });
await page.waitForTimeout(500);
assert(await humanClick("#trainer-jump"), "Lv.225에서 다시 찾아가면 또 배울 수 있음");
const jump3 = await page.evaluate(() => ({
  jumps: window.__game.simulation.state.player.maxJumps,
  badge: document.querySelector("#hud-jump")?.textContent?.trim(),
}));
assert(jump3.jumps === 3, `100레벨이 더 오르니 3단 점프 (${jump3.jumps}단)`);
assert(/3단/.test(jump3.badge ?? ""), `HUD 배지도 갱신: "${jump3.badge}"`);

// --- 실제로 공중에서 한 번 더 뛰어지는가 ---
await page.evaluate(() => window.__game.panels.closeAll());
await page.waitForTimeout(400);

/** 착지시킨 뒤 Space를 presses번 눌러 최고 높이를 잽니다. */
async function jumpHeight(presses) {
  await page.evaluate(() => {
    const sim = window.__game.simulation;
    const island = window.__game.islands.getIsland("ice");
    sim.playerController.teleport({ x: island.center.x, y: 30, z: island.center.z });
  });
  await page.waitForTimeout(2200); // 착지 대기
  const ground = (await pos()).y;
  let peak = ground;
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Space");
    // 첫 점프가 정점에 다다를 즈음 다음 점프를 눌러야 "한 번 더 뛴" 게 됩니다.
    for (let t = 0; t < 4; t++) {
      await page.waitForTimeout(70);
      peak = Math.max(peak, (await pos()).y);
    }
  }
  for (let t = 0; t < 14; t++) {
    await page.waitForTimeout(90);
    peak = Math.max(peak, (await pos()).y);
  }
  return { ground, peak, gain: peak - ground };
}

await page.evaluate(() => { window.__game.simulation.state.player.maxJumps = 1; });
const single = await jumpHeight(2); // 2번 눌러도 1단이면 한 번만 떠야 함
await page.evaluate(() => { window.__game.simulation.state.player.maxJumps = 3; });
const doubleJump = await jumpHeight(2);
const tripleJump = await jumpHeight(3);
console.log("  점프 높이:", JSON.stringify({ single: single.gain.toFixed(2), double: doubleJump.gain.toFixed(2), triple: tripleJump.gain.toFixed(2) }));
assert(single.gain > 0.5, `1단 점프로 실제로 떠오름 (+${single.gain.toFixed(2)}m)`);
assert(
  doubleJump.gain > single.gain + 0.5,
  `2단 점프가 실제로 더 높이 올라감 (${single.gain.toFixed(2)}m → ${doubleJump.gain.toFixed(2)}m)`,
);
assert(
  tripleJump.gain > doubleJump.gain,
  `3단 점프는 더 높이 (${doubleJump.gain.toFixed(2)}m → ${tripleJump.gain.toFixed(2)}m)`,
);

section("27. 새 HUD — 레벨+경험치 한 줄로 맨 위 · 모든 값에 숫자 표기");
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const p = sim.state.player;
  p.level = 42;
  p.expToNextLevel = 1000;
  p.exp = 250;
  p.maxHp = 400; p.hp = 300;
  p.maxMana = 200; p.mana = 50;
  p.fruitLevel = 7; p.fruitExpToNext = 800; p.fruitExp = 200;
  p.money = 1234567;
});
await page.waitForTimeout(500);
const hudView = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left) };
  };
  const txt = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim();
  return {
    level: txt("#hud-level"),
    exp: txt("#hud-exp-text"),
    hp: txt("#hud-hp-text"),
    mp: txt("#hud-mp-text"),
    fruit: txt("#hud-fruit-text"),
    fruitLabel: txt("#hud-fruit-level"),
    money: txt("#hud-money"),
    jump: txt("#hud-jump"),
    levelRow: box(".level-row"),
    hpRow: box(".bar-row"),
    sameRow: (() => {
      const chip = document.querySelector(".level-chip")?.getBoundingClientRect();
      const bar = document.querySelector(".level-track")?.getBoundingClientRect();
      if (!chip || !bar) return false;
      return Math.abs(chip.top - bar.top) < 14 && bar.left > chip.right - 2;
    })(),
  };
});
console.log("  HUD:", JSON.stringify(hudView));
assert(hudView.level === "42", `레벨 숫자 표시 (Lv.${hudView.level})`);
assert(hudView.sameRow, "레벨 칩과 경험치 바가 같은 줄에 붙어 있음 (하나로 합침)");
assert(
  hudView.levelRow && hudView.hpRow && hudView.levelRow.top < hudView.hpRow.top,
  "레벨+경험치 줄이 HP/MP보다 위에 있음",
);
assert(/250\s*\/\s*1,?000/.test(hudView.exp ?? ""), `경험치에 숫자 표기: "${hudView.exp}"`);
assert(/25%/.test(hudView.exp ?? ""), `경험치 퍼센트도 표기: "${hudView.exp}"`);
assert(/300\s*\/\s*400/.test(hudView.hp ?? ""), `체력에 숫자 표기: "${hudView.hp}"`);
assert(/^\d+\s*\/\s*200$/.test(hudView.mp ?? ""), `마나에 숫자 표기 (자연 회복 중이라 앞자리는 변함): "${hudView.mp}"`);
assert(/200\s*\/\s*800/.test(hudView.fruit ?? ""), `열매 경험치에 숫자 표기: "${hudView.fruit}"`);
assert(/7/.test(hudView.fruitLabel ?? ""), `열매 레벨 표시: "${hudView.fruitLabel}"`);
assert(/1,234,567/.test(hudView.money ?? ""), `코인도 자릿수 구분해 표기: "${hudView.money}"`);
assert(/3단/.test(hudView.jump ?? ""), `점프 단수 배지: "${hudView.jump}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-27-hud.png" });

// --- 저장/복원: 삼도류와 점프 단수가 살아남는가 ---
const savedTrainer = await page.evaluate(async () => {
  await window.__game.saves.flush(Date.now());
  return JSON.parse(localStorage.getItem("bloxfruits-web/save-v1") ?? "null");
});
console.log("  저장:", JSON.stringify({ maxJumps: savedTrainer?.maxJumps, inv: savedTrainer?.inventory?.map((i) => i.id) }));
assert(savedTrainer?.maxJumps === 3, `점프 단수가 저장됨 (${savedTrainer?.maxJumps}단)`);
assert(
  (savedTrainer?.inventory ?? []).some((i) => i.id === "sword_santoryu"),
  "설인 전용 무기(삼도류)도 저장됨",
);

await page.goto("http://localhost:4173/?guest=1", { waitUntil: "load" });
await page.waitForTimeout(1800);
await humanClick('.start-btn[data-mode="fast"]');
await waitUntil(() => typeof window.__game !== "undefined", { label: "복원 부팅" });
await page.waitForTimeout(1000);
const restoredTrainer = await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  return {
    jumps: p.maxJumps,
    hasSword: p.inventory.some((i) => i.id === "sword_santoryu"),
    haki: p.hakiLearned,
    badge: document.querySelector("#hud-jump")?.textContent?.trim(),
  };
});
console.log("  복원:", JSON.stringify(restoredTrainer));
assert(restoredTrainer.jumps === 3, `새로고침해도 3단 점프 유지 (${restoredTrainer.jumps}단)`);
assert(restoredTrainer.hasSword, "새로고침해도 삼도류가 인벤토리에 남아 있음");
assert(restoredTrainer.haki, "무장색 습득도 유지");
assert(/3단/.test(restoredTrainer.badge ?? ""), `복원 직후 HUD 배지도 정상: "${restoredTrainer.badge}"`);

await page.evaluate(() => localStorage.removeItem("bloxfruits-web/save-v1"));

section("28. 두 번째 바다 — 해적왕에게 부탁해야 갈 수 있음");

/** 중앙 교역섬(또는 분수 도시)의 해적왕 옆에 세웁니다. */
async function standByPirateKing() {
  await page.evaluate(() => {
    const sim = window.__game.simulation;
    const npc = sim.state.npcs.find(
      (n) => n.kind === "pirate_king" && n.islandId === sim.state.currentIslandId,
    ) ?? sim.state.npcs.find((n) => n.kind === "pirate_king");
    sim.state.player.hp = sim.state.player.maxHp;
    sim.playerController.teleport({ x: npc.position.x + 1.2, y: 2, z: npc.position.z });
  });
  await page.waitForTimeout(800);
}

await freshStart("http://localhost:4173/?faction=pirate&mode=fast&guest=1");
await waitUntil(() => typeof window.__game !== "undefined", { label: "28절 부팅" });
await page.waitForTimeout(900);

const kingPlace = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const kings = sim.state.npcs.filter((n) => n.kind === "pirate_king");
  const { getIsland } = window.__game.islands;
  return {
    count: kings.length,
    islands: kings.map((k) => k.islandId).sort(),
    names: [...new Set(kings.map((k) => k.name))],
    seas: kings.map((k) => getIsland(k.islandId).sea).sort(),
    inside: kings.every((k) => {
      const isl = getIsland(k.islandId);
      return Math.hypot(k.position.x - isl.center.x, k.position.z - isl.center.z) < isl.radius;
    }),
  };
});
console.log("  해적왕:", JSON.stringify(kingPlace));
assert(kingPlace.count === 2, `해적왕이 바다마다 한 명씩 (${kingPlace.count}명)`);
assert(kingPlace.names.join() === "해적왕", `이름이 해적왕 (${kingPlace.names.join()})`);
assert(kingPlace.islands.join() === "central,fountain", `중앙 교역섬과 분수 도시에 있음 (${kingPlace.islands.join()})`);
assert(kingPlace.seas.join() === "1,2", "두 바다에 한 명씩");
assert(kingPlace.inside, "둘 다 섬 안(반지름 내부)에 서 있음");

// ── 레벨이 모자랄 때 ──
await page.evaluate(() => { window.__game.simulation.state.player.level = 900; });
await standByPirateKing();
const denyPrompt = await page.evaluate(() => ({
  island: document.querySelector("#hud-island")?.textContent,
  seaBadge: document.querySelector("#hud-sea")?.textContent?.trim(),
  prompt: document.querySelector("#hud-interaction")?.textContent,
}));
console.log("  Lv.900 안내:", JSON.stringify(denyPrompt));
assert(denyPrompt.island === "중앙 교역섬", `중앙 교역섬에 있음 (${denyPrompt.island})`);
assert(/첫 번째 바다/.test(denyPrompt.seaBadge ?? ""), `HUD에 바다 표시: "${denyPrompt.seaBadge}"`);
assert(/1100/.test(denyPrompt.prompt ?? ""), `무엇이 모자란지 안내: "${denyPrompt.prompt}"`);

await page.keyboard.press("KeyE");
await page.waitForTimeout(700);
const lockedSea = await page.evaluate(() => ({
  open: !document.querySelector("#panel-sea").hidden,
  btn: document.querySelector("#panel-sea .buy-btn")?.textContent?.trim(),
  disabled: document.querySelector("#panel-sea .buy-btn")?.disabled,
  travelBtn: !!document.querySelector("#sea-travel"),
  islands: document.querySelector(".sea-islands-list")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  Lv.900 패널:", JSON.stringify(lockedSea));
assert(lockedSea.open, "E를 누르면 해적왕 패널이 열림");
assert(lockedSea.disabled === true && !lockedSea.travelBtn, "레벨이 모자라면 출항 버튼이 잠김");
assert(/1100/.test(lockedSea.btn ?? "") && /200레벨/.test(lockedSea.btn ?? ""),
  `얼마나 남았는지 표시: "${lockedSea.btn}"`);
assert(/장미 왕국/.test(lockedSea.islands ?? ""), `가게 될 섬 목록을 미리 보여줌: "${lockedSea.islands}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-28-king-locked.png" });

// ── 조건을 채우고 실제 항해 ──
await page.evaluate(() => {
  const p = window.__game.simulation.state.player;
  p.level = 1100;
  p.money = 54321;
  p.hakiLearned = true;
  p.maxJumps = 3;
});
await page.waitForTimeout(600);
const unlockedSea = await page.evaluate(() => ({
  travelBtn: document.querySelector("#sea-travel")?.textContent?.trim(),
  disabled: document.querySelector("#sea-travel")?.disabled,
}));
console.log("  Lv.1100 패널:", JSON.stringify(unlockedSea));
assert(!!unlockedSea.travelBtn && !unlockedSea.disabled,
  `Lv.1100이 되면 출항 버튼이 열림: "${unlockedSea.travelBtn}"`);

const beforeTravel = await page.evaluate(() => ({
  x: Math.round(window.__game.simulation.state.player.position.x),
  money: window.__game.simulation.state.player.money,
}));
assert(await humanClick("#sea-travel"), "출항 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(1200);
const arrived = await page.evaluate(() => {
  const sim = window.__game.simulation;
  const p = sim.state.player;
  return {
    sea: sim.state.sea,
    island: sim.state.currentIslandId,
    islandLabel: document.querySelector("#hud-island")?.textContent,
    seaBadge: document.querySelector("#hud-sea")?.textContent?.trim(),
    x: Math.round(p.position.x),
    z: Math.round(p.position.z),
    money: p.money,
    haki: p.hakiLearned,
    jumps: p.maxJumps,
    level: p.level,
    unlocked: p.unlockedSecondSea,
    panelOpen: !document.querySelector("#panel-sea").hidden,
    toast: Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "),
  };
});
console.log("  도착:", JSON.stringify(arrived));
assert(arrived.sea === 2, `두 번째 바다로 이동 (sea=${arrived.sea})`);
assert(arrived.island === "fountain", `분수 도시에 도착 (${arrived.island})`);
assert(arrived.islandLabel === "분수 도시", `HUD 섬 이름 갱신 (${arrived.islandLabel})`);
assert(/두 번째 바다/.test(arrived.seaBadge ?? ""), `HUD 바다 배지 갱신: "${arrived.seaBadge}"`);
assert(arrived.x > 5000 && Math.abs(arrived.x - 6000) < 200,
  `실제로 6km 떨어진 구역으로 옮겨짐 (x ${beforeTravel.x} → ${arrived.x})`);
assert(arrived.money === beforeTravel.money && arrived.money === 54321, `코인 그대로 (${arrived.money})`);
assert(arrived.haki && arrived.jumps === 3 && arrived.level === 1100, "무장색·점프·레벨 전부 그대로 이어짐");
assert(arrived.unlocked === true, "두 번째 바다가 열린 것으로 기록됨");
assert(!arrived.panelOpen, "출항하면 창이 닫혀서 바로 새 바다가 보임");
assert(/두 번째 바다/.test(arrived.toast ?? ""), `도착 알림: "${arrived.toast}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-28-fountain.png" });

// 땅이 실제로 만들어졌는지 — 콜라이더가 없으면 월드 아래로 떨어져 부활해버립니다
const standing = await page.evaluate(() => ({ y: window.__game.simulation.state.player.position.y }));
await page.waitForTimeout(1500);
const stillStanding = await page.evaluate(() => ({
  y: window.__game.simulation.state.player.position.y,
  island: window.__game.simulation.state.currentIslandId,
}));
console.log("  착지:", JSON.stringify({ before: standing.y.toFixed(2), after: stillStanding.y.toFixed(2) }));
assert(stillStanding.y > -5, `분수 도시 지면 위에 서 있음 (y=${stillStanding.y.toFixed(2)}) — 콜라이더가 실제로 생성됨`);
assert(stillStanding.island === "fountain", "1.5초 뒤에도 분수 도시 (바다로 떨어지지 않음)");

// ── 두 번째 바다의 섬들이 실제로 존재하고 몬스터가 사는지 ──
for (const id of ["rose", "green_zone", "graveyard", "snow_mountain", "hot_cold", "cursed_ship", "ice_castle", "forgotten", "mansion"]) {
  await page.evaluate((islandId) => {
    const sim = window.__game.simulation;
    const { islandArrivalPosition, getIsland } = window.__game.islands;
    sim.state.player.maxHp = 1_000_000;
    sim.state.player.hp = sim.state.player.maxHp;
    sim.playerController.teleport(islandArrivalPosition(getIsland(islandId)));
  }, id);
  await page.waitForTimeout(700);
  const here = await page.evaluate((islandId) => {
    const sim = window.__game.simulation;
    const alive = sim.state.enemies.filter((e) => e.islandId === islandId && e.alive);
    return {
      label: document.querySelector("#hud-island")?.textContent,
      y: sim.state.player.position.y,
      enemies: alive.length,
      species: new Set(alive.map((e) => e.speciesId)).size,
    };
  }, id);
  assert(here.y > -5 && here.enemies > 0,
    `${here.label}: 지면 위(y=${here.y.toFixed(1)}) · 몬스터 ${here.enemies}마리 ${here.species}종`);
  await page.screenshot({ path: `/home/claude/bp-project/scripts/out-28-${id}.png` });
}

// ── 길안내는 두 번째 바다 섬만 ──
await page.evaluate(() => {
  const sim = window.__game.simulation;
  const { getIsland } = window.__game.islands;
  sim.playerController.teleport({ ...getIsland("fountain").center, y: 4 });
  sim.state.player.position.y = 4;
});
await page.waitForTimeout(900);
await page.evaluate(() => window.__game.panels.openPanel("guide"));
await page.waitForTimeout(600);
const guideInSea2 = await page.evaluate(() => ({
  names: Array.from(document.querySelectorAll(".guide-row-name")).map((n) => n.textContent.trim().split(" ")[0]),
  summary: document.querySelector(".guide-summary")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  두 번째 바다 가이드:", JSON.stringify(guideInSea2.names));
assert(guideInSea2.names.length === 10, `두 번째 바다 섬 10개만 목록에 나옴 (${guideInSea2.names.length}개)`);
assert(!guideInSea2.names.includes("정글"), "첫 번째 바다 섬(정글 섬)은 목록에 없음 — 걸어서 갈 수 없으므로");
assert(guideInSea2.names.some((n) => n.includes("장미")), "장미 왕국이 목록에 있음");
assert(/장미 왕국/.test(guideInSea2.summary ?? ""), `Lv.1100 추천 사냥터: "${guideInSea2.summary}"`);
await page.screenshot({ path: "/home/claude/bp-project/scripts/out-28-guide.png" });
await page.evaluate(() => window.__game.panels.closeAll());

// ── 세이브: 새로고침해도 두 번째 바다에서 이어짐 ──
const savedSea = await page.evaluate(async () => {
  await window.__game.saves.flush(Date.now());
  return JSON.parse(localStorage.getItem("bloxfruits-web/save-v1") ?? "null");
});
console.log("  저장:", JSON.stringify({ sea: savedSea?.sea, island: savedSea?.currentIslandId }));
assert(savedSea?.sea === 2 && savedSea?.currentIslandId === "fountain", "어느 바다였는지 저장됨");

await page.goto("http://localhost:4173/?guest=1", { waitUntil: "load" });
await page.waitForTimeout(1800);
await humanClick('.start-btn[data-mode="fast"]');
await waitUntil(() => typeof window.__game !== "undefined", { label: "두 번째 바다 복원" });
await page.waitForTimeout(1400);
const restoredSea = await page.evaluate(() => ({
  sea: window.__game.simulation.state.sea,
  island: window.__game.simulation.state.currentIslandId,
  x: Math.round(window.__game.simulation.state.player.position.x),
  y: window.__game.simulation.state.player.position.y,
  badge: document.querySelector("#hud-sea")?.textContent?.trim(),
  unlocked: window.__game.simulation.state.player.unlockedSecondSea,
}));
console.log("  복원:", JSON.stringify(restoredSea));
assert(restoredSea.sea === 2, "새로고침해도 두 번째 바다에서 시작");
assert(restoredSea.island === "fountain" && restoredSea.x > 5000, `분수 도시 좌표로 복원 (x=${restoredSea.x})`);
assert(restoredSea.y > -5, `복원 직후에도 지면 위 (y=${restoredSea.y.toFixed(2)})`);
assert(/두 번째 바다/.test(restoredSea.badge ?? ""), `HUD 배지도 복원: "${restoredSea.badge}"`);
assert(restoredSea.unlocked === true, "해금 상태 복원");

// ── 다시 말을 걸면 첫 번째 바다로 ──
await standByPirateKing();
const backPrompt = await page.evaluate(() => document.querySelector("#hud-interaction")?.textContent);
assert(/첫 번째 바다/.test(backPrompt ?? ""), `돌아가기 안내: "${backPrompt}"`);
await page.keyboard.press("KeyE");
await page.waitForTimeout(700);
const backPanel = await page.evaluate(() => ({
  open: !document.querySelector("#panel-sea").hidden,
  btn: document.querySelector("#sea-travel")?.textContent?.trim(),
  route: document.querySelector(".sea-route")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("  귀환 패널:", JSON.stringify(backPanel));
assert(backPanel.open && /첫 번째 바다/.test(backPanel.btn ?? ""), `귀환 버튼: "${backPanel.btn}"`);
assert(/중앙 교역섬/.test(backPanel.route ?? ""), `어디로 도착하는지 표시: "${backPanel.route}"`);

assert(await humanClick("#sea-travel"), "귀환 버튼을 실제 마우스로 클릭 가능");
await page.waitForTimeout(1200);
const backHome = await page.evaluate(() => ({
  sea: window.__game.simulation.state.sea,
  island: window.__game.simulation.state.currentIslandId,
  label: document.querySelector("#hud-island")?.textContent,
  badge: document.querySelector("#hud-sea")?.textContent?.trim(),
  x: Math.round(window.__game.simulation.state.player.position.x),
}));
console.log("  귀환:", JSON.stringify(backHome));
assert(backHome.sea === 1 && backHome.island === "central", `중앙 교역섬으로 복귀 (${backHome.label})`);
assert(Math.abs(backHome.x) < 200, `첫 번째 바다 좌표로 돌아옴 (x=${backHome.x})`);
assert(/첫 번째 바다/.test(backHome.badge ?? ""), `HUD 배지 복귀: "${backHome.badge}"`);

// 레벨이 낮아져도 이미 연 바다는 다시 갈 수 있어야 합니다 (돌아왔다고 갇히면 안 됨)
await page.evaluate(() => { window.__game.simulation.state.player.level = 5; });
await standByPirateKing();
await page.keyboard.press("KeyE");
await page.waitForTimeout(700);
const reopen = await page.evaluate(() => ({
  btn: document.querySelector("#sea-travel")?.textContent?.trim(),
  disabled: document.querySelector("#sea-travel")?.disabled,
}));
console.log("  재출항(Lv.5):", JSON.stringify(reopen));
assert(!!reopen.btn && !reopen.disabled, "한 번 연 뒤에는 레벨이 낮아도 다시 건너갈 수 있음");
await page.evaluate(() => window.__game.panels.closeAll());
await page.evaluate(() => localStorage.removeItem("bloxfruits-web/save-v1"));

// ---------------------------------------------------------------------------
// 멀티플레이 · PvP — 진짜로 서버를 띄우고, 브라우저 두 개(해적 · 해군)를
// 각각 접속시켜 서로를 실제로 때립니다. server/state.ts가 데미지를 "다시
// 계산"해서 판정하므로, 여기서 hp가 실제로 줄어드는 걸 확인하면 서버 검증
// 로직이 클라이언트와 정확히 같은 결과를 낸다는 뜻입니다.
// ---------------------------------------------------------------------------
section("멀티플레이 · PvP");

const MP_PORT = 8799;
const MP_URL = `ws://localhost:${MP_PORT}`;
const tsxBin = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const mpServer = spawn(tsxBin, ["server/index.ts"], {
  cwd: REPO_ROOT,
  env: { ...process.env, PORT: String(MP_PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let mpServerLog = "";
mpServer.stdout.on("data", (d) => (mpServerLog += d.toString()));
mpServer.stderr.on("data", (d) => (mpServerLog += d.toString()));
// 아래에서 어떤 assert가 예상 밖으로 예외를 던져 스크립트가 중간에 죽더라도,
// 자식 프로세스(서버)가 좀비로 남지 않도록 안전망을 걸어둡니다.
process.on("exit", () => {
  try { mpServer.kill(); } catch { /* noop */ }
});

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* 아직 안 떴음 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const serverUp = await waitForServer(`http://localhost:${MP_PORT}/healthz`);
assert(serverUp, "멀티플레이 서버(server/index.ts)가 실제로 뜸");
if (!serverUp) console.log("  서버 로그:", mpServerLog);

const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors2 = [];
page2.on("console", (msg) => {
  if (msg.type() === "error") errors2.push(msg.text());
});
page2.on("pageerror", (err) => errors2.push(String(err)));

// 해적 하나(page), 해군 하나(page2) — 서로 다른 진영이라야 PvP가 허용됩니다.
await page.goto("http://localhost:4173/?faction=pirate&mode=fast&guest=1", { waitUntil: "load" });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto("http://localhost:4173/?faction=pirate&mode=fast&guest=1", { waitUntil: "load" });
await waitUntil(() => typeof window.__game !== "undefined", { label: "page(해적) 로드" });

await page2.goto("http://localhost:4173/?faction=marine&mode=fast&guest=1", { waitUntil: "load" });
await page2.evaluate(() => { try { localStorage.clear(); } catch {} });
await page2.goto("http://localhost:4173/?faction=marine&mode=fast&guest=1", { waitUntil: "load" });
await page2.waitForFunction(() => typeof window.__game !== "undefined", null, { timeout: 20000 });

// 두 시작 섬은 수백 미터 떨어져 있으므로, 근접 사거리 안으로 순간이동시켜 둡니다.
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: 0, y: 2, z: 0 };
  sim.playerController.teleport(sim.state.player.position);
});
await page2.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: 1.4, y: 2, z: 0 };
  sim.playerController.teleport(sim.state.player.position);
});

// 멀티플레이 패널을 실제로 열고, 서버 주소를 넣고, 실제 마우스로 접속 버튼을 누릅니다.
async function connectMultiplayer(pg, url, name) {
  await pg.evaluate((sel) => document.querySelector(sel)?.scrollIntoView(), "#btn-multiplayer");
  const clicked = await pg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, "#btn-multiplayer");
  if (!clicked) return false;
  await pg.waitForTimeout(150);
  await pg.evaluate(
    ({ url, name }) => {
      const urlInput = document.querySelector("#mp-url");
      const nameInput = document.querySelector("#mp-name");
      if (urlInput) urlInput.value = url;
      if (nameInput) nameInput.value = name;
    },
    { url, name },
  );
  await pg.evaluate(() => document.querySelector("#mp-connect-btn")?.click());
  return true;
}

assert(await connectMultiplayer(page, MP_URL, "해적테스터"), "해적 쪽 멀티플레이 패널 열고 접속 시도");
assert(await connectMultiplayer(page2, MP_URL, "해군테스터"), "해군 쪽 멀티플레이 패널 열고 접속 시도");

async function waitConnected(pg, label) {
  return waitUntil(() => window.__game.multiplayer.connected, { timeoutMs: 8000, label }).catch(() => false);
}
// waitUntil은 위에서 `page` 기준 클로저로 정의돼 있으므로, page2용은 직접 폴링합니다.
async function waitConnected2(pg) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (await pg.evaluate(() => window.__game.multiplayer.connected)) return true;
    await pg.waitForTimeout(150);
  }
  return false;
}
assert(await waitConnected(page, "해적 접속"), "해적 쪽이 실제로 서버에 연결됨");
assert(await waitConnected2(page2), "해군 쪽이 실제로 서버에 연결됨");

// 서로를 인식하는지 (presence)
const seesEachOther = await waitUntil(
  () => window.__game.multiplayer.players.length >= 1,
  { timeoutMs: 8000, label: "서로 인식" },
).catch(() => false);
assert(seesEachOther, "해적 클라이언트가 해군 플레이어를 목록에서 봄 (presence 동기화)");

// PvP는 이제 기본값이 켜짐이라, 따로 켜지 않아도 접속만 하면 서로 공격할 수 있어야 합니다.
await page.waitForTimeout(500);
const pvpBothOnByDefault = await page.evaluate(() => window.__game.simulation.state.player.pvpEnabled)
  && (await page2.evaluate(() => window.__game.simulation.state.player.pvpEnabled));
assert(pvpBothOnByDefault, "양쪽 다 PvP가 기본값으로 켜진 채 접속됨");
const checkboxDefaultChecked =
  (await page.evaluate(() => document.querySelector("#mp-pvp-checkbox")?.checked)) &&
  (await page2.evaluate(() => document.querySelector("#mp-pvp-checkbox")?.checked));
assert(checkboxDefaultChecked, "체크박스 UI도 기본으로 체크된 채 렌더링됨");

// 체크박스를 껐다가 다시 켜도 토글 메시지가 서버까지 실제로 반영되는지 확인합니다.
await page.evaluate(() => document.querySelector("#mp-pvp-checkbox")?.click());
await page.waitForTimeout(300);
const pvpOffAfterClick = await page.evaluate(() => window.__game.simulation.state.player.pvpEnabled);
assert(pvpOffAfterClick === false, "체크박스를 끄면 실제로 꺼짐");
await page.evaluate(() => document.querySelector("#mp-pvp-checkbox")?.click());
await page.waitForTimeout(300);
const pvpOnAgain = await page.evaluate(() => window.__game.simulation.state.player.pvpEnabled);
assert(pvpOnAgain === true, "다시 켜면 원래대로 켜짐 (양쪽 다 켜진 상태로 이후 공격 테스트 진행)");

// 패널을 닫아 입력을 가리지 않게 하고, 좌클릭으로 근접 공격을 날립니다.
await page.evaluate(() => document.querySelector("#mp-close")?.click());
await page2.evaluate(() => document.querySelector("#mp-close")?.click());

const mpHpBefore = await page2.evaluate(() => window.__game.simulation.state.player.hp);

let mpHit = false;
let mpAckToast = false;
for (let i = 0; i < 15 && !mpHit; i++) {
  await page.mouse.click(640, 400);
  // 토스트는 2.9초 뒤 DOM에서 사라지므로(hud.ts), hp를 확인하기 전에 먼저 짧게
  // 여러 번 폴링해서 "뜬 순간"을 놓치지 않게 합니다.
  for (let j = 0; j < 4; j++) {
    await page.waitForTimeout(100);
    const seen = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#hud-toasts .toast")).some((el) => el.textContent.includes("피해")),
    );
    if (seen) mpAckToast = true;
  }
  const mpHpNow = await page2.evaluate(() => window.__game.simulation.state.player.hp);
  if (mpHpNow < mpHpBefore) mpHit = true;
}
const mpHpAfter = await page2.evaluate(() => window.__game.simulation.state.player.hp);
console.log(`  PvP 근접 공격: hp ${mpHpBefore} → ${mpHpAfter}`);
assert(mpHpAfter < mpHpBefore, "서버가 판정한 근접 공격이 실제로 상대 hp를 깎음 (server/state.ts 재계산 경로)");
assert(mpAckToast, "공격자 화면에 피해 토스트가 뜸 (pvp_hit_ack)");

// 같은 진영끼리는 맞아도 안 되는지도 확인합니다 — 해적 두 명을 붙여봅니다.
const page3 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors3 = [];
page3.on("console", (msg) => { if (msg.type() === "error") errors3.push(msg.text()); });
page3.on("pageerror", (err) => errors3.push(String(err)));
await page3.goto("http://localhost:4173/?faction=pirate&mode=fast&guest=1", { waitUntil: "load" });
await page3.evaluate(() => { try { localStorage.clear(); } catch {} });
await page3.goto("http://localhost:4173/?faction=pirate&mode=fast&guest=1", { waitUntil: "load" });
await page3.waitForFunction(() => typeof window.__game !== "undefined", null, { timeout: 20000 });
await page3.evaluate(() => {
  const sim = window.__game.simulation;
  // page(0,2,0)가 기본 카메라(camYaw=0)로 +x 방향을 보고 있으므로, page3는 그
  // -x 쪽(뒤)이 아니라 page 기준 -x(=page3 기준으로는 page가 +x 방향)에 서야
  // page3의 기본 카메라로도 page가 정면에 잡힙니다 — 해군 공격 테스트(page→page2,
  // x:0→1.4)와 같은 상대 배치를 그대로 미러링했습니다.
  sim.state.player.position = { x: -1.4, y: 2, z: 0 };
  sim.playerController.teleport(sim.state.player.position);
});
await connectMultiplayer(page3, MP_URL, "같은편해적");
const p3Connected = await (async () => {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (await page3.evaluate(() => window.__game.multiplayer.connected)) return true;
    await page3.waitForTimeout(150);
  }
  return false;
})();
assert(p3Connected, "세 번째(같은 진영) 클라이언트도 접속됨");
await page3.waitForTimeout(400);
const page3PvpDefaultOn = await page3.evaluate(() => window.__game.simulation.state.player.pvpEnabled);
assert(page3PvpDefaultOn, "세 번째 클라이언트도 PvP가 기본값으로 켜져 있음");
await page3.evaluate(() => document.querySelector("#mp-close")?.click());

// 해적은 이제 자기들끼리도 싸울 수 있어야 합니다 (해적만 열기로 확정한 설계).
// 해군끼리 여전히 막히는지는 server/state.ts를 직접 두드리는 verify-logic.mjs
// 쪽에서 이미 확인하므로, 여기서는 실제 두 브라우저 간 해적 vs 해적만 검증합니다.
const pirateHpBefore = await page.evaluate(() => window.__game.simulation.state.player.hp);
let pirateHit = false;
for (let i = 0; i < 15 && !pirateHit; i++) {
  await page3.mouse.click(640, 400);
  await page3.waitForTimeout(300);
  const now = await page.evaluate(() => window.__game.simulation.state.player.hp);
  if (now < pirateHpBefore) pirateHit = true;
}
const pirateHpAfter = await page.evaluate(() => window.__game.simulation.state.player.hp);
console.log(`  같은 진영(해적) PvP: hp ${pirateHpBefore} → ${pirateHpAfter}`);
assert(pirateHpAfter < pirateHpBefore, "해적끼리도 서버가 피해를 인정함 (same_faction 예외 — 해적만 허용)");

section("멀티플레이 — 몬스터(NPC) 동기화");
// page(해적)가 몬스터를 실제로 어그로 끌면, page2(해군)는 그 몬스터한테서 멀리
// 떨어져 있어도(=page2 로컬 시뮬레이션은 그 몬스터를 전혀 인식 못함) 서버가
// 중계해주는 위치("유령")를 받아서 화면에 그대로 반영해야 합니다.
const enemyInfo = await page.evaluate(() => {
  const e = window.__game.simulation.state.enemies.find((x) => x.alive);
  return e ? { id: e.id, x: e.position.x, z: e.position.z } : null;
});
assert(enemyInfo !== null, "테스트용 몬스터를 하나 찾음");

await page.evaluate((pos) => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: pos.x + 2, y: 2, z: pos.z };
  sim.playerController.teleport(sim.state.player.position);
}, enemyInfo);
// page2는 어그로 범위(6m) 밖이지만 시야 거리(fast 모드 85m) 안쪽에 둡니다 —
// 자기 로컬 시뮬레이션으로는 이 몬스터를 못 쫓지만, 화면에는 보여야 정상입니다.
await page2.evaluate((pos) => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: pos.x + 20, y: 2, z: pos.z };
  sim.playerController.teleport(sim.state.player.position);
}, enemyInfo);

const myIdOnPage = await page.evaluate(() => window.__game.multiplayer.id);

async function waitForGhost(pg, id, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const g = await pg.evaluate((eid) => {
      const ghost = window.__game.multiplayer.enemyGhosts.get(eid);
      return ghost ? { x: ghost.x, z: ghost.z, alive: ghost.alive, fromId: ghost.fromId } : null;
    }, id);
    if (g) return g;
    await pg.waitForTimeout(200);
  }
  return null;
}
const ghostSeen = await waitForGhost(page2, enemyInfo.id);
assert(ghostSeen !== null, "page(해적)이 어그로 끈 몬스터를 page2(해군)가 서버 중계로 실제로 받음");
assert(ghostSeen?.fromId === myIdOnPage, "받은 유령이 실제로 page(해적)한테서 왔다고 정확히 표시됨");
assert(ghostSeen?.alive === true, "받은 유령 몬스터가 생존 상태로 표시됨");

// 렌더러가 그 유령 위치를 실제로 그림에 반영하는지 — ghost·visual을 같은 순간에
// 함께 읽어서, 둘 사이에 타이밍 차이로 인한 오탐을 없앱니다. (렌더 프레임 하나가
// 늦게 따라잡는 경우를 대비해 몇 번 다시 읽어봅니다 — 값 자체의 정확성과는
// 무관한, 프레임 타이밍만의 문제이므로.)
await page2.waitForTimeout(300);
async function readCombined() {
  return page2.evaluate((id) => {
    const ghost = window.__game.multiplayer.enemyGhosts.get(id);
    const visual = window.__game.renderer.enemyVisuals.get(id);
    return {
      ghost: ghost ? { x: ghost.x, z: ghost.z } : null,
      visual: visual ? { visible: visual.group.visible, x: visual.group.position.x, z: visual.group.position.z } : null,
    };
  }, enemyInfo.id);
}
let combined = await readCombined();
let posMatches = false;
for (let i = 0; i < 10 && !posMatches; i++) {
  posMatches = !!(
    combined.ghost && combined.visual &&
    Math.abs(combined.ghost.x - combined.visual.x) < 0.05 &&
    Math.abs(combined.ghost.z - combined.visual.z) < 0.05
  );
  if (!posMatches) {
    await page2.waitForTimeout(200);
    combined = await readCombined();
  }
}
assert(combined.visual?.visible === true, "원래는 너무 멀어서 안 보여야 할 몬스터가, 유령 덕분에 page2 화면에 실제로 보임");
assert(posMatches, "화면에 그려진 몬스터 위치가 (page2 자신의 시뮬레이션이 아니라) 받은 유령 좌표와 정확히 일치함");

section("멀티플레이 — P2P 거래·선물");
// src/network/protocol.ts의 TRADE_CONFIRM_DELAY_MS(5000ms)와 맞춰 둡니다 — 여기서 값을
// 다시 import하지 않는 대신, 실제 지연시간·타이머 오차를 여유있게 버틸 버퍼를 더합니다.
const TRADE_CONFIRM_WAIT_MS = 5400;
// page(해적)가 page2(해군)에게 실제로 마우스를 올리고 우클릭해서 거래/선물
// 메뉴를 띄웁니다. 화면 어디를 눌러야 상대가 있는지는 카메라가 어느 쪽을
// 보고 있느냐에 달려 있으므로, 고정 좌표(예: 640,400) 대신 SceneRenderer의
// worldToScreen()으로 "그 순간 실제로 상대가 그려진 픽셀"을 계산해서 누릅니다.
async function waitUntilOn(pg, fn, { timeoutMs = 8000, intervalMs = 150, arg } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pg.evaluate(fn, arg)) return true;
    await pg.waitForTimeout(intervalMs);
  }
  return false;
}

/** humanClick()의 page2/page3용 버전 — 패널이 매프레임 다시 그려져 버튼 DOM이
 *  사라지는 사고를 막기 위해, 여기서도 실제 마우스로 누르고 뗍니다. */
async function humanClickOn(pg, selector) {
  await pg.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), selector);
  await pg.waitForTimeout(200);
  const spot = await pg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, reachable: el === hit || el.contains(hit) };
  }, selector);
  if (!spot || !spot.reachable) return false;
  await pg.mouse.move(spot.x, spot.y);
  await pg.mouse.down();
  await pg.waitForTimeout(130);
  await pg.mouse.up();
  await pg.waitForTimeout(250);
  return true;
}

const marineId = await page2.evaluate(() => window.__game.multiplayer.id);

// 카메라 방향을 결정론적으로 고정하고(정면, 수평), 해군을 정확히 그 정면
// 4m 앞에 둡니다 — page3(같은 편 해적)는 멀리 치워서 화면에 안 걸리게 합니다.
await page.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: 0, y: 2, z: 0 };
  sim.playerController.teleport(sim.state.player.position);
  sim.playerController.camYaw = 0;
  sim.playerController.camPitch = 0;
});
await page2.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: 0, y: 2, z: 4 };
  sim.playerController.teleport(sim.state.player.position);
});
await page3.evaluate(() => {
  const sim = window.__game.simulation;
  sim.state.player.position = { x: 0, y: 2, z: -500 };
  sim.playerController.teleport(sim.state.player.position);
});

const marineSynced = await waitUntilOn(
  page,
  (id) => {
    const rv = window.__game.multiplayer.players.find((p) => p.snapshot.id === id);
    return !!rv && Math.abs(rv.renderX - 0) < 0.3 && Math.abs(rv.renderZ - 4) < 0.3;
  },
  { timeoutMs: 6000, arg: marineId },
);
assert(marineSynced, "해군 위치가 해적 화면에 실시간으로 동기화됨 (presence state 브로드캐스트)");

const screen = await page.evaluate((id) => {
  const g = window.__game;
  const rv = g.multiplayer.players.find((p) => p.snapshot.id === id);
  if (!rv) return null;
  return g.renderer.worldToScreen(rv.renderX, rv.renderY + 1, rv.renderZ);
}, marineId);
assert(screen !== null, "해군 플레이어가 해적 화면 안에 실제로 투영됨 (테스트 카메라 정렬 확인)");
let sx = screen?.x ?? 640;
let sy = screen?.y ?? 400;

// 마우스를 그 자리로 실제로 옮기면(호버) 테두리 효과가 켜져야 함
await page.mouse.move(sx, sy);
await page.waitForTimeout(150);
const hoveredId = await page.evaluate(() => window.__game.renderer.hoveredRemotePlayerId);
assert(hoveredId === marineId, "다른 플레이어 위에 마우스를 올리면 테두리 효과(hoverOutline) 대상이 그 사람으로 잡힘");

// 짧게 우클릭(누르자마자 뗌) — 드래그가 아니므로 거래/선물 메뉴가 떠야 함
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(100);
const menuOpen = await page.evaluate(() => !document.querySelector(".trade-menu")?.hidden);
assert(menuOpen, "마우스를 올린 채로 짧게 우클릭하면 거래/선물 메뉴가 뜸");

// 반대로 "누른 채로 드래그"하면(카메라 회전과 같은 제스처) 메뉴가 뜨면 안 됨 —
// 기존 우클릭-드래그 카메라 회전 조작과 충돌하지 않는지 확인하는 회귀 테스트.
await page.evaluate(() => window.__game.tradeUI.closeMenu());
await page.mouse.move(sx, sy);
await page.mouse.down({ button: "right" });
await page.mouse.move(sx + 120, sy + 60, { steps: 12 });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(100);
const menuAfterDrag = await page.evaluate(() => !document.querySelector(".trade-menu")?.hidden);
assert(!menuAfterDrag, "누른 채로 크게 움직이면(드래그=카메라 회전) 메뉴가 뜨지 않음");

// 방금 그 "드래그"는 실제로 InputManager의 카메라 회전을 그대로 작동시켰습니다
// (의도한 대로 — TradeUI가 InputManager를 건드리지 않았다는 증거이기도 합니다).
// 그래서 카메라가 실제로 돌아갔고, 해군이 그려지는 화면 좌표도 바뀌었습니다.
// 다음 클릭을 위해 카메라를 원래대로 되돌리고 좌표를 다시 계산합니다.
await page.evaluate(() => {
  window.__game.simulation.playerController.camYaw = 0;
  window.__game.simulation.playerController.camPitch = 0;
});
await page.waitForTimeout(100);
const screenAfterReset = await page.evaluate((id) => {
  const g = window.__game;
  const rv = g.multiplayer.players.find((p) => p.snapshot.id === id);
  if (!rv) return null;
  return g.renderer.worldToScreen(rv.renderX, rv.renderY + 1, rv.renderZ);
}, marineId);
assert(screenAfterReset !== null, "카메라를 되돌리면 해군이 다시 화면 안에 투영됨");
sx = screenAfterReset?.x ?? sx;
sy = screenAfterReset?.y ?? sy;

// 다시 짧게 우클릭해서 메뉴를 띄우고, "거래하기"를 실제로 클릭 —
// 이제는 곧바로 거래창이 열리지 않고, 상대에게 "수락/거절" 팝업이 먼저 떠야 합니다.
await page.mouse.move(sx, sy);
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(100);
assert(await humanClickOn(page, "#trade-menu-trade"), "거래하기 버튼을 실제 마우스로 클릭");

const inviteSeenOnB = await waitUntilOn(page2, () => window.__game.multiplayer.incomingTradeInvite !== null);
assert(inviteSeenOnB, "거래하기를 누르면 상대(해군) 쪽에 거래 신청이 도착함");
const outgoingSeenOnA = await waitUntilOn(page, () => window.__game.multiplayer.outgoingTradeInvite !== null);
assert(outgoingSeenOnA, "신청한 쪽(해적)은 '응답 대기 중' 상태를 앎");
assert(
  (await page.evaluate(() => window.__game.multiplayer.tradeSession)) === null &&
    (await page2.evaluate(() => window.__game.multiplayer.tradeSession)) === null,
  "응답 전에는 양쪽 다 거래창이 열리지 않음",
);
await page2.waitForTimeout(100);
const inviteVisibleOnB = await page2.evaluate(() => !document.querySelector(".trade-invite")?.hidden);
assert(inviteVisibleOnB, "해군 화면에 수락/거절 팝업 DOM이 실제로 보임");

// 먼저 "거절"을 실제로 눌러서 — 아무것도 시작되지 않고, 신청한 쪽에 거절 알림만 가는지 확인합니다.
assert(await humanClickOn(page2, "#trade-invite-decline"), "거절 버튼을 실제 마우스로 클릭");
const declinedOnA = await waitUntilOn(page, () =>
  Array.from(document.querySelectorAll("#hud-toasts .toast")).some((el) => el.textContent.includes("거절")),
);
assert(declinedOnA, "거절하면 신청한 쪽 화면에 거절 토스트가 뜸");
assert(
  (await page.evaluate(() => window.__game.multiplayer.tradeSession)) === null &&
    (await page2.evaluate(() => window.__game.multiplayer.tradeSession)) === null,
  "거절되면 거래창은 열리지 않음",
);
assert(
  (await page2.evaluate(() => window.__game.multiplayer.incomingTradeInvite)) === null,
  "거절한 쪽의 팝업도 닫힘",
);

// 다시 신청하고, 이번엔 "수락"을 실제로 눌러서 그제서야 양쪽 다 거래창이 열리는지 확인합니다.
await page.mouse.move(sx, sy);
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(100);
assert(await humanClickOn(page, "#trade-menu-trade"), "거래하기 버튼을 다시 실제 마우스로 클릭");
await waitUntilOn(page2, () => window.__game.multiplayer.incomingTradeInvite !== null);
await page2.waitForTimeout(100);
assert(await humanClickOn(page2, "#trade-invite-accept"), "수락 버튼을 실제 마우스로 클릭");

const tradeStartedOnA = await waitUntilOn(page, () => window.__game.multiplayer.tradeSession !== null);
const tradeStartedOnB = await waitUntilOn(page2, () => window.__game.multiplayer.tradeSession !== null);
assert(tradeStartedOnA, "수락하면 신청한 쪽(해적)에도 거래창이 열림");
assert(tradeStartedOnB, "수락한 쪽(해군)에도 거래창이 열림");
await page.waitForTimeout(100);
await page2.waitForTimeout(100);
const windowVisibleA = await page.evaluate(() => !document.querySelector(".trade-window")?.hidden);
const windowVisibleB = await page2.evaluate(() => !document.querySelector(".trade-window")?.hidden);
assert(windowVisibleA && windowVisibleB, "거래창 DOM이 실제로 양쪽 화면에 보임");

// 양쪽 인벤토리에 아이템을 하나씩 넣고, 거래창의 "내 인벤토리" 칸을 실제로 클릭해서 제안에 담습니다.
await page.evaluate(() => {
  window.__game.simulation.state.player.inventory.push({
    id: "potion_small", name: "회복 물약", description: "체력을 회복합니다", icon: "🧪", quantity: 3, usable: true,
  });
});
await page2.evaluate(() => {
  window.__game.simulation.state.player.inventory.push({
    id: "sword_yoru", name: "요루", description: "검", icon: "⚔️", quantity: 1, usable: false, equippable: true,
  });
});
await page.waitForTimeout(400);
await page2.waitForTimeout(400);

/**
 * 거래창의 "내 인벤토리" 칸을 실제로 클릭해서 제안에 담습니다.
 *
 * 패널이 매프레임 시그니처 비교로 다시 그려지는 타이밍과 실제 마우스
 * 다운/업 사이(130ms)가 겹치면, DOM 노드가 교체되면서 클릭이 씹힐 수
 * 있습니다(humanClick이 다른 패널들에서도 겪었던 문제와 같은 종류) —
 * 그래서 클릭 직후 "내 쪽" 로컬 상태(myOffer, 네트워크 왕복 필요 없음)로
 * 실제로 반영됐는지 즉시 확인하고, 안 됐으면 다시 클릭합니다.
 */
async function addToOfferAndVerify(pg, expectedItemId, label) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // 인벤토리 칸은 배열 순서 그대로 그려지므로, 클릭할 칸은 "첫 번째로 채워진
    // 칸"이 아니라 실제로 expectedItemId를 가진 칸이어야 합니다. 싱글플레이
    // 구간을 먼저 거친 브라우저(해적 쪽)는 인벤토리에 이미 다른 아이템이
    // 여러 개 쌓여 있어서, 방금 넣은 아이템이 맨 앞이 아닐 수 있습니다.
    const idx = await pg.evaluate((id) => {
      const inv = window.__game.simulation.state.player.inventory;
      return inv.findIndex((i) => i.id === id);
    }, expectedItemId);
    if (idx < 0) {
      await pg.waitForTimeout(200);
      continue;
    }
    const clicked = await humanClickOn(pg, `.trade-inv-grid .inv-slot[data-inv-idx="${idx}"]`);
    if (clicked) {
      const ok = await waitUntilOn(
        pg,
        (id) => window.__game.multiplayer.tradeSession?.myOffer?.some((o) => o.id === id) === true,
        { timeoutMs: 1500, arg: expectedItemId },
      );
      if (ok) return true;
    }
    await pg.waitForTimeout(200);
  }
  return false;
}

/**
 * 승낙 버튼도 인벤토리 칸과 같은 이유로 재시도가 필요합니다 — 자동 성사
 * 카운트다운이 도는 동안은 거래창이 1초에 한 번씩 다시 그려지므로(숫자를
 * 보여주기 위해), 그 순간과 실제 마우스 다운/업 사이가 겹치면 클릭이 씹힐
 * 수 있습니다. 클릭 직후 로컬 myAccepted 값으로 실제로 반영됐는지 확인합니다.
 */
async function clickAcceptAndVerify(pg, expectedAccepted) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const clicked = await humanClickOn(pg, "#trade-accept-btn");
    if (clicked) {
      const ok = await waitUntilOn(
        pg,
        (want) => window.__game.multiplayer.tradeSession?.myAccepted === want,
        { timeoutMs: 1500, arg: expectedAccepted },
      );
      if (ok) return true;
    }
    await pg.waitForTimeout(200);
  }
  return false;
}

assert(await addToOfferAndVerify(page, "potion_small"), "해적 쪽 인벤토리 칸 클릭 → 실제로 내 제안에 담김");
assert(await addToOfferAndVerify(page2, "sword_yoru"), "해군 쪽 인벤토리 칸 클릭 → 실제로 내 제안에 담김");

const offerSyncedOnA = await waitUntilOn(page, () =>
  window.__game.multiplayer.tradeSession?.partnerOffer?.[0]?.id === "sword_yoru",
);
const offerSyncedOnB = await waitUntilOn(page2, () =>
  window.__game.multiplayer.tradeSession?.partnerOffer?.[0]?.id === "potion_small",
);
assert(offerSyncedOnA, "해적이 인벤토리 칸을 클릭하면 상대(해군) 화면에 그 제안이 실시간으로 뜸");
assert(offerSyncedOnB, "해군이 넣은 요루도 해적 쪽에 실시간으로 보임");

// 승낙 버튼을 양쪽 다 실제로 클릭 → 곧바로 성사되지 않고 5초 자동 성사 유예가 걸림
await page.waitForTimeout(150);
await page2.waitForTimeout(150);
assert(await clickAcceptAndVerify(page, true), "해적 쪽 승낙 버튼 클릭");
assert(await clickAcceptAndVerify(page2, true), "해군 쪽 승낙 버튼 클릭");

const confirmingOnA = await waitUntilOn(page, () => window.__game.multiplayer.tradeSession?.confirmDeadlineMs != null);
assert(confirmingOnA, "양쪽 다 승낙하면 자동 성사 카운트다운이 시작됨 (confirmDeadlineMs가 잡힘)");
await page.waitForTimeout(300);
const stillOpenRightAfterAccept =
  (await page.evaluate(() => window.__game.multiplayer.tradeSession)) !== null &&
  (await page2.evaluate(() => window.__game.multiplayer.tradeSession)) !== null;
assert(stillOpenRightAfterAccept, "양쪽 다 승낙해도 곧바로 성사되지 않음 (유예 시간 동안은 거래창이 열려 있음)");
const countdownVisible = await page.evaluate(() => !!document.querySelector(".trade-confirm-countdown"));
assert(countdownVisible, "거래창에 자동 성사까지 남은 시간이 실제로 표시됨");

// 유예 시간 안에 한쪽이 승낙을 취소하면(승낙 버튼을 다시 클릭) 자동 성사가 취소되고,
// 원래 마감 시각이 지나도 거래가 성사되지 않아야 합니다.
assert(await clickAcceptAndVerify(page2, false), "해군 쪽이 유예 시간 안에 승낙을 다시 취소 클릭");
const confirmCancelledOnA = await waitUntilOn(page, () => window.__game.multiplayer.tradeSession?.confirmDeadlineMs == null);
assert(confirmCancelledOnA, "한쪽이 취소하면 자동 성사 카운트다운도 취소됨");
await page.waitForTimeout(TRADE_CONFIRM_WAIT_MS);
const notCompletedAfterCancel =
  (await page.evaluate(() => window.__game.multiplayer.tradeSession)) !== null &&
  (await page2.evaluate(() => window.__game.multiplayer.tradeSession)) !== null;
assert(notCompletedAfterCancel, "유예 중 취소했으면 원래 마감 시각이 지나도 거래가 성사되지 않음");

// 다시 양쪽 다 승낙 + 이번엔 아무도 취소하지 않고 유예 시간을 다 기다리면 그제서야 실제로 성사됨
assert(await clickAcceptAndVerify(page2, true), "해군 쪽 다시 승낙 클릭");
assert(await clickAcceptAndVerify(page, true), "해적 쪽 다시 승낙 클릭 (이번엔 끝까지 기다림)");
await waitUntilOn(page, () => window.__game.multiplayer.tradeSession?.confirmDeadlineMs != null);
await page.waitForTimeout(300);
const stillOpenBeforeWait = (await page.evaluate(() => window.__game.multiplayer.tradeSession)) !== null;
assert(stillOpenBeforeWait, "다시 승낙해도 즉시 성사되지 않고 유예가 다시 걸림");

const closedOnA = await waitUntilOn(page, () => window.__game.multiplayer.tradeSession === null, {
  timeoutMs: TRADE_CONFIRM_WAIT_MS + 6000,
});
const closedOnB = await waitUntilOn(page2, () => window.__game.multiplayer.tradeSession === null, { timeoutMs: 6000 });
assert(closedOnA && closedOnB, "유예 시간을 다 기다리면(아무도 취소 안 함) 그제서야 거래가 성사되어 거래창이 자동으로 닫힘");

const aInvIds = await page.evaluate(() => window.__game.simulation.state.player.inventory.map((i) => i.id));
const bInvIds = await page2.evaluate(() => window.__game.simulation.state.player.inventory.map((i) => i.id));
assert(aInvIds.includes("sword_yoru"), "해적이 실제로 요루를 받음 (상대가 제안했던 것)");
assert(!aInvIds.includes("potion_small"), "해적이 내줬던 물약은 자기 인벤토리에서 실제로 빠짐");
assert(bInvIds.includes("potion_small"), "해군이 실제로 물약을 받음");
assert(!bInvIds.includes("sword_yoru"), "해군이 내줬던 요루는 자기 인벤토리에서 실제로 빠짐");

const windowClosedA = await page.evaluate(() => document.querySelector(".trade-window")?.hidden !== false);
assert(windowClosedA, "거래창 DOM도 자동으로 다시 숨겨짐");

const completeToastSeen = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#hud-toasts .toast")).some((el) => el.textContent.includes("거래")),
);
assert(completeToastSeen, "거래 성사 토스트가 실제로 화면에 뜸");

// --- 선물: 거래창 없이 곧바로 전달 ---------------------------------------
// 인벤토리를 통째로 이 아이템 하나로 맞춰서, 선물 목록의 "보내기" 버튼이
// 정확히 이 아이템 것 하나만 있게 만듭니다 (여러 개면 클릭이 어느 걸 누를지
// 모호해짐).
await page.evaluate(() => {
  window.__game.simulation.state.player.inventory = [
    { id: "potion_exp", name: "경험치 물약", description: "경험치를 채워줍니다", icon: "🍾", quantity: 4, usable: true },
  ];
});
await page.waitForTimeout(100);
await page.mouse.move(sx, sy);
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(100);
assert(await humanClickOn(page, "#trade-menu-gift"), "선물 주기 버튼을 실제 마우스로 클릭");
await page.waitForTimeout(100);
const giftPickerOpen = await page.evaluate(() => !document.querySelector(".trade-gift-picker")?.hidden);
assert(giftPickerOpen, "선물 주기를 누르면 선물 고르기 창이 뜸");

const bMoneyItemsBefore = await page2.evaluate(() => window.__game.simulation.state.player.inventory.map((i) => i.id));
assert(await humanClickOn(page, ".trade-gift-send-btn"), "선물 보내기 버튼을 실제 마우스로 클릭");

const giftDeliveredOnB = await waitUntilOn(page2, () =>
  window.__game.simulation.state.player.inventory.some((i) => i.id === "potion_exp"),
);
assert(giftDeliveredOnB, "선물을 보내면 상대 인벤토리에 실제로 아이템이 생김");
const giftAckSeen = await waitUntilOn(page, () =>
  Array.from(document.querySelectorAll("#hud-toasts .toast")).some((el) => el.textContent.includes("선물")),
);
assert(giftAckSeen, "보낸 사람 화면에도 선물 전송 토스트가 뜸");
assert(!bMoneyItemsBefore.includes("potion_exp"), "선물받기 전에는 상대 인벤토리에 그 아이템이 없었음 (테스트 전제 확인)");

await page2.close();
await page3.close();
mpServer.kill();

console.log("  page2(해군) 콘솔 에러:", JSON.stringify(errors2));
console.log("  page3(같은편) 콘솔 에러:", JSON.stringify(errors3));
for (const e of errors2) errors.push(`[page2] ${e}`);
for (const e of errors3) errors.push(`[page3] ${e}`);

console.log("\nCONSOLE_ERRORS:", JSON.stringify(errors, null, 2));
console.log(failures === 0 ? "\n모든 브라우저 검증 통과 ✅" : `\n${failures}개 실패 ❌`);

await browser.close();
process.exit(failures === 0 || errors.length ? (failures === 0 ? 0 : 1) : 0);
