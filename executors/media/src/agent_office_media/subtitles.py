"""Burns timed text into a video: cue lines like "[00:00:01.200 --> 00:00:03.400] text" become an SRT that ffmpeg
draws onto the picture, nudged so the words appear as the speech starts."""
from __future__ import annotations

import json
import re
import statistics
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import timestamps

TIME_TOKEN = r"(?:\d{2}:)?\d{2}:\d{2}(?:\.\d{3})?"
TIMED_LINE = re.compile(rf"^\[({TIME_TOKEN})(?:\s*-->\s*({TIME_TOKEN}))?\]\s*(.+)$")
STYLE = (
    "FontName=Noto Sans CJK KR,FontSize=26,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
    "BackColour=&HFF000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginL=48,MarginR=48,MarginV=54"
)


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def build_cues(timed_text: str, duration: float | None = None) -> list[Cue]:
    """A line with only a start ends by its length (2-7 s) or just before the next line."""
    entries: list[tuple[float, float | None, str]] = []
    for raw in timed_text.splitlines():
        match = TIMED_LINE.match(raw.strip())
        if match:
            entries.append((timestamps.parse(match.group(1)), timestamps.parse(match.group(2)) if match.group(2) else None, match.group(3).strip()))
    if not entries:
        raise ValueError("NO_TIMED_LINES")
    cues: list[Cue] = []
    for index, (start, explicit_end, text) in enumerate(entries):
        if explicit_end is not None:
            cues.append(Cue(start, max(start + 0.25, explicit_end), text))
            continue
        natural = start + max(2.0, min(7.0, len(text) * 0.18))
        if index + 1 < len(entries):
            end = min(natural, max(start + 0.5, entries[index + 1][0] - 0.08))
        elif duration is not None:
            end = min(natural, max(start + 0.5, duration))
        else:
            end = natural
        cues.append(Cue(start, end, text))
    return cues


def wrap(text: str, width: int = 27) -> str:
    """Two balanced lines when one is too long."""
    words = text.split()
    if len(words) < 2 or sum(len(word) for word in words) + len(words) - 1 <= width:
        return text
    best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
    return " ".join(words[:best]) + "\n" + " ".join(words[best:])


def write_srt(cues: list[Cue], path: Path) -> Path:
    path.write_text(
        "\n\n".join(f"{i}\n{timestamps.srt(c.start)} --> {timestamps.srt(c.end)}\n{wrap(c.text)}" for i, c in enumerate(cues, start=1)) + "\n",
        encoding="utf-8",
    )
    return path


def shift(cues: list[Cue], delay: float) -> list[Cue]:
    moved = [Cue(max(0, c.start + delay), max(0.25, c.end + delay), c.text) for c in cues]
    return [Cue(c.start, min(c.end, moved[i + 1].start - 0.04) if i + 1 < len(moved) else c.end, c.text) for i, c in enumerate(moved)]


def _stream_correction(video: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "json", str(video)],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)
    starts = {s.get("codec_type"): float(s.get("start_time") or 0) for s in json.loads(out.stdout).get("streams", [])}
    return starts.get("audio", 0.0) - starts.get("video", 0.0)


def _silence_ends(video: Path) -> list[float]:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vn", "-af", "silencedetect=noise=-32dB:d=0.20", "-f", "null", "-"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    return [float(v) for v in re.findall(r"silence_end:\s*([0-9.]+)", out.stderr)]


def estimate_delay(video: Path, cues: list[Cue]) -> float:
    """Where speech resumes after silence, compared with the cues that start a phrase; kept between 0.10 and 0.45 s."""
    onsets = [c for i, c in enumerate(cues) if i == 0 or c.start - cues[i - 1].end >= 0.25]
    offsets: list[float] = []
    for end in _silence_ends(video):
        nearest = min(onsets, key=lambda c: abs(c.start - end), default=None)
        if nearest is not None and abs(nearest.start - end) <= 0.45:
            offsets.append(end - nearest.start)
    acoustic = statistics.median(offsets) if len(offsets) >= 3 else 0.05
    return round(min(0.45, max(0.10, 0.20 + acoustic + _stream_correction(video))), 3)


def burn(video: Path, timed_text: str, output: Path, duration: float | None = None, delay: float | None = None,
         progress: Callable[[int], None] | None = None) -> tuple[Path, Path, float]:
    """Writes OUTPUT (H.264/AAC, fast start) and OUTPUT.srt; returns them with the delay applied."""
    output.parent.mkdir(parents=True, exist_ok=True)
    cues = build_cues(timed_text, duration)
    applied = estimate_delay(video, cues) if delay is None else max(-1.0, min(2.0, delay))
    srt_path = write_srt(shift(cues, applied), output.with_suffix(".srt"))
    temporary = output.with_suffix(".tmp.mp4")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-y", "-i", str(video.resolve()),
               "-vf", f"subtitles={srt_path.name}:force_style='{STYLE}'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
               "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", temporary.name]
    try:
        process = subprocess.Popen(command, cwd=output.parent, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
        total, report = duration or cues[-1].end, 25
        assert process.stdout is not None
        for line in process.stdout:
            key, sep, value = line.strip().partition("=")
            if not sep or key not in {"out_time_us", "out_time_ms"}:
                continue
            try:
                percent = min(100, int(float(value) / 1_000_000 / total * 100))
            except (ValueError, ZeroDivisionError):
                continue
            if progress and percent >= report:
                progress(report)
                report += 25
        if process.wait() != 0:
            error = process.stderr.read().strip() if process.stderr else ""
            raise RuntimeError(f"ENCODE_FAILED: {error[-500:]}")
        if temporary.stat().st_size < 1_024:
            raise RuntimeError("ENCODE_EMPTY")
        temporary.replace(output)
        return output, srt_path, applied
    finally:
        temporary.unlink(missing_ok=True)
