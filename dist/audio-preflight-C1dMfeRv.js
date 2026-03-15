import "./query-expansion-DZdtzgla.js";
import "./paths-hfkBoC7i.js";
import { i as logVerbose, s as shouldLogVerbose } from "./globals-BMLYkE4T.js";
import "./subsystem-Dy0aoyS3.js";
import "./workspace-Z2QFJOOW.js";
import "./utils-CLXmcP40.js";
import "./logger-CBy2_Mu6.js";
import { Gn as resolveMediaAttachmentLocalRoots, Vn as runAudioTranscription, Wn as normalizeMediaAttachments, Yn as isAudioAttachment } from "./model-selection-DsW67hhn.js";
import "./github-copilot-token-HL6iN7ka.js";
import "./boolean-CG2O0e_b.js";
import "./fetch-Cq9Sb8ot.js";
import "./frontmatter-nVsmL5Kc.js";
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
