const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TOKEN_KEY   = "cs_token";
const REFRESH_KEY = "cs_refresh";
const USER_KEY    = "cs_user";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

// Un solo refresh en vuelo. Si varias llamadas reciben 401 a la vez (carga de
// página, el polling del inbox), todas esperan el MISMO refresh en lugar de
// disparar N refresh en paralelo — cada refresh emite un token nuevo e
// invalidaría a los demás en curso.
let refreshInFlight: Promise<string | null> | null = null;

// Guard para que el teardown (clearAuth + navegación) corra UNA sola vez cuando
// muchas requests reciben 401 en paralelo y el refresh compartido falla.
let redirecting = false;

function redirectToLogin() {
  if (redirecting) return;
  redirecting = true;
  clearAuth();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    // Llamada directa (no via request()) para no reentrar en la lógica de 401.
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    const payload = json?.data ?? json;
    const accessToken = payload?.accessToken;
    const newRefresh = payload?.refreshToken;
    if (!accessToken) return null;
    localStorage.setItem(TOKEN_KEY, accessToken);
    if (newRefresh) localStorage.setItem(REFRESH_KEY, newRefresh);
    return accessToken;
  } catch {
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isFormData = false,
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Solo declarar JSON cuando REALMENTE hay body. Fastify (backend) tira 500 si
  // recibe Content-Type: application/json con body vacío (PUT/POST sin body, ej.
  // approve/reject). Sin body → sin Content-Type → el handler corre normal.
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });

  // Credenciales inválidas en el propio login: mensaje claro, sin intentar refresh.
  if (res.status === 401 && path.includes("/auth/login")) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message ?? data?.message ?? "Invalid credentials");
  }

  // Access token expirado/ inválido → intentar UN refresh y reintentar la request.
  // Excluimos SOLO /auth/login y /auth/refresh para no entrar en loop; el resto
  // de los endpoints /auth/* (my-tenants, select-tenant, gmail/*) sí deben refrescar.
  if (res.status === 401 && !retried && !path.startsWith("/auth/login") && !path.startsWith("/auth/refresh")) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(method, path, body, isFormData, true);
    }
    // El refresh falló (expirado, revocado o inexistente) → a login.
    redirectToLogin();
    throw new Error("Tu sesión expiró. Volvé a iniciar sesión.");
  }

  const data = await res.json().catch(() => ({}));
  // El backend envuelve los errores como { success: false, error: { message, statusCode } }.
  // Leer error.message primero; data.message queda como fallback para respuestas sin envolver.
  if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get:    <T>(path: string) => request<T>("GET", path),
  post:   <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put:    <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch:  <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form, true),
};

export function saveAuth(token: string, refreshToken: string | null, user: unknown) {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getUser(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? "null"); }
  catch { return null; }
}
