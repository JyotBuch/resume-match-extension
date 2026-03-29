const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const FAST_MODEL    = 'llama-3.1-8b-instant';
const DEEP_MODEL    = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = 'You are a technical recruiter. Respond ONLY with valid JSON, no markdown, no explanation.';

function buildParsePrompt(resume) {
  return `Parse this resume into structured JSON. Be thorough and precise.

RESUME:
${resume}

Return ONLY this JSON object (no markdown fences, no extra text):
{
  "name": "<candidate full name, or empty string>",
  "experiences": [
    {
      "id": <1-based integer>,
      "title": "<job title>",
      "company": "<company name>",
      "period": "<date range e.g. Jan 2021 – Mar 2023>",
      "bullets": ["<achievement or responsibility, no leading bullet symbols>"]
    }
  ],
  "skills": ["<skill name>"],
  "education": [
    { "degree": "<degree and field>", "school": "<institution>", "year": "<graduation year>" }
  ]
}
Order experiences most-recent-first. Strip all bullet symbols (•, -, *, –) from bullet text. Include every bullet listed under each role.`;
}

function formatResumeForPrompt(resume, parsed) {
  if (!parsed) return resume;

  const expLines = (parsed.experiences || []).map(e =>
    `${e.title} @ ${e.company} (${e.period})\n${(e.bullets || []).map(b => `  • ${b}`).join('\n')}`
  ).join('\n\n');

  const skills = (parsed.skills || []).join(', ');
  const edu = (parsed.education || []).map(e => `${e.degree}, ${e.school} (${e.year})`).join(' | ');

  return [
    parsed.name ? `Candidate: ${parsed.name}` : '',
    skills       ? `Skills: ${skills}` : '',
    edu          ? `Education: ${edu}` : '',
    expLines     ? `\nExperience:\n${expLines}` : '',
  ].filter(Boolean).join('\n');
}

function buildFastPrompt(resume, parsed, jd) {
  return `Analyze how well the resume matches the job description below.

RESUME:
${formatResumeForPrompt(resume, parsed)}

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

function buildDeepPrompt(resume, parsed, jd, webContext) {
  const webSection = webContext ? `

REAL-WORLD CONTEXT (sourced from job blogs, forums, and industry sources — use this to ground your analysis in what the role actually requires day-to-day, not just what the JD says):
${webContext}
` : '';

  return `Perform a detailed resume-to-job-description analysis.

RESUME:
${formatResumeForPrompt(resume, parsed)}

JOB DESCRIPTION:
${jd}${webSection}

Return ONLY this JSON object (no markdown fences, no extra text):
{
  "match_pct": <integer 0-100>,
  "matched_skills": [<up to 6 skills the resume clearly demonstrates>],
  "missing_skills": [<up to 6 skills the job requires that are absent from the resume>],
  "verdict": "<one punchy sentence summarising fit>",
  "keywords_to_add": [<ATS keywords from the JD missing from the resume, up to 10>],
  "strength_tilts": [
    {
      "strength": "<3-6 word label for this strength>",
      "evidence": "<specific role, project, or bullet from the resume that proves this strength exists>",
      "tilt": "<concrete, specific advice on how to reframe or emphasise this strength for this exact role — what angle to take, what to foreground${webContext ? '. Reference real-world context where relevant' : ''}>",
      "why": "<what in the JD${webContext ? ' and real-world context' : ''} makes this relevant>"
    }
  ],
  "detailed_feedback": "<3-4 sentence overall assessment — what is working, what the gap is, and the single most important thing to address${webContext ? '. Ground observations in the real-world context where it adds signal' : ''}>"
}
Include 2-4 strength_tilts. Only include a tilt where the resume genuinely demonstrates the strength AND the JD genuinely values it. Do not invent experience or suggest tilts that require fabricating background the candidate does not have.`;
}

// ── Tavily web search ──────────────────────────────────────────────────────

async function extractJobContext(groqApiKey, jd) {
  const prompt = `Extract structured info from this job description.

JOB DESCRIPTION:
${jd.slice(0, 3000)}

Return ONLY this JSON (no markdown, no extra text):
{
  "jobTitle": "<exact job title>",
  "company": "<company name, or empty string if not mentioned>",
  "seniority": "<one of: junior, mid, senior, staff, principal, lead, manager, or empty>",
  "techStack": ["<up to 4 most specific technologies or tools mentioned>"],
  "domain": "<industry or domain e.g. fintech, developer tools, healthcare, e-commerce>"
}`;

  try {
    return await callGroq(groqApiKey, FAST_MODEL, prompt);
  } catch (_) {
    return null; // non-fatal — fall back to heuristic queries
  }
}

function buildSearchQueries(ctx) {
  // ctx: { jobTitle, company, seniority, techStack, domain } — may be null
  if (!ctx || !ctx.jobTitle) {
    return [
      'software engineer real day to day responsibilities reddit blind',
      'what hiring managers actually look for beyond job description',
    ];
  }

  const { jobTitle, company, seniority, techStack = [], domain } = ctx;
  const level = seniority ? `${seniority} ` : '';
  const stack = techStack.slice(0, 2).join(' ');
  const queries = [];

  // Query 1: real day-to-day grounded in the exact role + domain
  queries.push(
    `"${level}${jobTitle}" real day to day work ${domain || ''} reddit blind honest`.trim()
  );

  // Query 2: company-specific if we have one, otherwise stack/domain specific
  if (company) {
    queries.push(`${company} ${jobTitle} engineering culture what they actually look for`);
  } else {
    queries.push(
      `${level}${jobTitle} ${stack} what hiring managers actually need beyond job posting`.trim()
    );
  }

  // Query 3: only if specific tech stack — look for real production usage discussion
  if (techStack.length >= 2) {
    queries.push(`${jobTitle} ${stack} production real requirements day to day`);
  }

  return queries;
}

async function tavilySearch(apiKey, query) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 3,
      search_depth: 'basic',
      include_answer: false,
    }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  return data.results || [];
}

async function fetchWebContext(tavilyApiKey, groqApiKey, jd) {
  const jobCtx  = await extractJobContext(groqApiKey, jd);
  const queries  = buildSearchQueries(jobCtx);
  const searches = await Promise.allSettled(queries.map(q => tavilySearch(tavilyApiKey, q)));

  // Flatten results, deduplicate by URL, keep top 5
  const seen    = new Set();
  const results = [];
  for (const s of searches) {
    if (s.status !== 'fulfilled') continue;
    for (const r of s.value) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push(r);
      if (results.length >= 5) break;
    }
    if (results.length >= 5) break;
  }

  if (!results.length) return { context: null, sources: [] };

  // Format for prompt — cap each result to 400 chars to keep tokens in check
  const context = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.content.slice(0, 400).trim()}`
  ).join('\n\n');

  const sources = results.map(r => ({ title: r.title, url: r.url }));
  return { context, sources };
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
      max_tokens: 1500,
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

    chrome.storage.local.get(['resume', 'groqApiKey', 'parsedResume', 'tavilyApiKey'], async (data) => {
      const { resume, groqApiKey, parsedResume, tavilyApiKey } = data;

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
        let webContext = null;
        let sources    = [];

        // Fetch web context in parallel with nothing (prep only) — only for deep
        if (isDeep && tavilyApiKey) {
          const web = await fetchWebContext(tavilyApiKey, groqApiKey, jd);
          webContext = web.context;
          sources    = web.sources;
        }

        const model  = isDeep ? DEEP_MODEL : FAST_MODEL;
        const prompt = isDeep
          ? buildDeepPrompt(resume, parsedResume, jd, webContext)
          : buildFastPrompt(resume, parsedResume, jd);
        const result  = await callGroq(groqApiKey, model, prompt);
        result._model       = model;
        result._isDeep      = isDeep;
        result._parsedResume = parsedResume || null;
        result._sources     = sources;
        result._webEnriched = sources.length > 0;
        sendResponse({ result });
      } catch (err) {
        sendResponse({
          error: err.message || 'Unknown error.',
          isAuth: err.isAuth || false,
        });
      }
    });

    return true;
  }

  if (message.type === 'PARSE_RESUME') {
    chrome.storage.local.get(['resume', 'groqApiKey'], async (data) => {
      const { resume, groqApiKey } = data;

      if (!resume || !groqApiKey) {
        sendResponse({ error: 'Resume or API key missing.' });
        return;
      }

      try {
        const prompt = buildParsePrompt(resume.slice(0, 8000)); // guard token limit
        const parsed = await callGroq(groqApiKey, FAST_MODEL, prompt);
        chrome.storage.local.set({ parsedResume: parsed });
        sendResponse({ parsed });
      } catch (err) {
        sendResponse({ error: err.message || 'Parse failed.' });
      }
    });

    return true;
  }

});
