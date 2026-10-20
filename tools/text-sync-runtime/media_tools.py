import json
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Optional


class FFplayAudioPlayer:
    def __init__(self) -> None:
        self.current_path = ""
        self.length_seconds = 0.0
        self.process = None
        self.play_started_at = 0.0
        self.current_offset = 0.0
        self.ffplay_path = shutil.which("ffplay")
        self.ffprobe_path = shutil.which("ffprobe")

    def close(self) -> None:
        self.stop()
        self.length_seconds = 0.0
        self.current_path = ""

    def load(self, path: str) -> None:
        if not path:
            raise ValueError("Audio path is required")
        if not self.ffplay_path or not self.ffprobe_path:
            raise RuntimeError("ffplay/ffprobe were not found on this machine")
        if self.current_path == path and self.loaded:
            return
        self.stop()
        probe = subprocess.run(
            [
                self.ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(probe.stdout or "{}")
        self.length_seconds = float(payload.get("format", {}).get("duration", 0.0) or 0.0)
        self.current_path = path
        self.current_offset = 0.0
        self.play_started_at = 0.0

    def play(self, start_seconds: Optional[float] = None) -> None:
        if not self.loaded:
            raise RuntimeError("Audio is not loaded")
        if start_seconds is not None:
            self.current_offset = max(start_seconds, 0.0)
        elif self.process is not None and self.is_playing():
            return
        self._start_process(self.current_offset)

    def pause(self) -> None:
        if self.is_playing():
            self.current_offset = self.position_seconds()
            self._terminate_process()

    def stop(self) -> None:
        self._terminate_process()
        self.current_offset = 0.0
        self.play_started_at = 0.0

    def seek(self, seconds: float) -> None:
        if not self.loaded:
            return
        self.current_offset = max(seconds, 0.0)
        if self.is_playing():
            self._start_process(self.current_offset)

    def position_seconds(self) -> float:
        if self.is_playing():
            elapsed = max(time.monotonic() - self.play_started_at, 0.0)
            return min(self.current_offset + elapsed, self.length_seconds)
        return min(self.current_offset, self.length_seconds)

    def is_playing(self) -> bool:
        return self.process is not None and self.process.poll() is None

    @property
    def loaded(self) -> bool:
        return bool(self.current_path)

    def _start_process(self, start_seconds: float) -> None:
        self._terminate_process()
        self.current_offset = max(start_seconds, 0.0)
        self.play_started_at = time.monotonic()
        self.process = subprocess.Popen(
            [
                self.ffplay_path,
                "-nodisp",
                "-autoexit",
                "-loglevel",
                "quiet",
                "-ss",
                f"{self.current_offset:.3f}",
                self.current_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def _terminate_process(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None


class FFmpegAudioRecorder:
    def __init__(self) -> None:
        self.ffmpeg_path = shutil.which("ffmpeg")
        self.process = None
        self.output_path = ""
        self.last_error = ""

    @property
    def available(self) -> bool:
        return bool(self.ffmpeg_path)

    def probe_duration(self, path: str) -> float:
        if not self.ffmpeg_path:
            raise RuntimeError("ffmpeg was not found on this machine")
        ffprobe_path = shutil.which("ffprobe")
        if not ffprobe_path:
            raise RuntimeError("ffprobe was not found on this machine")
        probe = subprocess.run(
            [
                ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(probe.stdout or "{}")
        return float(payload.get("format", {}).get("duration", 0.0) or 0.0)

    def list_audio_devices(self) -> List[str]:
        if not self.ffmpeg_path:
            return []
        result = subprocess.run(
            [self.ffmpeg_path, "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True,
            text=True,
        )
        devices = []
        for line in (result.stdout + "\n" + result.stderr).splitlines():
            match = re.search(r'"(.+?)"\s+\(audio\)', line)
            if match:
                devices.append(match.group(1))
        if not devices:
            devices.append("default (WASAPI)")
        return devices

    def start_recording(self, device_name: str, output_path: str) -> None:
        if not self.ffmpeg_path:
            raise RuntimeError("ffmpeg was not found on this machine")
        if not device_name:
            raise ValueError("Microphone device is required")
        if self.is_recording:
            raise RuntimeError("Recording is already in progress")

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        self.output_path = output_path
        self.last_error = ""
        if device_name == "default (WASAPI)":
            command = [
                self.ffmpeg_path,
                "-y",
                "-f",
                "wasapi",
                "-i",
                "default",
                "-ac",
                "1",
                "-ar",
                "16000",
                output_path,
            ]
        else:
            command = [
                self.ffmpeg_path,
                "-y",
                "-f",
                "dshow",
                "-i",
                f"audio={device_name}",
                "-ac",
                "1",
                "-ar",
                "16000",
                output_path,
            ]

        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )

        time.sleep(0.8)
        if self.process.poll() is not None:
            stderr_text = self.process.stderr.read() if self.process.stderr else ""
            self.last_error = stderr_text.strip()
            self.process = None
            raise RuntimeError(self.last_error or "ffmpeg could not start recording from the selected microphone")

    def stop_recording(self) -> str:
        if not self.is_recording:
            return self.output_path

        try:
            if self.process.stdin:
                self.process.stdin.write("q\n")
                self.process.stdin.flush()
        except Exception:
            pass

        try:
            self.process.wait(timeout=4.0)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2.0)
        stderr_text = self.process.stderr.read() if self.process.stderr else ""
        return_code = self.process.returncode
        self.process = None

        file_exists = bool(self.output_path) and Path(self.output_path).exists()
        file_has_content = file_exists and Path(self.output_path).stat().st_size > 0

        if return_code not in (0, None) and not file_has_content:
            self.last_error = stderr_text.strip()
            raise RuntimeError(self.last_error or "Recording file was not created. Check microphone permissions or selected device.")

        if not self.output_path or not Path(self.output_path).exists() or Path(self.output_path).stat().st_size == 0:
            raise RuntimeError(self.last_error or "Recording file was not created. Check microphone permissions or selected device.")
        return self.output_path

    def concat_audio_files(self, input_paths: List[str], output_path: str) -> str:
        if not self.ffmpeg_path:
            raise RuntimeError("ffmpeg was not found on this machine")
        if not input_paths:
            raise ValueError("At least one audio file is required for concatenation")
        if len(input_paths) == 1:
            shutil.copyfile(input_paths[0], output_path)
            return output_path

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        list_path = ""
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as handle:
                list_path = handle.name
                for input_path in input_paths:
                    handle.write(f"file '{Path(input_path).resolve().as_posix()}'\n")
            subprocess.run(
                [
                    self.ffmpeg_path,
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    list_path,
                    "-c",
                    "copy",
                    output_path,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            return output_path
        except subprocess.CalledProcessError as exc:
            raise RuntimeError((exc.stderr or exc.stdout or "Audio concatenation failed").strip()) from exc
        finally:
            if list_path:
                Path(list_path).unlink(missing_ok=True)

    def trim_audio(self, input_path: str, output_path: str, end_seconds: float) -> str:
        if not self.ffmpeg_path:
            raise RuntimeError("ffmpeg was not found on this machine")
        if end_seconds <= 0:
            Path(output_path).unlink(missing_ok=True)
            return output_path
        try:
            subprocess.run(
                [
                    self.ffmpeg_path,
                    "-y",
                    "-i",
                    input_path,
                    "-t",
                    f"{end_seconds:.3f}",
                    "-c",
                    "copy",
                    output_path,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            return output_path
        except subprocess.CalledProcessError as exc:
            raise RuntimeError((exc.stderr or exc.stdout or "Audio trim failed").strip()) from exc

    def clean_voice_audio(self, input_path: str, output_path: str) -> str:
        if not self.ffmpeg_path:
            raise RuntimeError("ffmpeg was not found on this machine")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        # Gentle chain for spoken voice: remove low rumble, reduce steady background noise,
        # then normalize the result without sounding too processed.
        filter_chain = "highpass=f=90,afftdn=nf=-25,alimiter=limit=0.92"
        try:
            subprocess.run(
                [
                    self.ffmpeg_path,
                    "-y",
                    "-i",
                    input_path,
                    "-af",
                    filter_chain,
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    output_path,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            return output_path
        except subprocess.CalledProcessError as exc:
            raise RuntimeError((exc.stderr or exc.stdout or "Audio cleaning failed").strip()) from exc

    @property
    def is_recording(self) -> bool:
        return self.process is not None and self.process.poll() is None


class FFmpegMediaToolkit:
    def __init__(self) -> None:
        self.ffmpeg_path = shutil.which("ffmpeg")
        self.ffprobe_path = shutil.which("ffprobe")

    @property
    def available(self) -> bool:
        return bool(self.ffmpeg_path and self.ffprobe_path)

    def probe_duration(self, path: str) -> float:
        if not self.available:
            raise RuntimeError("ffmpeg/ffprobe were not found on this machine")
        probe = subprocess.run(
            [
                self.ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(probe.stdout or "{}")
        return float(payload.get("format", {}).get("duration", 0.0) or 0.0)

    def merge_video_files(self, input_paths: List[str], output_path: str, quality: str = "high") -> str:
        if not self.available:
            raise RuntimeError("ffmpeg/ffprobe were not found on this machine")
        if not input_paths:
            raise ValueError("At least one video file is required")
        if len(input_paths) == 1:
            shutil.copyfile(input_paths[0], output_path)
            return output_path

        quality_map = {
            "original": {"crf": "18", "audio_bitrate": "192k"},
            "high": {"crf": "21", "audio_bitrate": "160k"},
            "medium": {"crf": "25", "audio_bitrate": "128k"},
            "small": {"crf": "29", "audio_bitrate": "96k"},
        }
        settings = quality_map.get((quality or "high").lower(), quality_map["high"])

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        list_path = ""
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as handle:
                list_path = handle.name
                for input_path in input_paths:
                    handle.write(f"file '{Path(input_path).resolve().as_posix()}'\n")
            subprocess.run(
                [
                    self.ffmpeg_path,
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    list_path,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    settings["crf"],
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    settings["audio_bitrate"],
                    "-movflags",
                    "+faststart",
                    output_path,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            return output_path
        except subprocess.CalledProcessError as exc:
            raise RuntimeError((exc.stderr or exc.stdout or "Video merge failed").strip()) from exc
        finally:
            if list_path:
                Path(list_path).unlink(missing_ok=True)
