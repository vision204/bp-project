import * as THREE from "three";

// -----------------------------------------------------------------------
// 몬스터별 개성 부여 — 기존 블록형 휴머노이드 뼈대(몸통/머리/팔/다리)는 그대로
// 두고, 그 위에 종족마다 다른 모자/뿔/날개/무기 같은 장신구를 얹거나 다리색·
// 몸통 비율·투명도만 살짝 바꿔서 실루엣을 구분되게 합니다. 종족 이름(한글,
// EnemyState.speciesName과 정확히 같은 문자열)을 키로 하는 데이터라, 새 종족을
// 추가할 때도 이 파일에 한 줄만 더하면 됩니다.
// -----------------------------------------------------------------------

/** buildBlockyCharacterParts()가 그룹/색을 넘겨주면 장신구를 그 위에 붙이는 콜백 시그니처 */
export interface EnemyDecorateCtx {
  group: THREE.Group;
  color: number;
}

export interface EnemyVisualExtras {
  /** 기본 남색(0x2b3a67) 대신 다리색을 바꾸고 싶을 때 */
  legColor?: number;
  /** 몸통을 뚱뚱/홀쭉하게 (골렘은 떡 벌어지게, 유령은 홀쭉하게 등) */
  torsoScale?: [number, number, number];
  /** 머리 크기 배율 (새끼 드래곤처럼 머리를 좀 더 크게 등) */
  headScale?: number;
  /** 반투명 유령류 — 몸통/머리 재질에 적용 */
  opacity?: number;
  /** 머리/몸통 외에 종별 장신구(모자·뿔·날개·무기 등)를 그룹에 직접 붙입니다. */
  decorate?: (ctx: EnemyDecorateCtx) => void;
}

// ── 장신구 조립용 작은 헬퍼들 (buildProp/buildLandmark와 같은 스타일) ──────────
function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
}

function addMesh(group: THREE.Group, mesh: THREE.Mesh, y: number, x = 0, z = 0) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

/** 뾰족한 원뿔 모자(해적 두건/마법사 모자 등 기본형) */
function coneHat(group: THREE.Group, color: number, radius: number, height: number, y: number) {
  addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(radius, height, 10), mat(color)), y);
}

/** 머리 양쪽에 대칭으로 뿔/귀/깃털 등을 붙일 때 쓰는 헬퍼 */
function symmetric(
  group: THREE.Group,
  build: (side: number) => THREE.Mesh,
  spacing: number,
  y: number,
) {
  for (const side of [-1, 1]) {
    const m = build(side);
    m.position.set(side * spacing, y, m.position.z);
    m.castShadow = true;
    group.add(m);
  }
}

/** 등 뒤에 거는 평평한 망토 한 장 */
function cape(group: THREE.Group, color: number, w: number, h: number, y: number, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, transparent: opacity < 1, opacity }),
  );
  m.position.set(0, y, -0.28);
  m.rotation.x = 0.15;
  group.add(m);
}

const ENEMY_VISUALS: Record<string, EnemyVisualExtras> = {
  // ── 첫 번째 바다 ───────────────────────────────────────────────────────
  "해군 신병": {
    decorate: ({ group, color }) => {
      // 흰 정모 — 원통 챙 + 파란 사각 캡
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14), mat(0xf2f2f2)), 2.16);
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.22, 14), mat(0x2f5fa8)), 2.32);
      // 옷깃(가슴 견장)
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.06), mat(0xf2f2f2)), 1.5, 0, 0.24);
    },
  },
  "해적 잡병": {
    decorate: ({ group }) => {
      // 붉은 두건(반구) + 검은 안대
      addMesh(group, new THREE.Mesh(new THREE.SphereGeometry(0.43, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), mat(0xb23a3a)), 2.02);
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.05), mat(0x1a1a1a)), 1.95, -0.12, 0.36);
      // 금 귀걸이
      addMesh(group, new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 10), mat(0xe0b23c, { metalness: 0.7, roughness: 0.3 })), 1.83, 0.38, 0.05);
    },
  },
  "정글 도적": {
    decorate: ({ group }) => {
      // 나뭇잎 머리띠 + 목걸이(이빨/구슬)
      addMesh(group, new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 6, 12), mat(0x2e7d32)), 2.05).rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 5), mat(0xe8ddc0)), 1.52 + Math.sin(a) * 0.03, Math.cos(a) * 0.22, 0.2 + Math.sin(a) * 0.05);
      }
    },
  },
  "사막 도적": {
    decorate: ({ group }) => {
      // 사막 터번(원뿔대) + 얼굴 가리개(가로 띠)
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.32, 12), mat(0xd8c48a)), 2.14);
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42), mat(0xc9b482)), 1.85, 0, 0.02);
    },
  },
  "설원 늑대": {
    legColor: 0xe8f0f5,
    torsoScale: [1.1, 0.9, 1.15],
    decorate: ({ group }) => {
      // 삼각 늑대 귀 + 짧은 꼬리
      symmetric(group, () => new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 4), mat(0xdfe9ee)), 0.22, 2.22);
      const tail = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 6), mat(0xdfe9ee)), 1.15, 0, -0.34);
      tail.rotation.x = Math.PI / 2.4;
    },
  },
  "용암 병사": {
    decorate: ({ group }) => {
      // 뿔 달린 투구 + 빛나는 가슴판
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.3, 10), mat(0x2b1108)), 2.1);
      symmetric(group, () => new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 5), mat(0xff5722, { emissive: 0xff3300, emissiveIntensity: 0.6 })), 0.22, 2.34);
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), mat(0xff5722, { emissive: 0xcc3300, emissiveIntensity: 0.5 })), 1.15, 0, 0.26);
    },
  },
  "폭풍 해적": {
    decorate: ({ group }) => {
      // 삼각모(눌린 원뿔) + 회청색 망토
      const hat = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.34, 4), mat(0x263238)), 2.18);
      hat.rotation.y = Math.PI / 4;
      cape(group, 0x455a64, 0.75, 1.1, 1.4);
    },
  },
  "안개 유령": {
    opacity: 0.55,
    legColor: 0x7e57c2,
    decorate: ({ group }) => {
      // 해진 망토(반투명) + 빛나는 눈
      cape(group, 0x9575cd, 0.85, 1.3, 1.45, 0.4);
      symmetric(group, () => new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), new THREE.MeshStandardMaterial({ color: 0x26c6da, emissive: 0x26c6da, emissiveIntensity: 1.2 })), 0.14, 1.92);
    },
  },
  "수정 골렘": {
    torsoScale: [1.3, 1.1, 1.25],
    decorate: ({ group }) => {
      // 어깨/머리에 박힌 수정 조각들
      symmetric(group, () => new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), mat(0x4fc3f7, { metalness: 0.2, roughness: 0.2 })), 0.5, 1.62);
      addMesh(group, new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), mat(0x4fc3f7, { metalness: 0.2, roughness: 0.2 })), 2.28);
    },
  },
  "수정 군주": {
    torsoScale: [1.2, 1.15, 1.2],
    decorate: ({ group }) => {
      // 수정 왕관 + 긴 망토 + 더 큰 어깨 장식
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), mat(0x4fc3f7, { metalness: 0.3, roughness: 0.15 })), 2.25 + 0.05, Math.cos(a) * 0.28, Math.sin(a) * 0.28);
      }
      symmetric(group, () => new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), mat(0x7986cb, { metalness: 0.2, roughness: 0.2 })), 0.58, 1.68);
      cape(group, 0x3a4a8f, 0.9, 1.4, 1.3);
    },
  },
  "심연 촉수": {
    legColor: 0x0b1016,
    torsoScale: [1.1, 1, 1.1],
    decorate: ({ group }) => {
      // 몸통 주위를 감싸는 촉수 4개 + 빛나는 눈
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const tentacle = addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.9, 6), mat(0x10161f)), 0.7, Math.cos(a) * 0.35, Math.sin(a) * 0.35);
        tentacle.rotation.z = Math.cos(a) * 0.5;
        tentacle.rotation.x = Math.sin(a) * 0.5;
      }
      symmetric(group, () => new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0x26c6da, emissive: 0x26c6da, emissiveIntensity: 1.4 })), 0.15, 1.92);
    },
  },
  "천공 사제": {
    decorate: ({ group }) => {
      // 머리 위 후광 고리 + 로브 자락(스커트형 원뿔)
      const halo = addMesh(group, new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 20), mat(0xfff59d, { emissive: 0xfff59d, emissiveIntensity: 0.5 })), 2.55);
      halo.rotation.x = Math.PI / 2;
      addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 12, 1, true), mat(0xe8f4ff, { side: THREE.DoubleSide })), 0.55);
    },
  },
  // ── 두 번째 바다: 장미 왕국/초원/공동묘지/눈산 ───────────────────────────
  "장미 기사": {
    decorate: ({ group }) => {
      // 장미색 깃털 투구 + 흰 가슴 문장(장미 모양)
      addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 10), mat(0xe8e4dc)), 2.16);
      const plume = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 6), mat(0xd6415f)), 2.5, 0, -0.1);
      plume.rotation.x = -0.3;
      addMesh(group, new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(0xd6415f)), 1.3, 0, 0.27);
      cape(group, 0xf2e8e0, 0.7, 1.0, 1.45);
    },
  },
  "초원 사냥꾼": {
    decorate: ({ group }) => {
      // 두건 + 등에 멘 화살통
      addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 10), mat(0x5b4128)), 2.15);
      const quiver = addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.65, 8), mat(0x8d6e63)), 1.35, 0.05, -0.32);
      quiver.rotation.z = 0.25;
      for (const dx of [-0.03, 0.03]) {
        addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), mat(0xe0a33c)), 1.72, dx, -0.34);
      }
    },
  },
  "초원 족장": {
    torsoScale: [1.1, 1, 1.1],
    decorate: ({ group }) => {
      // 깃털 머리장식(부채꼴) + 큰 목걸이
      for (let i = -2; i <= 2; i++) {
        const feather = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 4), mat(i % 2 === 0 ? 0x3f8f34 : 0xe0a33c)), 2.35, i * 0.09, -0.05);
        feather.rotation.x = -0.5 - Math.abs(i) * 0.1;
      }
      addMesh(group, new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 6, 14), mat(0xd9c98a)), 1.42).rotation.x = Math.PI / 2;
    },
  },
  "무덤지기": {
    legColor: 0x3f3b33,
    opacity: 0.9,
    decorate: ({ group }) => {
      // 두건 달린 로브(후드가 얼굴을 덮듯 앞으로 내려옴) + 손에 든 등불
      addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.75, 12, 1, true), mat(0x3f3b33, { side: THREE.DoubleSide })), 2.15);
      const lantern = addMesh(group, new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), mat(0xb9b5a6, { emissive: 0xffcc66, emissiveIntensity: 0.4 })), 0.9, -0.5, 0.15);
      lantern.scale.set(0.9, 1.3, 0.9);
    },
  },
  "설산 산적": {
    decorate: ({ group }) => {
      // 털모자(구+가장자리 털) + 목도리
      addMesh(group, new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), mat(0x6d7a86)), 2.1);
      addMesh(group, new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 6, 14), mat(0xffffff)), 1.98).rotation.x = Math.PI / 2;
      addMesh(group, new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 12), mat(0xffffff)), 1.52).rotation.x = Math.PI / 2;
    },
  },
  "불꽃 야수": {
    legColor: 0x3e2723,
    torsoScale: [1.15, 1, 1.1],
    decorate: ({ group }) => {
      // 등에 솟은 불꽃 가시 + 빛나는 눈
      for (let i = 0; i < 3; i++) {
        const spike = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.08 - i * 0.01, 0.32 - i * 0.05, 5), mat(0xff5722, { emissive: 0xff3300, emissiveIntensity: 0.7 })), 1.55 + i * 0.22, 0, -0.28 + i * 0.03);
        spike.rotation.x = -0.25;
      }
      symmetric(group, () => new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xff9900, emissiveIntensity: 1.3 })), 0.14, 1.92);
    },
  },
  // ── 세 번째 바다 이후: 저주받은 배/얼음 성/잊혀진 섬/대저택 ──────────────
  "유령 선원": {
    opacity: 0.6,
    legColor: 0x2e2a26,
    decorate: ({ group }) => {
      // 낡은 세일러 모자 + 해진 옷자락(반투명)
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 12), mat(0x5f5a52)), 2.16);
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.16, 12), mat(0x5f5a52)), 2.28);
      cape(group, 0x86d6c6, 0.7, 1.2, 1.35, 0.35);
    },
  },
  "성벽 파수병": {
    decorate: ({ group }) => {
      // 완전 투구(원통+뿔) + 왼팔의 방패
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.5, 10), mat(0x8fc4e6, { metalness: 0.4, roughness: 0.4 })), 2.0);
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.65, 0.08), mat(0x63b8ec, { metalness: 0.3, roughness: 0.4 })), 1.1, 0.55, 0.1);
    },
  },
  "잊혀진 전사": {
    opacity: 0.85,
    legColor: 0x9b8f74,
    decorate: ({ group }) => {
      // 낡고 녹슨 견갑 + 찢어진 망토
      symmetric(group, () => new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), mat(0xbfb193, { roughness: 0.9 })), 0.5, 1.62);
      cape(group, 0xa79a78, 0.65, 1.0, 1.4, 0.7);
    },
  },
  "저택 하인": {
    decorate: ({ group }) => {
      // 나비넥타이 + 흰 앞치마
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), mat(0x1c1c1c)), 1.58, 0, 0.26);
      addMesh(group, new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.03), mat(0xf5f5f0)), 1.0, 0, 0.27);
    },
  },
  "저택의 주인": {
    torsoScale: [1.05, 1.1, 1.05],
    decorate: ({ group }) => {
      // 실크햇 + 긴 망토 + 지팡이
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 14), mat(0x1c1c1c)), 2.35);
      addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14), mat(0x1c1c1c)), 2.11);
      cape(group, 0x2f6b32, 0.9, 1.5, 1.3);
      const cane = addMesh(group, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), mat(0x2b1108)), 0.85, 0.55, 0.15);
      cane.rotation.z = 0.1;
    },
  },
  // ── 나머지(수정/심연 외 첫 바다 고레벨 + 두 번째 바다 특수 종족) ─────────
  "새끼 드래곤": {
    headScale: 1.15,
    torsoScale: [1.05, 0.95, 1.1],
    decorate: ({ group }) => {
      symmetric(group, () => new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), mat(0xff7043)), 0.2, 2.24);
      const tail = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 6), mat(0xff7043)), 1.05, 0, -0.38);
      tail.rotation.x = Math.PI / 2.2;
      symmetric(group, (side) => {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.08, 3), mat(0x4a1c12, { side: THREE.DoubleSide }));
        wing.rotation.z = side * Math.PI * 0.5;
        wing.position.z = -0.15;
        return wing;
      }, 0.5, 1.55);
    },
  },
  "고룡": {
    headScale: 1.3,
    torsoScale: [1.35, 1.2, 1.4],
    legColor: 0x2b1108,
    decorate: ({ group }) => {
      symmetric(group, () => new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.4, 5), mat(0xff7043)), 0.24, 2.42);
      const tail = addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 6), mat(0xff7043)), 0.9, 0, -0.6);
      tail.rotation.x = Math.PI / 2.1;
      symmetric(group, (side) => {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.1, 3), mat(0x2b1108, { side: THREE.DoubleSide }));
        wing.rotation.z = side * Math.PI * 0.5;
        wing.position.z = -0.2;
        return wing;
      }, 0.65, 1.7);
      for (let i = 0; i < 3; i++) {
        addMesh(group, new THREE.Mesh(new THREE.ConeGeometry(0.09 - i * 0.015, 0.28, 4), mat(0xff7043)), 1.55 + i * 0.26, 0, -0.3);
      }
    },
  },
};

/** 종족(species) 한글 이름으로 시각 커스터마이즈 데이터를 찾습니다. 없으면 기본(장신구 없음) 휴머노이드. */
export function getEnemyVisualExtras(speciesName: string): EnemyVisualExtras | undefined {
  return ENEMY_VISUALS[speciesName];
}
