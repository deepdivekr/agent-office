import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent_office_media import timestamps  # noqa: E402
from agent_office_media.narrate import split_text  # noqa: E402
from agent_office_media.subtitles import Cue, build_cues, shift, wrap, write_srt  # noqa: E402
from agent_office_media.transcribe import Transcript, split_words_into_cues  # noqa: E402


def word(start, end, text):
    return SimpleNamespace(start=start, end=end, word=text)


class Pure(unittest.TestCase):
    def test_timestamps(self):
        self.assertEqual(timestamps.short(65.4), "01:05")
        self.assertEqual(timestamps.short(3725), "01:02:05")
        self.assertEqual(timestamps.precise(1.2345), "00:00:01.234")
        self.assertEqual(timestamps.srt(61.5), "00:01:01,500")
        self.assertEqual(timestamps.parse("01:02.500"), 62.5)
        self.assertEqual(timestamps.parse("01:00:02.000"), 3602.0)

    def test_words_become_short_cues(self):
        words = [word(0.0, 0.4, " Hello"), word(0.4, 1.3, " world."), word(1.4, 1.6, " Hi"), word(5.0, 9.8, " a long pause")]
        cues = split_words_into_cues(words, offset_seconds=180.0)
        self.assertEqual(cues[0], (180.0, 181.3, "Hello world."))
        self.assertTrue(all(start >= 180.0 for start, _end, _text in cues))

    def test_transcript_text_forms(self):
        t = Transcript("en", 0.9, [(1.0, 2.5, "One"), (62.0, 63.0, "Two")])
        self.assertEqual(t.text, "[00:01] One\n[01:02] Two")
        self.assertEqual(t.timed_text.splitlines()[1], "[00:01:02.000 --> 00:01:03.000] Two")

    def test_cues_from_timed_text(self):
        cues = build_cues("[00:00:01.000 --> 00:00:02.000] 하나\nnoise\n[00:03.000] 둘\n[00:03.400] 셋", duration=10)
        self.assertEqual([c.text for c in cues], ["하나", "둘", "셋"])
        self.assertEqual(cues[0].end, 2.0)
        self.assertAlmostEqual(cues[1].end, 3.5, places=2)  # at least half a second on screen
        with self.assertRaises(ValueError):
            build_cues("no timing here")

    def test_shift_keeps_cues_apart_and_srt(self):
        moved = shift([Cue(1.0, 3.0, "a"), Cue(2.9, 4.0, "b")], 0.2)
        self.assertLess(moved[0].end, moved[1].start)
        self.assertEqual(wrap("짧은 문장"), "짧은 문장")
        self.assertIn("\n", wrap("이 문장은 자막 한 줄에 다 들어가지 않을 만큼 꽤 깁니다"))
        with tempfile.TemporaryDirectory() as d:
            path = write_srt(moved, Path(d) / "x.srt")
            self.assertTrue(path.read_text(encoding="utf-8").startswith("1\n00:00:01,200 --> "))

    def test_narration_split(self):
        self.assertEqual(split_text("a\n\nb", limit=10), ["a\n\nb"])
        parts = split_text("x" * 25 + ". " + "y" * 25, limit=30)
        self.assertTrue(all(len(p) <= 30 for p in parts))
        self.assertEqual(len(parts), 2)

    def test_cli_probe_and_missing_input(self):
        env_path = str(Path(__file__).resolve().parents[1] / "src")
        run = lambda *args: subprocess.run([sys.executable, "-m", "agent_office_media", *args], capture_output=True, text=True, env={"PYTHONPATH": env_path, "PATH": "/usr/bin:/bin"})
        probe = json.loads(run("probe").stdout)
        self.assertTrue(probe["ok"])
        self.assertEqual(set(probe), {"ok", "version", "ffmpeg", "ffprobe", "transcribe", "narrate"})
        missing = run("subtitle", "/nonexistent.mp4", "--cues", "/nonexistent.txt", "--out", "/tmp/x.mp4")
        self.assertEqual(missing.returncode, 1)
        self.assertEqual(json.loads(missing.stdout)["error"], "FileNotFoundError")


if __name__ == "__main__":
    unittest.main()
