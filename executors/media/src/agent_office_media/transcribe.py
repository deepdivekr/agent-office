"""Speech to text with faster-whisper: the media is split into three-minute pieces that are read in parallel, and the
words are grouped into short timed cues fit for subtitles."""
from __future__ import annotations

import os
import shutil
import subprocess
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import timestamps

CHUNK_SECONDS = 180.0


@dataclass(frozen=True)
class Transcript:
    language: str
    language_probability: float
    cues: list[tuple[float, float, str]]

    @property
    def text(self) -> str:
        return "\n".join(f"[{timestamps.short(start)}] {text}" for start, _end, text in self.cues)

    @property
    def timed_text(self) -> str:
        return "\n".join(f"[{timestamps.precise(start)} --> {timestamps.precise(end)}] {text}" for start, end, text in self.cues)


def split_words_into_cues(words: list[Any], offset_seconds: float) -> list[tuple[float, float, str]]:
    """A cue closes at 4.5 s, 54 characters, or punctuation after 1.2 s; a very short cue joins the one before it."""
    cues: list[tuple[float, float, str]] = []
    current: list[Any] = []
    for word in words:
        if getattr(word, "start", None) is None or getattr(word, "end", None) is None:
            continue
        current.append(word)
        text = "".join(str(item.word or "") for item in current).strip()
        duration = float(current[-1].end) - float(current[0].start)
        if duration >= 4.5 or len(text) >= 54 or (text.endswith((".", "?", "!", ",", ";", ":")) and duration >= 1.2):
            cues.append((offset_seconds + float(current[0].start), offset_seconds + float(current[-1].end), text))
            current = []
    if current:
        text = "".join(str(item.word or "") for item in current).strip()
        if text:
            cues.append((offset_seconds + float(current[0].start), offset_seconds + float(current[-1].end), text))
    merged: list[tuple[float, float, str]] = []
    for start, end, text in cues:
        if merged and end - start < 0.85 and start - merged[-1][1] <= 0.6 and end - merged[-1][0] <= 5.5:
            merged[-1] = (merged[-1][0], end, f"{merged[-1][2]} {text}")
        else:
            merged.append((start, end, text))
    return merged


def _chunk(job: tuple[str, str, str, str, float, int, bool]) -> tuple[str, float, list[tuple[float, float, str]]]:
    model_name, device, compute_type, audio_path, offset, beam_size, vad_filter = job
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=compute_type, cpu_threads=2 if device == "cpu" else 0)
    segments, info = model.transcribe(
        audio_path,
        beam_size=beam_size,
        vad_filter=vad_filter,
        vad_parameters={"min_silence_duration_ms": 500} if vad_filter else None,
        condition_on_previous_text=True,
        word_timestamps=True,
    )
    cues: list[tuple[float, float, str]] = []
    for segment in segments:
        split = split_words_into_cues(list(segment.words or []), offset)
        if split:
            cues.extend(split)
        elif segment.text.strip():
            cues.append((offset + segment.start, offset + segment.end, segment.text.strip()))
    return info.language, float(info.language_probability), cues


def transcribe(media: Path, work_dir: Path, model: str = "small", device: str = "cpu", compute_type: str = "int8", beam_size: int = 5, vad_filter: bool = False) -> Transcript:
    chunk_dir = work_dir / "transcribe-chunks"
    shutil.rmtree(chunk_dir, ignore_errors=True)
    chunk_dir.mkdir(parents=True)
    try:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(media), "-vn", "-ac", "1", "-ar", "16000",
             "-f", "segment", "-segment_time", str(int(CHUNK_SECONDS)), "-reset_timestamps", "1", str(chunk_dir / "chunk-%03d.wav")],
            check=True,
        )
        chunks = sorted(chunk_dir.glob("chunk-*.wav"))
        if not chunks:
            raise RuntimeError("NO_AUDIO")
        jobs = [(model, device, compute_type, str(chunk), index * CHUNK_SECONDS, beam_size, vad_filter) for index, chunk in enumerate(chunks)]
        workers = min(4, len(jobs), max(1, (os.cpu_count() or 2) // 2))
        if workers == 1:
            results = [_chunk(jobs[0])] if len(jobs) == 1 else [_chunk(job) for job in jobs]
        else:
            with ProcessPoolExecutor(max_workers=workers) as pool:
                results = list(pool.map(_chunk, jobs))
        language = Counter(result[0] for result in results).most_common(1)[0][0]
        probabilities = [result[1] for result in results if result[0] == language]
        return Transcript(language, sum(probabilities) / len(probabilities), [cue for result in results for cue in result[2]])
    finally:
        shutil.rmtree(chunk_dir, ignore_errors=True)
