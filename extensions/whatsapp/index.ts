import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { whatsappPlugin } from "./src/channel.js";
import { getWhatsAppRuntime, setWhatsAppRuntime } from "./src/runtime.js";

const plugin = {
  id: "whatsapp",
  name: "WhatsApp",
  description: "WhatsApp channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWhatsAppRuntime(api.runtime);
    api.registerChannel({ plugin: whatsappPlugin });
    // Ensure whatsapp_login is HTTP-callable via /tools/invoke.
    // Some builds expose it natively; others still require plugin registration.
    // If it's already present, ignore duplicate-name errors safely.
    try {
      api.registerTool((_ctx) => {
        try {
          return getWhatsAppRuntime().channel.whatsapp.createLoginTool();
        } catch {
          return null;
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("unique")) {
        throw error;
      }
    }
  },
};

export default plugin;
