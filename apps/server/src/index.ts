import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

import {
	createMatch,
	type MatchSimulation
} from "@tower-defense/simulation";
import {
	PROJECT_NAME,
	type MatchSetup,
	type TowerTargetMode,
	type SimulationCommand
} from "@tower-defense/shared";

const PORT = Number(process.env.PORT ?? "4173");
const MAX_PORT = Number(process.env.PORT_MAX ?? String(PORT + 20));
const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];

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

function htmlPage(): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Tower Defense Local Host</title>
		<style>
			:root {
				--bg: #f4f0e8;
				--ink: #20211c;
				--panel: #fffaf0;
				--line: #b8ab8f;
				--accent: #a64522;
				--accent2: #2f6f53;
			}
			* { box-sizing: border-box; }
			html, body { min-height: 100%; }
			body {
				margin: 0;
				font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
				color: var(--ink);
				background:
					radial-gradient(circle at 20% 0%, #f8dfb3 0%, transparent 40%),
					radial-gradient(circle at 100% 20%, #d4e1cc 0%, transparent 35%),
					var(--bg);
				display: flex;
				flex-direction: column;
			}
			header {
				padding: 16px 20px;
				border-bottom: 2px solid var(--line);
				background: linear-gradient(90deg, #fff3d6, #e8efd8);
			}
			h1 { margin: 0; font-size: 24px; letter-spacing: 0.4px; }
			main {
				display: grid;
				grid-template-columns: 330px 1fr;
				gap: 14px;
				padding: 14px;
				flex: 1;
			}
			.phase-banner {
				grid-column: 1 / -1;
				padding: 12px 16px;
				border-bottom: 3px solid #d4842d;
				background: linear-gradient(90deg, #fff1cc, #f5d891);
				border-radius: 8px;
				font-size: 13px;
				display: flex;
				justify-content: space-between;
				align-items: center;
				font-weight: 700;
			}
			.phase-banner.wave {
				border-bottom-color: #8a2c2c;
				background: linear-gradient(90deg, #ffd6d6, #f4b4b4);
			}
			.phase-banner.ended {
				border-bottom-color: #2f6f53;
				background: linear-gradient(90deg, #d6f0e1, #b8e4cc);
			}
			.phase-label {
				text-transform: uppercase;
				letter-spacing: 0.5px;
			}
			.phase-sub {
				font-size: 12px;
				font-weight: 500;
				color: #595b50;
			}
			.card {
				background: var(--panel);
				border: 2px solid var(--line);
				border-radius: 8px;
				padding: 12px;
			}
			label { display: block; font-size: 12px; margin: 8px 0 4px; font-weight: 700; }
			input, select, button, textarea {
				width: 100%;
				padding: 8px;
				border: 1px solid #8e866f;
				border-radius: 6px;
				font: inherit;
			}
			button {
				cursor: pointer;
				background: #fff;
				transition: transform 120ms ease, background 120ms ease;
			}
			button:hover { transform: translateY(-1px); background: #fff8ea; }
			button.primary { background: var(--accent); color: #fff; border-color: #6a2611; }
			button.good { background: var(--accent2); color: #fff; border-color: #184632; }
			.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
			.stack { display: grid; gap: 8px; margin-top: 8px; }
			.status {
				font-family: "IBM Plex Mono", "Consolas", monospace;
				white-space: pre-wrap;
				background: #fff;
				border: 1px dashed #8e866f;
				padding: 8px;
				min-height: 64px;
			}
			.board {
				font-family: "IBM Plex Mono", "Consolas", monospace;
				white-space: pre;
				background: #151917;
				color: #dfe8db;
				border-radius: 6px;
				padding: 10px;
				min-height: 220px;
				overflow: auto;
			}
			.player-cards {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
				gap: 8px;
			}
			.player-card {
				border: 2px solid var(--line);
				border-radius: 8px;
				padding: 8px;
				background: #fffdf7;
				font-size: 12px;
			}
			.player-card.ready {
				background: #ecfdf5;
				border-color: #2f6f53;
			}
			.player-card.waiting {
				background: #fff7ed;
				border-color: #b76f2d;
			}
			.player-card.eliminated {
				opacity: 0.6;
				background: #f4f4f2;
				border-color: #9e9e96;
			}
			.player-card-name {
				font-weight: 700;
				margin-bottom: 4px;
			}
			.player-card-meta {
				font-family: "IBM Plex Mono", "Consolas", monospace;
				font-size: 11px;
				white-space: pre-wrap;
			}
			.shortcuts-bar {
				background: #2d2c27;
				color: #dfe8db;
				padding: 8px 12px;
				font-size: 11px;
				border-top: 1px solid #5c5d52;
				display: flex;
				justify-content: center;
				gap: 16px;
				flex-wrap: wrap;
			}
			kbd {
				background: #3e3d37;
				border: 1px solid #66645f;
				border-radius: 3px;
				padding: 2px 4px;
				font-family: "IBM Plex Mono", "Consolas", monospace;
				font-size: 10px;
			}
			.match-end-overlay {
				display: none;
				position: fixed;
				inset: 0;
				background: rgba(16, 17, 15, 0.72);
				align-items: center;
				justify-content: center;
				z-index: 40;
			}
			.match-end-modal {
				width: min(460px, 92vw);
				background: #fffdf7;
				border: 3px solid #2f6f53;
				border-radius: 10px;
				padding: 14px;
			}
			.match-end-modal h2 {
				margin: 0 0 10px;
			}
			.match-end-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 6px;
				font-size: 12px;
				margin: 10px 0;
			}
			.small { font-size: 12px; color: #5c5d52; }
			textarea { min-height: 240px; font-size: 12px; font-family: "IBM Plex Mono", "Consolas", monospace; }
			@media (max-width: 980px) {
				main { grid-template-columns: 1fr; }
			}
		</style>
	</head>
	<body>
		<header>
			<h1>Tower Defense Local Host</h1>
			<div class="small">Playable local loop: start -> place towers -> ready -> advance wave</div>
		</header>
		<main>
			<section class="phase-banner" id="phaseBanner">
				<div class="phase-label" id="phaseLabel">NO MATCH</div>
				<div class="phase-sub" id="phaseSub"></div>
			</section>
			<section class="card">
				<label>Seed</label>
				<input id="seed" type="number" value="777" />
				<label>Players (comma-separated names, 1-8)</label>
				<input id="players" value="Alpha,Bravo" />
				<div class="stack">
					<button id="startBtn" class="primary">Start Match</button>
				</div>

				<hr />
				<label>Active Player</label>
				<select id="playerId"></select>
				<div class="grid2">
					<div>
						<label>X</label>
						<input id="x" type="number" value="0" />
					</div>
					<div>
						<label>Y</label>
						<input id="y" type="number" value="1" />
					</div>
				</div>
				<div class="stack">
					<button id="placeTowerBtn">Place Tower</button>
					<button id="readyBtn" class="good">Ready For Wave</button>
					<button id="placeWallBtn">Place Wall</button>
					<button id="upgradeBtn">Upgrade Tower</button>
				</div>
				<label>Target Mode</label>
				<select id="mode">
					<option value="first">first</option>
					<option value="last">last</option>
					<option value="strongest">strongest</option>
					<option value="nearest">nearest</option>
				</select>
				<div class="stack">
					<button id="modeBtn">Set Target Mode</button>
					<button id="advanceBtn" class="primary">Advance Wave Tick</button>
					<button id="autoBtn">Advance 30 Ticks</button>
					<button id="refreshBtn">Refresh Snapshot</button>
				</div>
				<h3>Players</h3>
				<div id="playerCards" class="player-cards">No match yet.</div>
				<h3>Last Action</h3>
				<div id="status" class="status">No match yet.</div>
			</section>
			<section class="card">
				<h3>Board</h3>
				<div id="board" class="board"></div>
				<h3>Snapshot</h3>
				<textarea id="snapshot" readonly></textarea>
			</section>
		</main>
		<footer class="shortcuts-bar" id="shortcutBar">
			<div><kbd>R</kbd> ready <kbd>T</kbd> tower <kbd>W</kbd> wall <kbd>U</kbd> upgrade <kbd>A</kbd> tick</div>
			<div><kbd>Arrows</kbd> move X/Y</div>
		</footer>
		<div class="match-end-overlay" id="matchEndOverlay">
			<div class="match-end-modal">
				<h2>Match Ended</h2>
				<div id="matchEndSummary" class="small"></div>
				<div id="matchEndScores" class="match-end-grid"></div>
				<div class="stack">
					<button id="restartBtn" class="primary">Start New Match</button>
					<button id="closeOverlayBtn">Close</button>
				</div>
			</div>
		</div>
		<script>
			let current = null;

			const el = {
				seed: document.getElementById("seed"),
				players: document.getElementById("players"),
				playerId: document.getElementById("playerId"),
				x: document.getElementById("x"),
				y: document.getElementById("y"),
				mode: document.getElementById("mode"),
				playerCards: document.getElementById("playerCards"),
				phaseBanner: document.getElementById("phaseBanner"),
				phaseLabel: document.getElementById("phaseLabel"),
				phaseSub: document.getElementById("phaseSub"),
				shortcutBar: document.getElementById("shortcutBar"),
				overlay: document.getElementById("matchEndOverlay"),
				overlaySummary: document.getElementById("matchEndSummary"),
				overlayScores: document.getElementById("matchEndScores"),
				status: document.getElementById("status"),
				board: document.getElementById("board"),
				snapshot: document.getElementById("snapshot")
			};

			function playerTowerId(playerId) {
				return "tower-" + playerId;
			}

			function setStatus(text) {
				el.status.textContent = text;
			}

			function pickDefaultPlayer(snapshot) {
				if (!snapshot || !snapshot.players || snapshot.players.length === 0) {
					return "";
				}
				return snapshot.players[0].id;
			}

			function updatePlayerOptions(snapshot) {
				const previous = el.playerId.value;
				el.playerId.innerHTML = "";
				const players = snapshot?.players ?? [];
				for (const player of players) {
					const option = document.createElement("option");
					option.value = player.id;
					option.textContent = player.id + " (" + player.name + ")";
					el.playerId.append(option);
				}
				if (players.some((p) => p.id === previous)) {
					el.playerId.value = previous;
				} else {
					el.playerId.value = pickDefaultPlayer(snapshot);
				}
			}

			function renderBoard(snapshot) {
				if (!snapshot) {
					el.board.textContent = "No active match";
					return;
				}

				const width = snapshot.map.width;
				const height = snapshot.map.height;
				const byCell = new Map();
				for (const cell of snapshot.map.cells) {
					byCell.set(cell.x + "," + cell.y, cell);
				}

				const mark = new Map();
				for (const wall of snapshot.walls) {
					mark.set(wall.x + "," + wall.y, "W");
				}
				for (const tower of snapshot.towers) {
					mark.set(tower.x + "," + tower.y, "T");
				}
				for (const creature of snapshot.creatures) {
					mark.set(creature.x + "," + creature.y, "C");
				}

				const lines = [];
				lines.push("phase=" + snapshot.phase + " wave=" + snapshot.wave + " tick=" + snapshot.waveTick);
				lines.push("legend: T=tower W=wall C=creature .=buildable #=blocked");
				lines.push("   " + Array.from({ length: width }, (_, x) => String(x).padStart(2, " ")).join(" "));

				for (let y = 0; y < height; y += 1) {
					const row = [String(y).padStart(2, " "), " "];
					for (let x = 0; x < width; x += 1) {
						const key = x + "," + y;
						const cell = byCell.get(key);
						const char = mark.get(key) ?? (cell?.buildable ? "." : "#");
						row.push(" " + char + " ");
					}
					lines.push(row.join(""));
				}

				lines.push("");
				lines.push("players:");
				for (const player of snapshot.players) {
					lines.push("- " + player.id + " " + player.name + ": points=" + player.points + " placed=" + player.hasPlacedTower + " ready=" + player.readyForWave + " eliminated=" + player.eliminated);
				}

				el.board.textContent = lines.join("\n");
			}

			function renderSnapshot(snapshot) {
				el.snapshot.value = JSON.stringify(snapshot, null, 2);
			}

			function renderPlayerCards(snapshot) {
				if (!snapshot) {
					el.playerCards.textContent = "No active match";
					return;
				}

				const cards = [];
				for (const player of snapshot.players) {
					let status = "waiting";
					let label = "WAITING";
					if (player.eliminated) {
						status = "eliminated";
						label = "ELIMINATED";
					} else if (player.readyForWave) {
						status = "ready";
						label = "READY";
					}

					cards.push(
						'<div class="player-card ' + status + '">' +
						'<div class="player-card-name">' + player.name + '</div>' +
						'<div class="player-card-meta">id=' + player.id + '\npoints=' + player.points + '\nplaced=' + player.hasPlacedTower + '</div>' +
						'<div class="small">' + label + '</div>' +
						'</div>'
					);
				}
				el.playerCards.innerHTML = cards.join("");
			}

			function renderPhase(snapshot) {
				if (!snapshot) {
					el.phaseBanner.className = "phase-banner";
					el.phaseLabel.textContent = "NO MATCH";
					el.phaseSub.textContent = "Start a local match to play.";
					el.shortcutBar.style.display = "flex";
					return;
				}

				let label = "PLACEMENT PHASE";
				let sub = "Place one tower per player and mark ready.";
				el.phaseBanner.className = "phase-banner";

				if (snapshot.phase === "wave") {
					el.phaseBanner.classList.add("wave");
					label = "WAVE " + snapshot.wave + " COMBAT";
					sub = "tick=" + snapshot.waveTick + " active-creatures=" + snapshot.creatures.length;
				}

				if (snapshot.phase === "ended") {
					el.phaseBanner.classList.add("ended");
					label = "MATCH ENDED";
					sub = snapshot.winnerId ? ("winner=" + snapshot.winnerId + " reason=" + (snapshot.endReason ?? "unknown")) : "no winner";
				}

				el.phaseLabel.textContent = label;
				el.phaseSub.textContent = sub;
				el.shortcutBar.style.display = snapshot.phase === "ended" ? "none" : "flex";
			}

			function renderEndOverlay(snapshot) {
				if (!snapshot || snapshot.phase !== "ended") {
					el.overlay.style.display = "none";
					return;
				}

				const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
				const winnerText = winner
					? (winner.name + " (" + winner.id + ")")
					: (snapshot.winnerId ?? "none");

				el.overlaySummary.textContent = "Winner: " + winnerText + " | reason=" + (snapshot.endReason ?? "unknown");

				const ranked = [...snapshot.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
				el.overlayScores.innerHTML = ranked
					.map((player) => "<div>" + player.name + "</div><div>" + player.points + " pts</div>")
					.join("");

				el.overlay.style.display = "flex";
			}

			function closeOverlay() {
				el.overlay.style.display = "none";
			}

			async function fetchSnapshot() {
				const response = await fetch("/api/snapshot");
				const data = await response.json();
				if (!response.ok) {
					setStatus(data.message ?? data.error ?? "Failed to fetch snapshot");
					return null;
				}

				current = data.snapshot;
				updatePlayerOptions(current);
				renderBoard(current);
				renderPlayerCards(current);
				renderPhase(current);
				renderEndOverlay(current);
				renderSnapshot(current);
				return current;
			}

			async function post(path, payload) {
				const response = await fetch(path, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				});
				const data = await response.json();
				if (!response.ok) {
					setStatus("error: " + (data.message ?? data.error ?? "request-failed"));
					return null;
				}
				return data;
			}

			async function startMatch() {
				closeOverlay();
				const rawPlayers = String(el.players.value)
					.split(",")
					.map((name) => name.trim())
					.filter(Boolean);

				const players = rawPlayers.map((name, index) => ({
					id: "p" + (index + 1),
					name
				}));

				const payload = {
					seed: Number(el.seed.value),
					players
				};

				const data = await post("/api/start", payload);
				if (!data) {
					return;
				}

				setStatus("match-started: players=" + players.length + " seed=" + payload.seed);
				await fetchSnapshot();
			}

			function selectedPlayerId() {
				return String(el.playerId.value || "");
			}

			function coordValue(field) {
				return Number(field.value);
			}

			function clampCoord(value, max) {
				if (max <= 0 || Number.isNaN(value)) {
					return 0;
				}
				return Math.max(0, Math.min(max - 1, value));
			}

			function adjustCoord(dx, dy) {
				const width = current?.map?.width ?? 64;
				const height = current?.map?.height ?? 64;
				const nextX = clampCoord(coordValue(el.x) + dx, width);
				const nextY = clampCoord(coordValue(el.y) + dy, height);
				el.x.value = String(nextX);
				el.y.value = String(nextY);
			}

			function isFormField(target) {
				if (!(target instanceof HTMLElement)) {
					return false;
				}
				const tag = target.tagName.toLowerCase();
				return tag === "input" || tag === "textarea" || tag === "select";
			}

			async function sendCommand(command) {
				const data = await post("/api/command", { command });
				if (!data) {
					return;
				}

				const result = data.result;
				if (!result?.accepted) {
					setStatus("rejected: " + (result?.reason ?? "unknown"));
				} else {
					setStatus("accepted");
				}
				await fetchSnapshot();
			}

			document.getElementById("startBtn").addEventListener("click", startMatch);
			document.getElementById("refreshBtn").addEventListener("click", fetchSnapshot);
			document.getElementById("restartBtn").addEventListener("click", startMatch);
			document.getElementById("closeOverlayBtn").addEventListener("click", closeOverlay);

			document.getElementById("placeTowerBtn").addEventListener("click", async () => {
				await sendCommand({
					type: "place-tower",
					playerId: selectedPlayerId(),
					x: coordValue(el.x),
					y: coordValue(el.y)
				});
			});

			document.getElementById("readyBtn").addEventListener("click", async () => {
				await sendCommand({ type: "ready-for-wave", playerId: selectedPlayerId() });
			});

			document.getElementById("placeWallBtn").addEventListener("click", async () => {
				await sendCommand({
					type: "place-wall",
					playerId: selectedPlayerId(),
					x: coordValue(el.x),
					y: coordValue(el.y)
				});
			});

			document.getElementById("upgradeBtn").addEventListener("click", async () => {
				const playerId = selectedPlayerId();
				await sendCommand({
					type: "upgrade-tower",
					playerId,
					towerId: playerTowerId(playerId)
				});
			});

			document.getElementById("modeBtn").addEventListener("click", async () => {
				const playerId = selectedPlayerId();
				await sendCommand({
					type: "set-target-mode",
					playerId,
					towerId: playerTowerId(playerId),
					mode: String(el.mode.value)
				});
			});

			document.getElementById("advanceBtn").addEventListener("click", async () => {
				await sendCommand({ type: "advance-wave" });
			});

			document.getElementById("autoBtn").addEventListener("click", async () => {
				const data = await post("/api/advance-many", { ticks: 30 });
				if (!data) {
					return;
				}
				setStatus("advance-many: attempted=30 accepted=" + data.acceptedTicks + " stopped=" + (data.stoppedReason ?? "none"));
				await fetchSnapshot();
			});

			document.addEventListener("keydown", (event) => {
				if (isFormField(event.target)) {
					return;
				}

				const key = event.key.toLowerCase();
				if (key === "r") {
					event.preventDefault();
					document.getElementById("readyBtn").click();
					return;
				}

				if (key === "t") {
					event.preventDefault();
					document.getElementById("placeTowerBtn").click();
					return;
				}

				if (key === "w") {
					event.preventDefault();
					document.getElementById("placeWallBtn").click();
					return;
				}

				if (key === "u") {
					event.preventDefault();
					document.getElementById("upgradeBtn").click();
					return;
				}

				if (key === "a") {
					event.preventDefault();
					document.getElementById("advanceBtn").click();
					return;
				}

				if (event.key === "ArrowLeft") {
					event.preventDefault();
					adjustCoord(-1, 0);
					return;
				}

				if (event.key === "ArrowRight") {
					event.preventDefault();
					adjustCoord(1, 0);
					return;
				}

				if (event.key === "ArrowUp") {
					event.preventDefault();
					adjustCoord(0, -1);
					return;
				}

				if (event.key === "ArrowDown") {
					event.preventDefault();
					adjustCoord(0, 1);
				}
			});
		</script>
	</body>
</html>`;
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

const server = createServer(async (request, response) => {
	const method = request.method ?? "GET";
	const url = request.url ?? "/";

	try {
		if (method === "GET" && url === "/") {
			response.statusCode = 200;
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.end(htmlPage());
			return;
		}

		if (method === "GET" && url === "/health") {
			writeJson(response, 200, {
				ok: true,
				project: PROJECT_NAME,
				runningMatch: simulation !== null,
				setup
			});
			return;
		}

		if (method === "GET" && url === "/api/snapshot") {
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

		if (method === "POST" && url === "/api/start") {
			const body = await readJsonBody(request);
			const nextSetup = normalizeSetup(body);
			simulation = createMatch(nextSetup);
			setup = nextSetup;
			writeJson(response, 200, {
				ok: true,
				setup,
				snapshot: simulation.getSnapshot()
			});
			return;
		}

		if (method === "POST" && url === "/api/command") {
			const activeSimulation = requireSimulation(response);
			if (!activeSimulation) {
				return;
			}

			const body = await readJsonBody(request);
			const command = parseCommand(body);
			const result = activeSimulation.applyCommand(command);
			writeJson(response, 200, {
				ok: true,
				result,
				snapshot: activeSimulation.getSnapshot()
			});
			return;
		}

		if (method === "POST" && url === "/api/advance-many") {
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
				const result = activeSimulation.applyCommand({ type: "advance-wave" });
				if (!result.accepted) {
					stoppedReason = result.reason ?? "rejected";
					break;
				}
				acceptedTicks += 1;

				const snapshot = activeSimulation.getSnapshot();
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
			console.log(`[${PROJECT_NAME}] local game host running at http://localhost:${port}`);
		});
	})
	.catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[${PROJECT_NAME}] failed to start local game host: ${message}`);
		process.exit(1);
	});
