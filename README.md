_# StudyStream_


**The smartest way to turn watch-time into study-time.**

StudyStream helps students turn long videos and recordings into usable study material. Paste a YouTube link or upload an audio/video file to generate a transcript, summary, and study notes.

## Features

- Generate transcripts from YouTube links
- Upload audio or video files for transcription
- Generate AI-powered summaries
- Generate AI-powered study notes
- Copy transcript, summary, and notes with one click
- Download transcript, summary, and notes as `.txt` or `.pdf`
- Scrollable result boxes for long content
- Clean, student-friendly UI

## Tech Used

- Next.js
- React
- TypeScript
- Tailwind CSS
- Flask
- FFmpeg
- NVIDIA Whisper / Riva
- NVIDIA Gemma

## How It Works

### YouTube links
1. User pastes a YouTube link
2. The app fetches the transcript
3. The transcript is cleaned
4. Gemma generates the summary and study notes

### Uploaded files
1. User uploads an audio or video file
2. The Flask whisper-service converts the file to a Whisper-friendly WAV format
3. NVIDIA Whisper transcribes the file
4. The transcript is sent back to the app
5. Gemma generates the summary and study notes

## Status

StudyStream currently supports:
- YouTube transcript generation
- Uploaded file transcription
- AI summaries
- AI study notes
- Copy and download actions
