import {accessSync,constants} from 'node:fs';
import {delimiter,join} from 'node:path';

/**
 * The optional media executor (executors/media, `agent-office-media`): transcription, subtitled video and narration a
 * Work's AI app can call. Office only says it is there; it is installed by the owner where the Work runs.
 */
export function mediaExecutorPath(path=process.env.PATH??''){
  for(const dir of path.split(delimiter).filter(Boolean))for(const name of ['agent-office-media','agent-office-media.exe'])
    try{const file=join(dir,name);accessSync(file,constants.X_OK);return file;}catch{/* next */}
  return null;
}
export function mediaExecutorBrief(path=mediaExecutorPath()){
  return path?`For speech-to-text, subtitled video or narration, this computer has the Agent Office media executor (${path}): \`agent-office-media transcribe MEDIA --out DIR\` writes transcript.txt and transcript.timed.txt; translate or summarise those yourself; \`agent-office-media subtitle VIDEO --cues TIMED.txt --out OUT.mp4\` burns timed cue lines ("[HH:MM:SS.mmm --> HH:MM:SS.mmm] text") into the video; \`agent-office-media narrate TEXT.txt --out OUT.mp3\` reads text aloud; \`agent-office-media probe\` says which steps are installed. Each prints one JSON line. Save the video and audio you make in the Work folder: the feed plays them.`:null;
}
