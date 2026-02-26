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
    // Expose whatsapp_login as an HTTP-callable gateway tool so the backend
    // orchestrator can initiate QR login via POST /tools/invoke.
    // The tool is in the default HTTP deny list; operators must add it to
    // gateway.tools.allow in openclaw.json to enable it.
    api.registerTool((_ctx) => {
      try {
        return getWhatsAppRuntime().channel.whatsapp.createLoginTool();
      } catch {
        return null;
      }
    });
  },
};

export default plugin;
