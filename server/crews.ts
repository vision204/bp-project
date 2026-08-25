// ---------------------------------------------------------------------------
// 해적 사단(길드) — server/data/crews.json에 영구 저장됩니다.
//
// 여러 사단이 동시에 존재할 수 있고(요청: "여러 사단을 만들고 선택 가입"),
// 가입은 접속마다 새로 생기는 Connection.id가 아니라 브라우저의 영구 id
// (src/core/PlayerId.ts, hello 메시지의 uid)로 식별합니다 — 그래야 재접속해도
// 같은 사단원으로 남습니다.
//
// 현상금 보너스 규칙(요청 그대로):
//   · 사단원이 PvP로 플레이어를 죽이면 기본 현상금에 +2를 더 받습니다.
//   · 사단의 누적 보너스 점수(totalBounty)가 10,000이 되면 그 +2가 +3이 됩니다.
//   · 그 뒤로도 10,000점씩 오를 때마다 +1씩 더 받습니다.
//   → perKillBonus = 2 + floor(totalBounty / 10000)
// totalBounty 자체는 "사단원이 킬할 때마다 받은 보너스 점수의 누적"입니다 —
// 보너스가 커질수록 다음 문턱까지 더 빨리 쌓이는, 스스로 강화되는 구조입니다.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Crew {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  /** 사단원들이 PvP 킬로 쌓아온 누적 보너스 점수 (아래 crewBonusForKill 참고) */
  totalBounty: number;
  createdAtMs: number;
}

export interface CrewSummary {
  id: string;
  name: string;
  memberCount: number;
  totalBounty: number;
  perKillBonus: number;
}

const DATA_DIR = path.join(process.cwd(), "server", "data");
const FILE = path.join(DATA_DIR, "crews.json");

let crews = new Map<string, Crew>();
/** uid → crewId — 한 사람은 한 번에 한 사단에만 속합니다. */
let membership = new Map<string, string>();
let nextCrewNum = 1;

function load() {
  try {
    if (!existsSync(FILE)) return;
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as { crews?: Crew[] };
    if (!raw || !Array.isArray(raw.crews)) return;
    for (const c of raw.crews) {
      if (!c || typeof c.id !== "string") continue;
      crews.set(c.id, c);
      for (const uid of c.memberUids) membership.set(uid, c.id);
      const num = Number(c.id.replace(/^crew/, ""));
      if (Number.isFinite(num) && num >= nextCrewNum) nextCrewNum = num + 1;
    }
  } catch (err) {
    console.error("[crews] 저장 파일을 불러오지 못했습니다 — 빈 상태로 시작합니다.", err);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ crews: [...crews.values()] }, null, 2), "utf8");
  } catch (err) {
    console.error("[crews] 저장 실패", err);
  }
}

load();

/** 지금 이 누적 보너스 점수 기준으로, 사단원이 킬 하나당 추가로 받는 점수. */
export function crewBonusForKill(crew: Crew): number {
  return 2 + Math.floor(Math.max(0, crew.totalBounty) / 10000);
}

export function summarize(crew: Crew): CrewSummary {
  return {
    id: crew.id,
    name: crew.name,
    memberCount: crew.memberUids.length,
    totalBounty: crew.totalBounty,
    perKillBonus: crewBonusForKill(crew),
  };
}

export function crewOf(uid: string): Crew | null {
  if (!uid) return null;
  const id = membership.get(uid);
  if (!id) return null;
  return crews.get(id) ?? null;
}

export function listCrews(): CrewSummary[] {
  return [...crews.values()]
    .sort((a, b) => b.totalBounty - a.totalBounty || a.createdAtMs - b.createdAtMs)
    .map(summarize);
}

const MAX_NAME_LEN = 20;

export function createCrew(uid: string, rawName: string, nowMs: number): Crew | { error: string } {
  if (!uid) return { error: "no_uid" };
  if (membership.has(uid)) return { error: "already_in_crew" };
  const name = rawName.trim().slice(0, MAX_NAME_LEN);
  if (!name) return { error: "invalid_name" };
  if ([...crews.values()].some((c) => c.name === name)) return { error: "name_taken" };

  const id = `crew${nextCrewNum++}`;
  const crew: Crew = { id, name, ownerUid: uid, memberUids: [uid], totalBounty: 0, createdAtMs: nowMs };
  crews.set(id, crew);
  membership.set(uid, id);
  persist();
  return crew;
}

export function joinCrew(uid: string, crewId: string): Crew | { error: string } {
  if (!uid) return { error: "no_uid" };
  if (membership.has(uid)) return { error: "already_in_crew" };
  const crew = crews.get(crewId);
  if (!crew) return { error: "not_found" };
  crew.memberUids.push(uid);
  membership.set(uid, crewId);
  persist();
  return crew;
}

export function leaveCrew(uid: string): void {
  const id = membership.get(uid);
  if (!id) return;
  const crew = crews.get(id);
  if (crew) crew.memberUids = crew.memberUids.filter((m) => m !== uid);
  membership.delete(uid);
  persist();
}

/** PvP 킬 처리 중 서버(state.ts)가 호출 — 사단의 누적 보너스 점수를 올리고 저장합니다. */
export function addCrewBounty(crew: Crew, amount: number) {
  crew.totalBounty += amount;
  persist();
}
