# Resume Match Analyzer — Chrome Extension

Instantly score how well your resume matches any job posting using Groq's fast inference API. Works on LinkedIn, Indeed, Greenhouse, and generic job pages.

---

## Folder structure

```
resume-match-extension/
├── manifest.json       # Manifest V3 config
├── background.js       # Service worker — Groq API calls
├── content.js          # Injected into job pages to scrape the JD
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic
├── options.html        # Settings page
├── options.js          # Settings logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Setup

### 1. Get a Groq API key

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / log in
3. Navigate to **API Keys** and create a new key (starts with `gsk_`)
4. Copy it — you'll paste it into the extension settings

### 2. Load the extension in Chrome / Chromium / Comet

1. Open `chrome://extensions` (or `brave://extensions` / `edge://extensions`)
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `resume-match-extension/` folder
5. The extension icon appears in your toolbar

### 3. Configure your resume

1. Click the extension icon → you'll see a "Set up your resume first" prompt
2. Click **Open settings** (or right-click the icon → *Options*)
3. Paste your plain-text resume into the textarea
4. Paste your Groq API key
5. Click **Save settings** — you'll see a green "Saved!" confirmation

---

## How to use

1. Navigate to any job posting page (LinkedIn, Indeed, Greenhouse, etc.)
2. Click the **Resume Match** extension icon
3. Click **Analyze this job**
4. Wait ~2 seconds for the fast analysis (8B model)
5. View your match %, matched/missing skills, and a verdict sentence
6. Optionally click **Deep Analysis** to get bullet rewrites, ATS keywords, and detailed feedback (uses the 70B model — takes ~5 seconds)

---

## Model routing

| Action | Model | Why |
|---|---|---|
| Analyze this job | `llama-3.1-8b-instant` | Fast and cheap — sub-2s latency |
| Deep Analysis | `llama-3.3-70b-versatile` | Richer reasoning for rewrites and feedback |

### How to swap models

Open `background.js` and change either constant at the top:

```js
const FAST_MODEL = 'llama-3.1-8b-instant';
const DEEP_MODEL = 'llama-3.3-70b-versatile';
```

Other Groq models you can use:
- `llama-3.1-70b-versatile` — alternative deep model
- `mixtral-8x7b-32768` — longer context window
- `gemma2-9b-it` — Google's Gemma 2

Check the current model list at [console.groq.com/docs/models](https://console.groq.com/docs/models).

---

## Supported job sites

| Site | Selector used |
|---|---|
| LinkedIn | `.jobs-description__content` |
| Indeed | `#jobDescriptionText` |
| Greenhouse | `[data-testid="job-description"]` |
| LinkedIn (fallback) | `.job-details-jobs-unified-top-card__job-insight` |
| Generic | `article` tag |
| Last resort | First 5 000 chars of `document.body.innerText` |

---

## Privacy

- Your resume and API key are stored **locally** in `chrome.storage.local` — never sent to any server except Groq's inference endpoint when you trigger an analysis.
- No telemetry, no analytics, no third-party requests.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not extract a job description" | Navigate directly to the job listing page (not a search results page) |
| Auth error / 401 | Your Groq API key is invalid or expired — update it in Settings |
| Extension not responding | Go to `chrome://extensions`, click the reload icon on the extension |
| Score seems off | Try Deep Analysis — the 70B model is more accurate |
