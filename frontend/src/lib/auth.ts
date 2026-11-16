// Sign-in with Amazon Cognito (plan §6). The API tells the SPA how to sign in
// (`GET /api/auth/config`, public). Locally the dev bypass answers `mode: "none"` and nothing here
// runs. In prod: Cognito's managed login page, authorization code + PKCE, and the ID token on
// every API call in `X-Id-Token` (CloudFront's OAC takes the Authorization header).
//
// Tokens last an hour and renew quietly with the refresh token (7 days). They're kept in
// localStorage so the app survives a reload or a new tab; nothing else on the page is
// third-party script.
import { UserManager, WebStorageStateStore } from "oidc-client-ts";

type AuthConfig =
  | { mode: "none" }
  | { mode: "cognito"; authority: string; client_id: string; domain: string; app_url: string };

const CALLBACK_PATH = "/auth/callback";
// Set when a 401 sent us to the login page; a second 401 right after means the login itself
// isn't accepted (e.g. another email), so we stop instead of looping through the login page.
const RETRY_KEY = "jt-auth-retry";

let config: AuthConfig = { mode: "none" };
let manager: UserManager | null = null;

export type AuthState = { status: "ready"; email: string | null } | { status: "redirecting" };

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

async function signIn(returnTo = currentPath()): Promise<AuthState> {
  await manager!.signinRedirect({ state: { returnTo } });
  return { status: "redirecting" };
}

/** Runs once before the app renders. Either the user is signed in, or we're on the way to the
 * login page (or back from it). Throws when sign-in can't proceed. */
export async function initAuth(): Promise<AuthState> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error(`Couldn't load the sign-in settings (${res.status}).`);
  config = await res.json();
  if (config.mode === "none") return { status: "ready", email: null };

  // Cognito only returns to the registered address, so sign in there (not on cloudfront.net).
  if (window.location.origin !== new URL(config.app_url).origin) {
    window.location.replace(config.app_url + currentPath());
    return { status: "redirecting" };
  }

  manager = new UserManager({
    authority: config.authority,
    client_id: config.client_id,
    redirect_uri: config.app_url + CALLBACK_PATH,
    post_logout_redirect_uri: config.app_url + "/",
    response_type: "code",
    scope: "openid email",
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });

  if (window.location.pathname === CALLBACK_PATH) {
    const user = await manager.signinRedirectCallback();
    const state = user.state as { returnTo?: string } | undefined;
    const returnTo = state?.returnTo?.startsWith("/") && !state.returnTo.startsWith("//") ? state.returnTo : "/";
    window.history.replaceState(null, "", returnTo === CALLBACK_PATH ? "/" : returnTo);
    return { status: "ready", email: user.profile.email ?? null };
  }

  let user = await manager.getUser();
  if (user?.expired && user.refresh_token) user = await manager.signinSilent().catch(() => null);
  if (!user || user.expired) return signIn();
  return { status: "ready", email: user.profile.email ?? null };
}

/** The ID token for the next API call, renewed first if it has run out. */
export async function idToken(): Promise<string | null> {
  if (!manager) return null;
  let user = await manager.getUser();
  if (user?.expired && user.refresh_token) user = await manager.signinSilent().catch(() => null);
  return user && !user.expired ? user.id_token ?? null : null;
}

/** The API said 401 to a request we made. Sign in again, once. Returns false when that already
 * happened just now, so the caller shows the error instead. */
export async function onUnauthorized(): Promise<boolean> {
  if (!manager) return false;
  try {
    if (sessionStorage.getItem(RETRY_KEY)) return false;
    sessionStorage.setItem(RETRY_KEY, "1");
  } catch {
    return false;
  }
  await manager.removeUser();
  await signIn();
  return true;
}

/** An API call went through with our token: the next 401 may sign in again. */
export function onAuthorized(): void {
  try {
    sessionStorage.removeItem(RETRY_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function canSignOut(): boolean {
  return config.mode === "cognito";
}

/** Forget the tokens here, revoke the refresh token, and end the Cognito session (its own
 * /logout endpoint: Cognito doesn't publish an OIDC end_session_endpoint). */
export async function signOut(): Promise<void> {
  if (config.mode !== "cognito" || !manager) return;
  await manager.revokeTokens(["refresh_token"]).catch(() => undefined);
  await manager.removeUser();
  const params = new URLSearchParams({ client_id: config.client_id, logout_uri: config.app_url + "/" });
  window.location.assign(`${config.domain}/logout?${params}`);
}
