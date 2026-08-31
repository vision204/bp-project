// 이 프로젝트에는 index.html이 따로 없고(main.ts 등 다른 UI 모듈과 같은 이유로,
// 모든 화면 요소를 JS에서 직접 만듭니다) <meta name="viewport"> 태그도 없습니다.
// 그 상태로 모바일 브라우저에서 열면 데스크톱 폭(약 980px) 기준으로 렌더링해서
// 레이아웃이 다 깨지고, 두 손가락으로 확대/축소까지 됩니다 — 게임 화면에서는
// 원치 않는 동작입니다.
//
// main.ts 맨 위에서 다른 어떤 DOM 작업보다도 먼저 이 함수를 호출해서, 없으면
// 새로 만들고 있으면 내용을 덮어씁니다. viewport-fit=cover는 iPhone 노치/홈
// 인디케이터 영역까지 화면을 채우고, 그 대신 CSS의 env(safe-area-inset-*)로
// 안전 영역을 직접 챙겨야 합니다 (TouchControls.ts가 조작 버튼 위치에 씁니다).
export function ensureMobileViewportMeta(): void {
  if (typeof document === "undefined") return;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.prepend(meta);
  }
  meta.setAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  );
}
