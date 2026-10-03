// ?debug=1 "Demo combat": synthetic creatures and events fed straight to the board so creature and effect
// visuals can be exercised without the simulation (which rarely keeps creatures alive on noise maps).
import { CREATURE_ARCHETYPE_STATS, getCreatureAttackDamage, getCreatureRewardPoints } from "@tower-defense/shared";
const ARCHETYPES = ["runner", "swarm", "armored", "tank"];
const TOTAL_CREATURES = 28;
const SPAWN_EVERY_TICKS = 2;
// Shortest walkable (buildable) route from the left edge to the right edge; falls back to a straight row.
export function findLane(map) {
    const byKey = new Map();
    for (const cell of map.cells) {
        byKey.set(`${cell.x},${cell.y}`, cell);
    }
    const parent = new Map();
    const queue = [];
    // Demo creatures enter through the monster cave, like real ones.
    const y0 = map.spawn?.y ?? Math.floor(map.height / 3);
    for (let offset = 0; offset < map.height; offset += 1) {
        const y = (y0 + offset) % map.height;
        if (byKey.get(`0,${y}`)?.buildable === true) {
            parent.set(`0,${y}`, null);
            queue.push({ x: 0, y });
            break;
        }
    }
    for (let i = 0; i < queue.length; i += 1) {
        const cur = queue[i];
        if (!cur) {
            continue;
        }
        if (cur.x === map.width - 1) {
            const out = [];
            let key = `${cur.x},${cur.y}`;
            while (key) {
                const [x, y] = key.split(",").map(Number);
                out.push({ x: x ?? 0, y: y ?? 0 });
                key = parent.get(key);
            }
            return out.reverse();
        }
        for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            const key = `${nx},${ny}`;
            if (parent.has(key) || byKey.get(key)?.buildable !== true) {
                continue;
            }
            parent.set(key, `${cur.x},${cur.y}`);
            queue.push({ x: nx, y: ny });
        }
    }
    return Array.from({ length: map.width }, (_, x) => ({ x, y: y0 }));
}
export function createDemo(deps) {
    let timer = null;
    function start() {
        const live = deps.current();
        if (!live || live.towers.length === 0) {
            return false;
        }
        // Showcase upgrade art: each later tower is one style tier higher (presentation only).
        const base = { ...live, towers: live.towers.map((tower, index) => ({ ...tower, level: Math.min(13, tower.level + index * 3), upgrades: { range: 1 + index, damage: 1 + index * 2, accuracy: 1 } })) };
        stop();
        const path = findLane(base.map);
        const creatures = [];
        const towerHealth = new Map(base.towers.map((tower) => [tower.id, tower.health]));
        const points = new Map(base.players.map((player) => [player.id, player.points]));
        let tick = 0;
        let spawned = 0;
        const step = () => {
            tick += 1;
            const events = [];
            const wave = 1;
            if (tick === 1) {
                events.push({ type: "wave-start", wave, tick });
            }
            if (spawned < TOTAL_CREATURES && (tick - 1) % SPAWN_EVERY_TICKS === 0) {
                const archetype = ARCHETYPES[spawned % ARCHETYPES.length] ?? "runner";
                creatures.push({ id: `demo-${spawned}`, archetype, hp: CREATURE_ARCHETYPE_STATS[archetype].hp, index: 0, spawnTick: tick });
                spawned += 1;
            }
            for (const creature of creatures) {
                // Tanks lumber: they advance every other tick.
                if (creature.archetype !== "tank" || tick % 2 === 0) {
                    creature.index += 1;
                }
            }
            const ordered = [...creatures].sort((a, b) => b.index - a.index);
            const assignments = base.towers.map((tower) => ({
                towerId: tower.id,
                mode: tower.targetMode,
                targetCreatureId: ordered[0]?.id ?? null
            }));
            for (const [towerIndex, tower] of base.towers.entries()) {
                // Demo-only pacing: towers fire every other tick at creatures within 12 cells, so creatures stay visible.
                if ((tick + towerIndex) % 2 !== 0) {
                    continue;
                }
                const target = ordered.find((creature) => {
                    const cell = path[Math.min(creature.index, path.length - 1)];
                    return creature.hp > 0 && Math.abs(tower.x - (cell?.x ?? 0)) + Math.abs(tower.y - (cell?.y ?? 0)) <= 12;
                });
                if (!target) {
                    continue;
                }
                const damage = Math.max(1, tower.upgrades.damage);
                target.hp -= damage;
                const targetCell = path[Math.min(target.index, path.length - 1)];
                const x = targetCell?.x ?? 0;
                const y = targetCell?.y ?? 0;
                events.push({ type: "tower-hit", wave, tick, towerId: tower.id, playerId: tower.playerId, creatureId: target.id, x, y, damage, damageType: tower.damageType, remainingHp: Math.max(0, target.hp) });
                if (target.hp <= 0) {
                    const rewardPoints = getCreatureRewardPoints(target.archetype);
                    points.set(tower.playerId, (points.get(tower.playerId) ?? 0) + rewardPoints);
                    events.push({ type: "creature-defeated", wave, tick, towerId: tower.id, playerId: tower.playerId, creatureId: target.id, x, y, rewardPoints });
                }
            }
            for (let i = creatures.length - 1; i >= 0; i -= 1) {
                const creature = creatures[i];
                if (creature && (creature.hp <= 0 || creature.index >= path.length - 1)) {
                    creatures.splice(i, 1);
                }
            }
            if (tick % 3 === 0) {
                for (const creature of creatures) {
                    const cell = path[Math.min(creature.index, path.length - 1)];
                    const tower = base.towers.find((entry) => Math.abs(entry.x - (cell?.x ?? 0)) + Math.abs(entry.y - (cell?.y ?? 0)) <= 5);
                    if (!tower) {
                        continue;
                    }
                    const damage = getCreatureAttackDamage(creature.archetype);
                    const remaining = Math.max(10, (towerHealth.get(tower.id) ?? tower.health) - damage);
                    towerHealth.set(tower.id, remaining);
                    events.push({ type: "creature-attack", wave, tick, creatureId: creature.id, targetTowerId: tower.id, damage, remainingHp: remaining });
                    break;
                }
            }
            const finished = spawned >= TOTAL_CREATURES && creatures.length === 0;
            const liveCreatures = creatures.map((creature) => {
                const cell = path[Math.min(creature.index, path.length - 1)] ?? { x: 0, y: 0 };
                return {
                    id: creature.id,
                    archetype: creature.archetype,
                    hp: creature.hp,
                    x: cell.x,
                    y: cell.y,
                    pathIndex: creature.index,
                    pathProgressUnits: 0,
                    spawnTick: creature.spawnTick,
                    targetTowerId: base.towers[0]?.id ?? "",
                    lane: Number(creature.id.split("-")[1]) % 2
                };
            });
            const falling = finished ? base.towers[base.towers.length - 1] : undefined;
            if (falling && base.towers.length > 1) {
                events.push({ type: "tower-destroyed", wave, tick, towerId: falling.id, playerId: falling.playerId, destroyedByCreatureId: "demo-0" });
            }
            if (finished) {
                events.push({ type: "wave-end", wave, tick });
                events.push({ type: "wave-clear-bonus", wave, tick, playerId: base.players[0]?.id ?? "p1", bonus: 15, cleared: true });
            }
            const snapshot = {
                ...base,
                phase: finished ? "placement" : "wave",
                wave: finished ? 2 : wave,
                waveTick: tick,
                creatures: liveCreatures,
                targetAssignments: assignments,
                towers: base.towers
                    .filter((tower) => !(falling && base.towers.length > 1 && tower.id === falling.id))
                    .map((tower) => ({ ...tower, health: towerHealth.get(tower.id) ?? tower.health })),
                players: base.players.map((player) => ({ ...player, points: points.get(player.id) ?? player.points, readyForWave: false })),
                events: []
            };
            deps.feed(snapshot, events, deps.tickMs());
            if (finished) {
                stop();
                deps.onFinished();
            }
        };
        timer = setInterval(step, deps.tickMs());
        step();
        return true;
    }
    function stop() {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    }
    return { start, stop, running: () => timer !== null };
}
