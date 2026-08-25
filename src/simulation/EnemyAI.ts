import type { EnemyState, GameEvent, PlayerState } from "../core/GameState";
import { getIsland } from "../world/islands";
import { markDamagedNow } from "./HpSystem";

// 스폰 지점에서 이 배수만큼 벌어지면(=플레이어가 몬스터를 섬 반대편까지 끌고 가면)
// 추적을 포기하고 복귀합니다.
const LEASH_MULTIPLIER = 2.5;
const RETURN_SPEED_MULT = 0.6;

function dist2D(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

export function stepEnemyAI(
  enemies: EnemyState[],
  player: PlayerState,
  dt: number,
  events: GameEvent[],
  nowMs: number,
) {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    enemy.remainingContactCooldownSec = Math.max(0, enemy.remainingContactCooldownSec - dt);

    // 완전히 얼어붙었으면 추적·복귀 이동도, 접촉 공격도 하지 않습니다.
    if (enemy.status.freezeRemainingSec > 0) continue;

    const distToPlayer = dist2D(enemy.position.x, enemy.position.z, player.position.x, player.position.z);
    const distSpawnToPlayer = dist2D(
      enemy.spawnPosition.x,
      enemy.spawnPosition.z,
      player.position.x,
      player.position.z,
    );

    let dx = 0;
    let dz = 0;
    let speed = 0;

    if (distToPlayer <= enemy.aggroRange && distSpawnToPlayer <= enemy.aggroRange * LEASH_MULTIPLIER) {
      // 인식 범위 안 + 리시 범위 안 → 추적
      dx = player.position.x - enemy.position.x;
      dz = player.position.z - enemy.position.z;
      speed = enemy.chaseSpeed;

      if (distToPlayer <= enemy.contactRange && enemy.remainingContactCooldownSec <= 0) {
        enemy.remainingContactCooldownSec = enemy.contactCooldownSec;
        player.hp = Math.max(0, player.hp - enemy.contactDamage);
        markDamagedNow(player, nowMs);
        events.push({ type: "player_damaged", amount: enemy.contactDamage });
      }
    } else {
      // 범위 밖 → 스폰 지점으로 복귀
      dx = enemy.spawnPosition.x - enemy.position.x;
      dz = enemy.spawnPosition.z - enemy.position.z;
      speed = enemy.chaseSpeed * RETURN_SPEED_MULT;
    }

    // 얼음/모래 계열 스킬에 맞으면 둔화가 걸려 느리게 움직입니다.
    speed *= enemy.status.slowFactor;

    const len = Math.hypot(dx, dz);
    if (len > 0.05) {
      enemy.position.x += (dx / len) * speed * dt;
      enemy.position.z += (dz / len) * speed * dt;
    }

    // 몬스터가 자기 섬 밖(바다)으로 나가지 않도록 안전 클램프
    const island = getIsland(enemy.islandId);
    const distFromCenter = dist2D(enemy.position.x, enemy.position.z, island.center.x, island.center.z);
    const limit = island.radius - 3;
    if (distFromCenter > limit) {
      const scale = limit / distFromCenter;
      enemy.position.x = island.center.x + (enemy.position.x - island.center.x) * scale;
      enemy.position.z = island.center.z + (enemy.position.z - island.center.z) * scale;
    }
  }
}
