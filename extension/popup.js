const statusEl = document.getElementById('status');
const exportBtn = document.getElementById('exportBtn');
const refreshBtn = document.getElementById('refreshBtn');
const progressArea = document.getElementById('progress-area');
const progressStep = document.getElementById('progress-step');
const progressText = document.getElementById('progress-text');
const skippedWarning = document.getElementById('skipped-warning');
const skippedDetails = document.getElementById('skipped-details');
const authStatus = document.getElementById('auth-status');
const authText = document.getElementById('auth-text');

let currentBankId = null;

function updateAuthStatus(hasAuth, count, domains) {
  if (hasAuth && count > 0) {
    authStatus.classList.remove('pending');
    authStatus.classList.add('authenticated');
    const domainList = domains?.map(d => {
      try { return new URL(d).hostname; } catch { return d; }
    }).join(', ') || '';
    authText.textContent = `${count} token${count > 1 ? 's' : ''} captured`;
    authText.title = domainList; // Show domains on hover
  } else {
    authStatus.classList.remove('authenticated');
    authStatus.classList.add('pending');
    authText.textContent = 'No auth token captured';
    authText.title = '';
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "REQUEST_BANK" }, (response) => {
    // Update auth status with count and domains
    updateAuthStatus(response?.hasAuth, response?.authCount, response?.authDomains);
    
    if (response?.bank?.id) {
      currentBankId = response.bank.id;
      showBankDetected(currentBankId);
    } else {
      statusEl.textContent = "No bank detected. Navigate to an Item Bank in Canvas.";
      statusEl.classList.remove('detected');
      exportBtn.style.display = 'none';
    }
  });
}

function showBankDetected(bankId) {
  statusEl.textContent = `✅ Bank detected: ${bankId}`;
  statusEl.classList.add('detected');
  exportBtn.style.display = 'block';
}

// Refresh button click
refreshBtn.addEventListener('click', refresh);

// Export button click
exportBtn.addEventListener('click', () => {
  if (!currentBankId) return;
  
  exportBtn.disabled = true;
  progressArea.style.display = 'block';
  progressArea.classList.remove('success', 'error');
  skippedWarning.style.display = 'none';
  
  chrome.runtime.sendMessage({ 
    type: "EXPORT_BANK", 
    bankId: currentBankId 
  });
});

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.channel !== 'export') return;
  
  switch (msg.type) {
    case 'progress':
      progressStep.textContent = `Step ${msg.step}/6`;
      progressText.textContent = msg.message;
      break;
      
    case 'complete':
      progressStep.textContent = '✅ Complete';
      progressText.textContent = msg.message;
      progressArea.classList.add('success');
      exportBtn.disabled = false;
      
      // Show skipped items warning if any
      if (msg.skippedItems && msg.skippedItems.length > 0) {
        showSkippedWarning(msg.skippedItems);
      }
      break;
      
    case 'error':
      progressStep.textContent = '❌ Error';
      progressText.textContent = msg.error;
      progressArea.classList.add('error');
      exportBtn.disabled = false;
      break;
  }
});

function showSkippedWarning(skippedItems) {
  const typeCounts = {};
  for (const item of skippedItems) {
    const type = item.type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  
  const summary = Object.entries(typeCounts)
    .map(([type, count]) => `${type} (${count})`)
    .join(', ');
  
  skippedDetails.textContent = `${skippedItems.length} items skipped: ${summary}. See skipped_items.txt in the ZIP for details.`;
  skippedWarning.style.display = 'block';
}

// Initial load
refresh();
