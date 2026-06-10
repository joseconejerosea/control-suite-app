const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cs_token");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isFormData = false
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && path.includes("/auth/login")) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message ?? "Invalid credentials");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
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

export function saveAuth(token: string, user: unknown) {
  localStorage.setItem("cs_token", token);
  localStorage.setItem("cs_user", JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem("cs_token");
  localStorage.removeItem("cs_user");
}

export function getUser(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem("cs_user") ?? "null"); }
  catch { return null; }
}