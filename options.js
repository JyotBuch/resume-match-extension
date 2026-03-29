(() => {
  const resumeEl     = document.getElementById('resume');
  const apiKeyEl     = document.getElementById('apiKey');
  const tavilyKeyEl  = document.getElementById('tavilyKey');
  const saveBtn      = document.getElementById('saveBtn');
  const confirm      = document.getElementById('confirm');
  const toggleKey    = document.getElementById('toggleKey');
  const toggleTavily = document.getElementById('toggleTavily');
  const parseStatus  = document.getElementById('parseStatus');
  const parseLabel   = document.getElementById('parseLabel');
  const parseSpinner = document.getElementById('parseSpinner');

  // Populate fields from storage on load
  chrome.storage.local.get(['resume', 'groqApiKey', 'tavilyApiKey'], (data) => {
    if (data.resume)       resumeEl.value    = data.resume;
    if (data.groqApiKey)   apiKeyEl.value    = data.groqApiKey;
    if (data.tavilyApiKey) tavilyKeyEl.value = data.tavilyApiKey;
  });

  // Toggle API key visibility
  toggleKey.addEventListener('click', () => {
    const isPassword = apiKeyEl.type === 'password';
    apiKeyEl.type = isPassword ? 'text' : 'password';
    toggleKey.textContent = isPassword ? 'Hide' : 'Show';
  });

  toggleTavily.addEventListener('click', () => {
    const isPassword = tavilyKeyEl.type === 'password';
    tavilyKeyEl.type = isPassword ? 'text' : 'password';
    toggleTavily.textContent = isPassword ? 'Hide' : 'Show';
  });

  // Save
  saveBtn.addEventListener('click', () => {
    const resume    = resumeEl.value.trim();
    const groqApiKey = apiKeyEl.value.trim();

    if (!resume) {
      alert('Please paste your resume text before saving.');
      resumeEl.focus();
      return;
    }
    if (!groqApiKey) {
      alert('Please enter your Groq API key before saving.');
      apiKeyEl.focus();
      return;
    }

    const tavilyApiKey = tavilyKeyEl.value.trim();

    // Clear any previously parsed resume so stale data isn't used while parsing
    chrome.storage.local.set({ resume, groqApiKey, tavilyApiKey: tavilyApiKey || null, parsedResume: null }, () => {
      confirm.classList.add('visible');
      setTimeout(() => confirm.classList.remove('visible'), 2500);

      // Kick off resume parse in background
      parseStatus.style.display = 'flex';
      parseSpinner.style.display = 'inline-block';
      parseLabel.textContent = 'Indexing resume structure…';
      saveBtn.disabled = true;

      chrome.runtime.sendMessage({ type: 'PARSE_RESUME' }, (response) => {
        parseSpinner.style.display = 'none';
        saveBtn.disabled = false;

        if (response?.parsed?.experiences?.length > 0) {
          const count = response.parsed.experiences.length;
          parseLabel.textContent = `✓ Indexed ${count} experience${count > 1 ? 's' : ''}`;
          parseLabel.style.color = 'var(--success)';
        } else {
          parseLabel.textContent = response?.error
            ? `⚠ Index failed: ${response.error}`
            : '⚠ Could not index experiences — analysis will still work';
          parseLabel.style.color = 'var(--warning)';
        }
      });
    });
  });
})();
