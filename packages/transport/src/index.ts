import { createSimulationBootstrap, type SimulationBootstrap } from "@tower-defense/simulation";

export interface TransportAdapter {
  readonly mode: "local";
  connect(): SimulationBootstrap;
}

export class LocalTransportAdapter implements TransportAdapter {
  public readonly mode = "local" as const;

  public connect(): SimulationBootstrap {
    return createSimulationBootstrap();
  }
}
