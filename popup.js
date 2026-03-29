(() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let currentJD     = null;  // scraped job description, preserved for Deep Analysis
  let deepPending   = false; // guard against double-clicks on Deep Analysis

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
  const deepSection  = document.getElementById('deepSection');
  const rewritesList = document.getElementById('rewritesList');
  const atsChips     = document.getElementById('atsChips');
  const feedbackPara = document.getElementById('feedbackPara');
  const disclaimer   = document.getElementById('disclaimer');
  const errorMsg     = document.getElementById('errorMsg');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showState(name) {
    Object.entries(states).forEach(([key, el]) => {
      el.classList.toggle('active', key === name);
    });
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  function makeChip(text, cls) {
    const span = document.createElement('span');
    span.className = `chip ${cls}`;
    span.textContent = text;
    return span;
  }

  // Score ring — circumference for r=46 is 2π×46 ≈ 289
  const CIRC = 2 * Math.PI * 46;

  function animateRing(pct) {
    const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    scoreFill.style.stroke = color;
    scoreNumber.style.color = color;

    // Start at fully hidden, animate to target offset
    scoreFill.style.strokeDasharray  = `${CIRC} ${CIRC}`;
    scoreFill.style.strokeDashoffset = CIRC;

    // Force reflow so transition fires
    scoreFill.getBoundingClientRect();
    scoreFill.style.strokeDashoffset = CIRC * (1 - pct / 100);
  }

  // ── Render result ──────────────────────────────────────────────────────────
  function renderResult(result) {
    const pct = Math.max(0, Math.min(100, Math.round(result.match_pct || 0)));

    scoreNumber.textContent = `${pct}%`;
    verdictText.textContent = result.verdict || '';

    matchedChips.innerHTML = '';
    missingChips.innerHTML = '';

    (result.matched_skills || []).forEach(s => matchedChips.appendChild(makeChip(s, 'chip-success')));
    (result.missing_skills  || []).forEach(s => missingChips.appendChild(makeChip(s, 'chip-danger')));

    // Score ring animates after a tiny delay (let DOM paint first)
    requestAnimationFrame(() => animateRing(pct));

    disclaimer.textContent = `Powered by Groq · ${result._model || 'llama-3.1-8b-instant'}`;
    showState('result');
  }

  // ── Render deep additions ─────────────────────────────────────────────────
  function renderDeep(result) {
    rewritesList.innerHTML = '';
    atsChips.innerHTML     = '';
    feedbackPara.textContent = '';

    (result.bullet_rewrites || []).forEach(({ original, improved }) => {
      const card = document.createElement('div');
      card.className = 'rewrite-card';
      card.innerHTML = `
        <div class="rewrite-label rewrite-original">Before</div>
        <p class="rewrite-text">${escHtml(original)}</p>
        <div class="arrow">↓</div>
        <div class="rewrite-label rewrite-improved">After</div>
        <p class="rewrite-text" style="color:var(--success)">${escHtml(improved)}</p>
      `;
      rewritesList.appendChild(card);
    });

    (result.keywords_to_add || []).forEach(kw => atsChips.appendChild(makeChip(kw, 'chip-accent')));

    feedbackPara.textContent = result.detailed_feedback || '';
    deepSection.style.display = 'block';
    disclaimer.textContent = `Powered by Groq · ${result._model || 'llama-3.3-70b-versatile'}`;
    deepBtn.style.display = 'none';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Show error ─────────────────────────────────────────────────────────────
  function showError(msg, { isSetup = false, isAuth = false } = {}) {
    errorMsg.textContent = msg;
    errorSetupBtn.style.display = (isSetup || isAuth) ? 'block' : 'none';
    showState('error');
  }

  // ── Get active tab ─────────────────────────────────────────────────────────
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ── Inject content script and wait for ANALYZE message ────────────────────
  function injectAndAnalyze() {
    currentJD = null;
    deepSection.style.display = 'none';
    deepBtn.style.display = 'block';
    deepPending = false;
    loadingLabel.textContent = 'Analyzing…';
    showState('loading');

    getActiveTab().then(tab => {
      if (!tab || !tab.id) {
        showError('Could not access the current tab.');
        return;
      }

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

  // ── Listen for messages from content.js / background.js ───────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ANALYZE_ERROR') {
      showError(message.error);
      return;
    }

    if (message.type === 'ANALYZE') {
      // Forward to background for processing
      currentJD = message.jobDescription;
      chrome.runtime.sendMessage({ type: 'ANALYZE', jobDescription: currentJD }, handleAnalyzeResponse);
    }
  });

  function handleAnalyzeResponse(response) {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }
    if (!response) {
      showError('No response from background. Try reloading the extension.');
      return;
    }
    if (response.error) {
      showError(response.error, { isSetup: response.isSetup, isAuth: response.isAuth });
      return;
    }
    renderResult(response.result);
  }

  // ── Deep Analysis ──────────────────────────────────────────────────────────
  function triggerDeepAnalysis() {
    if (!currentJD || deepPending) return;
    deepPending = true;
    loadingLabel.textContent = 'Running deep analysis…';
    showState('loading');

    chrome.runtime.sendMessage(
      { type: 'DEEP_ANALYZE', jobDescription: currentJD },
      (response) => {
        deepPending = false;
        if (chrome.runtime.lastError) {
          showError(chrome.runtime.lastError.message);
          return;
        }
        if (!response) {
          showError('No response from background.');
          return;
        }
        if (response.error) {
          showError(response.error, { isSetup: response.isSetup, isAuth: response.isAuth });
          return;
        }

        // Re-render base result with 70B data, then append deep section
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
      // We already have a JD; re-run analysis without re-injecting
      loadingLabel.textContent = 'Analyzing…';
      showState('loading');
      chrome.runtime.sendMessage({ type: 'ANALYZE', jobDescription: currentJD }, handleAnalyzeResponse);
    } else {
      injectAndAnalyze();
    }
  });
  errorSetupBtn.addEventListener('click', openOptions);

  // ── Init: check storage for resume + key ──────────────────────────────────
  chrome.storage.local.get(['resume', 'groqApiKey'], (data) => {
    if (!data.resume || !data.groqApiKey) {
      showState('setup');
    } else {
      showState('default');
    }
  });
})();
