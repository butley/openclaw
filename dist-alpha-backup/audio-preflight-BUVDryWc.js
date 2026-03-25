import "./paths-tuenh9TL.js";
import { a as logVerbose, c as shouldLogVerbose } from "./globals-cEUy0WVg.js";
import "./theme-CipOb_We.js";
import "./utils-B1xPTYn-.js";
import { $d as normalizeMediaAttachments, Xd as runAudioTranscription, ef as resolveMediaAttachmentLocalRoots, uf as isAudioAttachment } from "./reply-BRIrPGWy.js";
import "./agent-scope-D85sFDRQ.js";
import "./subsystem-Du2dCfuD.js";
import "./openclaw-root-B76Z4doY.js";
import "./logger-CTiHjjqB.js";
import "./exec-C6U2qsJQ.js";
import "./github-copilot-token-deWTDWZu.js";
import "./boolean-D8Ha5nYV.js";
import "./env-DWcyui2j.js";
import "./env-overrides-B59mbP3-.js";
import "./registry-3SOFgkh6.js";
import "./skills-CObtH1pm.js";
import "./frontmatter-D-zbDLA0.js";
import "./plugins-B3EU9SbO.js";
import "./query-expansion-D7MNjl_J.js";
import "./redact-BnV2ewAv.js";
import "./path-alias-guards-CGklijb0.js";
import "./fetch-Dp4lHtjH.js";
import "./errors-BVotJzwa.js";
import "./cmd-argv-BjL6p-dP.js";
import "./delivery-queue-CYy8h7nH.js";
import "./paths-B4q5wccl.js";
import "./session-cost-usage-DTqf62Zp.js";
import "./prompt-style-BJRiCD0E.js";
import "./links-TpjR6UKS.js";
import "./cli-utils-Bal-Phw0.js";
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
