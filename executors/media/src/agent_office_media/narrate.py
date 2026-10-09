"""Narration: text read aloud by an online voice (edge-tts), in pieces joined into one MP3."""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path


def split_text(text: str, limit: int = 3_500) -> list[str]:
    """Paragraphs packed up to LIMIT characters; a longer paragraph breaks at a sentence end."""
    chunks: list[str] = []
    current = ""
    for paragraph in (p.strip() for p in text.splitlines() if p.strip()):
        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        while len(paragraph) > limit:
            cut = paragraph.rfind(". ", 0, limit)
            cut = limit if cut < limit // 2 else cut + 1
            chunks.append(paragraph[:cut].strip())
            paragraph = paragraph[cut:].strip()
        current = paragraph
    if current:
        chunks.append(current)
    return chunks


def narrate(text: str, output: Path, voice: str = "ko-KR-SunHiNeural", rate: str = "-3%") -> Path:
    return asyncio.run(_narrate(text, output, voice, rate))


async def _narrate(text: str, output: Path, voice: str, rate: str) -> Path:
    import edge_tts

    output.parent.mkdir(parents=True, exist_ok=True)
    parts_dir = output.parent / f"{output.stem}-parts"
    shutil.rmtree(parts_dir, ignore_errors=True)
    parts_dir.mkdir(parents=True)
    try:
        parts: list[Path] = []
        for index, chunk in enumerate(split_text(text), start=1):
            part = parts_dir / f"part-{index:03d}.mp3"
            await edge_tts.Communicate(chunk, voice, rate=rate, volume="+0%", pitch="+0Hz").save(str(part))
            if not part.exists() or part.stat().st_size == 0:
                raise RuntimeError(f"EMPTY_PART_{index}")
            parts.append(part)
        if not parts:
            raise RuntimeError("NO_TEXT")
        if len(parts) == 1:
            shutil.copy2(parts[0], output)
        else:
            listing = parts_dir / "concat.txt"
            listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(output)], check=True)
        return output
    finally:
        shutil.rmtree(parts_dir, ignore_errors=True)
