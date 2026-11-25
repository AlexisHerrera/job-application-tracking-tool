// Sign-in with Amazon Cognito (plan §6). The API tells the SPA how to sign in
// (`GET /api/auth/config`, public). Locally the dev bypass answers `mode: "none"` and nothing here
// runs. In prod: Cognito's managed login page, authorization code + PKCE, and the ID token on
// every API call in `X-Id-Token` (CloudFront's OAC takes the Authorization header).
//
// Tokens last an hour and renew quietly with the refresh token (7 days). They're kept in
// localStorage so the app survives a reload or a new tab; nothing else on the page is
// third-party script.
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

type AuthConfig =
  | { mode: "none" }
  | { mode: "cognito"; authority: string; client_id: string; domain: string; app_url: string };

const CALLBACK_PATH = "/auth/callback";
const CONFIG_KEY = "jt-auth-config";
// Set when a 401 sent us to the login page; a second 401 right after means the login itself
// isn't accepted (e.g. another email), so we stop instead of looping through the login page.
const RETRY_KEY = "jt-auth-retry";

let config: AuthConfig = { mode: "none" };
let manager: UserManager | null = null;
let initialization: Promise<AuthState> | undefined;
let renewal: Promise<User | null> | undefined;
let signingOut = false;

export type AuthState = { status: "ready"; email: string | null } | { status: "redirecting" };

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

async function signIn(returnTo = currentPath()): Promise<AuthState> {
  await manager!.signinRedirect({ state: { returnTo } });
  return { status: "redirecting" };
}

function readCachedConfig(): AuthConfig | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
    if (cached?.mode === "none") return { mode: "none" };
    if (cached?.mode === "cognito" &&
      ["authority", "client_id", "domain", "app_url"].every((key) => typeof cached[key] === "string" && cached[key])) {
      return cached;
    }
  } catch {
    // Storage may be blocked or the cached value unreadable.
  }
  return null;
}

async function fetchConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error(`Couldn't load the sign-in settings (${res.status}).`);
  const fresh: AuthConfig = await res.json();
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(fresh));
  } catch {
    // The current visit can still use the fetched settings.
  }
  return fresh;
}

export function initAuth(): Promise<AuthState> {
  // StrictMode re-runs effects. Share initialization, including any callback exchange.
  return (initialization ??= initialize());
}

async function initialize(): Promise<AuthState> {
  const cached = readCachedConfig();
  if (cached) void fetchConfig().catch(() => undefined);
  config = cached ?? await fetchConfig();
  if (config.mode === "none") return { status: "ready", email: null };

  // Cognito only returns to the registered address, so sign in there (not on cloudfront.net).
  if (window.location.origin !== new URL(config.app_url).origin) {
    window.location.replace(config.app_url + currentPath());
    return { status: "redirecting" };
  }

  manager = new UserManager({
    authority: config.authority,
    metadata: {
      issuer: config.authority,
      authorization_endpoint: `${config.domain}/oauth2/authorize`,
      token_endpoint: `${config.domain}/oauth2/token`,
      userinfo_endpoint: `${config.domain}/oauth2/userInfo`,
      revocation_endpoint: `${config.domain}/oauth2/revoke`,
      jwks_uri: `${config.authority}/.well-known/jwks.json`,
    },
    client_id: config.client_id,
    redirect_uri: config.app_url + CALLBACK_PATH,
    post_logout_redirect_uri: config.app_url + "/",
    response_type: "code",
    scope: "openid email",
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    // API requests share a single renewal, including requests made on first paint.
    automaticSilentRenew: false,
  });

  if (window.location.pathname === CALLBACK_PATH) {
    const user = await manager.signinRedirectCallback();
    const state = user.state as { returnTo?: string } | undefined;
    const returnTo = state?.returnTo?.startsWith("/") && !state.returnTo.startsWith("//") ? state.returnTo : "/";
    window.history.replaceState(null, "", returnTo === CALLBACK_PATH ? "/" : returnTo);
    return { status: "ready", email: user.profile.email ?? null };
  }

  const user = await manager.getUser();
  if (!user || ((!user.id_token || user.expired) && !user.refresh_token)) return signIn();
  return { status: "ready", email: user.profile.email ?? null };
}

/** The ID token for the next API call, renewed first if it has run out. */
export async function idToken(): Promise<string | null> {
  if (!manager || signingOut) return null;
  let user = await manager.getUser();
  if (signingOut) return null;
  if (user?.refresh_token && (!user.id_token || user.expired)) {
    renewal ??= manager.signinSilent().catch(() => null).finally(() => { renewal = undefined; });
    user = await renewal;
  }
  return user && !user.expired ? user.id_token ?? null : null;
}

/** The API said 401 to a request we made. Sign in again, once. Returns false when that already
 * happened just now, so the caller shows the error instead. */
export async function onUnauthorized(): Promise<boolean> {
  if (!manager || signingOut) return false;
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
  if (config.mode !== "cognito" || !manager || signingOut) return;
  signingOut = true;
  await renewal;
  await manager.revokeTokens(["refresh_token"]).catch(() => undefined);
  await manager.removeUser();
  const params = new URLSearchParams({ client_id: config.client_id, logout_uri: config.app_url + "/" });
  window.location.assign(`${config.domain}/logout?${params}`);
}
