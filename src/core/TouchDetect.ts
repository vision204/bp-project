// 모바일/터치 기기 감지.
//
// User-Agent 문자열은 브라우저마다 제각각이고 위장하기도 쉬워서 믿을 수
// 없습니다 — 대신 표준 기반 신호 두 가지를 씁니다:
//   · navigator.maxTouchPoints / 'ontouchstart' — 실제 터치 입력 지원 여부
//   · matchMedia('(pointer: coarse)') — "정밀하지 않은 포인터"(손가락)가
//     주 입력 수단인지. 터치스크린 노트북처럼 마우스도 있는 하이브리드
//     기기에서도 상황에 따라 유용한 보조 신호입니다.
//
// 순수 함수라 아무 데서나 안전하게 호출할 수 있고, SSR 등 window가 없는
// 환경(테스트 하네스)에서도 그냥 false를 돌려줍니다.
export function isTouchDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const hasTouchPoints = (navigator.maxTouchPoints ?? 0) > 0;
  const hasTouchEvents = "ontouchstart" in window;
  const coarsePointer =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  return hasTouchPoints || hasTouchEvents || coarsePointer;
}

/**
 * 데스크톱/태블릿/폰 3단계 중 어떤 HUD 레이아웃을 써야 하는지.
 *
 * · 터치 기기가 아니면 무조건 "desktop" (마우스/키보드용 기존 HUD).
 * · 터치 기기면 화면의 "짧은 쪽"(가로/세로 중 작은 값)을 기준으로 판정합니다.
 *   가로/세로 중 큰 쪽만 보면 폰을 눕혔을 때(가로 모드) 태블릿으로 오판할 수
 *   있으므로, 항상 짧은 쪽 — 즉 "손에 쥐었을 때 실제 폭"에 해당하는 값을 씁니다.
 *   그 값이 손목시계처럼 좁은 iPhone 계열이면 "phone", iPad급으로 넓으면
 *   "tablet"으로 봅니다.
 * · 리사이즈에 반응할 필요는 없습니다 — isTouchDevice()처럼 시작 시 한 번만
 *   계산해서 그 값을 게임 내내 그대로 씁니다(방향 전환 중 레이아웃이 계속
 *   널뛰는 것을 막기 위해서이기도 합니다).
 */
export function getDeviceTier(): "desktop" | "tablet" | "phone" {
  if (!isTouchDevice()) return "desktop";
  if (typeof window === "undefined") return "phone";

  const shortSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  const PHONE_MAX_SHORT_SIDE = 780;
  return shortSide > 0 && shortSide < PHONE_MAX_SHORT_SIDE ? "phone" : "tablet";
}
