import { createGameApi } from "@tower-defense/transport/game-api";
// Runs the game "server" inside the page for static hosting (GitHub Pages); no network involved.
const handle = createGameApi();
export function localRequest(method, path, body) {
    const { pathname, searchParams } = new URL(path, "http://local");
    try {
        const result = handle({ method, pathname, searchParams, body: body ?? {} });
        return { ok: result.status >= 200 && result.status < 300, text: JSON.stringify(result.payload) };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "unexpected-error";
        return { ok: false, text: JSON.stringify({ ok: false, error: "bad-request", message }) };
    }
}
