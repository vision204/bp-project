// ---------------------------------------------------------------------------
// 개발자 모드 접근 권한.
//
// 개발자 모드는 만렙·무적·비행·순간이동이 되는 **테스트용 모드**라서,
// 아무나 들어가면 곤란합니다. 그래서 두 가지 경우에만 열립니다.
//
//   1. 아래 허용 목록에 있는 구글 계정으로 로그인했을 때
//   2. 개발 중인 내 컴퓨터에서 열었을 때 (localhost) — 로그인 없이도 열립니다
//
// ── 이 검사의 한계를 분명히 해둡니다 ────────────────────────────────────────
// 이 판정은 **브라우저 안에서** 돕니다. 개발자 도구를 열어 코드를 고칠 줄 아는
// 사람은 우회할 수 있습니다. 브라우저에 내려간 코드는 전부 사용자 것이라,
// 클라이언트 검사만으로 막을 수 있는 건 원래 없습니다.
//
// 그래서 **우회해도 얻을 게 없도록** 만들어 두었습니다.
//   · 개발자 모드는 세이브를 읽지도 쓰지도 않습니다 (SaveManager가 통째로 잠깁니다).
//     → 만렙 캐릭터가 내 진짜 세이브를 덮어쓰는 사고가 나지 않습니다.
//   · 랭킹에도 올라가지 않습니다. → Lv.2050짜리 유령이 리더보드를 더럽히지 않습니다.
//   · 서버(Firestore)에 남는 흔적이 전혀 없습니다.
// 즉 개발자 모드로 할 수 있는 일은 "내 화면에서 혼자 둘러보기"가 전부입니다.
// 진짜 데이터를 지키는 건 이 파일이 아니라 firestore.rules(내 uid 문서만 쓰기 가능)입니다.
// ---------------------------------------------------------------------------

/**
 * 개발자 모드를 쓸 수 있는 구글 계정.
 * 사람을 추가하려면 여기에 이메일 한 줄만 넣고 다시 빌드하면 됩니다.
 */
export const DEV_EMAILS: string[] = [
  "jjapgobrus@gmail.com",
];

/** 개발 중인 내 컴퓨터로 보는 주소들 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

/**
 * 구글 계정 이메일 정규화.
 * 지메일은 **점을 무시하고 +뒤를 무시**합니다. jjapgo.brus+test@gmail.com 은
 * jjapgobrus@gmail.com 과 같은 계정이라, 목록에 한 줄만 적어도 통하게 맞춥니다.
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split(".").join("");
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

const ALLOWED = new Set(DEV_EMAILS.map(normalizeEmail));

/** 이 이메일이 허용 목록에 있는지 */
export function isDevEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED.has(normalizeEmail(email));
}

/** 이 주소가 내 개발용 컴퓨터인지 (배포된 사이트에서는 false) */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

export type DevDenyReason =
  /** 로그인을 안 했음 */
  | "anonymous"
  /** 로그인은 했지만 허용 목록에 없는 계정 */
  | "not_allowed"
  | null;

/**
 * 개발자 모드를 열어줄지 판정합니다.
 * null이면 열어도 되고, 문자열이면 그 이유로 막습니다.
 */
export function devDenyReason(
  email: string | null | undefined,
  hostname: string,
): DevDenyReason {
  if (isLocalHost(hostname)) return null; // 내 컴퓨터에서 개발 중
  if (isDevEmail(email)) return null;
  return email ? "not_allowed" : "anonymous";
}

export function devModeAllowed(email: string | null | undefined, hostname: string): boolean {
  return devDenyReason(email, hostname) === null;
}

/** 막힌 이유를 사람이 읽는 문장으로 */
export function devDenyMessage(reason: DevDenyReason): string {
  switch (reason) {
    case "anonymous":
      return "개발자 모드는 지정된 계정만 쓸 수 있습니다. 구글 로그인 후 다시 시도하세요.";
    case "not_allowed":
      return "이 계정에는 개발자 모드 권한이 없습니다.";
    default:
      return "";
  }
}
