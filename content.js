(() => {
  /**
   * Try a list of CSS selectors in priority order.
   * Returns the innerText of the first matching element, or null.
   */
  function queryText(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 80) return text;
        }
      } catch (_) {
        // invalid selector — skip
      }
    }
    return null;
  }

  const SELECTORS = [
    '.jobs-description__content',            // LinkedIn primary
    '#jobDescriptionText',                   // Indeed
    '[data-testid="job-description"]',       // Greenhouse
    '.job-details-jobs-unified-top-card__job-insight', // LinkedIn fallback
    'article',                               // generic article tag
  ];

  let jobDescription = queryText(SELECTORS);

  // Last resort: grab body text, trimmed to 5000 chars
  if (!jobDescription) {
    jobDescription = document.body.innerText.slice(0, 5000).trim();
  }

  if (!jobDescription || jobDescription.length < 30) {
    chrome.runtime.sendMessage({
      type: 'ANALYZE_ERROR',
      error: 'Could not extract a job description from this page. Try navigating directly to the job listing.',
    });
    return;
  }

  chrome.runtime.sendMessage({
    type: 'ANALYZE',
    jobDescription,
  });
})();
