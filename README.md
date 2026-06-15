# Parti — Architectural Pre-Design Research Studio

> 🇬🇧 English (default) · [🇰🇷 한국어](README.ko.md)

**Parti** turns a single starting point — a *site* + a *space type* — into a
continuous pre-design pipeline:

**Research → Problem definition → Concept structuring → Concept images.**

It is built to run on **local, free AI**: text with [Ollama](https://ollama.com)
and images with [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — while still
letting you plug in hosted APIs (Anthropic, Gemini, OpenAI) per task when you want
live, higher-quality results.

> Bring-your-own-key, local-first, no vendor lock-in. All API keys are stored
> **only in your browser** (localStorage) and are never committed or sent anywhere
> except the provider you choose.

---

## The pipeline

| Phase | What it does | Input → Output |
|---|---|---|
| **P1·2 Research** | Auto-generates research prompts, runs them, tags findings by confidence | site + space type → research notes ([1차]/[2차]/[미확인]) |
| **P3 Problem definition** | Findings → patterns → a single Problem Statement | research → one design thesis |
| **P4 Concept structuring** | Parti, keywords, spatial strategies, materiality, scene anchors | problem → structured concept |
| **P5 Concept images** | Builds image prompts and renders them | concept → image prompts → renders |

Plus: **batch generation** (up to 20 concepts × 8 images each, saved to disk),
a **results viewer / moodboard** with curation, frequency analysis, AI compare +
concept synthesis, **site analysis** (V-World), **precedent research**, and
**report export** (PDF / Markdown).

---

## Tech stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript** · **Tailwind v4**
- **Text LLM**: adapter layer over Ollama / Anthropic / Gemini — swap models per task from a dropdown
- **Images**: adapter layer over ComfyUI (Flux / Z-Image Turbo) / OpenAI / Gemini
- **Web search grounding** (optional): Tavily, for live-sourced research
- **Storage**: disk is the source of truth for batch output; in-progress projects live in the browser (localStorage + IndexedDB)

---

## Getting started (development)

Requirements: **Node.js 20+**. For local AI, also run **Ollama** and **ComfyUI**.

```bash
npm install
npm run dev          # http://localhost:3000
```

Pull a text model for local generation (most stable choice):

```bash
ollama pull qwen2.5:14b
```

Open **Settings** in the app to configure providers and (optionally) paste hosted
API keys. The defaults are `Ollama + qwen2.5:14b` for text and `ComfyUI` for images.

### Production / self-hosting

```bash
npm run build
npm start            # serves the built app on :3000
```

On Windows, the included double-click scripts start the server and an
[ngrok](https://ngrok.com) tunnel for sharing to other devices:

- `start-server.bat` — start the server (+ ngrok)
- `update-and-start.bat` — rebuild, then start

To pin a stable ngrok URL, put your reserved domain on a single line in
`ngrok-domain.txt` (this file is git-ignored). See [README.ko.md](README.ko.md)
for the full Korean walkthrough.

---

## Project layout

| Path | Contents |
|---|---|
| `app/` | App Router pages + API routes (the AI/image/V-World endpoints) |
| `lib/` | Core logic — LLM router & adapters, image router & adapters, skill prompts, stores |
| `components/` | Shared UI (e.g. the per-task model pickers) |
| `public/` | Static assets |
| `parti-output/` | Generated batch output (git-ignored) |

---

## Privacy & keys

- API keys are entered in **Settings** and kept in the browser only.
- There are **no secrets in this repository**; nothing is hardcoded.
- Batch output and the in-progress project store stay on your machine.

---

## Status

A personal/portfolio project. The UI is currently in Korean; an English UI
(English default + Korean toggle) is planned. Contributions and issues welcome.

## License

[MIT](LICENSE) © 2026 임준섭 (Junseop Lim). Free to use, modify, and distribute.
