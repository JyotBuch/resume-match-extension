const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const FAST_MODEL    = 'llama-3.1-8b-instant';
const DEEP_MODEL    = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = 'You are a technical recruiter. Respond ONLY with valid JSON, no markdown, no explanation.';

function buildFastPrompt(resume, jd) {
  return `Analyze how well the resume matches the job description below.

RESUME:
${resume}

JOB DESCRIPTION:
${jd}

Return ONLY this JSON object (no markdown fences, no extra text):
{
  "match_pct": <integer 0-100>,
  "matched_skills": [<up to 6 skills the resume clearly demonstrates>],
  "missing_skills": [<up to 6 skills the job requires that are absent from the resume>],
  "verdict": "<one punchy sentence summarising fit>"
}`;
}

function buildDeepPrompt(resume, jd) {
  return `Perform a detailed resume-to-job-description analysis.

RESUME:
${resume}

JOB DESCRIPTION:
${jd}

Return ONLY this JSON object (no markdown fences, no extra text):
{
  "match_pct": <integer 0-100>,
  "matched_skills": [<up to 6 skills the resume clearly demonstrates>],
  "missing_skills": [<up to 6 skills the job requires that are absent from the resume>],
  "verdict": "<one punchy sentence summarising fit>",
  "bullet_rewrites": [
    { "original": "<existing resume bullet>", "improved": "<rewritten bullet tailored to this JD>" }
  ],
  "keywords_to_add": [<ATS keywords from the JD missing from the resume, up to 10>],
  "detailed_feedback": "<3-4 sentence paragraph with specific, actionable advice>"
}
Include 2-3 bullet_rewrites. Choose bullets from the resume that are closest to the JD requirements.`;
}

/**
 * Parse JSON from the model response, stripping markdown fences if present.
 */
function safeParseJSON(raw) {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ```
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Sometimes models prepend a sentence before the JSON
  const firstBrace = text.indexOf('{');
  if (firstBrace > 0) text = text.slice(firstBrace);

  return JSON.parse(text); // throws if still invalid
}

async function callGroq(apiKey, model, userPrompt) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    let errMsg = `Groq API error ${response.status}`;
    try {
      const errBody = await response.json();
      errMsg = errBody?.error?.message || errMsg;
    } catch (_) {}
    const isAuth = response.status === 401 || response.status === 403;
    throw Object.assign(new Error(errMsg), { isAuth });
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error('Empty response from Groq.');

  return safeParseJSON(rawContent);
}

// Main message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ANALYZE' || message.type === 'DEEP_ANALYZE') {
    const isDeep = message.type === 'DEEP_ANALYZE';

    chrome.storage.local.get(['resume', 'groqApiKey'], async (data) => {
      const { resume, groqApiKey } = data;

      if (!resume || !groqApiKey) {
        sendResponse({
          error: 'Resume or API key not configured. Please open the extension settings.',
          isSetup: true,
        });
        return;
      }

      const jd = message.jobDescription;
      if (!jd) {
        sendResponse({ error: 'No job description received.' });
        return;
      }

      try {
        const model      = isDeep ? DEEP_MODEL : FAST_MODEL;
        const prompt     = isDeep ? buildDeepPrompt(resume, jd) : buildFastPrompt(resume, jd);
        const result     = await callGroq(groqApiKey, model, prompt);
        result._model    = model;
        result._isDeep   = isDeep;
        sendResponse({ result });
      } catch (err) {
        sendResponse({
          error: err.message || 'Unknown error.',
          isAuth: err.isAuth || false,
        });
      }
    });

    // Return true to keep the message channel open for the async response
    return true;
  }
});
