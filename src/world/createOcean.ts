import * as THREE from "three";
import { OCEAN_MESH_Y, SEA_ORIGINS, worldRadius, type Sea } from "./islands";
import type { QualitySettings } from "../core/GraphicsSettings";

// 아트 에셋(텍스처) 없이 셰이더만으로 그럴듯한 바다를 만듭니다. 정점 셰이더에서
// 사인파 두 개를 겹쳐 파도를 만들고, 프래그먼트 셰이더에서 파도 높이에 따라
// 짙은/옅은 파랑을 섞고 반짝임(스페큘러 느낌)을 더합니다.

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying float vWave;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float wave = sin(pos.x * 0.06 + uTime * 0.8) * 0.6
               + cos(pos.y * 0.08 - uTime * 0.6) * 0.4;
    pos.z += wave;
    vWave = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uSparkle;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  varying float vWave;
  varying vec2 vUv;

  void main() {
    vec3 deep = uDeep;
    vec3 shallow = uShallow;
    float t = clamp(vWave * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = mix(deep, shallow, t);

    // 반짝이는 하이라이트 (텍스처 없이 절차적으로, 너무 촘촘하면 소프트웨어 렌더링에서
    // 앨리어싱으로 버벅여서 주파수를 낮게 잡음)
    if (uSparkle > 0.5) {
      float sparkle = sin(vUv.x * 70.0 + uTime * 2.0) * sin(vUv.y * 70.0 - uTime * 1.7);
      sparkle = smoothstep(0.94, 1.0, sparkle);
      color += sparkle * 0.4;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface OceanHandle {
  mesh: THREE.Mesh;
  update: (elapsedSec: number) => void;
}

/** 바다별 물빛 — 두 번째 바다는 조금 더 짙고 푸릅니다 */
const SEA_WATER: Record<Sea, { deep: [number, number, number]; shallow: [number, number, number] }> = {
  1: { deep: [0.02, 0.16, 0.35], shallow: [0.14, 0.55, 0.72] },
  2: { deep: [0.03, 0.10, 0.30], shallow: [0.10, 0.40, 0.66] },
};

/**
 * 바다 메시를 **바다(세계)마다 하나씩** 만듭니다.
 *
 * 하나의 거대한 판으로 두 구역을 다 덮을 수도 있지만, 그러면 6km짜리 판에
 * 같은 정점 수를 쓰게 돼서 파도가 흐물흐물해지고, 물빛도 두 바다가 똑같아집니다.
 * 각자 자기 원점 위에 놓으면 파도 밀도도 물빛도 바다마다 따로 잡을 수 있습니다.
 */
export function createOcean(scene: THREE.Scene, quality: QualitySettings): OceanHandle {
  const materials: THREE.ShaderMaterial[] = [];
  const meshes: THREE.Mesh[] = [];

  for (const sea of [1, 2] as const) {
    // 가장 바깥 섬보다 넉넉히 크게 — 수평선이 끊겨 보이지 않도록
    const size = Math.max(1600, worldRadius(sea) * 4);
    const geometry = new THREE.PlaneGeometry(size, size, quality.oceanSegments, quality.oceanSegments);
    const water = SEA_WATER[sea];
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSparkle: { value: quality.oceanSparkle ? 1 : 0 },
        uDeep: { value: new THREE.Vector3(...water.deep) },
        uShallow: { value: new THREE.Vector3(...water.shallow) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      // 불투명으로 그려서(오버드로우/블렌딩 비용 없이) 소프트웨어 렌더링에서도 가볍게
      transparent: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    // 섬 지면(y≈0)보다 아래에 두어 섬이 바다 위에 떠 있는 것처럼 보이게 함.
    // 익사 판정과 높이가 어긋나지 않도록 islands.ts의 상수를 그대로 씁니다.
    mesh.position.set(SEA_ORIGINS[sea].x, OCEAN_MESH_Y, SEA_ORIGINS[sea].z);
    scene.add(mesh);
    materials.push(material);
    meshes.push(mesh);
  }

  return {
    mesh: meshes[0],
    update(elapsedSec: number) {
      for (const material of materials) material.uniforms.uTime.value = elapsedSec;
    },
  };
}
