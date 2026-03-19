import type { OpenClawPluginApi } from "openclaw/plugin-sdk/whatsapp";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/whatsapp";
import { whatsappPlugin } from "./src/channel.js";
import { setWhatsAppRuntime } from "./src/runtime.js";

const plugin = {
  id: "whatsapp",
  name: "WhatsApp",
  description: "WhatsApp channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWhatsAppRuntime(api.runtime);
    api.registerChannel({ plugin: whatsappPlugin });
    // [FORK-PATCH-12] WA Login Tool Dedup — prevents duplicate tool registration. See patches/README.md #12.
    // whatsapp_login is provided by core tooling/runtime.
    // Do not register tool here (would duplicate names in LLM tool list).
  },
};

export default plugin;
