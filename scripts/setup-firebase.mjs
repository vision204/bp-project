#!/usr/bin/env node
// ---------------------------------------------------------------------------
// .env 만들어주는 도구
//
//   npm run firebase:setup
//
// 파이어베이스 콘솔에서 본 firebaseConfig 블록을 **통째로 복사해서 붙여넣기만** 하면
// .env 파일을 알아서 만들어 줍니다. 6개 값을 하나씩 옮겨 적다가 오타 나는 걸 막으려고
// 만들었습니다. (VITE_FIREBASE_... 같은 이름을 외울 필요도 없습니다)
// ---------------------------------------------------------------------------

import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

/** 콘솔 config의 키 → .env 변수 이름 */
const FIELDS = [
  ["apiKey", "VITE_FIREBASE_API_KEY"],
  ["authDomain", "VITE_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "VITE_FIREBASE_PROJECT_ID"],
  ["storageBucket", "VITE_FIREBASE_STORAGE_BUCKET"],
  ["messagingSenderId", "VITE_FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "VITE_FIREBASE_APP_ID"],
];

// ── --check : 지금 .env가 제대로 채워졌는지만 확인하고 끝냅니다 ──────────────
if (process.argv.includes("--check")) {
  if (!existsSync(ENV_PATH)) {
    console.log("\n❌ .env 파일이 없습니다.");
    console.log("   npm run firebase:setup  을 실행해서 만들어 주세요.\n");
    console.log("   (.env가 없어도 게임은 돌아갑니다 — 로그인·랭킹만 꺼집니다)\n");
    process.exit(1);
  }
  const text = readFileSync(ENV_PATH, "utf8");
  let ok = true;
  console.log("\n.env 확인 결과:\n");
  for (const [key, envName] of FIELDS) {
    const match = text.match(new RegExp(`^${envName}=(.*)$`, "m"));
    const value = match?.[1]?.trim() ?? "";
    const filled = value !== "" && !value.startsWith("여기에");
    if (!filled) ok = false;
    const shown = filled ? (value.length > 28 ? `${value.slice(0, 25)}…` : value) : "(비어 있음)";
    console.log(`   ${filled ? "✔" : "✖"} ${key.padEnd(20)} ${shown}`);
  }
  console.log(
    ok
      ? "\n✅ 다 채워졌습니다. npm run dev 로 실행하면 로그인 버튼이 보입니다.\n"
      : "\n⚠️  비어 있는 값이 있습니다. npm run firebase:setup 을 다시 실행해 보세요.\n",
  );
  process.exit(ok ? 0 : 1);
}

console.log(`
╭──────────────────────────────────────────────────────────────╮
│  파이어베이스 설정 도우미                                    │
╰──────────────────────────────────────────────────────────────╯

파이어베이스 콘솔에서 이 순서로 가세요:

  ⚙️ 프로젝트 설정  →  일반  →  아래로 스크롤  →  "내 앱"
  →  웹 앱(</>)을 고르고  →  "SDK 설정 및 구성"에서 **구성** 선택

그러면 이런 게 보입니다:

  const firebaseConfig = {
    apiKey: "AIza...",
    authDomain: "내프로젝트.firebaseapp.com",
    ...
  };

👉 **그 부분을 복사해서 여기에 붙여넣고 Enter를 누르세요.**

   · SDK를 "npm" 으로 봤든 "<script> 태그" 로 봤든 상관없습니다.
     둘 다 firebaseConfig 값은 똑같고, <script> 태그 전체를 통째로 붙여넣어도 됩니다.
   · 값 6개가 다 들어오면 자동으로 끝납니다.
     (혹시 안 끝나면 빈 줄에서 Enter를 한 번 더 누르세요)
`);

/** 붙여넣은 글에서 "키: 값" 을 느슨하게 뽑아냅니다 (따옴표 종류·콤마 무관) */
function extract(text) {
  const out = {};
  for (const [key, envName] of FIELDS) {
    const match = text.match(new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`));
    if (match) out[envName] = match[1].trim();
  }
  return out;
}

const rl = createInterface({ input: process.stdin, terminal: false });

// 언제 그만 받을지가 은근히 까다롭습니다.
//
// 콘솔에서 "npm" 대신 **"<script> 태그 사용"**을 고르면 이런 게 나옵니다:
//
//   <script type="module">
//     import { initializeApp } from "https://...";   ← 여기 { } 때문에
//     const firebaseConfig = { ... };                   중괄호만 세면 여기서 멈춰버립니다
//   </script>
//
// 그래서 중괄호를 세는 대신 **필요한 값 6개가 다 모이면** 끝냅니다.
// (값이 덜 들어와도 빈 줄에서 Enter를 한 번 더 누르면 마무리됩니다)
let buffer = "";
let found = {};
let blankAfterContent = false;

for await (const line of rl) {
  buffer += line + "\n";
  found = extract(buffer);

  if (Object.keys(found).length === FIELDS.length) break; // 6개 다 모임 → 끝
  if (line.trim() === "" && Object.keys(found).length > 0) {
    if (blankAfterContent) break; // 빈 줄 두 번 → 그만 받기
    blankAfterContent = true;
  } else if (line.trim() !== "") {
    blankAfterContent = false;
  }
}

rl.close();
found = extract(buffer);

if (buffer.trim() === "") {
  console.error("\n❌ 아무것도 붙여넣지 않으셨습니다. firebaseConfig 블록을 복사해서 붙여넣어 주세요.");
  process.exit(1);
}

const missing = FIELDS.filter(([, envName]) => !found[envName]);

if (missing.length === FIELDS.length) {
  console.error("\n❌ 값을 하나도 찾지 못했습니다. firebaseConfig 블록이 맞는지 확인해 주세요.");
  process.exit(1);
}

if (existsSync(ENV_PATH)) {
  const backup = `${ENV_PATH}.backup`;
  writeFileSync(backup, readFileSync(ENV_PATH));
  console.log(`\n📦 기존 .env를 .env.backup 으로 백업했습니다.`);
}

const body = FIELDS.map(([, envName]) => `${envName}=${found[envName] ?? ""}`).join("\n");
writeFileSync(ENV_PATH, `# 파이어베이스 설정 (npm run firebase:setup 으로 자동 생성)\n${body}\n`);

console.log("\n✅ .env 파일을 만들었습니다!\n");
for (const [key, envName] of FIELDS) {
  const value = found[envName];
  const shown = value ? (value.length > 28 ? `${value.slice(0, 25)}…` : value) : "(못 찾음)";
  console.log(`   ${value ? "✔" : "✖"} ${key.padEnd(20)} ${shown}`);
}

if (missing.length > 0) {
  console.log(`\n⚠️  못 찾은 값이 있습니다: ${missing.map(([k]) => k).join(", ")}`);
  console.log("   .env 파일을 직접 열어 채워 넣어 주세요.");
} else {
  console.log("\n다 됐습니다. 이제 개발 서버를 다시 켜세요:\n\n   npm run dev\n");
  console.log("시작 화면 맨 앞에 '구글로 로그인' 버튼이 보이면 성공입니다. 🎉");
}
