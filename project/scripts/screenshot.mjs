import { chromium } from "playwright";

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

await page.goto("http://localhost:4173/", { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/home/claude/bp-project/scripts/shot-1-initial.png" });

// simulate movement + camera without pointer lock (pointer lock unsupported headless, but keys still work)
await page.keyboard.down("KeyW");
await page.mouse.move(640, 400);
await page.mouse.move(500, 380, { steps: 10 });
await page.waitForTimeout(1200);
await page.keyboard.up("KeyW");
await page.screenshot({ path: "/home/claude/bp-project/scripts/shot-2-moved.png" });

console.log("CONSOLE_ERRORS:", JSON.stringify(errors, null, 2));

await browser.close();
