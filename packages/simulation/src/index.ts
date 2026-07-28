import { PROJECT_NAME } from "@tower-defense/shared";

export * from "./match-simulation.js";

export interface SimulationBootstrap {
  hostMode: "local";
  project: string;
}

export function createSimulationBootstrap(): SimulationBootstrap {
  return {
    hostMode: "local",
    project: PROJECT_NAME
  };
}
