import "./paths-BJV7vkaX.js";
import { a as logVerbose, c as shouldLogVerbose } from "./globals-BM8hKFm0.js";
import "./utils-DPPFsC2y.js";
import { cf as resolveMediaAttachmentLocalRoots, if as runAudioTranscription, sf as normalizeMediaAttachments, vf as isAudioAttachment } from "./reply-CwTwC1oS.js";
import "./agent-scope-bBcv3AIJ.js";
import "./subsystem-BvX9dUUv.js";
import "./openclaw-root-DrFjwUcG.js";
import "./logger-DCuywXMd.js";
import "./exec-TuwQr-2y.js";
import "./github-copilot-token-D37fjdwy.js";
import "./boolean-CJxfhBkG.js";
import "./env-CxRUQUsA.js";
import "./env-overrides-CyhGSMpJ.js";
import "./registry-B62TT8EF.js";
import "./skills-DlDmGWv1.js";
import "./frontmatter-7FVJq8_7.js";
import "./plugins-DcM3N09V.js";
import "./query-expansion-CHR_rUXw.js";
import "./redact-B6xsEMyG.js";
import "./path-alias-guards-CdGRC4Iy.js";
import "./fetch-DDFoAqMq.js";
import "./cli-utils-bDNIASFn.js";
import "./delivery-queue-BoVxHNnx.js";
import "./paths-i-OZT6Ed.js";
import "./session-cost-usage-BXfE6h21.js";
import "./prompt-style-RdMoUk0e.js";
import "./links-CLy2YkK3.js";
//#region src/media-understanding/audio-preflight.ts
/**
* Transcribes the first audio attachment BEFORE mention checking.
* This allows voice notes to be processed in group chats with requireMention: true.
* Returns the transcript or undefined if transcription fails or no audio is found.
*/
async function transcribeFirstAudio(params) {
	const { ctx, cfg } = params;
	const audioConfig = cfg.tools?.media?.audio;
	if (!audioConfig || audioConfig.enabled === false) return;
	const attachments = normalizeMediaAttachments(ctx);
	if (!attachments || attachments.length === 0) return;
	const firstAudio = attachments.find((att) => att && isAudioAttachment(att) && !att.alreadyTranscribed);
	if (!firstAudio) return;
	if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribing attachment ${firstAudio.index} for mention check`);
	try {
		const { transcript } = await runAudioTranscription({
			ctx,
			cfg,
			attachments,
			agentDir: params.agentDir,
			providers: params.providers,
			activeModel: params.activeModel,
			localPathRoots: resolveMediaAttachmentLocalRoots({
				cfg,
				ctx
			})
		});
		if (!transcript) return;
		firstAudio.alreadyTranscribed = true;
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribed ${transcript.length} chars from attachment ${firstAudio.index}`);
		return transcript;
	} catch (err) {
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcription failed: ${String(err)}`);
		return;
	}
}
//#endregion
export { transcribeFirstAudio };
