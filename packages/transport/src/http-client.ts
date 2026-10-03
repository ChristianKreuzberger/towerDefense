// Client side of the game API. It only knows how to move request text around; where the request goes
// (a Node server over fetch, or the in-page host) is decided by the requester the caller plugs in.

export interface RawResponse {
  ok: boolean;
  text: string;
}

export type GameRequester = (method: "GET" | "POST", path: string, payload?: unknown) => Promise<RawResponse>;

export interface GameClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, payload: unknown): Promise<T>;
}

interface ErrorFields {
  ok?: boolean;
  error?: string;
  message?: string;
}

export function createFetchRequester(
  baseUrl: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  options?: { timeoutMs?: number }
): GameRequester {
  const base = baseUrl.replace(/\/$/, "");
  const timeoutMs = options?.timeoutMs;
  return async (method, path, payload) => {
    // A host that never answers would leave the caller's in-flight guards set forever, so a timeout aborts the request.
    const controller = timeoutMs === undefined ? undefined : new AbortController();
    const timer = controller && setTimeout(() => controller.abort(), timeoutMs);
    const init: RequestInit | undefined = method === "POST"
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      : undefined;
    try {
      const response = await fetchImpl(
        `${base}${path}`,
        controller ? { ...init, signal: controller.signal } : init
      );
      return { ok: response.ok, text: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createGameClient(request: GameRequester, options?: { onResponseText?: (text: string) => void }): GameClient {
  async function send<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const { ok, text } = await request(method, path, payload);
    options?.onResponseText?.(text);
    // An HTML error page, an empty body or `null` must not surface as a raw SyntaxError/TypeError.
    let data: (T & ErrorFields) | null;
    try {
      data = JSON.parse(text) as T & ErrorFields;
    } catch {
      data = null;
    }
    if (!ok || data === null || typeof data !== "object" || data.ok === false) {
      throw new Error(data?.message ?? data?.error ?? "request-failed");
    }
    return data;
  }
  return {
    get: (path) => send("GET", path),
    post: (path, payload) => send("POST", path, payload)
  };
}
