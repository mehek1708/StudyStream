import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function extractYouTubeId(input: string): string | null {
  try {
    const url = new URL(input);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1) || null;
    }

    if (
      url.hostname.includes("youtube.com") ||
      url.hostname.includes("www.youtube.com")
    ) {
      const videoId = url.searchParams.get("v");
      if (videoId) return videoId;

      const parts = url.pathname.split("/");
      const embedIndex = parts.findIndex((part) => part === "embed");
      if (embedIndex !== -1 && parts[embedIndex + 1]) {
        return parts[embedIndex + 1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

function chunkText(text: string, maxLength = 1200): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length > maxLength) {
      if (current.trim()) chunks.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

function cleanTranscriptForStudyContent(transcript: string): string {
  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const blockedPatterns = [
    /\[[^\]]+\]/i,
    /\([^)]+\)/i,
    /sponsored by/i,
    /this video is sponsored/i,
    /thanks to .* sponsor/i,
    /launch your e-?commerce/i,
    /clicking on my link/i,
    /link in the description/i,
    /pinned comment/i,
    /free offer/i,
    /custom domain/i,
    /unlimited hosting/i,
    /support and a custom/i,
    /odoo/i,
    /shop to sell/i,
    /e-?commerce store/i,
    /grab a picture/i,
    /target roman landholders/i,
    /sales flow/i,
    /sign up/i,
    /use my code/i,
    /affiliate/i,
    /discount code/i,
    /promo code/i,
    /sponsor/i,
    /description below/i,
    /launch .* for free/i,
    /all-in-one management software/i,
    /web shop/i,
    /homepage/i,
    /target customers/i,
  ];

  const filtered = sentences.filter(
    (sentence) => !blockedPatterns.some((pattern) => pattern.test(sentence))
  );

  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

function clipText(text: string, maxChars = 18000): string {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(0, maxChars);
}

async function generateWithGemma(
  prompt: string,
  maxTokens = 700
): Promise<string | null> {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemma-3-27b-it",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
        top_p: 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemma API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      console.error("Gemma response had no content:", data);
      return null;
    }

    return content.trim();
  } catch (error) {
    console.error("Gemma fetch failed:", error);
    return null;
  }
}

async function buildGemmaStudyOutputs(transcript: string): Promise<{
  summary: string;
  notes: string;
}> {
  const studyTranscript = clipText(transcript);

  const summaryPrompt = `You are creating a clean study summary from a YouTube transcript.

Rules:
- Absolutely do not include sponsor messages, ads, affiliate mentions, creator promos, website builders, discount codes, links, descriptions, pinned comments, or calls to action.
- Ignore any sentence that sounds promotional or unrelated to the educational topic.
- Write only the actual study content.
- Preserve important facts, names, dates, arguments, examples, and cause-and-effect relationships.
- Do not write labels like "Key point 1", "Point 2", or similar.
- Use clean bullet points.
- Make the summary detailed enough that a student would not miss an important idea.

Transcript:
${studyTranscript}`;

  const notesPrompt = `You are creating detailed study notes from a YouTube transcript.

Rules:
- Absolutely do not include sponsor messages, ads, affiliate mentions, creator promos, website builders, discount codes, links, descriptions, pinned comments, or calls to action.
- Ignore any sentence that sounds promotional or unrelated to the actual lesson.
- Write only the educational content.
- Preserve important names, dates, ideas, examples, explanations, comparisons, and takeaways.
- Do not write labels like "Note 1" or numbered headings unless naturally needed.
- Use concise but detailed bullet points.
- Make the notes useful for exam prep and revision.

Transcript:
${studyTranscript}`;

  const [summaryResult, notesResult] = await Promise.all([
    generateWithGemma(summaryPrompt, 900),
    generateWithGemma(notesPrompt, 1300),
  ]);

  return {
    summary: summaryResult || buildSimpleSummary(transcript),
    notes: notesResult || buildSimpleNotes(transcript),
  };
}

function buildSimpleSummary(transcript: string): string {
  const chunks = chunkText(transcript, 900);
  const preview = chunks.slice(0, 5);

  if (!preview.length) {
    return "No summary could be generated.";
  }

  return preview.map((chunk) => `• ${chunk}`).join("\n\n");
}

function buildSimpleNotes(transcript: string): string {
  const chunks = chunkText(transcript, 500);
  const preview = chunks.slice(0, 8);

  if (!preview.length) {
    return "No study notes could be generated.";
  }

  return preview.map((chunk) => `• ${chunk}`).join("\n\n");
}

export async function POST(request: NextRequest) {
  let isUploadRequest = false;

  try {
    const contentType = request.headers.get("content-type") || "";

    let youtubeLink = "";
    let uploadedFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const youtubeLinkValue = formData.get("youtubeLink");
      const fileValue = formData.get("file");

      if (typeof youtubeLinkValue === "string") {
        youtubeLink = youtubeLinkValue.trim();
      }

      if (fileValue instanceof File && fileValue.size > 0) {
        uploadedFile = fileValue;
        isUploadRequest = true;
      }
    } else {
      const body = await request.json();
      if (typeof body?.youtubeLink === "string") {
        youtubeLink = body.youtubeLink.trim();
      }
    }

    if (!youtubeLink && !uploadedFile) {
      return NextResponse.json(
        { error: "Please provide a YouTube link or upload a file." },
        { status: 400 }
      );
    }

    if (uploadedFile && !youtubeLink) {
      const whisperFormData = new FormData();
      whisperFormData.append("file", uploadedFile);

      const whisperResponse = await fetch(
        "https://studystream-whisper-service.onrender.com/transcribe",
        {
          method: "POST",
          body: whisperFormData,
        }
      );

      const whisperData = await whisperResponse.json();

      if (!whisperResponse.ok) {
        return NextResponse.json(
          { error: whisperData?.error || "File transcription failed." },
          { status: 500 }
        );
      }

      const transcript =
        typeof whisperData?.transcript === "string"
          ? whisperData.transcript
              .replace(/\[[^\]]+\]/gi, " ")
              .replace(/\([^)]+\)/gi, " ")
              .replace(/\s+/g, " ")
              .trim()
          : "";

      if (
        !transcript ||
        transcript.includes(
          "Whisper service is connected. Real NVIDIA transcription comes next."
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Oops! We can’t generate this right now 😔 Please upload a relevant audio or video file first.",
          },
          { status: 500 }
        );
      }

      const cleanedTranscript = cleanTranscriptForStudyContent(transcript);
      const studySource = cleanedTranscript || transcript;
      const { summary, notes } = await buildGemmaStudyOutputs(studySource);

      return NextResponse.json({
        success: true,
        videoId: null,
        transcript,
        summary,
        notes,
      });
    }

    const videoId = extractYouTubeId(youtubeLink);

    if (!videoId) {
      return NextResponse.json(
        { error: "Could not extract a YouTube video ID from that link." },
        { status: 400 }
      );
    }

    let transcriptItems;

    try {
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (error) {
      console.error("YouTube transcript fetch failed:", error);

      return NextResponse.json(
        {
          error:
            "Could not fetch the YouTube transcript. The video may not have captions available.",
        },
        { status: 500 }
      );
    }

    if (!transcriptItems.length) {
      return NextResponse.json(
        { error: "No transcript was found for this video." },
        { status: 404 }
      );
    }

    const transcript = transcriptItems
      .map((item) => item.text)
      .join(" ")
      .replace(/\[[^\]]+\]/gi, " ")
      .replace(/\([^)]+\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const cleanedTranscript = cleanTranscriptForStudyContent(transcript);
    const studySource = cleanedTranscript || transcript;
    const { summary, notes } = await buildGemmaStudyOutputs(studySource);

    return NextResponse.json({
      success: true,
      videoId,
      transcript,
      summary,
      notes,
    });
  } catch (error) {
    console.error("Transcript route failed:", error);

    const fallbackMessage = isUploadRequest
      ? "Oops! We can’t generate this right now 😔 Please upload a relevant audio or video file first."
      : "Could not fetch the YouTube transcript. The video may not have captions available.";

    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message && isUploadRequest
            ? error.message
            : fallbackMessage,
      },
      { status: 500 }
    );
  }
}