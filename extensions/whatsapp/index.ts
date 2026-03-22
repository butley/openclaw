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
    // [FORK-PATCH-12] WA Login Tool Dedup — whatsapp_login is provided by core OpenClaw.
  },
};

export default plugin;
