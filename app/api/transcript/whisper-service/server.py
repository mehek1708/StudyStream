import os
import re
import subprocess
import tempfile
from pathlib import Path

from flask import Flask, request, jsonify

app = Flask(__name__)


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


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    uploaded_file = request.files["file"]

    if uploaded_file.filename == "":
        return jsonify({"error": "Empty file."}), 400

    api_key = os.getenv("WHISPER_API")

    if not api_key:
        return jsonify({"error": "WHISPER_API is missing in whisper-service/.env"}), 500

    if not CLIENT_SCRIPT.exists():
        return jsonify({"error": "NVIDIA transcription client script was not found."}), 500

    suffix = Path(uploaded_file.filename).suffix or ".tmp"
    temp_path = None
    wav_path = None

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        uploaded_file.save(temp_file.name)
        temp_path = temp_file.name

    try:
        wav_path = convert_to_wav(temp_path)

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
            return jsonify(
                {
                    "error": "NVIDIA Whisper transcription failed.",
                    "details": combined_output,
                }
            ), 500

        transcript = extract_transcript(result.stdout)

        if not transcript:
            return jsonify(
                {
                    "error": "Oops! We can’t generate this right now 😔 Please upload a relevant audio or video file first.",
                    "details": combined_output,
                }
            ), 500

        return jsonify(
            {
                "success": True,
                "transcript": transcript,
            }
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Transcription timed out."}), 500
    except Exception as error:
        return jsonify({"error": str(error)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        if wav_path and os.path.exists(wav_path):
            os.remove(wav_path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)