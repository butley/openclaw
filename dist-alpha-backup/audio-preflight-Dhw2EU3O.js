import "./query-expansion-C3Ync4Cm.js";
import "./paths-BwJ6yG6k.js";
import { i as logVerbose, s as shouldLogVerbose } from "./globals-zsOvxm3k.js";
import "./subsystem-C0UNPQiX.js";
import "./workspace-Btxyh5AG.js";
import "./utils-DY-S31jy.js";
import "./logger-hWznDPaF.js";
import { Bn as runAudioTranscription, Jn as isAudioAttachment, Un as normalizeMediaAttachments, Wn as resolveMediaAttachmentLocalRoots } from "./model-selection-CEVVlPA7.js";
import "./github-copilot-token-fLUlkgux.js";
import "./boolean-CG2O0e_b.js";
import "./fetch-D9ZABJCa.js";
import "./frontmatter-Dg8PE16Q.js";
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
