import RAPIER from "@dimforge/rapier3d-compat";

let initialized = false;

/** Rapier는 WASM이라 사용 전에 한 번 init()을 await 해야 합니다. */
export async function initPhysics(): Promise<typeof RAPIER> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  return RAPIER;
}

export function createWorld(RAPIER_NS: typeof RAPIER) {
  const gravity = { x: 0.0, y: -20.0, z: 0.0 };
  return new RAPIER_NS.World(gravity);
}
