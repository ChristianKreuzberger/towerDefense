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

export function createFetchRequester(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): GameRequester {
  const base = baseUrl.replace(/\/$/, "");
  return async (method, path, payload) => {
    const response = await fetchImpl(`${base}${path}`, method === "POST"
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      : undefined);
    return { ok: response.ok, text: await response.text() };
  };
}

export function createGameClient(request: GameRequester, options?: { onResponseText?: (text: string) => void }): GameClient {
  async function send<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const { ok, text } = await request(method, path, payload);
    options?.onResponseText?.(text);
    const data = JSON.parse(text) as T & ErrorFields;
    if (!ok || data.ok === false) {
      throw new Error(data.message ?? data.error ?? "request-failed");
    }
    return data;
  }
  return {
    get: (path) => send("GET", path),
    post: (path, payload) => send("POST", path, payload)
  };
}
