import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

app = Flask(__name__)
CORS(app)


def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")

    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()

            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            if key and key not in os.environ:
                os.environ[key] = value


load_env_file()

BASE_DIR = Path(__file__).resolve().parent
CLIENT_SCRIPT = BASE_DIR / "python-clients" / "scripts" / "asr" / "transcribe_file_offline.py"
FUNCTION_ID = "b702f636-f60c-4a3d-a6f4-f3568c13bd7d"


# ---------------------------------------------------------------------------
# YouTube caption helpers
# ---------------------------------------------------------------------------

def get_youtube_video_id(url: str) -> str | None:
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11})",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
        r"embed\/([0-9A-Za-z_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def clean_youtube_transcript(entries: list) -> str:
    """Join transcript entries and strip timestamps, music/sound cues."""
    raw = " ".join(entry["text"] for entry in entries)
    raw = re.sub(r"\[.*?\]", "", raw)       # [Music], [Applause], etc.
    raw = re.sub(r"\(.*?\)", "", raw)       # (music), (laughter), etc.
    raw = re.sub(r"♪[^♪]*♪", "", raw)      # ♪ music notes ♪
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw


def fetch_youtube_transcript(youtube_url: str) -> str | None:
    """
    Try to fetch existing YouTube captions.
    Returns the cleaned transcript string, or None if unavailable.
    """
    video_id = get_youtube_video_id(youtube_url)
    if not video_id:
        return None

    try:
        # Try English first, then fall back to any available language
        try:
            entries = YouTubeTranscriptApi.get_transcript(video_id, languages=["en"])
        except Exception:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            transcript = transcript_list.find_transcript(
                [t.language_code for t in transcript_list]
            )
            entries = transcript.fetch()

        return clean_youtube_transcript(entries)

    except (NoTranscriptFound, TranscriptsDisabled):
        return None  # No captions available — caller will fall back to Whisper
    except Exception:
        return None  # Any other error — fall back to Whisper


# ---------------------------------------------------------------------------
# Whisper / audio helpers
# ---------------------------------------------------------------------------

def extract_transcript(output: str) -> str:
    cleaned_output = re.sub(r"\s+", " ", output).strip()

    final_match = re.search(r"Final transcript:\s*(.*)", cleaned_output, re.IGNORECASE)
    if final_match:
        final_text = final_match.group(1).strip()
        if final_text:
            return final_text

    json_transcript_match = re.search(
        r'"transcript"\s*:\s*"([^"]+)"', cleaned_output, re.IGNORECASE
    )
    if json_transcript_match:
        return json_transcript_match.group(1).strip()

    lines = [line.strip() for line in output.splitlines() if line.strip()]

    cleaned_lines = []
    for line in lines:
        lower = line.lower()
        if (
            line.startswith("##")
            or line.startswith("WARNING")
            or "grpc" in lower
            or "detected language" in lower
            or '"results"' in line
            or '"alternatives"' in line
            or '"audioProcessed"' in line
            or '"channelTag"' in line
            or line.startswith("{")
            or line.startswith("}")
            or line.startswith("[")
            or line.startswith("]")
        ):
            continue
        cleaned_lines.append(line)

    text = " ".join(cleaned_lines).strip()
    text = re.sub(r"\s+", " ", text).strip()
    return text


def convert_to_wav(input_path: str) -> str:
    output_path = f"{input_path}.wav"

    command = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-sample_fmt",
        "s16",
        output_path,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(result.stderr.strip() or "FFmpeg conversion failed.")

    return output_path


def download_youtube_audio(youtube_url: str) -> tuple[str, str]:
    yt_dlp_path = shutil.which("yt-dlp") or "yt-dlp"
    temp_dir = tempfile.mkdtemp()
    output_template = os.path.join(temp_dir, "source.%(ext)s")

    command = [
        yt_dlp_path,
        "-f",
        "bestaudio/best",
        "-o",
        output_template,
        youtube_url,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "yt-dlp download failed.")

    files = list(Path(temp_dir).glob("source.*"))
    if not files:
        raise RuntimeError("Could not download YouTube audio.")

    return str(files[0]), temp_dir


def transcribe_audio_file(audio_path: str, api_key: str) -> str:
    wav_path = convert_to_wav(audio_path)

    try:
        command = [
            "python3",
            str(CLIENT_SCRIPT),
            "--server",
            "grpc.nvcf.nvidia.com:443",
            "--use-ssl",
            "--metadata",
            "function-id",
            FUNCTION_ID,
            "--metadata",
            "authorization",
            f"Bearer {api_key}",
            "--language-code",
            "en",
            "--input-file",
            wav_path,
        ]

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR),
            timeout=300,
        )

        combined_output = f"{result.stdout}\n{result.stderr}".strip()

        if result.returncode != 0:
            raise RuntimeError(combined_output or "NVIDIA Whisper transcription failed.")

        transcript = extract_transcript(result.stdout)

        if not transcript:
            raise RuntimeError("No transcript was returned.")

        return transcript
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/healthz", methods=["GET"])
def healthz():
    return jsonify({"ok": True}), 200


@app.route("/transcribe", methods=["POST"])
def transcribe():
    api_key = os.getenv("WHISPER_API")

    if not api_key:
        return jsonify({"error": "WHISPER_API is missing in whisper-service/.env"}), 500

    if not CLIENT_SCRIPT.exists():
        return jsonify({"error": "NVIDIA transcription client script was not found."}), 500

    temp_paths: list[str] = []
    temp_dirs: list[str] = []

    try:
        youtube_link = None

        if request.is_json:
            body = request.get_json(silent=True) or {}
            youtube_link = body.get("youtubeLink")
        else:
            youtube_link = request.form.get("youtubeLink")

        if youtube_link:
            # Step 1: Try fetching existing YouTube captions first (fast, free)
            transcript = fetch_youtube_transcript(youtube_link)

            if transcript:
                return jsonify({
                    "success": True,
                    "transcript": transcript,
                    "source": "youtube_captions",
                })

            # Step 2: No captions found — fall back to Whisper
            source_path, temp_dir = download_youtube_audio(youtube_link)
            temp_paths.append(source_path)
            temp_dirs.append(temp_dir)

            transcript = transcribe_audio_file(source_path, api_key)

            return jsonify({
                "success": True,
                "transcript": transcript,
                "source": "whisper",
            })

        # Uploaded file — always use Whisper
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded."}), 400

        uploaded_file = request.files["file"]

        if uploaded_file.filename == "":
            return jsonify({"error": "Empty file."}), 400

        suffix = Path(uploaded_file.filename).suffix or ".tmp"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            uploaded_file.save(temp_file.name)
            source_path = temp_file.name
            temp_paths.append(source_path)

        transcript = transcribe_audio_file(source_path, api_key)

        return jsonify({
            "success": True,
            "transcript": transcript,
            "source": "whisper",
        })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Transcription timed out."}), 500
    except Exception as error:
        return jsonify({"error": str(error)}), 500
    finally:
        for path in temp_paths:
            if os.path.exists(path):
                os.remove(path)

        for temp_dir in temp_dirs:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)