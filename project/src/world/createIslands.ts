import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { ISLANDS, dockDirection, worldRadius, type IslandDef, type IslandTheme, type Sea } from "./islands";
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
  // 분수 도시 — 흰 석재와 청록 지붕의 항구 도시 (2세계의 관문)
  fountain: { sand: 0xe8dfc8, ground: 0xc9c3b2, rock: 0xa8a496, propTrunk: 0xded6c2, propTop: 0x3fa9a0, fogColor: 0x8fd0ff },
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

/** 섬마다 배치가 매번 달라지지 않도록 시드 기반 난수를 씁니다. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * 테마별 소품(나무/선인장/얼음기둥/용암기둥)을 만듭니다. 충돌체는 붙이지 않아서
 * 플레이어가 통과할 수 있습니다 — 좁은 섬에서 소품에 끼는 것을 피하기 위함입니다.
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
 * 허브 섬(중앙 교역섬 / 분수 도시)에 세우는 마을 — 광장을 둘러싸듯 원형으로 배치합니다.
 * 건물에는 전부 충돌체가 붙어 있어서 안으로 들어갈 수 없습니다 (겉모습 장식).
 */
function buildTradeTown(
  island: IslandDef,
  palette: ThemePalette,
  group: THREE.Group,
  world: RAPIER.World,
  RAPIER_NS: typeof RAPIER,
  quality: QualitySettings,
) {
  // 두 허브가 똑같이 생기지 않도록 섬마다 다른 시드를 씁니다.
  const rand = makeRandom(island.id === "central" ? 4271 : 90211);
  const isFountainCity = island.theme === "fountain";
  const houseCount = Math.max(6, Math.round((isFountainCity ? 12 : 10) * quality.propDensity));

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
  const plazaMat = new THREE.MeshStandardMaterial({
    color: isFountainCity ? 0xdad3c2 : 0xc9bfa6,
    roughness: 1,
  });
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(island.radius * 0.36, island.radius * 0.36, 0.12, quality.islandSegments),
    plazaMat,
  );
  plaza.position.set(island.center.x, 0.33, island.center.z);
  plaza.receiveShadow = quality.shadows;
  group.add(plaza);

  // 광장 한가운데 분수대 (역시 장식).
  // "분수 도시"는 이름값을 해야 하므로 한 단 더 올린 3층 분수로 세웁니다.
  const scale = isFountainCity ? 1.45 : 1;
  const stoneMat = new THREE.MeshStandardMaterial({
    color: isFountainCity ? 0xe2dccc : 0xb8ae97,
    roughness: 0.95,
  });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x4aa3d8, roughness: 0.2, metalness: 0.3 });

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.4 * scale, 2.6 * scale, 0.9, 12), stoneMat);
  basin.position.set(island.center.x, 0.75, island.center.z);
  basin.castShadow = quality.shadows;
  group.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * scale, 2.1 * scale, 0.12, 12), waterMat);
  water.position.set(island.center.x, 1.18, island.center.z);
  group.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 2.2 * scale, 8), stoneMat);
  pillar.position.set(island.center.x, 1.1 + 1.1 * scale, island.center.z);
  pillar.castShadow = quality.shadows;
  group.add(pillar);

  if (isFountainCity) {
    // 위쪽 물받이 두 단 + 꼭대기 물줄기
    for (const [i, y] of [3.2, 4.6].entries()) {
      const tierRadius = 1.5 - i * 0.55;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(tierRadius, tierRadius * 0.8, 0.32, 12), stoneMat);
      tier.position.set(island.center.x, y, island.center.z);
      tier.castShadow = quality.shadows;
      group.add(tier);
      const tierWater = new THREE.Mesh(new THREE.CylinderGeometry(tierRadius * 0.9, tierRadius * 0.9, 0.08, 12), waterMat);
      tierWater.position.set(island.center.x, y + 0.2, island.center.z);
      group.add(tierWater);
    }
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 10), waterMat);
    jet.position.set(island.center.x, 5.7, island.center.z);
    group.add(jet);
  }

  const fountainBody = world.createRigidBody(
    RAPIER_NS.RigidBodyDesc.fixed().setTranslation(island.center.x, 0.75, island.center.z),
  );
  world.createCollider(RAPIER_NS.ColliderDesc.cylinder(0.45, 2.6 * scale), fountainBody);
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
  buildDock(island, group, world, RAPIER_NS, quality);

  // 중앙 교역섬은 소품 대신 마을(2~3층 건물 + 광장 + 분수)로 꾸밉니다.
  if (island.kind === "hub") {
    buildTradeTown(island, palette, group, world, RAPIER_NS, quality);
    return group;
  }

  // 소품 배치 (부두 방향은 비워둠 — 배 타러 가는 길을 막지 않도록)
  const rand = makeRandom(island.id.length * 7919 + Math.round(island.center.x));
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
  }

  const rockCount = Math.max(2, Math.round(5 * (island.radius / 40) * quality.propDensity));
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + 1.1;
    const dist = island.radius * (0.6 + rand() * 0.25);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + rand() * 1.1, 0), rockMat);
    rock.position.set(island.center.x + Math.cos(angle) * dist, 0.7, island.center.z + Math.sin(angle) * dist);
    rock.rotation.set(rand(), rand(), rand());
    rock.castShadow = quality.shadows;
    group.add(rock);
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
