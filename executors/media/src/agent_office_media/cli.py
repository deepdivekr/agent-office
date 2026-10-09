"""agent-office-media: one command per step, files in and files out, one JSON line on stdout.

  agent-office-media probe
  agent-office-media transcribe MEDIA --out DIR [--model small] [--device cpu]
  agent-office-media subtitle VIDEO --cues TIMED.txt --out OUTPUT.mp4 [--delay SECONDS]
  agent-office-media narrate TEXT.txt --out OUTPUT.mp3 [--voice ko-KR-SunHiNeural]

Translation and summaries are the AI app's part: it reads transcript.timed.txt, writes the translated cue lines and
passes them to subtitle. Getting the media is the Work's part too; this executor only reads files it is given.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from pathlib import Path

from . import __version__


def _emit(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")


def probe() -> dict:
    return {"ok": True, "version": __version__,
            "ffmpeg": bool(shutil.which("ffmpeg")), "ffprobe": bool(shutil.which("ffprobe")),
            "transcribe": importlib.util.find_spec("faster_whisper") is not None,
            "narrate": importlib.util.find_spec("edge_tts") is not None}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agent-office-media")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("probe")
    t = sub.add_parser("transcribe")
    t.add_argument("media", type=Path)
    t.add_argument("--out", type=Path, required=True)
    t.add_argument("--model", default="small")
    t.add_argument("--device", default="cpu")
    t.add_argument("--compute-type", default="int8")
    t.add_argument("--vad", action="store_true")
    s = sub.add_parser("subtitle")
    s.add_argument("video", type=Path)
    s.add_argument("--cues", type=Path, required=True)
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--delay", type=float)
    n = sub.add_parser("narrate")
    n.add_argument("text", type=Path)
    n.add_argument("--out", type=Path, required=True)
    n.add_argument("--voice", default="ko-KR-SunHiNeural")
    args = parser.parse_args(argv)
    try:
        if args.command == "probe":
            _emit(probe())
            return 0
        if args.command == "transcribe":
            from .transcribe import transcribe
            if not args.media.is_file():
                raise FileNotFoundError("MEDIA_NOT_FOUND")
            args.out.mkdir(parents=True, exist_ok=True)
            result = transcribe(args.media, args.out, model=args.model, device=args.device, compute_type=args.compute_type, vad_filter=args.vad)
            text, timed = args.out / "transcript.txt", args.out / "transcript.timed.txt"
            text.write_text(result.text + "\n", encoding="utf-8")
            timed.write_text(result.timed_text + "\n", encoding="utf-8")
            _emit({"ok": True, "language": result.language, "language_probability": round(result.language_probability, 3), "cues": len(result.cues),
                   "outputs": [{"kind": "text", "path": str(text)}, {"kind": "timed_text", "path": str(timed)}]})
            return 0
        if args.command == "subtitle":
            from .subtitles import burn
            if not args.video.is_file():
                raise FileNotFoundError("VIDEO_NOT_FOUND")
            video, srt, delay = burn(args.video, args.cues.read_text(encoding="utf-8"), args.out, delay=args.delay)
            _emit({"ok": True, "delay_seconds": delay, "outputs": [{"kind": "video", "path": str(video)}, {"kind": "subtitles", "path": str(srt)}]})
            return 0
        if args.command == "narrate":
            from .narrate import narrate
            audio = narrate(args.text.read_text(encoding="utf-8"), args.out, voice=args.voice)
            _emit({"ok": True, "outputs": [{"kind": "audio", "path": str(audio)}]})
            return 0
    except ModuleNotFoundError as error:
        _emit({"ok": False, "error": "DEPENDENCY_MISSING", "detail": error.name})
        return 3
    except Exception as error:  # noqa: BLE001 - one JSON line for the caller, whatever failed
        _emit({"ok": False, "error": type(error).__name__, "detail": str(error)[:500]})
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
