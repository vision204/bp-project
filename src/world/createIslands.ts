import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { ISLANDS, SEA_ORIGINS, dockDirection, worldRadius, type IslandDef, type IslandTheme, type Sea } from "./islands";
import { HQ_BUILDING } from "./SafeZones";
import type { QualitySettings } from "../core/GraphicsSettings";

// -----------------------------------------------------------------------
// 아트 에셋이 없는 지금 단계에서는 저해상도 도형(박스/원기둥/원뿔)만으로 섬을
// 구성합니다. 테마별로 색과 소품 모양만 바꿔서 정글/사막/얼음 같은 분위기를 냅니다.
// 나중에 .glb 모델로 교체할 때 이 파일만 손대면 됩니다.
// -----------------------------------------------------------------------

interface ThemePalette {
  sand: number;
  ground: number;
  rock: number;
  propTrunk: number;
  propTop: number;
  fogColor: number;
}

const PALETTES: Record<IslandTheme, ThemePalette> = {
  grass: { sand: 0xdcc27a, ground: 0x7fbf5b, rock: 0x8b8b8b, propTrunk: 0x6b4a2f, propTop: 0x3f9142, fogColor: 0x8fd0ff },
  // 해적 마을 — 나무통·붉은 깃발의 거친 항구 마을
  pirate: { sand: 0xd8b877, ground: 0x8aa855, rock: 0x7a6a55, propTrunk: 0x6b4a2f, propTop: 0xb23a3a, fogColor: 0x8fd0ff },
  // 해군 기지 — 흰 석재와 파란 지붕의 정돈된 요새
  marine: { sand: 0xe6ddc4, ground: 0x9fc47a, rock: 0xd8d4cc, propTrunk: 0xe8e4dc, propTop: 0x2f5fa8, fogColor: 0x8fd0ff },
  // 중앙 교역섬 — 돌바닥 광장과 천막 시장
  trade: { sand: 0xe0cfa0, ground: 0xb9ad8f, rock: 0x9a9080, propTrunk: 0x8d6e63, propTop: 0xe0a33c, fogColor: 0x8fd0ff },
  jungle: { sand: 0xa1887f, ground: 0x2e7d32, rock: 0x5d4037, propTrunk: 0x4e342e, propTop: 0x1b5e20, fogColor: 0x8fd0ff },
  desert: { sand: 0xe8d08a, ground: 0xe5c76b, rock: 0xbfa267, propTrunk: 0x8d6e63, propTop: 0x4caf50, fogColor: 0x8fd0ff },
  ice: { sand: 0xe3f2fd, ground: 0xd6f0ff, rock: 0xb0bec5, propTrunk: 0x90caf9, propTop: 0x81d4fa, fogColor: 0x8fd0ff },
  volcano: { sand: 0x5d4037, ground: 0x4e342e, rock: 0x263238, propTrunk: 0x3e2723, propTop: 0xff5722, fogColor: 0x8fd0ff },
  storm: { sand: 0x546e7a, ground: 0x37474f, rock: 0x455a64, propTrunk: 0x37474f, propTop: 0x7e57c2, fogColor: 0x8fd0ff },
  haunted: { sand: 0x6d6a75, ground: 0x4a4458, rock: 0x3e3a4a, propTrunk: 0x2f2b38, propTop: 0x9575cd, fogColor: 0x8fd0ff },
  crystal: { sand: 0xdfe7f5, ground: 0xb9c9e8, rock: 0x8fa6cf, propTrunk: 0x7986cb, propTop: 0x4fc3f7, fogColor: 0x8fd0ff },
  abyss: { sand: 0x1b2430, ground: 0x10161f, rock: 0x0b1016, propTrunk: 0x1a2b3c, propTop: 0x26c6da, fogColor: 0x8fd0ff },
  sky: { sand: 0xf3e9d2, ground: 0xe8f4ff, rock: 0xcfd8dc, propTrunk: 0xb0bec5, propTop: 0xfff59d, fogColor: 0x8fd0ff },
  dragon: { sand: 0x6d2f1e, ground: 0x4a1c12, rock: 0x2b1108, propTrunk: 0x3e1a0e, propTop: 0xff7043, fogColor: 0x8fd0ff },

  // ── 두 번째 바다 ─────────────────────────────────────────────────────────
  // 본부 — 초록 창고 건물의 대륙 중심 거점 (2세계의 관문)
  hq: { sand: 0xe8dfc8, ground: 0xc9c3b2, rock: 0xa8a496, propTrunk: 0x3f5c3f, propTop: 0x4a7a4a, fogColor: 0x8fd0ff },
  // 장미 왕국 — 붉은 장미 정원과 흰 성벽
  rose: { sand: 0xe4c9a8, ground: 0x6f9c58, rock: 0xd9cfc0, propTrunk: 0x4f7a3f, propTop: 0xd6415f, fogColor: 0x8fd0ff },
  // 초원 지대 — 탁 트인 풀밭
  green: { sand: 0xd9c98a, ground: 0x6cb04a, rock: 0x8a8f7a, propTrunk: 0x5b4128, propTop: 0x3f8f34, fogColor: 0x8fd0ff },
  // 공동묘지 — 잿빛 흙과 마른 가지
  graveyard: { sand: 0x8a8778, ground: 0x5c5a50, rock: 0x9a978c, propTrunk: 0x3f3b33, propTop: 0xb9b5a6, fogColor: 0x8fd0ff },
  // 눈 덮인 산 — 회청빛 바위와 눈
  snow: { sand: 0xdfe9f0, ground: 0xeef5fa, rock: 0x8fa0ad, propTrunk: 0x6d7a86, propTop: 0xffffff, fogColor: 0x8fd0ff },
  // 화염과 얼음 — 절반은 화산재, 절반은 서리 (땅은 그 경계색)
  hotcold: { sand: 0xb08a72, ground: 0x8e7f7a, rock: 0x6a5b58, propTrunk: 0x53403c, propTop: 0xff6a2a, fogColor: 0x8fd0ff },
  // 저주받은 배 — 젖은 검은 목재
  cursed: { sand: 0x5f5a52, ground: 0x4a453f, rock: 0x38342f, propTrunk: 0x2e2a26, propTop: 0x86d6c6, fogColor: 0x8fd0ff },
  // 얼음 성 — 푸른 유리 같은 얼음
  icecastle: { sand: 0xdff0fb, ground: 0xc3e4f7, rock: 0x8fc4e6, propTrunk: 0xa9d8f2, propTop: 0x63b8ec, fogColor: 0x8fd0ff },
  // 잊혀진 섬 — 모래에 반쯤 묻힌 옛 유적
  forgotten: { sand: 0xd8c9a0, ground: 0xa79a78, rock: 0xbfb193, propTrunk: 0x9b8f74, propTop: 0xd6c99f, fogColor: 0x8fd0ff },
  // 대저택 — 잘 손질된 정원과 짙은 목재
  mansion: { sand: 0xcbb894, ground: 0x577f45, rock: 0x7d6a55, propTrunk: 0x4b3a2b, propTop: 0x2f6b32, fogColor: 0x8fd0ff },
};

// ── Lv.400 이상 섬 — 고원 + 중앙 랜드마크 ─────────────────────────────────
// 수정 섬(400)부터 대저택(1900)까지, 두 바다에 걸친 13개 "고레벨" 섬은
// 섬 중앙에 다단 점프 없이는 못 올라가는 고원을 세우고 그 위에 커다란
// 조형물(랜드마크)을 놓습니다. 부두·해변·기존 몬스터 배치는 그대로 두고
// 고원은 "추가로" 얹는 구조라서 낮은 레벨대 섬 로직에는 영향이 없습니다.
/** 이 레벨 이상인 섬부터 고원이 생깁니다 (수정 섬 = 정확히 400). */
const PLATEAU_MIN_LEVEL = 400;
/**
 * 고원 벽 높이(m). 점프 물리(JUMP_SPEED=9, GRAVITY=20)로 계산하면 한 단
 * 점프의 이론상 최대 상승량은 v²/(2g) ≈ 2.0m이고, 정점에 맞춰 눌러야 하는
 * 실제 플레이라면 한 단당 대략 1.5m 안팎이 나옵니다(e2e 실측치 기준).
 * 그러면 4단(약 6m)으로는 못 넘고 5단(약 7.5m)이면 넘을 수 있는 높이가
 * 7m입니다 — "적어도 5단 점프를 안 하면 못 올라가는" 요청에 맞춘 값입니다.
 */
const PLATEAU_HEIGHT = 7;

/** 섬 반지름에 비례하되 12~22m 사이로 잡습니다 (너무 작거나 섬을 다 덮지 않게). */
function plateauRadiusFor(island: IslandDef): number {
  return Math.min(22, Math.max(12, island.radius * 0.3));
}

// ── Lv.400 미만인 첫 번째 바다의 다섯 섬 — 걸어서 오를 수 있는 완만한 언덕 ──
// 정글·사막·얼음·화산·폭풍 섬은 Lv.25~235라 아직 다단 점프를 못 배웠을 수도
// 있으므로(2단 점프는 Lv.125부터), 고원처럼 **절벽**을 세우면 안 됩니다. 대신
// 경사면을 완만한 계단(칸당 0.4m — 캐릭터 컨트롤러의 오토스텝 0.5m보다 낮음)으로
// 깔아서 그냥 걸어 올라갈 수 있게 하고, 그 위에 섬 테마에 맞는 랜드마크를 얹습니다.
// "섬마다 높이를 다양하게" 해달라는 요청대로 섬마다 언덕 높이를 다르게 잡았습니다.
const HILL_HEIGHTS: Record<string, number> = {
  jungle: 3.2,
  desert: 4.4,
  ice: 3.8,
  volcano: 6.5, // 분화구가 있는 화산이 가장 높습니다.
  storm: 4.6,
};

/** 섬 반지름에 비례하되 11~20m 사이로 잡습니다 (고원보다 살짝 작게 — 절벽이 아니라 언덕이라서). */
function hillRadiusFor(island: IslandDef): number {
  return Math.min(20, Math.max(11, island.radius * 0.32));
}

/** 섬마다 배치가 매번 달라지지 않도록 시드 기반 난수를 씁니다. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * 소품(나무/선인장/얼음기둥/바위 등) 하나에 붙일 충돌체의 반지름(m).
 * 테마마다 시각적으로는 모양이 다 다르지만(선인장 팔, 깃대, 지붕 등), 충돌은
 * 몸통 굵기 정도의 가벼운 원기둥 하나로만 잡습니다 — 섬마다 수십 개씩 놓이므로
 * 복합 충돌체를 쓰면 물리 연산이 무거워지고, 나무를 "가로지르지는 못하지만
 * 스치듯 지나갈 수는 있는" 정도가 실제 플레이 감각에도 적당합니다.
 */
const PROP_COLLIDER_RADIUS = 0.4;
const PROP_COLLIDER_HALF_HEIGHT = 1.0;

/**
 * 테마별 소품(나무/선인장/얼음기둥/용암기둥)을 만듭니다.
 */
function buildProp(theme: IslandTheme, palette: ThemePalette): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: palette.propTrunk });
  const topMat = new THREE.MeshStandardMaterial({ color: palette.propTop });

  switch (theme) {
    case "desert": {
      // 선인장: 몸통 + 팔 두 개
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 3.4, 8), topMat);
      body.position.y = 1.7;
      body.castShadow = true;
      group.add(body);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 6), topMat);
        arm.position.set(side * 0.6, 2.2, 0);
        arm.castShadow = true;
        group.add(arm);
      }
      break;
    }
    case "ice": {
      // 얼음 기둥
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 6), topMat);
      spike.position.y = 2.25;
      spike.castShadow = true;
      group.add(spike);
      break;
    }
    case "volcano": {
      // 용암이 굳은 뾰족 바위 + 붉게 빛나는 끝
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.6, 5), trunkMat);
      spire.position.y = 1.8;
      spire.castShadow = true;
      group.add(spire);
      const glow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 5), topMat);
      glow.position.y = 3.6;
      group.add(glow);
      break;
    }
    case "pirate": {
      // 해적 마을 — 나무통 위에 붉은 깃발을 단 장대
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.65, 1.4, 10), trunkMat);
      barrel.position.y = 0.7;
      barrel.castShadow = true;
      group.add(barrel);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6), trunkMat);
      pole.position.y = 3.2;
      pole.castShadow = true;
      group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), topMat);
      (flag.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      flag.position.set(0.78, 4.4, 0);
      group.add(flag);
      break;
    }
    case "marine": {
      // 해군 기지 — 흰 석재 기둥 위 파란 지붕의 초소
      const column = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.2, 1.3), trunkMat);
      column.position.y = 1.6;
      column.castShadow = true;
      group.add(column);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.4, 4), topMat);
      roof.position.y = 3.9;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
      break;
    }
    case "trade": {
      // 중앙 교역섬 — 천막을 친 시장 좌판
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.6), trunkMat);
      table.position.y = 0.45;
      table.castShadow = true;
      group.add(table);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5), trunkMat);
        post.position.set(side * 1.1, 1.2, 0);
        group.add(post);
      }
      const awning = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.0, 4), topMat);
      awning.position.y = 2.8;
      awning.rotation.y = Math.PI / 4;
      awning.castShadow = true;
      group.add(awning);
      break;
    }
    case "storm": {
      // 번개에 그을린 앙상한 나무
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 4, 6), trunkMat);
      trunk.position.y = 2;
      trunk.castShadow = true;
      group.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), topMat);
      crown.position.y = 4.3;
      crown.castShadow = true;
      group.add(crown);
      break;
    }
    case "haunted": {
      // 뒤틀린 고목 + 떠다니는 보라 도깨비불
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.42, 5, 6), trunkMat);
      trunk.position.y = 2.5;
      trunk.rotation.z = 0.14;
      trunk.castShadow = true;
      group.add(trunk);
      for (const [i, h] of [3.2, 4.3].entries()) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.2, 5), trunkMat);
        branch.position.set(i === 0 ? -0.8 : 0.9, h, 0);
        branch.rotation.z = i === 0 ? 0.9 : -0.8;
        group.add(branch);
      }
      const wisp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), topMat);
      wisp.position.set(0.6, 5.6, 0.4);
      group.add(wisp);
      break;
    }
    case "crystal": {
      // 커다란 수정 결정 + 주변 작은 결정들
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), topMat);
      core.position.y = 2.4;
      core.castShadow = true;
      group.add(core);
      for (const side of [-1, 1]) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), topMat);
        shard.position.set(side * 1.3, 1.1, side * 0.5);
        shard.rotation.set(0.4, side, 0.2);
        shard.castShadow = true;
        group.add(shard);
      }
      break;
    }
    case "abyss": {
      // 심연에서 솟은 검은 기둥 + 청록빛 균열
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 5.5, 5), trunkMat);
      pillar.position.y = 2.75;
      pillar.castShadow = true;
      group.add(pillar);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 6, 14), topMat);
      glow.position.y = 3.4;
      glow.rotation.x = Math.PI / 2;
      group.add(glow);
      break;
    }
    case "sky": {
      // 흰 구름 덩어리 위에 황금빛 첨탑
      const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 0), trunkMat);
      cloud.position.y = 1.2;
      cloud.scale.set(1.5, 0.7, 1.4);
      cloud.castShadow = true;
      group.add(cloud);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.4, 7), topMat);
      spire.position.y = 3.4;
      spire.castShadow = true;
      group.add(spire);
      break;
    }
    case "dragon": {
      // 거대한 용암 첨탑 + 이글거리는 균열
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6.5, 6), trunkMat);
      spire.position.y = 3.25;
      spire.castShadow = true;
      group.add(spire);
      const molten = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 6), topMat);
      molten.position.y = 6.2;
      group.add(molten);
      for (const side of [-1, 1]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 5), trunkMat);
        claw.position.set(side * 1.7, 1.2, side * 0.6);
        claw.rotation.z = side * 0.45;
        claw.castShadow = true;
        group.add(claw);
      }
      break;
    }
    case "jungle": {
      // 키 큰 야자수 + 넓은 잎 (원뿔 2겹)
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 5, 8), trunkMat);
      trunk.position.y = 2.5;
      trunk.castShadow = true;
      group.add(trunk);
      const lower = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.6, 8), topMat);
      lower.position.y = 5.2;
      lower.castShadow = true;
      group.add(lower);
      const upper = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.8, 8), topMat);
      upper.position.y = 6.2;
      upper.castShadow = true;
      group.add(upper);
      break;
    }
    // ── 두 번째 바다 ───────────────────────────────────────────────────────
    case "rose": {
      // 장미 덩굴 아치 — 흰 기둥 두 개에 붉은 장미가 얹힌 모양
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.2, 8), trunkMat);
        post.position.set(side * 1.1, 1.6, 0);
        post.castShadow = true;
        group.add(post);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.18, 6, 12, Math.PI), topMat);
      arch.position.y = 3.2;
      arch.castShadow = true;
      group.add(arch);
      for (const [i, x] of [-0.8, 0, 0.9].entries()) {
        const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), topMat);
        bloom.position.set(x, 3.5 + i * 0.15, 0);
        group.add(bloom);
      }
      break;
    }
    case "green": {
      // 넓은 활엽수 — 초원이라 키는 낮고 수관이 큽니다
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 2.8, 8), trunkMat);
      trunk.position.y = 1.4;
      trunk.castShadow = true;
      group.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 0), topMat);
      crown.position.y = 3.9;
      crown.scale.set(1.25, 0.85, 1.25);
      crown.castShadow = true;
      group.add(crown);
      break;
    }
    case "graveyard": {
      // 비석 + 마른 가지
      const stone = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.7, 0.28), topMat);
      stone.position.y = 0.85;
      stone.castShadow = true;
      group.add(stone);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.26, 12, 1, false, 0, Math.PI), topMat);
      cap.position.y = 1.7;
      cap.rotation.z = Math.PI / 2;
      cap.rotation.y = Math.PI / 2;
      group.add(cap);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.1, 5), trunkMat);
      branch.position.set(1.4, 1.55, 0.3);
      branch.rotation.z = 0.25;
      branch.castShadow = true;
      group.add(branch);
      break;
    }
    case "snow": {
      // 눈을 뒤집어쓴 침엽수
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6), trunkMat);
      trunk.position.y = 0.8;
      trunk.castShadow = true;
      group.add(trunk);
      for (const [i, y] of [1.9, 3.0, 3.9].entries()) {
        const tier = new THREE.Mesh(new THREE.ConeGeometry(1.6 - i * 0.42, 1.5, 7), topMat);
        tier.position.y = y;
        tier.castShadow = true;
        group.add(tier);
      }
      break;
    }
    case "hotcold": {
      // 한쪽은 불기둥, 반대쪽은 얼음 기둥 — 섬의 이름 그대로
      const lava = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.6, 6), topMat);
      lava.position.set(-0.9, 1.8, 0);
      lava.castShadow = true;
      group.add(lava);
      const iceMat = new THREE.MeshStandardMaterial({ color: 0x9fe0f5 });
      const ice = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3.9, 6), iceMat);
      ice.position.set(0.95, 1.95, 0.2);
      ice.castShadow = true;
      group.add(ice);
      break;
    }
    case "cursed": {
      // 부서진 돛대 — 기울어진 기둥에 찢긴 돛
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 5.4, 6), trunkMat);
      mast.position.y = 2.7;
      mast.rotation.z = 0.18;
      mast.castShadow = true;
      group.add(mast);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 5), trunkMat);
      yard.position.set(-0.4, 4.2, 0);
      yard.rotation.z = Math.PI / 2;
      group.add(yard);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.9), topMat);
      (sail.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      (sail.material as THREE.MeshStandardMaterial).transparent = true;
      (sail.material as THREE.MeshStandardMaterial).opacity = 0.55;
      sail.position.set(-0.4, 3.2, 0);
      group.add(sail);
      break;
    }
    case "icecastle": {
      // 얼음 첨탑 — 육각 기둥 위 뾰족지붕
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 4.2, 6), trunkMat);
      tower.position.y = 2.1;
      tower.castShadow = true;
      group.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.6, 6), topMat);
      roof.position.y = 5.5;
      roof.castShadow = true;
      group.add(roof);
      break;
    }
    case "forgotten": {
      // 반쯤 무너진 신전 기둥
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 4.4, 10), topMat);
      column.position.y = 2.2;
      column.rotation.z = 0.06;
      column.castShadow = true;
      group.add(column);
      const capital = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 1.5), topMat);
      capital.position.y = 4.5;
      capital.castShadow = true;
      group.add(capital);
      const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), trunkMat);
      rubble.position.set(1.6, 0.4, 0.5);
      rubble.castShadow = true;
      group.add(rubble);
      break;
    }
    case "mansion": {
      // 다듬은 정원수 — 네모난 산울타리 위에 둥근 수형
      const hedge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.0), topMat);
      hedge.position.y = 0.55;
      hedge.castShadow = true;
      group.add(hedge);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.6, 6), trunkMat);
      trunk.position.y = 1.6;
      group.add(trunk);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), topMat);
      ball.position.y = 3.0;
      ball.castShadow = true;
      group.add(ball);
      break;
    }
    default: {
      // 기본 야자수
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 3, 8), trunkMat);
      trunk.position.y = 1.5;
      trunk.castShadow = true;
      group.add(trunk);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.5, 8), topMat);
      leaves.position.y = 3.8;
      leaves.castShadow = true;
      group.add(leaves);
      break;
    }
  }
  return group;
}

/**
 * 고원 꼭대기에 세우는 커다란 중앙 조형물. buildProp보다 훨씬 큰 스케일로,
 * 섬 테마에 어울리는 랜드마크(화산분화구/성/큰 나무 등)를 만듭니다.
 * Lv.400 이상 13개 섬은 테마가 서로 겹치지 않으므로 테마 하나당 케이스 하나입니다.
 */
function buildLandmark(theme: IslandTheme, palette: ThemePalette, rand: () => number): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: palette.propTrunk, roughness: 0.85 });
  const topMat = new THREE.MeshStandardMaterial({ color: palette.propTop, roughness: 0.45 });
  const rockMat = new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 0.92 });
  const groundMat = new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 0.9 });

  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  switch (theme) {
    case "desert": {
      // 피라미드 — 매끈한 사각뿔 몸체 + 금빛 캡스톤 + 좌우에 보초 서듯 선 작은 오벨리스크
      const pyramidMat = new THREE.MeshStandardMaterial({ color: 0xd9b873, roughness: 0.88 });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xe8c94a, roughness: 0.3, metalness: 0.55 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(5.2, 6.4, 4), pyramidMat);
      body.position.y = 3.2;
      body.rotation.y = Math.PI / 4;
      add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.3, 4), goldMat);
      cap.position.y = 6.95;
      cap.rotation.y = Math.PI / 4;
      add(cap);
      for (const side of [-1, 1]) {
        const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 3.4, 4), rockMat);
        obelisk.position.set(side * 4.6, 1.7, 3.4);
        obelisk.rotation.y = Math.PI / 4;
        add(obelisk);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.6, 4), goldMat);
        tip.position.set(side * 4.6, 3.7, 3.4);
        tip.rotation.y = Math.PI / 4;
        add(tip);
      }
      break;
    }
    case "volcano": {
      // 분화구 — 바위 테두리 고리 + 이글거리는 용암 웅덩이 + 피어오르는 연기, 주변에 용암암 파편
      const rim = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.75, 8, 16), rockMat);
      rim.position.y = 0.5;
      rim.rotation.x = Math.PI / 2;
      add(rim);
      const lava = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.3, 14), topMat);
      lava.position.y = 0.2;
      group.add(lava);
      const smokeMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 1,
        transparent: true,
        opacity: 0.5,
      });
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.85 + rand() * 0.5, 8, 8), smokeMat);
        puff.position.set((rand() - 0.5) * 2.2, 2.2 + i * 1.5, (rand() - 0.5) * 2.2);
        group.add(puff);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rand();
        const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rand() * 0.4, 0), rockMat);
        chunk.position.set(Math.cos(a) * 4.0, 0.5, Math.sin(a) * 4.0);
        add(chunk);
      }
      break;
    }
    case "jungle": {
      // 거대한 반얀나무 — 굵은 기둥 + 넓은 수관 + 사방으로 늘어진 공중뿌리
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 5.5, 9), trunkMat);
      trunk.position.y = 2.75;
      add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3.6, 0), topMat);
      crown.position.y = 7.4;
      crown.scale.set(1.3, 0.8, 1.3);
      add(crown);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const root = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 3.4 + rand(), 5), trunkMat);
        root.position.set(Math.cos(a) * 1.7, 5.4, Math.sin(a) * 1.7);
        root.rotation.z = 0.15;
        add(root);
      }
      break;
    }
    case "ice": {
      // 빙하 첨봉 — 커다란 얼음 결정 첨탑 + 주위를 둘러싼 작은 얼음 결정 무리
      const spike = new THREE.Mesh(new THREE.ConeGeometry(2.6, 7.5, 6), topMat);
      spike.position.y = 3.75;
      add(spike);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + rand();
        const shard = new THREE.Mesh(new THREE.ConeGeometry(0.7 + rand() * 0.4, 2.6 + rand(), 5), topMat);
        shard.position.set(Math.cos(a) * 3.3, 1.3, Math.sin(a) * 3.3);
        add(shard);
      }
      break;
    }
    case "storm": {
      // 벼락 맞은 거목 — 앙상한 큰 나무 위로 먹구름이 떠 있고, 그 아래로 번개가 내리꽂힌 모습
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 6.5, 7), trunkMat);
      trunk.position.y = 3.25;
      trunk.rotation.z = 0.1;
      add(trunk);
      for (const [i, h] of [4.2, 5.6].entries()) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 3.4, 5), trunkMat);
        branch.position.set(i === 0 ? -1.6 : 1.8, h, 0);
        branch.rotation.z = i === 0 ? 0.85 : -0.75;
        add(branch);
      }
      const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 0), rockMat);
      cloud.position.y = 8.2;
      cloud.scale.set(1.6, 0.6, 1.4);
      group.add(cloud);
      const bolt = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.6, 3), topMat);
      bolt.position.set(0.3, 6.2, 0);
      bolt.rotation.z = Math.PI;
      group.add(bolt);
      break;
    }
    case "crystal": {
      // 거대 수정 결정 무리 — 가운데 큰 결정 + 주위 5개 작은 결정
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.6, 2, 9), rockMat);
      base.position.y = 1;
      add(base);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(4.2, 0), topMat);
      core.position.y = 6.6;
      add(core);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rand();
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(1.6 + rand() * 1.1, 0), topMat);
        shard.position.set(Math.cos(a) * 3.8, 2.6 + rand() * 3, Math.sin(a) * 3.8);
        shard.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
        add(shard);
      }
      break;
    }
    case "abyss": {
      // 심연 첨탑 — 검은 오벨리스크 + 청록빛 균열 고리들
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.6, 11, 6), trunkMat);
      spire.position.y = 5.5;
      add(spire);
      for (const y of [3, 6.2, 9]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9 - (y - 3) * 0.12, 0.16, 6, 16), topMat);
        ring.position.y = y;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), topMat);
      tip.position.y = 11.4;
      add(tip);
      break;
    }
    case "sky": {
      // 구름 위 황금 첨탑 — 3단 파고다 실루엣
      const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(3.6, 0), trunkMat);
      cloud.position.y = 2.2;
      cloud.scale.set(1.6, 0.6, 1.6);
      add(cloud);
      for (const [i, y] of [4.2, 6.6, 8.8].entries()) {
        const tier = new THREE.Mesh(new THREE.ConeGeometry(2.6 - i * 0.6, 1.6, 4), topMat);
        tier.position.y = y;
        tier.rotation.y = Math.PI / 4;
        add(tier);
      }
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 3, 6), topMat);
      spire.position.y = 11.5;
      add(spire);
      break;
    }
    case "dragon": {
      // 용의 둥지 — 화산분화구: 크레이터 산 + 안에서 빛나는 용암
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 6.8, 9, 10, 1, true), trunkMat);
      cone.position.y = 4.5;
      cone.material.side = THREE.DoubleSide;
      add(cone);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.5, 8, 14), rockMat);
      rim.position.y = 9;
      rim.rotation.x = Math.PI / 2;
      add(rim);
      const lava = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.4, 10), topMat);
      lava.position.y = 8.2;
      group.add(lava);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const egg = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), rockMat);
        egg.position.set(Math.cos(a) * 6.5, 1.1, Math.sin(a) * 6.5);
        egg.scale.set(0.8, 1.15, 0.8);
        add(egg);
      }
      break;
    }
    case "rose": {
      // 장미 왕국의 성 — 중앙 keep + 4개 모서리 첨탑
      const keep = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 8, 12), groundMat);
      keep.position.y = 4;
      add(keep);
      const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 3.2, 12), topMat);
      keepRoof.position.y = 9.6;
      add(keepRoof);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 5.5, 8), groundMat);
        turret.position.set(Math.cos(a) * 4.6, 2.75, Math.sin(a) * 4.6);
        add(turret);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2, 8), topMat);
        roof.position.set(Math.cos(a) * 4.6, 6.5, Math.sin(a) * 4.6);
        add(roof);
      }
      break;
    }
    case "green": {
      // 초원의 커다란 고목
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 6.5, 10), trunkMat);
      trunk.position.y = 3.25;
      add(trunk);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6 + rand() * 1.2, 0), topMat);
        blob.position.set(Math.cos(a) * 2.4, 8 + rand() * 1.6, Math.sin(a) * 2.4);
        blob.scale.set(1.1, 0.8, 1.1);
        add(blob);
      }
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3.8, 0), topMat);
      crown.position.y = 9.4;
      crown.scale.set(1.3, 0.75, 1.3);
      add(crown);
      break;
    }
    case "graveyard": {
      // 대묘 — 돌 영묘 + 기둥 + 꼭대기 첨탑
      const crypt = new THREE.Mesh(new THREE.BoxGeometry(6.5, 4.2, 5.5), groundMat);
      crypt.position.y = 2.1;
      add(crypt);
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 5.4, 8), rockMat);
        col.position.set(side * 3.6, 2.7, 3.2);
        add(col);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.4, 4), rockMat);
      roof.position.y = 5.4;
      roof.rotation.y = Math.PI / 4;
      add(roof);
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 4.4, 6), rockMat);
      spire.position.y = 8.8;
      add(spire);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), topMat);
      orb.position.y = 11.2;
      add(orb);
      break;
    }
    case "snow": {
      // 눈 덮인 봉우리 — 큰 설산 첨봉 + 주변 바위 봉우리들
      const peak = new THREE.Mesh(new THREE.ConeGeometry(4.6, 11, 9), topMat);
      peak.position.y = 5.5;
      add(peak);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        const small = new THREE.Mesh(new THREE.ConeGeometry(1.5 + rand(), 5 + rand() * 2, 7), rockMat);
        small.position.set(Math.cos(a) * 4.8, 2.5, Math.sin(a) * 4.8);
        add(small);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.6, 7), topMat);
        cap.position.set(Math.cos(a) * 4.8, 5.6, Math.sin(a) * 4.8);
        add(cap);
      }
      break;
    }
    case "hotcold": {
      // 화염과 얼음 — 절반은 화산분화구, 절반은 얼음 첨탑
      const iceMat = new THREE.MeshStandardMaterial({ color: 0x9fe0f5, roughness: 0.3 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.2, 1.6, 10), rockMat);
      base.position.y = 0.8;
      add(base);
      const lavaCone = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.4, 7.5, 8, 1, true), trunkMat);
      lavaCone.position.set(-2.2, 4.55, 0);
      lavaCone.material.side = THREE.DoubleSide;
      add(lavaCone);
      const lavaTop = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.4, 8), topMat);
      lavaTop.position.set(-2.2, 8.2, 0);
      group.add(lavaTop);
      const ice = new THREE.Mesh(new THREE.ConeGeometry(2.6, 9, 7), iceMat);
      ice.position.set(2.6, 4.5, 0);
      add(ice);
      break;
    }
    case "cursed": {
      // 저주받은 배 — 좌초한 선체 + 부러진 돛대
      const hull = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 4.2), trunkMat);
      hull.position.set(0, 1.6, 0);
      hull.rotation.z = 0.12;
      add(hull);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4, 4), trunkMat);
      bow.position.set(5.4, 2, 0);
      bow.rotation.z = Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      add(bow);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 9, 7), trunkMat);
      mast.position.set(-1.5, 6.5, 0.3);
      mast.rotation.z = 0.22;
      add(mast);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.6), topMat);
      (sail.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      (sail.material as THREE.MeshStandardMaterial).transparent = true;
      (sail.material as THREE.MeshStandardMaterial).opacity = 0.6;
      sail.position.set(-2.4, 8.4, 0.3);
      sail.rotation.z = 0.3;
      group.add(sail);
      break;
    }
    case "icecastle": {
      // 얼음 성 — 육각 본성 + 좌우 소첨탑
      const keep = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 8.5, 6), groundMat);
      keep.position.y = 4.25;
      add(keep);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.9, 4.6, 6), topMat);
      roof.position.y = 10.8;
      add(roof);
      for (const side of [-1, 1]) {
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 6, 6), groundMat);
        turret.position.set(side * 4.6, 3, 1.5);
        add(turret);
        const tRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 6), topMat);
        tRoof.position.set(side * 4.6, 7.3, 1.5);
        add(tRoof);
      }
      break;
    }
    case "forgotten": {
      // 잊혀진 신전 — 계단식 피라미드 + 부서진 첨탑
      for (const [i, s] of [6.2, 4.8, 3.4].entries()) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(s * 1.8, 1.6, s * 1.8), groundMat);
        tier.position.y = 0.8 + i * 1.6;
        add(tier);
      }
      const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.85, 5.4, 6), rockMat);
      obelisk.position.y = 7.5;
      obelisk.rotation.z = 0.08;
      add(obelisk);
      const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3, 0), rockMat);
      rubble.position.set(3.6, 1, 3.2);
      add(rubble);
      break;
    }
    case "mansion": {
      // 대저택 — 커다란 본관 + 정원 산울타리 고리
      const manor = new THREE.Mesh(new THREE.BoxGeometry(8.5, 6.4, 6.5), groundMat);
      manor.position.y = 3.2;
      add(manor);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 4), trunkMat);
      roof.position.y = 8;
      roof.rotation.y = Math.PI / 4;
      add(roof);
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6.4, 8), topMat);
        pillar.position.set(side * 3.6, 3.2, 3.6);
        add(pillar);
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const hedge = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), trunkMat);
        hedge.position.set(Math.cos(a) * 8.5, 1, Math.sin(a) * 8.5);
        add(hedge);
      }
      break;
    }
    default: {
      // 방어적 기본값 — 사실상 도달하지 않지만, 큰 돌기둥 하나
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 9, 10), rockMat);
      pillar.position.y = 4.5;
      add(pillar);
      break;
    }
  }

  return group;
}

/**
 * Lv.400 이상 섬의 중앙 고원. 섬 중심에 다단 점프 없이는 못 넘는 원기둥
 * 벽을 세우고(측면이 곧 "절벽"), 그 꼭대기 평평한 면 위에 랜드마크를
 * 올립니다. 기존 해변/부두/소품 배치는 건드리지 않는 별도 구조물입니다.
 */
function buildPlateau(
  island: IslandDef,
  palette: ThemePalette,
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
  rand: () => number,
) {
  const radius = plateauRadiusFor(island);
  const height = PLATEAU_HEIGHT;

  // 절벽 벽 — 시각 + 충돌 모두 이 하나의 원기둥으로 처리합니다
  // (측면이 절벽, 윗면이 그대로 고원 바닥의 충돌면이 됩니다).
  const wallMat = new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 0.95 });
  const wallMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, quality.islandSegments), wallMat);
  wallMesh.position.set(island.center.x, height / 2, island.center.z);
  wallMesh.castShadow = quality.shadows;
  wallMesh.receiveShadow = quality.shadows;
  group.add(wallMesh);

  const wallBody = world.createRigidBody(
    RAPIER_NS.RigidBodyDesc.fixed().setTranslation(island.center.x, height / 2, island.center.z),
  );
  world.createCollider(RAPIER_NS.ColliderDesc.cylinder(height / 2, radius), wallBody);

  // 고원 윗면 — 테마 색 얇은 판 (시각용, 충돌은 위 벽 콜라이더가 이미 처리)
  const topMat = new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1 });
  const topMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.4, radius - 0.4, 0.3, quality.islandSegments), topMat);
  topMesh.position.set(island.center.x, height + 0.15, island.center.z);
  topMesh.receiveShadow = quality.shadows;
  group.add(topMesh);

  const landmark = buildLandmark(island.theme, palette, rand);
  landmark.position.set(island.center.x, height + 0.3, island.center.z);
  group.add(landmark);
}

/**
 * Lv.400 미만인 첫 번째 바다의 다섯 섬(정글·사막·얼음·화산·폭풍)에 세우는 완만한
 * 중앙 언덕. buildPlateau와 달리 **절벽이 아니라 경사**입니다 — 계단 한 칸을
 * 0.4m로 잡아서 캐릭터 컨트롤러의 자동보행(오토스텝 0.5m)만으로 걸어 올라갈 수
 * 있습니다(해변 경사와 같은 기법). 꼭대기에는 buildLandmark로 만든 섬 테마
 * 랜드마크(피라미드/분화구 등)를 얹습니다.
 */
function buildHill(
  island: IslandDef,
  palette: ThemePalette,
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
  rand: () => number,
) {
  const height = HILL_HEIGHTS[island.id] ?? 3;
  const baseRadius = hillRadiusFor(island);
  const topRadius = baseRadius * 0.42;

  // 완만한 원뿔대 — 시각
  const hillMat = new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 0.95 });
  const hillMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius, baseRadius, height, quality.islandSegments),
    hillMat,
  );
  hillMesh.position.set(island.center.x, height / 2, island.center.z);
  hillMesh.castShadow = quality.shadows;
  hillMesh.receiveShadow = quality.shadows;
  group.add(hillMesh);

  // 꼭대기 판 — 테마 색
  const topMat = new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1 });
  const topMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius - 0.3, topRadius - 0.3, 0.3, quality.islandSegments),
    topMat,
  );
  topMesh.position.set(island.center.x, height + 0.15, island.center.z);
  topMesh.receiveShadow = quality.shadows;
  group.add(topMesh);

  // 충돌: 계단식으로 쌓아 걸어서 오를 수 있게 (해변 경사와 같은 기법)
  const stepHeight = 0.4;
  const steps = Math.max(1, Math.ceil(height / stepHeight));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const stepRadius = baseRadius + (topRadius - baseRadius) * t;
    const topY = t * height;
    const body = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed().setTranslation(island.center.x, topY - 0.5, island.center.z),
    );
    world.createCollider(RAPIER_NS.ColliderDesc.cylinder(0.5, stepRadius), body);
  }

  const landmark = buildLandmark(island.theme, palette, rand);
  landmark.position.set(island.center.x, height + 0.3, island.center.z);
  group.add(landmark);
}

/**
 * 해변 경사: 물속에서 섬 위로 걸어 올라올 수 있도록 4단 계단 콜라이더를 깔고,
 * 그 위에 매끈한 원뿔대 메시를 덮어 시각적으로는 완만한 모래사장처럼 보이게 합니다.
 * (계단 한 칸 높이 0.35m는 캐릭터 컨트롤러의 autostep 0.5m보다 낮아서 자동으로 올라갑니다.)
 */
function buildBeach(
  island: IslandDef,
  palette: ThemePalette,
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
) {
  const sandMat = new THREE.MeshStandardMaterial({ color: palette.sand, roughness: 1 });

  // 시각용 매끈한 경사면
  const slope = new THREE.Mesh(new THREE.CylinderGeometry(island.radius, island.radius + 6.5, 1.6, quality.islandSegments, 1, true), sandMat);
  slope.position.set(island.center.x, -0.75, island.center.z);
  slope.receiveShadow = quality.shadows;
  slope.material.side = THREE.DoubleSide;
  group.add(slope);

  // 충돌용 계단 (4단)
  for (let i = 1; i <= 4; i++) {
    const stepRadius = island.radius + i * 1.5;
    const topY = -i * 0.35;
    const body = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed().setTranslation(island.center.x, topY - 1, island.center.z),
    );
    world.createCollider(RAPIER_NS.ColliderDesc.cylinder(1, stepRadius), body);
  }
}

/** 부두: 섬 가장자리에서 바다 쪽으로 뻗은 나무 판자 다리 */
function buildDock(
  island: IslandDef,
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
) {
  const dir = dockDirection(island);
  const length = 16;
  const width = 3.6;
  const centerDist = island.radius + 2;
  const cx = island.center.x + dir.x * centerDist;
  const cz = island.center.z + dir.z * centerDist;
  const angle = Math.atan2(dir.z, dir.x);

  const plankMat = new THREE.MeshStandardMaterial({ color: 0x8d6e46, roughness: 0.9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, 0.3, width), plankMat);
  deck.position.set(cx, -0.1, cz);
  deck.rotation.y = -angle;
  deck.receiveShadow = quality.shadows;
  deck.castShadow = quality.shadows;
  group.add(deck);

  const deckBody = world.createRigidBody(
    RAPIER_NS.RigidBodyDesc.fixed()
      .setTranslation(cx, -0.1, cz)
      .setRotation({ x: 0, y: Math.sin(-angle / 2), z: 0, w: Math.cos(-angle / 2) }),
  );
  world.createCollider(RAPIER_NS.ColliderDesc.cuboid(length / 2, 0.15, width / 2), deckBody);

  // 기둥 몇 개 (장식)
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x6d4c33 });
  for (let i = -1; i <= 1; i += 2) {
    for (let t = 0.25; t <= 0.85; t += 0.3) {
      const along = (t - 0.5) * length;
      const perpX = -dir.z * (width / 2 - 0.25) * i;
      const perpZ = dir.x * (width / 2 - 0.25) * i;
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 6), pileMat);
      pile.position.set(cx + dir.x * along + perpX, -1.1, cz + dir.z * along + perpZ);
      group.add(pile);
    }
  }
}

/**
 * 중앙 교역섬을 꾸미는 2~3층짜리 작은 건물.
 *
 * **안으로는 들어갈 수 없습니다** — 문과 창문은 벽에 붙인 판때기이고,
 * 건물 전체에 네모난 충돌체가 있어서 통과하지 못하고 옆으로 돌아가게 됩니다.
 * (지금은 마을 분위기를 내는 배경물입니다. 나중에 실내를 만들 거라면
 *  이 충돌체를 벽 4개로 쪼개고 문 자리만 비우면 됩니다.)
 */
function buildTownHouse(
  floors: number,
  width: number,
  depth: number,
  palette: ThemePalette,
  rand: () => number,
): THREE.Group {
  const group = new THREE.Group();
  const floorHeight = 3.1;

  // 층마다 색을 살짝 달리해서 층이 눈에 보이게 합니다.
  const wallColors = [0xefe3c8, 0xe6d3ad, 0xdcc79c, 0xf2e7d5];
  const roofColors = [0xb23a3a, 0x8d6e63, 0x2f5fa8, 0x4a6b52];
  const roofColor = roofColors[Math.floor(rand() * roofColors.length)];

  for (let f = 0; f < floors; f++) {
    const shrink = f * 0.12; // 위층으로 갈수록 살짝 좁아지게
    const w = width - shrink;
    const d = depth - shrink;
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColors[(f + Math.floor(rand() * 2)) % wallColors.length],
      roughness: 0.85,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, floorHeight, d), wallMat);
    box.position.y = floorHeight * (f + 0.5);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    // 층 사이 띠 (2층집인지 3층집인지 한눈에 보이도록)
    const bandMat = new THREE.MeshStandardMaterial({ color: palette.propTrunk, roughness: 0.9 });
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.22, d + 0.16), bandMat);
    band.position.y = floorHeight * (f + 1);
    group.add(band);

    // 앞뒤 벽의 창문 (판때기 — 실제로 뚫린 건 아닙니다)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x8ec9e8,
      roughness: 0.25,
      metalness: 0.35,
    });
    for (const side of [1, -1]) {
      for (const offset of [-w * 0.24, w * 0.24]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.08), glassMat);
        win.position.set(offset, floorHeight * (f + 0.55), (side * d) / 2 + side * 0.04);
        group.add(win);
      }
    }
  }

  // 1층 정면의 문 (역시 장식 — 열리지 않습니다)
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.1), doorMat);
  door.position.set(0, 0.95, depth / 2 + 0.05);
  group.add(door);

  // 지붕 — 4각뿔
  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8 });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.78, 2.1, 4), roofMat);
  roof.position.y = floorHeight * floors + 1.05;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

/**
 * 허브 섬(중앙 교역섬)에 세우는 마을 — 광장을 둘러싸듯 원형으로 배치합니다.
 * 건물에는 전부 충돌체가 붙어 있어서 안으로 들어갈 수 없습니다 (겉모습 장식).
 *
 * 두 번째 바다의 허브(본부)는 더 이상 이 함수를 쓰지 않습니다 — buildHqBuilding이
 * 대신 걸어 들어갈 수 있는 창고 건물을 세웁니다 (옛 "분수 도시" 마을/분수 장식은
 * 제거됐습니다).
 */
function buildTradeTown(
  island: IslandDef,
  palette: ThemePalette,
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
) {
  const rand = makeRandom(4271);
  const houseCount = Math.max(6, Math.round(10 * quality.propDensity));

  for (let i = 0; i < houseCount; i++) {
    // 부두 방향(배 타러 가는 길)과 열매 상인 자리(dockAngle 방향 안쪽)는 비워둡니다.
    const angle = island.dockAngle + Math.PI * 0.42 + (i / houseCount) * Math.PI * 1.62;
    const dist = island.radius * (0.55 + rand() * 0.16);
    const x = island.center.x + Math.cos(angle) * dist;
    const z = island.center.z + Math.sin(angle) * dist;

    const floors = rand() < 0.45 ? 3 : 2;
    const width = 4.6 + rand() * 2.2;
    const depth = 4.2 + rand() * 1.8;

    const house = buildTownHouse(floors, width, depth, palette, rand);
    house.position.set(x, 0.3, z);
    // 정면이 광장(섬 중심)을 바라보게
    house.rotation.y = Math.atan2(island.center.x - x, island.center.z - z);
    group.add(house);

    // 들어갈 수 없도록 건물 전체를 막는 충돌체
    const body = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed()
        .setTranslation(x, 0.3 + (floors * 3.1) / 2, z)
        .setRotation({ x: 0, y: Math.sin(house.rotation.y / 2), z: 0, w: Math.cos(house.rotation.y / 2) }),
    );
    world.createCollider(
      RAPIER_NS.ColliderDesc.cuboid(width / 2, (floors * 3.1) / 2, depth / 2),
      body,
    );
  }

  // 광장 바닥 — 돌 포장 느낌의 원반
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xc9bfa6, roughness: 1 });
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(island.radius * 0.36, island.radius * 0.36, 0.12, quality.islandSegments),
    plazaMat,
  );
  plaza.position.set(island.center.x, 0.33, island.center.z);
  plaza.receiveShadow = quality.shadows;
  group.add(plaza);

  // 광장 한가운데 분수대 (역시 장식).
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb8ae97, roughness: 0.95 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x4aa3d8, roughness: 0.2, metalness: 0.3 });

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.9, 12), stoneMat);
  basin.position.set(island.center.x, 0.75, island.center.z);
  basin.castShadow = quality.shadows;
  group.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.12, 12), waterMat);
  water.position.set(island.center.x, 1.18, island.center.z);
  group.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 2.2, 8), stoneMat);
  pillar.position.set(island.center.x, 2.2, island.center.z);
  pillar.castShadow = quality.shadows;
  group.add(pillar);

  const fountainBody = world.createRigidBody(
    RAPIER_NS.RigidBodyDesc.fixed().setTranslation(island.center.x, 0.75, island.center.z),
  );
  world.createCollider(RAPIER_NS.ColliderDesc.cylinder(0.45, 2.6), fountainBody);
}

// ═══════════════════════════════════════════════════════════════════════
// 두 번째 바다 안쪽 대륙 — 장미 왕국/초원 지대/공동묘지/눈 덮인 산을 하나로
// 잇는 자유형(비원형) 땅덩어리 + 성벽 + 본부 건물.
//
// 위 네 섬과 "hq" 허브는 여전히 islands.ts에서 독립된 원형 IslandDef(각자의
// center/radius)로 존재하고 몬스터/퀘스트/길안내는 전부 그 원형 판정을
// 그대로 씁니다 — 여기서 만드는 건 "그 5개의 원이 다 들어가는 하나로 이어진
// 지형/성벽/건물"이라는 시각+물리 레이어일 뿐입니다. islandAt() 등 로직에는
// 관여하지 않습니다.
// ═══════════════════════════════════════════════════════════════════════

/**
 * 대륙 해안선 — 16개 점을 각도·반지름으로 손으로 잡았습니다. 완전한 원이
 * 아니라 각도마다 반지름을 다르게 줘서(210~252m) 자연스러운 굴곡을 냅니다.
 * 0°/90°/180°/270°(장미·초원·공동묘지·눈산이 있는 정확히 그 방향)는 반지름을
 * 넉넉히 키워서(≥245m) 그 섬들(중심에서 150m + 자기 반지름 48m = 198m 필요)이
 * 여유 있게 다 들어가고, 그 사이(대각선 방향)는 살짝 좁혀서(210~232m) 진짜
 * 해안선처럼 굴곡이 보이게 했습니다. (검증: 가장 좁은 구간도 210m로,
 * 198m보다 12m 이상 여유가 있고, 실제로 각 섬이 걸리는 부채꼴 구간은 그보다
 * 더 안쪽인 대각선 최저점에서 멀리 떨어져 있어 안전합니다 — 자세한 계산은
 * PR 설명 참고.)
 */
/**
 * 대륙 지면의 높이(y). 원형 섬들은 기둥 몸체 위에 0.3m 두께의 상판 텍스처
 * 디스크를 얹어서 실제 걸어다니는 표면이 y≈0.3에 옵니다. 대륙 지형은 그
 * 상판 디스크가 없는 평평한 폴리곤 한 장이라 예전엔 y=0에 있었는데, 바다
 * 메시(OCEAN_MESH_Y = -0.8)와의 여유가 원형 섬보다 0.3m 적어서 파도가 치는
 * 각도/거리에 따라 해안선 쪽에서 바다와 지면이 겹쳐 보이는 문제가 있었습니다.
 * 원형 섬과 정확히 같은 높이(0.3)로 맞춥니다 — buildIsland()의 소품/바위/고원
 * 배치(y=0.3, y=0.7 등)도 전부 이 관례를 전제로 하고 있어서, 대륙 안쪽 4개
 * 사냥터(skipOwnTerrain)에 있는 소품들과도 높이가 어긋나지 않습니다.
 */
const CONTINENT_GROUND_Y = 0.3;

const CONTINENT_FOOTPRINT: { angleDeg: number; radius: number }[] = [
  { angleDeg: 0, radius: 245 }, // → 초원 지대 방향(+x)
  { angleDeg: 22.5, radius: 225 },
  { angleDeg: 45, radius: 218 }, // 성문 방향 (본부 부두가 나가는 쪽)
  { angleDeg: 67.5, radius: 232 },
  { angleDeg: 90, radius: 252 }, // → 장미 왕국 방향(+z)
  { angleDeg: 112.5, radius: 228 },
  { angleDeg: 135, radius: 212 },
  { angleDeg: 157.5, radius: 230 },
  { angleDeg: 180, radius: 248 }, // → 눈 덮인 산 방향(-x)
  { angleDeg: 202.5, radius: 222 },
  { angleDeg: 225, radius: 210 }, // 뒷문 방향
  { angleDeg: 247.5, radius: 226 },
  { angleDeg: 270, radius: 250 }, // → 공동묘지 방향(-z)
  { angleDeg: 292.5, radius: 224 },
  { angleDeg: 315, radius: 214 },
  { angleDeg: 337.5, radius: 234 },
];

/** 대륙 원점(두 번째 바다 원점) 기준 로컬 좌표의 해안선 정점들. */
function continentCoastPoints(): { x: number; z: number }[] {
  return CONTINENT_FOOTPRINT.map(({ angleDeg, radius }) => {
    const a = (angleDeg * Math.PI) / 180;
    return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
  });
}

/** 해안선을 원점 쪽으로 amount(m)만큼 들여온 점들 (성벽 등 안쪽 구조물에 씀). */
function insetPolygon(points: { x: number; z: number }[], amount: number) {
  return points.map((p) => {
    const len = Math.hypot(p.x, p.z) || 1;
    const t = Math.max(0, len - amount) / len;
    return { x: p.x * t, z: p.z * t };
  });
}

/**
 * 대륙 본체 — THREE.ShapeUtils로 해안선 폴리곤을 삼각분할해서 평평한 지형
 * 메시를 만들고, 정확히 같은 삼각분할 데이터로 Rapier trimesh 충돌체를
 * 만듭니다(메시와 충돌이 한 치도 어긋나지 않도록 같은 데이터를 공유).
 * trimesh를 고른 이유: 원형 섬들의 원기둥 충돌체와 달리 이 폴리곤은 진짜
 * 비정형이라 원/실린더/박스 몇 개로는 근사가 지저분해지고, 이 프로젝트의
 * KinematicCharacterController(오토스텝 포함)는 평평한 정적 trimesh 위에서
 * 별문제 없이 동작합니다 — 원기둥 충돌체들 위를 이미 문제없이 걷고 있는
 * 것과 같은 부류의 정적 충돌체이기 때문입니다.
 */
function buildContinentGround(
  points: { x: number; z: number }[],
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
  origin: { x: number; z: number },
  groundColor: number,
) {
  const contour = points.map((p) => new THREE.Vector2(p.x, p.z));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);

  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    positions[i * 3] = origin.x + p.x;
    positions[i * 3 + 1] = CONTINENT_GROUND_Y;
    positions[i * 3 + 2] = origin.z + p.z;
  });

  // triangulateShape는 2D 도형 좌표계(반시계 = 앞면) 기준 순서를 돌려주는데,
  // 그 (x,y)를 그대로 월드 (x,z)에 심으면(회전 없이) 앞면 법선이 -Y(바닥
  // 방향)로 뒤집힙니다. i1/i2를 맞바꿔 감는 방향을 뒤집어 법선이 +Y(위쪽)를
  // 보게 합니다.
  const indices = new Uint32Array(triangles.length * 3);
  triangles.forEach((tri, i) => {
    indices[i * 3] = tri[0];
    indices[i * 3 + 1] = tri[2];
    indices[i * 3 + 2] = tri[1];
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  // side: DoubleSide — 위 winding 계산이 혹시 어긋나도(수동 계산이라) 최소한
  // 안 보이는 사고는 나지 않도록 하는 안전장치입니다.
  const mat = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = quality.shadows;
  group.add(mesh);

  const body = world.createRigidBody(RAPIER_NS.RigidBodyDesc.fixed());
  world.createCollider(RAPIER_NS.ColliderDesc.trimesh(positions, indices), body);
}

/**
 * 해변 경사 — buildBeach(원형 섬용)와 같은 발상을, 폴리곤 변 하나하나에
 * 적용한 버전입니다. 변마다 바깥쪽 법선 방향으로 밀어낸 사다리꼴 하나(시각용
 * 경사면)와, 그 위를 걸어 오를 수 있는 4단 박스 충돌체(변을 따라 뻗은 긴
 * 상자)를 놓습니다. 옆 변과 살짝 겹치게(+1.2m) 잡아서 모서리에 빈틈이
 * 생기지 않게 했습니다.
 */
function buildContinentBeachSkirt(
  points: { x: number; z: number }[],
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
  origin: { x: number; z: number },
  sandColor: number,
) {
  const sandMat = new THREE.MeshStandardMaterial({ color: sandColor, roughness: 1, side: THREE.DoubleSide });
  const skirtWidth = 7;
  const n = points.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len;
    let nz = dx / len;
    const midX = (p1.x + p2.x) / 2;
    const midZ = (p1.z + p2.z) / 2;
    if (nx * midX + nz * midZ < 0) {
      nx = -nx;
      nz = -nz;
    }

    const base = positions.length / 3;
    positions.push(
      origin.x + p1.x, CONTINENT_GROUND_Y, origin.z + p1.z,
      origin.x + p2.x, CONTINENT_GROUND_Y, origin.z + p2.z,
      origin.x + p2.x + nx * skirtWidth, CONTINENT_GROUND_Y - 1.6, origin.z + p2.z + nz * skirtWidth,
      origin.x + p1.x + nx * skirtWidth, CONTINENT_GROUND_Y - 1.6, origin.z + p1.z + nz * skirtWidth,
    );
    // side: DoubleSide 재질이라 앞/뒤 어느 방향에서 봐도 보이므로 감는 순서 하나면 충분합니다.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

    // 충돌용 4단 계단 — 변 방향으로 긴 상자를 깊이별로 쌓습니다 (원형 섬의
    // buildBeach와 같은 step 높이 0.35m, 오토스텝 0.5m보다 낮아서 자동으로 오름).
    const angle = Math.atan2(dz, dx);
    const halfLen = len / 2 + 1.2;
    for (let s = 1; s <= 4; s++) {
      const t = s / 4;
      const cx = origin.x + midX + nx * skirtWidth * t;
      const cz = origin.z + midZ + nz * skirtWidth * t;
      const topY = CONTINENT_GROUND_Y - s * 0.35;
      const body = world.createRigidBody(
        RAPIER_NS.RigidBodyDesc.fixed()
          .setTranslation(cx, topY - 0.5, cz)
          .setRotation({ x: 0, y: Math.sin(-angle / 2), z: 0, w: Math.cos(-angle / 2) }),
      );
      world.createCollider(RAPIER_NS.ColliderDesc.cuboid(halfLen, 0.5, 1.6), body);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, sandMat);
  mesh.receiveShadow = quality.shadows;
  group.add(mesh);
}

/**
 * 성벽 — 해안선을 ~9m 안쪽으로 들여온 폴리곤을 따라 박스 세그먼트(변 하나가
 * 22m를 넘으면 여러 조각으로 쪼갬)를 두르고, 각 꼭짓점에는 살짝 더 높은
 * 원기둥 + 원뿔 지붕으로 성탑을 얹습니다. GATE_EDGE_INDICES에 있는 변은
 * 통째로 비워서 성문 두 곳(본부 부두가 나가는 45° 방향과 그 반대쪽)을 냅니다.
 */
function buildCastleWall(
  points: { x: number; z: number }[],
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
  origin: { x: number; z: number },
) {
  const WALL_INSET = 9;
  const WALL_HEIGHT = 5.5;
  const WALL_THICKNESS = 2;
  const MAX_SEGMENT_LEN = 22;
  // 인덱스 1 = 22.5°~45° 변(본부 부두가 나가는 방향), 인덱스 9 = 202.5°~225°
  // 변(그 반대쪽) — 성문 두 곳.
  const GATE_EDGE_INDICES = new Set([1, 9]);

  const wallPts = insetPolygon(points, WALL_INSET);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.9 });
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x7d786c, roughness: 0.85 });

  const n = wallPts.length;
  for (let i = 0; i < n; i++) {
    if (GATE_EDGE_INDICES.has(i)) continue;
    const p1 = wallPts[i];
    const p2 = wallPts[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const segCount = Math.max(1, Math.ceil(len / MAX_SEGMENT_LEN));
    const segLen = len / segCount;

    for (let s = 0; s < segCount; s++) {
      const t = (s + 0.5) / segCount;
      const cx = origin.x + p1.x + dx * t;
      const cz = origin.z + p1.z + dz * t;

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.5, WALL_HEIGHT, WALL_THICKNESS), wallMat);
      mesh.position.set(cx, CONTINENT_GROUND_Y + WALL_HEIGHT / 2, cz);
      mesh.rotation.y = -angle;
      mesh.castShadow = quality.shadows;
      mesh.receiveShadow = quality.shadows;
      group.add(mesh);

      const body = world.createRigidBody(
        RAPIER_NS.RigidBodyDesc.fixed()
          .setTranslation(cx, CONTINENT_GROUND_Y + WALL_HEIGHT / 2, cz)
          .setRotation({ x: 0, y: Math.sin(-angle / 2), z: 0, w: Math.cos(-angle / 2) }),
      );
      world.createCollider(
        RAPIER_NS.ColliderDesc.cuboid(segLen / 2 + 0.25, WALL_HEIGHT / 2, WALL_THICKNESS / 2),
        body,
      );
    }
  }

  // 모서리 성탑
  for (const p of wallPts) {
    const cx = origin.x + p.x;
    const cz = origin.z + p.z;
    const towerHeight = WALL_HEIGHT + 2.5;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.85, towerHeight, 8), towerMat);
    tower.position.set(cx, CONTINENT_GROUND_Y + towerHeight / 2, cz);
    tower.castShadow = quality.shadows;
    group.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.8, 8), towerMat);
    roof.position.set(cx, CONTINENT_GROUND_Y + towerHeight + 0.9, cz);
    roof.castShadow = quality.shadows;
    group.add(roof);

    const body = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed().setTranslation(cx, CONTINENT_GROUND_Y + towerHeight / 2, cz),
    );
    world.createCollider(RAPIER_NS.ColliderDesc.cylinder(towerHeight / 2, 1.7), body);
  }
}

/** 본부 건물 위에 늘 보이는 이름표 — 카메라를 향해 자동으로 돌아가는 캔버스 스프라이트. */
function makeFloatingLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(20, 40, 24, 0.78)";
  ctx.beginPath();
  const r = 28;
  ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 240, 210, 0.9)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#eafff0";
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(9, 2.25, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * 본부(HQ) 건물 — buildTownHouse와 달리 **안으로 걸어 들어갈 수 있는 실내**입니다.
 * 벽 4개를 각각 따로 세우고(동쪽 벽만 문 자리를 비워 두 조각으로 쪼갬) 지붕은
 * 장식만(충돌 있음, 안에서 위로 못 뚫고 나가게), 바닥은 대륙 지형(y=CONTINENT_GROUND_Y)을
 * 그대로 씁니다 — 이미 걸을 수 있는 평지라 따로 바닥을 깔 필요가 없습니다.
 * 치수는 SafeZones.ts의 HQ_BUILDING과 정확히 같은 값을 가져다 씁니다 —
 * 눈에 보이는 벽과 PvP 안전지역 판정 경계가 어긋나지 않게 하기 위해서입니다.
 */
function buildHqBuilding(
  center: { x: number; z: number },
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
) {
  const { width, depth, wallHeight, wallThickness, doorWidth } = HQ_BUILDING;
  const halfW = width / 2;
  const halfD = depth / 2;

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c3f24, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x24492c, roughness: 0.7 });

  const wallY = CONTINENT_GROUND_Y + wallHeight / 2;
  const addWall = (cx: number, cz: number, sx: number, sz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, wallHeight, sz), wallMat);
    mesh.position.set(cx, wallY, cz);
    mesh.castShadow = quality.shadows;
    mesh.receiveShadow = quality.shadows;
    group.add(mesh);
    const body = world.createRigidBody(RAPIER_NS.RigidBodyDesc.fixed().setTranslation(cx, wallY, cz));
    world.createCollider(RAPIER_NS.ColliderDesc.cuboid(sx / 2, wallHeight / 2, sz / 2), body);
  };

  // 남/북 벽 (전체 폭)
  addWall(center.x, center.z - halfD + wallThickness / 2, width, wallThickness);
  addWall(center.x, center.z + halfD - wallThickness / 2, width, wallThickness);
  // 서쪽 벽 (전체)
  addWall(center.x - halfW + wallThickness / 2, center.z, wallThickness, depth);
  // 동쪽 벽 — 가운데 문(doorWidth)만큼 비우고 위아래 두 조각
  const doorHalf = doorWidth / 2;
  const sideLen = halfD - doorHalf;
  if (sideLen > 0.5) {
    addWall(center.x + halfW - wallThickness / 2, center.z - doorHalf - sideLen / 2, wallThickness, sideLen);
    addWall(center.x + halfW - wallThickness / 2, center.z + doorHalf + sideLen / 2, wallThickness, sideLen);
  }

  // 문 상인방 (장식)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(wallThickness + 0.5, 1.2, doorWidth + 0.6), trimMat);
  lintel.position.set(center.x + halfW - wallThickness / 2, CONTINENT_GROUND_Y + wallHeight - 0.6, center.z);
  group.add(lintel);

  // 지붕 — 평지붕 한 장 + 충돌(위로 뚫고 나가는 것 방지, 안은 그대로 비워둠)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.6, depth + 1.2), roofMat);
  roof.position.set(center.x, CONTINENT_GROUND_Y + wallHeight + 0.3, center.z);
  roof.castShadow = quality.shadows;
  group.add(roof);
  const roofBody = world.createRigidBody(
    RAPIER_NS.RigidBodyDesc.fixed().setTranslation(center.x, CONTINENT_GROUND_Y + wallHeight + 0.3, center.z),
  );
  world.createCollider(RAPIER_NS.ColliderDesc.cuboid((width + 1.2) / 2, 0.3, (depth + 1.2) / 2), roofBody);

  // 처마 띠 장식
  const band = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.4, depth + 0.3), trimMat);
  band.position.set(center.x, CONTINENT_GROUND_Y + wallHeight, center.z);
  group.add(band);

  const label = makeFloatingLabel("본부");
  label.position.set(center.x + halfW + 2, CONTINENT_GROUND_Y + wallHeight * 0.65, center.z);
  group.add(label);
}

/**
 * 두 번째 바다 안쪽 대륙 전체(지형+해변+성벽+본부 건물)를 한 번만 짓습니다.
 * 개별 IslandDef를 도는 buildIsland()와 달리 이 함수는 createIslands()에서
 * 딱 한 번 호출됩니다.
 */
function buildSecondSeaContinent(
  scene: THREE.Scene,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
): IslandVisual {
  const origin = SEA_ORIGINS[2];
  const group = new THREE.Group();
  scene.add(group);

  const coast = continentCoastPoints();
  const palette = PALETTES.hq;
  buildContinentGround(coast, group, world, RAPIER_NS, quality, origin, palette.ground);
  buildContinentBeachSkirt(coast, group, world, RAPIER_NS, quality, origin, palette.sand);
  buildCastleWall(coast, group, world, RAPIER_NS, quality, origin);
  buildHqBuilding({ x: origin.x + HQ_BUILDING.localCenter.x, z: origin.z + HQ_BUILDING.localCenter.z }, group, world, RAPIER_NS, quality);

  return { group, center: { x: origin.x, z: origin.z } };
}

function buildIsland(
  island: IslandDef,
  scene: THREE.Scene,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
): THREE.Group {
  const palette = PALETTES[island.theme];
  const group = new THREE.Group();
  scene.add(group);

  // skipOwnTerrain 섬(두 번째 바다 안쪽 대륙의 허브+4개 사냥터)은 자기 원형
  // 본체/해변을 만들지 않습니다 — buildContinentLandmass가 만든 공용 대륙
  // 지형이 이미 바닥을 깔아뒀기 때문입니다 (섬 한가운데에 이중으로 원판이
  // 겹쳐 튀어나오는 일을 막습니다). center/radius는 몬스터·퀘스트·길안내에는
  // 그대로 쓰이므로 여기서만 렌더링을 건너뜁니다.
  if (!island.skipOwnTerrain) {
    // 섬 본체 (윗면 y=0)
    const baseGeo = new THREE.CylinderGeometry(island.radius, island.radius, 2, quality.islandSegments);
    const baseMat = new THREE.MeshStandardMaterial({ color: palette.sand, roughness: 0.9 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(island.center.x, -1, island.center.z);
    baseMesh.receiveShadow = quality.shadows;
    group.add(baseMesh);

    const baseBody = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed().setTranslation(island.center.x, -1, island.center.z),
    );
    world.createCollider(RAPIER_NS.ColliderDesc.cylinder(1, island.radius), baseBody);

    // 지표면 (테마 색)
    const topGeo = new THREE.CylinderGeometry(island.radius - 1, island.radius - 1, 0.3, quality.islandSegments);
    const topMat = new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1 });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.set(island.center.x, 0.15, island.center.z);
    topMesh.receiveShadow = quality.shadows;
    group.add(topMesh);

    buildBeach(island, palette, group, world, RAPIER_NS, quality);
  }

  // 부두: 허브(본부)는 대륙에 공용 부두 하나를 그대로 유지합니다(배가 내리는
  // 자리). skipOwnTerrain이 걸린 4개 사냥터는 이제 대륙 안쪽 땅이라 저마다
  // 부두를 가질 이유가 없어서(육지 한가운데 다리가 튀어나오는 꼴이 됩니다) 뺐습니다.
  if (!island.skipOwnTerrain || island.kind === "hub") {
    buildDock(island, group, world, RAPIER_NS, quality);
  }

  // 중앙 교역섬은 소품 대신 마을(2~3층 건물 + 광장 + 분수)로 꾸밉니다.
  // 두 번째 바다의 허브(본부)는 buildHqBuilding이 대륙 중심에 따로 세우므로
  // 여기서는 아무것도 더 짓지 않고 끝냅니다.
  if (island.kind === "hub") {
    if (island.theme !== "hq") {
      buildTradeTown(island, palette, group, world, RAPIER_NS, quality);
    }
    return group;
  }

  // 소품 배치 (부두 방향은 비워둠 — 배 타러 가는 길을 막지 않도록)
  const rand = makeRandom(island.id.length * 7919 + Math.round(island.center.x));

  // Lv.400 이상 섬은 중앙에 다단 점프 고원 + 랜드마크를 추가로 세웁니다.
  // Lv.400 미만인 첫 번째 바다의 사냥터 섬(정글·사막·얼음·화산·폭풍)은 그 대신
  // 절벽 없이 걸어 오를 수 있는 완만한 언덕 + 랜드마크를 얹습니다.
  if (island.requiredLevel >= PLATEAU_MIN_LEVEL) {
    buildPlateau(island, palette, group, world, RAPIER_NS, quality, rand);
  } else if (island.kind === "wild") {
    buildHill(island, palette, group, world, RAPIER_NS, quality, rand);
  }

  const rockMat = new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 0.95 });
  const propCount = Math.max(2, Math.round(9 * (island.radius / 40) * quality.propDensity));
  for (let i = 0; i < propCount; i++) {
    const angle = (i / propCount) * Math.PI * 2 + 0.35;
    if (Math.abs(((angle - island.dockAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.5) continue;
    const dist = island.radius * (0.35 + rand() * 0.45);
    const x = island.center.x + Math.cos(angle) * dist;
    const z = island.center.z + Math.sin(angle) * dist;
    const prop = buildProp(island.theme, palette);
    prop.position.set(x, 0.3, z);
    prop.rotation.y = rand() * Math.PI * 2;
    group.add(prop);

    // 나무/선인장/기둥 등 지형지물에 충돌 추가 — 몸통 굵기의 가벼운 원기둥 하나로,
    // 통과하지 못하고 부딪히게 합니다 (섬마다 여럿이라 primitive 하나로 최소화).
    const propBody = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed().setTranslation(x, 0.3 + PROP_COLLIDER_HALF_HEIGHT, z),
    );
    world.createCollider(
      RAPIER_NS.ColliderDesc.cylinder(PROP_COLLIDER_HALF_HEIGHT, PROP_COLLIDER_RADIUS),
      propBody,
    );
  }

  const rockCount = Math.max(2, Math.round(5 * (island.radius / 40) * quality.propDensity));
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + 1.1;
    const dist = island.radius * (0.6 + rand() * 0.25);
    const rockRadius = 1.1 + rand() * 1.1;
    const rx = island.center.x + Math.cos(angle) * dist;
    const rz = island.center.z + Math.sin(angle) * dist;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rockRadius, 0), rockMat);
    rock.position.set(rx, 0.7, rz);
    rock.rotation.set(rand(), rand(), rand());
    rock.castShadow = quality.shadows;
    group.add(rock);

    // 바위도 충돌 추가 — 모양은 다각형(icosahedron)이지만, 충돌체는 그 반지름에
    // 맞춘 구(ball) 하나로 저렴하게 근사합니다.
    const rockBody = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.fixed().setTranslation(rx, 0.7, rz),
    );
    world.createCollider(RAPIER_NS.ColliderDesc.ball(rockRadius * 0.85), rockBody);
  }

  return group;
}

/** 멀리 있는 섬을 통째로 숨기기 위해 렌더러에 넘겨주는 핸들 */
export interface IslandVisual {
  group: THREE.Group;
  center: { x: number; z: number };
}

export function createIslands(
  scene: THREE.Scene,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
): IslandVisual[] {
  const visuals: IslandVisual[] = [];
  for (const island of ISLANDS) {
    visuals.push({ group: buildIsland(island, scene, world, RAPIER_NS, quality), center: island.center });
  }
  // 두 번째 바다 안쪽 대륙(성벽+본부 건물 포함)은 섬 하나하나가 아니라 통째로
  // 한 번만 짓습니다 — 위 루프의 "hq"/rose/green_zone/graveyard/snow_mountain은
  // skipOwnTerrain이 걸려 있어 자기 지형은 만들지 않고, 이 대륙이 그 바닥을
  // 대신 제공합니다.
  visuals.push(buildSecondSeaContinent(scene, world, RAPIER_NS, quality));
  return visuals;
}

/** 바다(세계)별 하늘·안개 색. 두 번째 바다는 조금 더 짙고 서늘한 하늘입니다. */
const SEA_SKY: Record<Sea, number> = {
  1: 0x8fd0ff,
  2: 0x6f8fd8,
};

export interface EnvironmentHandle {
  /** 매 프레임 — 태양을 플레이어 위로 옮깁니다 */
  follow: (x: number, z: number) => void;
  /** 바다가 바뀌었을 때 하늘색과 안개 범위를 갈아끼웁니다 */
  setSea: (sea: Sea) => void;
}

/**
 * 조명 + 하늘 + 안개. 섬 메시와 분리해 둔 이유는 두 가지입니다.
 *
 *  1. **그림자가 플레이어를 따라다녀야 합니다.** 예전에는 태양이 월드 원점에
 *     고정돼 있고 그림자 카메라 범위가 ±110m였습니다. 그래서 시작 섬 근처를
 *     벗어나면 그림자가 통째로 사라졌습니다 (6km 떨어진 두 번째 바다는 말할 것도
 *     없고요). 이제 태양과 그 타깃을 매 프레임 플레이어 위로 옮겨서, 어느 바다
 *     어느 섬에 있든 같은 품질의 그림자가 나옵니다.
 *  2. **안개는 "지금 있는 바다" 기준**이어야 합니다. 두 바다를 통틀어 잡으면
 *     안개 거리가 6km가 돼서 수평선이 텅 비어 보입니다.
 */
export function createEnvironment(scene: THREE.Scene, quality: QualitySettings): EnvironmentHandle {
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x445533, 0.95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  // 그림자는 플레이어 주변만 선명하면 되므로 범위를 너무 키우지 않습니다
  // (범위를 넓히면 같은 해상도에 더 넓은 영역을 담아 그림자가 뭉개집니다)
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.far = 500;
  scene.add(sun);
  // 타깃도 씬에 넣어야 매 프레임 옮긴 값이 반영됩니다 (Three.js 규칙).
  scene.add(sun.target);

  const fog = new THREE.Fog(SEA_SKY[1], 1, 2);
  scene.fog = fog;
  scene.background = new THREE.Color(SEA_SKY[1]);

  let currentSea: Sea | null = null;

  const handle: EnvironmentHandle = {
    follow(x: number, z: number) {
      // 광원의 "방향"은 그대로 두고 위치만 평행 이동시킵니다.
      sun.position.set(x + 80, 120, z + 40);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld();
    },
    setSea(sea: Sea) {
      if (sea === currentSea) return;
      currentSea = sea;
      const sky = SEA_SKY[sea];
      const far = worldRadius(sea);
      fog.color.setHex(sky);
      fog.near = far * 0.35;
      fog.far = far * 2.1;
      (scene.background as THREE.Color).setHex(sky);
    },
  };

  handle.setSea(1);
  return handle;
}
