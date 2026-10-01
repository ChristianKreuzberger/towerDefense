import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGameApi, GameApiError } from "@tower-defense/transport";
import { PROJECT_NAME } from "@tower-defense/shared";
import { logger } from "./logger.js";

const DEFAULT_PORT = 4173;
const EXPLICIT_PORT = Number(process.env.PORT ?? "");
const PORT = Number.isInteger(EXPLICIT_PORT) && EXPLICIT_PORT > 0 ? EXPLICIT_PORT : DEFAULT_PORT;
const MAX_PORT = Number(process.env.PORT_MAX ?? String(PORT + 20));
const SERVER_RUNTIME_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO_ROOT = resolve(SERVER_RUNTIME_DIR, "..", "..", "..");
const CLIENT_DIST_DIR = resolve(REPO_ROOT, "apps/client/dist");
const CLIENT_INDEX_PATH = join(CLIENT_DIST_DIR, "index.html");
const CLIENT_ASSET_PREFIX = "/assets/";

const gameApi = createGameApi(logger);

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	const bodyText = Buffer.concat(chunks).toString("utf8").trim();
	if (!bodyText) {
		return {};
	}

	try {
		return JSON.parse(bodyText) as unknown;
	} catch {
		// Keep the parser's own message out of the response; the code is the stable contract.
		throw new GameApiError("invalid-json", "request body is not valid JSON");
	}
}

function contentTypeFor(path: string): string {
	const extension = extname(path).toLowerCase();
	if (extension === ".html") {
		return "text/html; charset=utf-8";
	}
	if (extension === ".js" || extension === ".mjs") {
		return "application/javascript; charset=utf-8";
	}
	if (extension === ".css") {
		return "text/css; charset=utf-8";
	}
	if (extension === ".json") {
		return "application/json; charset=utf-8";
	}
	if (extension === ".svg") {
		return "image/svg+xml";
	}
	if (extension === ".ico") {
		return "image/x-icon";
	}
	if (extension === ".png") {
		return "image/png";
	}
	if (extension === ".jpg" || extension === ".jpeg") {
		return "image/jpeg";
	}
	return "application/octet-stream";
}

async function tryServeClientAsset(pathname: string, response: ServerResponse): Promise<boolean> {
	if (pathname === "/") {
		try {
			const html = await readFile(CLIENT_INDEX_PATH);
			response.statusCode = 200;
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.end(html);
			return true;
		} catch {
			response.statusCode = 200;
			response.setHeader("Content-Type", "text/plain; charset=utf-8");
			response.end(
				"Client build not found. Run `npm --workspace @tower-defense/client run build` or `npm run dev:client` for Vite dev server."
			);
			return true;
		}
	}

	if (!pathname.startsWith(CLIENT_ASSET_PREFIX)) {
		return false;
	}

	const safeRelativePath = pathname.replace(/^\/+/, "");
	const assetPath = resolve(CLIENT_DIST_DIR, safeRelativePath);
	if (!assetPath.startsWith(CLIENT_DIST_DIR)) {
		return false;
	}

	try {
		const content = await readFile(assetPath);
		response.statusCode = 200;
		response.setHeader("Content-Type", contentTypeFor(assetPath));
		response.end(content);
		return true;
	} catch {
		return false;
	}
}

function findOpenPort(startPort: number, endPort: number): Promise<number> {
	const probe = (port: number): Promise<number> => {
		if (port > endPort) {
			return Promise.reject(new Error(`no open port found in range ${startPort}-${endPort}`));
		}

		return new Promise((resolve, reject) => {
			const probeServer = createNetServer();

			probeServer.once("error", (error: NodeJS.ErrnoException) => {
				probeServer.close();
				if (error.code === "EADDRINUSE") {
					console.warn(`[${PROJECT_NAME}] port ${port} in use, trying ${port + 1}`);
					resolve(probe(port + 1));
					return;
				}

				reject(error);
			});

			probeServer.once("listening", () => {
				probeServer.close((closeError) => {
					if (closeError) {
						reject(closeError);
						return;
					}

					resolve(port);
				});
			});

			probeServer.listen(port, "127.0.0.1");
		});
	};

	return probe(startPort);
}

const server = createServer(async (request, response) => {
	const method = request.method ?? "GET";
	const requestUrl = request.url ?? "/";
	const { pathname, searchParams } = new URL(requestUrl, "http://localhost");

	// Local, unauthenticated dev host: any origin may call the API (documented in spec/07).
	response.setHeader("Access-Control-Allow-Origin", "*");
	response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	response.setHeader("Access-Control-Allow-Headers", "Content-Type");
	if (method === "OPTIONS") {
		response.statusCode = 204;
		response.end();
		return;
	}

	try {
		if (method === "GET") {
			const served = await tryServeClientAsset(pathname, response);
			if (served) {
				return;
			}
		}

		const body = method === "POST" ? await readJsonBody(request) : {};
		const result = gameApi({ method, pathname, searchParams, body });
		writeJson(response, result.status, result.payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unexpected-error";
		logger.error({ event: "request-error", method, pathname, message }, "request failed");
		writeJson(response, 400, {
			ok: false,
			error: error instanceof GameApiError ? error.code : "bad-request",
			message
		});
	}
});

const startServer = (): void => {
	if (Number.isInteger(EXPLICIT_PORT) && EXPLICIT_PORT > 0) {
		server.listen(PORT, "127.0.0.1", () => {
			logger.info({ event: "server-started", project: PROJECT_NAME, port: PORT }, "local game host running");
		});
		return;
	}

	void findOpenPort(PORT, MAX_PORT)
		.then((port) => {
			server.listen(port, "127.0.0.1", () => {
				logger.info({ event: "server-started", project: PROJECT_NAME, port }, "local game host running");
			});
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ event: "server-start-failed", project: PROJECT_NAME, message }, "failed to start local game host");
			process.exit(1);
		});
};

startServer();
