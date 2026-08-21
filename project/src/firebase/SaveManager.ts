// ---------------------------------------------------------------------------
// 세이브 관리 — 언제 저장할지, 어디에 저장할지를 한 곳에서 정합니다.
//
//   · 로그인함  → Firestore + 이 브라우저(오프라인 백업) 양쪽에 저장
//   · 게스트     → 이 브라우저에만 저장
//
// 저장은 매 프레임이 아니라 **바뀐 게 있을 때만, 최소 간격을 두고** 합니다.
// (Firestore 쓰기 비용은 문서 단위로 붙기 때문에 초당 저장하면 요금이 샙니다)
// ---------------------------------------------------------------------------

import type { GameState } from "../core/GameState";
import { toSaveData } from "../core/SaveData";
import { saveLocalSave } from "../core/Persistence";
import { saveCloudSave, submitScore, type CloudUser } from "./cloud";

/** 자동 저장 최소 간격 — 이보다 자주 쓰지 않습니다 */
export const AUTOSAVE_INTERVAL_MS = 15000;

export class SaveManager {
  private dirty = false;
  private lastSaveAtMs = 0;
  private saving = false;
  /** 다음 저장 때 뽑기 시각을 서버 시각으로 갱신할지 */
  private gachaTouched = false;
  private lastSubmittedLevel = -1;

  /**
   * 저장을 통째로 끄는 모드. 개발자 모드에서 씁니다.
   * 만렙 테스트 캐릭터가 내 진짜 세이브를 덮어쓰거나 랭킹에 올라가면 안 되니까,
   * "저장하지 않기"를 조건문 여러 군데에 흩뿌리지 않고 **여기 한 곳에서** 잠급니다.
   */
  private readonly readOnly: boolean;

  constructor(
    private readonly state: GameState,
    private user: CloudUser | null,
    options: { readOnly?: boolean } = {},
  ) {
    this.readOnly = options.readOnly === true;
  }

  get isCloud() {
    return this.user !== null && !this.readOnly;
  }

  /** 저장이 꺼져 있는지 (개발자 모드) */
  get isReadOnly() {
    return this.readOnly;
  }

  get userName() {
    return this.user?.name ?? null;
  }

  setUser(user: CloudUser | null) {
    this.user = user;
    this.dirty = true;
  }

  /** 저장할 만한 변화가 생겼다고 알립니다 */
  markDirty() {
    if (this.readOnly) return;
    this.dirty = true;
  }

  /** 뽑기를 했다고 알립니다 — 다음 저장에서 서버 시각으로 기록됩니다 */
  markGachaRolled() {
    if (this.readOnly) return;
    this.gachaTouched = true;
    this.dirty = true;
  }

  /**
   * 매 프레임 호출. 저장할 게 있고 간격이 지났으면 저장합니다.
   * 실제 쓰기는 비동기이고, 겹쳐 들어가지 않도록 잠금을 겁니다.
   */
  tick(nowMs: number) {
    if (this.readOnly) return;
    if (!this.dirty || this.saving) return;
    if (nowMs - this.lastSaveAtMs < AUTOSAVE_INTERVAL_MS) return;
    void this.flush(nowMs);
  }

  /** 지금 바로 저장 (창을 닫을 때, 중요한 변화가 있을 때) */
  async flush(nowMs: number): Promise<void> {
    // 개발자 모드 — 로컬에도 클라우드에도 랭킹에도 아무것도 쓰지 않습니다.
    if (this.readOnly) return;
    if (this.saving) return;
    this.saving = true;
    this.dirty = false;
    this.lastSaveAtMs = nowMs;
    const touchGacha = this.gachaTouched;
    this.gachaTouched = false;

    const data = toSaveData(this.state, nowMs);
    // 오프라인 백업은 항상 먼저 — 네트워크가 죽어도 진행상황은 남습니다.
    saveLocalSave(data);

    if (this.user) {
      await saveCloudSave(this.user.uid, data, touchGacha);

      // 랭킹은 레벨이 바뀌었을 때만 갱신합니다 (쓰기 횟수 절약)
      const p = this.state.player;
      if (p.level !== this.lastSubmittedLevel) {
        this.lastSubmittedLevel = p.level;
        await submitScore(this.user.uid, {
          name: this.user.name,
          faction: p.faction,
          level: p.level,
          money: p.money,
          fruitLevel: p.fruitLevel,
        });
      }
    }
    this.saving = false;
  }
}
