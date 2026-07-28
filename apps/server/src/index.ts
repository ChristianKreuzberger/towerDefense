import { LocalTransportAdapter } from "@tower-defense/transport";

const transport = new LocalTransportAdapter();
const bootstrap = transport.connect();

console.log("Server bootstrap ready:", bootstrap);
