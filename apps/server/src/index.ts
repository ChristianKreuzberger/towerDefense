import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createMatch,
	type MatchSimulation
} from "@tower-defense/simulation";
import {
	PROJECT_NAME,
	type MatchSetup,
	type MatchSnapshot,
	type TowerTargetMode,
	type SimulationCommand
} from "@tower-defense/shared";
import { logger } from "./logger.js";

const PORT = Number(process.env.PORT ?? "4173");
const MAX_PORT = Number(process.env.PORT_MAX ?? String(PORT + 20));
const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];
const SERVER_RUNTIME_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO_ROOT = resolve(SERVER_RUNTIME_DIR, "..", "..", "..");
const CLIENT_DIST_DIR = resolve(REPO_ROOT, "apps/client/dist");
const CLIENT_INDEX_PATH = join(CLIENT_DIST_DIR, "index.html");
const CLIENT_ASSET_PREFIX = "/assets/";

let simulation: MatchSimulation | null = null;
let setup: MatchSetup | null = null;

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

	return JSON.parse(bodyText) as unknown;
}

function normalizeSetup(body: unknown): MatchSetup {
	const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};

	const seed = typeof source.seed === "number" && Number.isInteger(source.seed)
		? source.seed
		: Number(source.seed ?? 777);

	const inputPlayers = Array.isArray(source.players) ? source.players : [];
	const players = inputPlayers
		.map((entry, index) => {
			if (typeof entry !== "object" || !entry) {
				return null;
			}

			const mapped = entry as Record<string, unknown>;
			const id = typeof mapped.id === "string" && mapped.id.trim().length > 0
				? mapped.id.trim()
				: `p${index + 1}`;
			const name = typeof mapped.name === "string" && mapped.name.trim().length > 0
				? mapped.name.trim()
				: `Player ${index + 1}`;

			return { id, name };
		})
		.filter((entry): entry is { id: string; name: string } => entry !== null);

	if (players.length < 1 || players.length > 8) {
		throw new Error("player count must be between 1 and 8");
	}

	return { players, seed };
}

function requireSimulation(response: ServerResponse): MatchSimulation | null {
	if (!simulation) {
		writeJson(response, 400, {
			ok: false,
			error: "match-not-started",
			message: "Start a match first."
		});
		return null;
	}

	return simulation;
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

			probeServer.listen(port);
		});
	};

	return probe(startPort);
}

function parseCommand(body: unknown): SimulationCommand {
	const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
	const commandSource = typeof source.command === "object" && source.command
		? (source.command as Record<string, unknown>)
		: null;

	if (!commandSource || typeof commandSource.type !== "string") {
		throw new Error("invalid command payload");
	}

	const type = commandSource.type;

	if (type === "place-tower" || type === "place-wall") {
		return {
			type,
			playerId: String(commandSource.playerId ?? ""),
			x: Number(commandSource.x),
			y: Number(commandSource.y)
		};
	}

	if (type === "upgrade-tower") {
		return {
			type,
			playerId: String(commandSource.playerId ?? ""),
			towerId: String(commandSource.towerId ?? "")
		};
	}

	if (type === "set-target-mode") {
		const requestedMode = String(commandSource.mode ?? "first");
		const normalizedMode: TowerTargetMode = TARGET_MODES.includes(requestedMode as TowerTargetMode)
			? (requestedMode as TowerTargetMode)
			: "first";

		return {
			type,
			playerId: String(commandSource.playerId ?? ""),
			towerId: String(commandSource.towerId ?? ""),
			mode: normalizedMode
		};
	}

	if (type === "ready-for-wave") {
		return {
			type,
			playerId: String(commandSource.playerId ?? "")
		};
	}

	if (type === "advance-wave") {
		return { type };
	}

	throw new Error(`unsupported command type: ${type}`);
}

function logPhaseTransition(previous: MatchSnapshot, next: MatchSnapshot): void {
	if (previous.phase !== "placement" && next.phase === "placement") {
		logger.info({ event: "wave-ended", wave: Math.max(1, next.wave - 1), tick: previous.waveTick }, "wave ended");
	}

	if (previous.phase !== "wave" && next.phase === "wave") {
		logger.info({ event: "wave-started", wave: next.wave, tick: next.waveTick }, "wave started");
	}

	if (previous.phase !== "ended" && next.phase === "ended") {
		logger.info({ event: "match-ended", wave: next.wave, winnerId: next.winnerId, reason: next.endReason }, "match ended");
	}
}

const server = createServer(async (request, response) => {
	const method = request.method ?? "GET";
	const requestUrl = request.url ?? "/";
	const { pathname } = new URL(requestUrl, "http://localhost");

	try {
		if (method === "GET") {
			const served = await tryServeClientAsset(pathname, response);
			if (served) {
				return;
			}
		}

		if (method === "GET" && pathname === "/health") {
			writeJson(response, 200, {
				ok: true,
				project: PROJECT_NAME,
				runningMatch: simulation !== null,
				setup
			});
			return;
		}

		if (method === "GET" && pathname === "/api/snapshot") {
			const activeSimulation = requireSimulation(response);
			if (!activeSimulation) {
				return;
			}
			writeJson(response, 200, {
				ok: true,
				snapshot: activeSimulation.getSnapshot()
			});
			return;
		}

		if (method === "POST" && pathname === "/api/start") {
			const body = await readJsonBody(request);
			const nextSetup = normalizeSetup(body);
			simulation = createMatch(nextSetup);
			setup = nextSetup;
			logger.info({
				event: "match-created",
				players: nextSetup.players.length,
				seed: nextSetup.seed
			}, "match created");
			writeJson(response, 200, {
				ok: true,
				setup,
				snapshot: simulation.getSnapshot()
			});
			return;
		}

		if (method === "POST" && pathname === "/api/command") {
			const activeSimulation = requireSimulation(response);
			if (!activeSimulation) {
				return;
			}

			const body = await readJsonBody(request);
			const command = parseCommand(body);
			const previousSnapshot = activeSimulation.getSnapshot();
			const result = activeSimulation.applyCommand(command);
			const nextSnapshot = activeSimulation.getSnapshot();
			logPhaseTransition(previousSnapshot, nextSnapshot);
			writeJson(response, 200, {
				ok: true,
				result,
				snapshot: nextSnapshot
			});
			return;
		}

		if (method === "POST" && pathname === "/api/advance-many") {
			const activeSimulation = requireSimulation(response);
			if (!activeSimulation) {
				return;
			}

			const body = await readJsonBody(request);
			const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
			const ticks = Math.max(1, Math.min(500, Number(source.ticks ?? 30)));

			let acceptedTicks = 0;
			let stoppedReason = "";
			for (let i = 0; i < ticks; i += 1) {
				const previousSnapshot = activeSimulation.getSnapshot();
				const result = activeSimulation.applyCommand({ type: "advance-wave" });
				if (!result.accepted) {
					stoppedReason = result.reason ?? "rejected";
					break;
				}
				acceptedTicks += 1;

				const snapshot = activeSimulation.getSnapshot();
				logPhaseTransition(previousSnapshot, snapshot);
				if (snapshot.phase !== "wave") {
					stoppedReason = `phase=${snapshot.phase}`;
					break;
				}
			}

			writeJson(response, 200, {
				ok: true,
				acceptedTicks,
				stoppedReason,
				snapshot: activeSimulation.getSnapshot()
			});
			return;
		}

		writeJson(response, 404, {
			ok: false,
			error: "not-found"
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "unexpected-error";
		logger.error({ event: "request-error", method, pathname, message }, "request failed");
		writeJson(response, 400, {
			ok: false,
			error: "bad-request",
			message
		});
	}
});

void findOpenPort(PORT, MAX_PORT)
	.then((port) => {
		server.listen(port, () => {
				logger.info({ event: "server-started", project: PROJECT_NAME, port }, "local game host running");
		});
	})
	.catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		logger.error({ event: "server-start-failed", project: PROJECT_NAME, message }, "failed to start local game host");
		process.exit(1);
	});
