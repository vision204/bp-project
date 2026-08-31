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
