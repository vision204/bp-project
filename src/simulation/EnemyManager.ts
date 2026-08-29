import type { EnemyState } from "../core/GameState";
import { ISLANDS, getIsland } from "../world/islands";

const RESPAWN_SEC = 6;

/** 시작 섬 몬스터 1마리를 처치했을 때 주는 기본 보상. 퀘스트 보상 배율 계산에 재사용됩니다. */
export const DUMMY_EXP_REWARD = ISLANDS[0].species[0].exp;
export const DUMMY_MONEY_REWARD = ISLANDS[0].species[0].money;

// 추적 AI 기본값 — 요청에 따라 인식 범위를 작게 잡았습니다 (플레이어가 조금만
// 거리를 벌려도 놓치도록). 이동속도도 플레이어(8m/s)보다 느리게 잡아 도망칠 수 있게 함.
const AGGRO_RANGE = 6;
const CHASE_SPEED = 3.5;
const CONTACT_RANGE = 1.5;
const CONTACT_COOLDOWN_SEC = 1;

/**
 * 모든 섬에 몬스터를 배치합니다. 섬마다 체력/경험치/코인이 크게 다르며,
 * 상위 섬일수록 경험치가 급격히 커져서 900레벨까지 성장이 가능하도록 잡았습니다.
 *
 * 몬스터가 여러 종류인 섬에서는 종족별로 **서식 구역이 갈립니다**.
 *   · 각도: 부두 반대편의 넓은 호를 종족 수만큼 부채꼴로 나눔
 *   · 거리: 약한 종족은 섬 안쪽, 강한 종족은 바깥쪽
 * 이렇게 해두면 퀘스트에서 특정 종류를 고른 뒤 어디로 가야 할지가 분명해집니다.
 */
export function createInitialEnemies(): EnemyState[] {
  const enemies: EnemyState[] = [];

  for (const island of ISLANDS) {
    const speciesCount = island.species.length;
    // 중앙 교역섬처럼 몬스터가 없는 중립 지대는 건너뜁니다.
    if (speciesCount === 0) continue;
    // 부두 쪽(±약 27도)은 비워두고 나머지 호를 종족 수만큼 나눕니다.
    const arc = Math.PI * 1.7;
    const sectorWidth = arc / speciesCount;

    // 몬스터 종류가 3종류 이상인 섬은 부채꼴이 좁아져서 겹쳐 보이기 쉬우므로,
    // 종족 간 거리 밴드를 더 넓게 벌리고(안쪽↔바깥쪽 폭) 개체 사이 반경도 더
    // 흩어지게 잡습니다 — densityScaledCount로 마리 수를 줄인 것과 함께 적용해
    // 전체적으로 "여유 있는" 배치가 되도록 했습니다.
    const spacious = speciesCount >= 3;
    const bandStart = spacious ? 0.28 : 0.34;
    const bandEnd = spacious ? 0.74 : 0.68;
    const radialJitter = spacious ? 0.1 : 0.07;

    island.species.forEach((species, k) => {
      const { count, hp, exp, money, contactDamage } = species;
      const sectorCenter = island.dockAngle + Math.PI + (k - (speciesCount - 1) / 2) * sectorWidth;
      // 종족이 하나뿐이면 예전처럼 섬 중반부에 고르게, 여럿이면 단계별로 바깥으로.
      const bandRatio = speciesCount === 1 ? 0.52 : bandStart + ((bandEnd - bandStart) * k) / (speciesCount - 1);

      for (let i = 0; i < count; i++) {
        const angle = sectorCenter + ((i - (count - 1) / 2) / count) * sectorWidth * 0.85;
        const dist = island.radius * (bandRatio + (i % 2 === 0 ? -radialJitter : radialJitter));
        const x = island.center.x + Math.cos(angle) * dist;
        const z = island.center.z + Math.sin(angle) * dist;

        enemies.push({
          id: `${species.id}_enemy_${i}`,
          islandId: island.id,
          speciesId: species.id,
          speciesName: species.name,
          color: species.color,
          scale: species.scale,
          position: { x, y: 1, z },
          spawnPosition: { x, y: 1, z },
          hp,
          maxHp: hp,
          alive: true,
          respawnTimerSec: 0,
          expReward: exp,
          moneyReward: money,
          status: { slowFactor: 1, slowRemainingSec: 0, burnDps: 0, burnRemainingSec: 0, freezeRemainingSec: 0 },

          aggroRange: AGGRO_RANGE,
          chaseSpeed: CHASE_SPEED,
          contactRange: CONTACT_RANGE,
          contactDamage,
          contactCooldownSec: CONTACT_COOLDOWN_SEC,
          remainingContactCooldownSec: 0,
        });
      }
    });
  }

  return enemies;
}

export function stepEnemies(enemies: EnemyState[], dt: number) {
  for (const enemy of enemies) {
    if (!enemy.alive) {
      enemy.respawnTimerSec -= dt;
      if (enemy.respawnTimerSec <= 0) {
        enemy.alive = true;
        enemy.hp = enemy.maxHp;
        // 쫓아오다 죽었을 수도 있으니 리스폰 시 원래 스폰 지점으로 되돌림
        enemy.position = { ...enemy.spawnPosition };
        // 상태이상(둔화·화상)도 함께 초기화
        enemy.status = { slowFactor: 1, slowRemainingSec: 0, burnDps: 0, burnRemainingSec: 0, freezeRemainingSec: 0 };
      }
    }
  }
}

export function damageEnemy(enemy: EnemyState, amount: number) {
  if (!enemy.alive) return false;
  enemy.hp -= amount;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.alive = false;
    enemy.respawnTimerSec = RESPAWN_SEC;
    return true; // died this hit
  }
  return false;
}

export function enemyIsland(enemy: EnemyState) {
  return getIsland(enemy.islandId);
}
