"use client";

import { CSSProperties, useState } from "react";

type ApiResponse = {
  success?: boolean;
  videoId?: string | null;
  transcript?: string;
  summary?: string;
  notes?: string;
  error?: string;
};

export default function Home() {
  const [showSummary, setShowSummary] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [youtubeLink, setYoutubeLink] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [transcriptText, setTranscriptText] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedSection, setCopiedSection] = useState<
    "transcript" | "summary" | "notes" | null
  >(null);

  const wandCursorStyle: CSSProperties = {
    cursor:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><text x='4' y='24' font-size='22'>🪄</text></svg>\") 6 24, pointer",
  };

  const resetViews = () => {
    setShowTranscript(false);
    setShowSummary(false);
    setShowNotes(false);
  };

  const downloadAsText = (title: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/\s+/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const downloadAsPdf = (title: string, content: string) => {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body {
              font-family: Arial, Helvetica, sans-serif;
              padding: 40px;
              color: #111;
              line-height: 1.6;
              white-space: pre-wrap;
            }
            h1 {
              margin-bottom: 24px;
            }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div>${escapeHtml(content)}</div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const copyToClipboard = async (
    section: "transcript" | "summary" | "notes",
    content: string
  ) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedSection(section);
      window.setTimeout(() => {
        setCopiedSection((current) => (current === section ? null : current));
      }, 1800);
    } catch {
      setErrorMessage("Couldn’t copy that right now.");
    }
  };

  const renderLoadingState = (label: string) => (
    <div className="flex flex-col items-center justify-center gap-5 py-6 text-center">
      <div className="relative h-28 w-64 overflow-hidden">
        <img
          src="/witch-loader.png"
          alt="Flying witch loader"
          className="absolute left-0 top-1/2 h-24 w-auto -translate-y-1/2 animate-[flyAcross_2.8s_ease-in-out_infinite] drop-shadow-[0_0_18px_rgba(236,72,153,0.28)]"
        />
      </div>
      <div className="space-y-2">
        <p className="text-base font-medium text-slate-200">{label}</p>
        <p className="text-sm text-slate-400">Hang tight while the magic happens.</p>
      </div>
    </div>
  );

  const handlePrimaryAction = async (
    action: "transcript" | "summary" | "notes"
  ) => {
    setErrorMessage("");

    if (!youtubeLink.trim() && !selectedFile) {
      resetViews();
      if (action === "transcript") setShowTranscript(true);
      if (action === "summary") setShowSummary(true);
      if (action === "notes") setShowNotes(true);
      return;
    }

    setIsLoading(true);
    resetViews();

    if (action === "transcript") setShowTranscript(true);
    if (action === "summary") setShowSummary(true);
    if (action === "notes") setShowNotes(true);

    try {
      let response: Response;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("action", action);

        if (youtubeLink.trim()) {
          formData.append("youtubeLink", youtubeLink);
        }

        response = await fetch("/api/transcript", {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch("/api/transcript", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ youtubeLink, action }),
        });
      }

      const data: ApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setTranscriptText(data.transcript || "No transcript returned.");
      setSummaryText(data.summary || "No summary returned.");
      setNotesText(data.notes || "No study notes returned.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#22133a_0%,_#09090b_45%,_#050508_100%)] px-6 py-12 font-serif text-slate-100 [--fly-distance:12rem]">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section className="rounded-[32px] border border-fuchsia-200/10 bg-white/[0.04] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex flex-col gap-4">
            <div className="space-y-3">
              <h1 className="max-w-3xl bg-gradient-to-r from-fuchsia-300 via-violet-200 to-indigo-300 bg-clip-text pb-2 font-serif text-5xl font-semibold leading-[1.15] tracking-tight text-transparent sm:text-6xl">
                StudyStream
              </h1>
              <p className="max-w-2xl font-serif text-xl leading-8 text-slate-300">
                The smartest way to turn watch-time into study-time.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-5 rounded-[28px] border border-white/10 bg-slate-950/60 p-5 sm:p-6">
            <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_280px]">
              <input
                type="text"
                placeholder="Paste your link here..."
                value={youtubeLink}
                onChange={(event) => setYoutubeLink(event.target.value)}
                className="min-h-[78px] w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-center text-xl text-white outline-none transition placeholder:text-center placeholder:text-slate-500 focus:border-fuchsia-300/40"
              />

              <div className="text-center text-sm font-semibold uppercase tracking-[0.35em] text-slate-400">
                OR
              </div>

              <div className="relative">
                <label
                  style={wandCursorStyle}
                  className="flex min-h-[78px] cursor-pointer items-center justify-center rounded-2xl border border-fuchsia-300/20 bg-gradient-to-r from-fuchsia-500/20 via-violet-500/20 to-indigo-500/20 px-4 py-4 text-center text-xl text-slate-100 shadow-lg shadow-fuchsia-950/20 transition hover:border-fuchsia-200/30 hover:from-fuchsia-500/30 hover:via-violet-500/30 hover:to-indigo-500/30 active:scale-[0.99]"
                >
                  <input
                    key={fileInputKey}
                    type="file"
                    accept=".mp3,.wav,.m4a,.mp4,audio/*,video/*"
                    className="hidden"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                  />
                  {selectedFile ? selectedFile.name : "Upload file"}
                </label>

                {selectedFile ? (
                  <button
                    type="button"
                    aria-label="Remove selected file"
                    onClick={() => {
                      setSelectedFile(null);
                      setFileInputKey((prev) => prev + 1);
                    }}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/25 text-lg text-white transition hover:bg-black/40"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => handlePrimaryAction("transcript")}
                style={wandCursorStyle}
                className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-lg font-medium text-white shadow-lg shadow-fuchsia-950/30 transition hover:opacity-95"
              >
                Generate Transcript
              </button>
              <button
                type="button"
                onClick={() => handlePrimaryAction("summary")}
                style={wandCursorStyle}
                className="w-full rounded-2xl bg-gradient-to-r from-violet-500 via-indigo-500 to-purple-500 px-5 py-4 text-lg font-medium text-white shadow-lg shadow-violet-950/30 transition hover:opacity-95"
              >
                Generate Summary
              </button>
              <button
                type="button"
                onClick={() => handlePrimaryAction("notes")}
                style={wandCursorStyle}
                className="w-full rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 px-5 py-4 text-lg font-medium text-white shadow-lg shadow-fuchsia-950/30 transition hover:opacity-95"
              >
                Generate Study Notes
              </button>
            </div>
          </div>
        </section>

        {showTranscript ? (
          <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.38)] backdrop-blur">
            <h2 className="mt-2 bg-gradient-to-r from-fuchsia-300 via-violet-200 to-indigo-300 bg-clip-text font-serif text-4xl font-semibold text-transparent">
              Transcript
            </h2>
            <div
              className={`mt-5 h-[420px] overflow-y-auto rounded-[28px] border border-white/10 bg-slate-950/70 p-6 text-base leading-9 text-white ${
                (!youtubeLink.trim() && !selectedFile) || isLoading || errorMessage
                  ? "flex items-center justify-center text-center"
                  : "whitespace-pre-wrap break-words"
              }`}
            >
              {!youtubeLink.trim() && !selectedFile
                ? "Please paste a YouTube link or upload a file first."
                : isLoading
                  ? renderLoadingState("Generating transcript...")
                  : errorMessage
                    ? errorMessage
                    : transcriptText}
            </div>
            {transcriptText && !isLoading && !errorMessage ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => copyToClipboard("transcript", transcriptText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  {copiedSection === "transcript" ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadAsText("Transcript", transcriptText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  Download as .txt
                </button>
                <button
                  type="button"
                  onClick={() => downloadAsPdf("Transcript", transcriptText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-violet-500 via-indigo-500 to-purple-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  Download as .pdf
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {showSummary ? (
          <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.38)] backdrop-blur">
            <h2 className="mt-2 bg-gradient-to-r from-fuchsia-300 via-violet-200 to-indigo-300 bg-clip-text font-serif text-4xl font-semibold text-transparent">
              Summary
            </h2>
            <div
              className={`mt-5 h-[320px] overflow-y-auto rounded-[28px] border border-white/10 bg-slate-950/70 p-6 text-base leading-9 text-white ${
                (!youtubeLink.trim() && !selectedFile) || isLoading || errorMessage
                  ? "flex items-center justify-center text-center"
                  : "whitespace-pre-wrap break-words"
              }`}
            >
              {!youtubeLink.trim() && !selectedFile
                ? "Please paste a YouTube link or upload a file first."
                : isLoading
                  ? renderLoadingState("Generating summary...")
                  : errorMessage
                    ? errorMessage
                    : summaryText}
            </div>
            {summaryText && !isLoading && !errorMessage ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => copyToClipboard("summary", summaryText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  {copiedSection === "summary" ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadAsText("Summary", summaryText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  Download as .txt
                </button>
                <button
                  type="button"
                  onClick={() => downloadAsPdf("Summary", summaryText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-violet-500 via-indigo-500 to-purple-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  Download as .pdf
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {showNotes ? (
          <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.38)] backdrop-blur">
            <h2 className="mt-2 bg-gradient-to-r from-fuchsia-300 via-violet-200 to-indigo-300 bg-clip-text font-serif text-4xl font-semibold text-transparent">
              Study Notes
            </h2>
            <div
              className={`mt-5 h-[360px] overflow-y-auto rounded-[28px] border border-white/10 bg-slate-950/70 p-6 text-base leading-9 text-white ${
                (!youtubeLink.trim() && !selectedFile) || isLoading || errorMessage
                  ? "flex items-center justify-center text-center"
                  : "whitespace-pre-wrap break-words"
              }`}
            >
              {!youtubeLink.trim() && !selectedFile
                ? "Please paste a YouTube link or upload a file first."
                : isLoading
                  ? renderLoadingState("Generating study notes...")
                  : errorMessage
                    ? errorMessage
                    : notesText}
            </div>
            {notesText && !isLoading && !errorMessage ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => copyToClipboard("notes", notesText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  {copiedSection === "notes" ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadAsText("Study Notes", notesText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  Download as .txt
                </button>
                <button
                  type="button"
                  onClick={() => downloadAsPdf("Study Notes", notesText)}
                  style={wandCursorStyle}
                  className="rounded-xl bg-gradient-to-r from-violet-500 via-indigo-500 to-purple-500 px-4 py-2 text-sm text-white transition hover:opacity-95"
                >
                  Download as .pdf
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}