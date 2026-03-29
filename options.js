(() => {
  const resumeEl = document.getElementById('resume');
  const apiKeyEl = document.getElementById('apiKey');
  const saveBtn  = document.getElementById('saveBtn');
  const confirm  = document.getElementById('confirm');
  const toggleKey = document.getElementById('toggleKey');

  // Populate fields from storage on load
  chrome.storage.local.get(['resume', 'groqApiKey'], (data) => {
    if (data.resume)    resumeEl.value = data.resume;
    if (data.groqApiKey) apiKeyEl.value = data.groqApiKey;
  });

  // Toggle API key visibility
  toggleKey.addEventListener('click', () => {
    const isPassword = apiKeyEl.type === 'password';
    apiKeyEl.type = isPassword ? 'text' : 'password';
    toggleKey.textContent = isPassword ? 'Hide' : 'Show';
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

    chrome.storage.local.set({ resume, groqApiKey }, () => {
      confirm.classList.add('visible');
      setTimeout(() => confirm.classList.remove('visible'), 2500);
    });
  });
})();
