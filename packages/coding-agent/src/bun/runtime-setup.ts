import { bedrockProviderModule } from "@hhamud/pi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@hhamud/pi-ai/bun-oauth";
import { setBedrockProviderModule } from "@hhamud/pi-ai/compat";
import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
