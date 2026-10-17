import {
  CREATURE_ARCHETYPES,
  type CumulativeTelemetrySnapshot,
  type TelemetryKillsByArchetype,
  type WaveTelemetrySnapshot
} from "@tower-defense/shared";

export function createEmptyKillsByArchetype(): TelemetryKillsByArchetype {
  return Object.fromEntries(CREATURE_ARCHETYPES.map((archetype) => [archetype, 0])) as TelemetryKillsByArchetype;
}

export function createWaveTelemetrySnapshot(wave: number, tick: number): WaveTelemetrySnapshot {
  return {
    wave,
    tick,
    movementProgressUnits: 0,
    movementSteps: 0,
    creaturesSpawned: 0,
    creaturesDefeated: 0,
    creaturesExited: 0,
    killsByArchetype: createEmptyKillsByArchetype(),
    towerDamageDealt: 0,
    towerDamageIntake: 0,
    towerRepairApplied: 0,
    waveClearBonusAwarded: 0,
    catchUpBonusAwarded: 0,
    swarmIncomeCapped: 0
  };
}

export function cloneWaveTelemetrySnapshot(snapshot: WaveTelemetrySnapshot): WaveTelemetrySnapshot {
  return {
    ...snapshot,
    killsByArchetype: { ...snapshot.killsByArchetype }
  };
}

export function createEmptyCumulativeTelemetrySnapshot(): CumulativeTelemetrySnapshot {
  return {
    completedWaveCount: 0,
    movementProgressUnits: 0,
    movementSteps: 0,
    creaturesSpawned: 0,
    creaturesDefeated: 0,
    creaturesExited: 0,
    killsByArchetype: createEmptyKillsByArchetype(),
    towerDamageDealt: 0,
    towerDamageIntake: 0,
    towerRepairApplied: 0,
    waveClearBonusAwarded: 0,
    catchUpBonusAwarded: 0,
    swarmIncomeCapped: 0
  };
}

export function accumulateWaveTelemetry(
  target: CumulativeTelemetrySnapshot,
  waveTelemetry: WaveTelemetrySnapshot
): void {
  target.completedWaveCount += 1;
  target.movementProgressUnits += waveTelemetry.movementProgressUnits;
  target.movementSteps += waveTelemetry.movementSteps;
  target.creaturesSpawned += waveTelemetry.creaturesSpawned;
  target.creaturesDefeated += waveTelemetry.creaturesDefeated;
  target.creaturesExited += waveTelemetry.creaturesExited;
  for (const archetype of CREATURE_ARCHETYPES) {
    target.killsByArchetype[archetype] += waveTelemetry.killsByArchetype[archetype] ?? 0;
  }
  target.towerDamageDealt += waveTelemetry.towerDamageDealt;
  target.towerDamageIntake += waveTelemetry.towerDamageIntake;
  target.towerRepairApplied += waveTelemetry.towerRepairApplied;
  target.waveClearBonusAwarded += waveTelemetry.waveClearBonusAwarded;
  target.catchUpBonusAwarded += waveTelemetry.catchUpBonusAwarded;
  target.swarmIncomeCapped += waveTelemetry.swarmIncomeCapped;
}

export function cloneCumulativeTelemetrySnapshot(snapshot: CumulativeTelemetrySnapshot): CumulativeTelemetrySnapshot {
  return {
    ...snapshot,
    killsByArchetype: { ...snapshot.killsByArchetype }
  };
}
