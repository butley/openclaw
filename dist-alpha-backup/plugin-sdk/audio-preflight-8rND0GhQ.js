import "./channel-config-helpers-DXyHWBVJ.js";
import { Ti as resolveMediaAttachmentLocalRoots, ji as isAudioAttachment, wi as normalizeMediaAttachments, xi as runAudioTranscription } from "./thread-bindings-0Uc4GeBT.js";
import "./paths-WR8OhEmw.js";
import "./github-copilot-token-BGYH4ltJ.js";
import "./logger-C9fkmDdb.js";
import "./tmp-openclaw-dir-DRPiOszV.js";
import { i as logVerbose, s as shouldLogVerbose } from "./globals-DMfGJ_36.js";
import "./utils-DfdxfpoM.js";
import "./subsystem-CfLo2GBS.js";
import "./fetch-DftkrN27.js";
import "./exec-Btxwbj1p.js";
import "./thinking-CSUA5PYQ.js";
import "./query-expansion-s2jldUV4.js";
import "./logger-BYeF241k.js";
import "./zod-schema.core-De203jOD.js";
import "./redact-BuzJ8kUo.js";
import "./http-registry-BsB8N5w2.js";
import "./pairing-token-DX0HaDzb.js";
import "./ssrf--5Fh_apX.js";
import "./fetch-guard-B43Ufsg7.js";
import "./registry-SHl7cuYc.js";
import "./http-body-Cgn9Rlev.js";
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
