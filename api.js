import { createFetchRequester, createGameClient } from "@tower-defense/transport/http-client";
import { perfRecordBytes } from "./perf";
// The client only talks to the host through the transport package; this module just picks the requester.
function apiBase() {
    const configured = import.meta.env.VITE_API_BASE_URL;
    if (typeof configured === "string" && configured.length > 0) {
        return configured;
    }
    return "";
}
// GitHub Pages has no backend, so that build hosts the game API in the page itself.
const inBrowserServer = import.meta.env.VITE_IN_BROWSER_SERVER === "true";
const requester = inBrowserServer
    ? async (method, path, payload) => {
        const { localRequest } = await import("./local-host.js");
        return localRequest(method, path, payload);
    }
    : createFetchRequester(apiBase(), undefined, { timeoutMs: 10_000 });
const client = createGameClient(requester, { onResponseText: (text) => perfRecordBytes(text.length) });
export const getJson = client.get;
export const postJson = client.post;
