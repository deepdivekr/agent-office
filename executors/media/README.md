# Agent Office media executor

Optional. Lets a Work's AI app turn video and audio files into transcripts, subtitled video and narration on the
computer that runs the Work. The results land in the Work folder, and the Office feed plays them.

| Command | Does | Needs |
|---|---|---|
| `agent-office-media probe` | Says which steps are installed | — |
| `agent-office-media transcribe MEDIA --out DIR` | `transcript.txt` and `transcript.timed.txt` (timed cue lines) | ffmpeg, `whisper` extra |
| `agent-office-media subtitle VIDEO --cues TIMED.txt --out OUT.mp4` | Burns timed cue lines into the video (H.264/AAC) and writes `OUT.srt` | ffmpeg, ffprobe |
| `agent-office-media narrate TEXT.txt --out OUT.mp3` | Reads the text aloud | ffmpeg, `tts` extra |

Each prints one JSON line (`{"ok":true,"outputs":[{"kind":"video","path":"…"}]}` or `{"ok":false,"error":"…"}`).
Translation and summaries are the AI app's part: it reads `transcript.timed.txt` and writes translated cue lines
in the same form (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] text`) for `subtitle`.

The executor reads only the files it is given. Getting the media is up to the Work and the owner: use files you have
the right to process.

## Install

```bash
sudo apt install ffmpeg          # or your system's package
pipx install "$HOME/.local/share/agent-office/executors/media[whisper,tts]"
agent-office-media probe
```

When `agent-office-media` is on the PATH of the computer that runs a Work, Office tells the Work's AI app how to use it.

- `whisper` installs [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT); it downloads its model on first use.
- `tts` installs [edge-tts](https://github.com/rany2/edge-tts) (LGPL-3.0), which uses Microsoft Edge's online voices
  through an unofficial endpoint that may change.
