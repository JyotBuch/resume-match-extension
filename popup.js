(() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let currentJD  = null;
  let deepPending = false;

  // ── Element refs ───────────────────────────────────────────────────────────
  const states = {
    setup:   document.getElementById('state-setup'),
    default: document.getElementById('state-default'),
    loading: document.getElementById('state-loading'),
    result:  document.getElementById('state-result'),
    error:   document.getElementById('state-error'),
  };

  const settingsBtn   = document.getElementById('settingsBtn');
  const goSetupBtn    = document.getElementById('goSetupBtn');
  const analyzeBtn    = document.getElementById('analyzeBtn');
  const deepBtn       = document.getElementById('deepBtn');
  const retryBtn      = document.getElementById('retryBtn');
  const errorSetupBtn = document.getElementById('errorSetupBtn');
  const loadingLabel  = document.getElementById('loadingLabel');

  const scoreFill    = document.getElementById('scoreFill');
  const scoreNumber  = document.getElementById('scoreNumber');
  const verdictText  = document.getElementById('verdictText');
  const matchedChips = document.getElementById('matchedChips');
  const missingChips = document.getElementById('missingChips');
  const deepSection    = document.getElementById('deepSection');
  const tiltsList      = document.getElementById('tiltsList');
  const atsChips       = document.getElementById('atsChips');
  const feedbackPara   = document.getElementById('feedbackPara');
  const sourcesSection = document.getElementById('sourcesSection');
  const sourcesList    = document.getElementById('sourcesList');
  const disclaimer     = document.getElementById('disclaimer');
  const errorMsg       = document.getElementById('errorMsg');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showState(name) {
    Object.entries(states).forEach(([key, el]) => {
      el.classList.toggle('active', key === name);
    });
  }

  function openOptions() { chrome.runtime.openOptionsPage(); }

  function makeChip(text, cls) {
    const span = document.createElement('span');
    span.className = `chip ${cls}`;
    span.textContent = text;
    return span;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Score ring — circumference for r=46 is 2π×46 ≈ 289
  const CIRC = 2 * Math.PI * 46;

  function animateRing(pct) {
    const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    scoreFill.style.stroke = color;
    scoreNumber.style.color = color;
    scoreFill.style.strokeDasharray  = `${CIRC} ${CIRC}`;
    scoreFill.style.strokeDashoffset = CIRC;
    scoreFill.getBoundingClientRect();
    scoreFill.style.strokeDashoffset = CIRC * (1 - pct / 100);
  }

  // ── Render base result ─────────────────────────────────────────────────────
  function renderResult(result) {
    const pct = Math.max(0, Math.min(100, Math.round(result.match_pct || 0)));
    scoreNumber.textContent = `${pct}%`;
    verdictText.textContent = result.verdict || '';

    matchedChips.innerHTML = '';
    missingChips.innerHTML = '';
    (result.matched_skills || []).forEach(s => matchedChips.appendChild(makeChip(s, 'chip-success')));
    (result.missing_skills  || []).forEach(s => missingChips.appendChild(makeChip(s, 'chip-danger')));

    requestAnimationFrame(() => animateRing(pct));
    disclaimer.textContent = `Powered by Groq · ${result._model || 'llama-3.1-8b-instant'}`;
    showState('result');
  }

  // ── Render deep section ────────────────────────────────────────────────────
  function renderDeep(result) {
    atsChips.innerHTML = '';
    tiltsList.innerHTML = '';
    feedbackPara.textContent = '';

    // Strength tilts
    (result.strength_tilts || []).forEach(({ strength, evidence, tilt, why }) => {
      const card = document.createElement('div');
      card.className = 'tilt-card';
      card.innerHTML = `
        <div class="tilt-strength">${escHtml(strength)}</div>
        <div class="tilt-row">
          <span class="tilt-label">From your resume</span>
          <p class="tilt-text tilt-evidence">${escHtml(evidence)}</p>
        </div>
        <div class="tilt-row">
          <span class="tilt-label tilt-label-why">Why it's relevant</span>
          <p class="tilt-text" style="color:var(--muted)">${escHtml(why)}</p>
        </div>
        <div class="tilt-row">
          <span class="tilt-label tilt-label-tilt">How to tilt it</span>
          <p class="tilt-text" style="color:var(--accent)">${escHtml(tilt)}</p>
        </div>
      `;
      tiltsList.appendChild(card);
    });

    // ATS keywords
    (result.keywords_to_add || []).forEach(kw => atsChips.appendChild(makeChip(kw, 'chip-accent')));

    // Overall feedback
    feedbackPara.textContent = result.detailed_feedback || '';

    // Sources (only when web-enriched)
    sourcesList.innerHTML = '';
    if (result._sources?.length > 0) {
      result._sources.forEach((src, i) => {
        const row = document.createElement('div');
        row.className = 'source-item';
        row.innerHTML = `
          <span class="source-num">${i + 1}</span>
          <a class="source-link" href="${escHtml(src.url)}" target="_blank" rel="noopener" title="${escHtml(src.title)}">${escHtml(src.title)}</a>
        `;
        sourcesList.appendChild(row);
      });
      sourcesSection.style.display = 'block';
    } else {
      sourcesSection.style.display = 'none';
    }

    deepSection.style.display = 'block';
    deepBtn.style.display = 'none';
    const webTag = result._webEnriched ? ' · Web-enriched' : '';
    disclaimer.textContent = `Powered by Groq · ${result._model || 'llama-3.3-70b-versatile'}${webTag}`;
  }

  // ── Show error ─────────────────────────────────────────────────────────────
  function showError(msg, { isSetup = false, isAuth = false } = {}) {
    errorMsg.textContent = msg;
    errorSetupBtn.style.display = (isSetup || isAuth) ? 'block' : 'none';
    showState('error');
  }

  // ── Active tab ─────────────────────────────────────────────────────────────
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ── Inject content script ──────────────────────────────────────────────────
  function injectAndAnalyze() {
    currentJD = null;
    deepSection.style.display = 'none';
    deepBtn.style.display = 'block';
    deepPending = false;
    loadingLabel.textContent = 'Analyzing…';
    showState('loading');

    getActiveTab().then(tab => {
      if (!tab || !tab.id) { showError('Could not access the current tab.'); return; }
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ['content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            showError(`Script injection failed: ${chrome.runtime.lastError.message}`);
          }
        }
      );
    });
  }

  // ── Message listener (from content.js) ────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ANALYZE_ERROR') { showError(message.error); return; }
    if (message.type === 'ANALYZE') {
      currentJD = message.jobDescription;
      chrome.runtime.sendMessage(
        { type: 'ANALYZE', jobDescription: currentJD },
        handleAnalyzeResponse
      );
    }
  });

  function handleAnalyzeResponse(response) {
    if (chrome.runtime.lastError) { showError(chrome.runtime.lastError.message); return; }
    if (!response)                 { showError('No response from background. Try reloading the extension.'); return; }
    if (response.error)            { showError(response.error, { isSetup: response.isSetup, isAuth: response.isAuth }); return; }
    renderResult(response.result);
  }

  // ── Deep Analysis ──────────────────────────────────────────────────────────
  function triggerDeepAnalysis() {
    if (!currentJD || deepPending) return;
    deepPending = true;
    showState('loading');

    // Tell the user whether web search will run
    chrome.storage.local.get(['tavilyApiKey'], (d) => {
      loadingLabel.textContent = d.tavilyApiKey
        ? 'Searching web + analyzing…'
        : 'Running deep analysis…';
    });

    chrome.runtime.sendMessage(
      { type: 'DEEP_ANALYZE', jobDescription: currentJD },
      (response) => {
        deepPending = false;
        if (chrome.runtime.lastError) { showError(chrome.runtime.lastError.message); return; }
        if (!response)                { showError('No response from background.'); return; }
        if (response.error)           { showError(response.error, { isSetup: response.isSetup, isAuth: response.isAuth }); return; }

        renderResult(response.result);
        renderDeep(response.result);
      }
    );
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  settingsBtn.addEventListener('click', openOptions);
  goSetupBtn.addEventListener('click', openOptions);
  analyzeBtn.addEventListener('click', injectAndAnalyze);
  deepBtn.addEventListener('click', triggerDeepAnalysis);
  retryBtn.addEventListener('click', () => {
    if (currentJD) {
      loadingLabel.textContent = 'Analyzing…';
      showState('loading');
      chrome.runtime.sendMessage({ type: 'ANALYZE', jobDescription: currentJD }, handleAnalyzeResponse);
    } else {
      injectAndAnalyze();
    }
  });
  errorSetupBtn.addEventListener('click', openOptions);

  // ── Init ───────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['resume', 'groqApiKey'], (data) => {
    showState(!data.resume || !data.groqApiKey ? 'setup' : 'default');
  });
})();
