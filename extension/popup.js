const statusEl = document.getElementById('status');
const exportBtn = document.getElementById('exportBtn');
const refreshBtn = document.getElementById('refreshBtn');
const progressArea = document.getElementById('progress-area');
const progressStep = document.getElementById('progress-step');
const progressText = document.getElementById('progress-text');
const progressBarContainer = document.getElementById('progress-bar-container');
const progressBar = document.getElementById('progress-bar');
const progressItem = document.getElementById('progress-item');
const progressTime = document.getElementById('progress-time');
const authStatus = document.getElementById('auth-status');
const authText = document.getElementById('auth-text');
const typeSummary = document.getElementById('type-summary');
const openFolderBtn = document.getElementById('open-folder-btn');
const warningsArea = document.getElementById('warnings-area');
const warningCount = document.getElementById('warning-count');
const warningsList = document.getElementById('warnings-list');
const warningsHeader = document.getElementById('warnings-header');
const warningsToggle = document.getElementById('warnings-toggle');
const versionEl = document.getElementById('version');

let itemStartTime = null;
let currentBankId = null;
let currentBankType = null;
let currentCourseId = null;
let lastDownloadId = null;

// Initialize version
versionEl.textContent = chrome.runtime.getManifest().version;

function updateAuthStatus(hasAuth, count, domains) {
  if (hasAuth && count > 0) {
    authStatus.classList.remove('pending');
    authStatus.classList.add('authenticated');
    const domainList = domains?.map(d => {
      try { return new URL(d).hostname; } catch { return d; }
    }).join(', ') || '';
    authText.textContent = `${count} token${count > 1 ? 's' : ''} captured`;
    authText.title = domainList;
  } else {
    authStatus.classList.remove('authenticated');
    authStatus.classList.add('pending');
    authText.textContent = 'No auth token captured';
    authText.title = '';
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "REQUEST_BANK" }, (response) => {
    updateAuthStatus(response?.hasAuth, response?.authCount, response?.authDomains);
    
    if (response?.bank?.id) {
      showBankDetected(response.bank);
    } else {
      showNoBank();
    }
  });
}

function showBankDetected(bank) {
  const typeIcon = bank.type === 'classic' ? '📘' : '📙';
  const typeLabel = bank.type === 'classic' ? 'Classic Quiz' : 'New Quizzes';
  const typeBadgeClass = bank.type === 'classic' ? 'classic' : 'new-quiz';
  const typeTooltip = bank.type === 'classic' 
    ? 'Parsed directly from Canvas page HTML' 
    : 'Fetched using Canvas public Item Bank API';
  
  const courseInfo = bank.courseId ? ` • Course ${bank.courseId}` : '';
  
  statusEl.innerHTML = `${typeIcon} Bank detected: <strong>${bank.id}</strong>${courseInfo}<span class="type-badge ${typeBadgeClass}" title="${typeTooltip}">${typeLabel}</span>`;
  statusEl.classList.add('detected');
  
  exportBtn.style.display = 'block';
  exportBtn.disabled = false;
  
  currentBankId = bank.id;
  currentBankType = bank.type || 'item_bank';
  currentCourseId = bank.courseId || null;
}

function showNoBank() {
  statusEl.textContent = "No question bank detected. Navigate to a Question Bank in Canvas.";
  statusEl.classList.remove('detected');
  exportBtn.style.display = 'block';
  exportBtn.disabled = true;
  exportBtn.textContent = '📄 Export JSON';
  
  currentBankId = null;
  currentBankType = null;
  currentCourseId = null;
}

refreshBtn.addEventListener('click', refresh);

exportBtn.addEventListener('click', () => {
  if (!currentBankId || exportBtn.disabled) return;
  
  exportBtn.disabled = true;
  progressArea.style.display = 'block';
  progressArea.classList.remove('success', 'error');
  progressBarContainer.style.display = 'none';
  progressBar.style.width = '0%';
  progressItem.style.display = 'none';
  progressItem.textContent = '';
  progressTime.style.display = 'none';
  progressTime.textContent = '';
  itemStartTime = null;
  typeSummary.style.display = 'none';
  openFolderBtn.style.display = 'none';
  warningsArea.style.display = 'none';
  
  chrome.runtime.sendMessage({ 
    type: "EXPORT_BANK", 
    bankId: currentBankId,
    bankType: currentBankType,
    courseId: currentCourseId
  });
});

openFolderBtn.addEventListener('click', () => {
  if (lastDownloadId) {
    chrome.downloads.show(lastDownloadId);
  }
});

warningsHeader.addEventListener('click', () => {
  warningsList.classList.toggle('collapsed');
  warningsToggle.textContent = warningsList.classList.contains('collapsed') ? '▶' : '▼';
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.channel !== 'export') return;
  
  switch (msg.type) {
    case 'progress':
      progressStep.textContent = `Step ${msg.step}/4`;
      progressText.textContent = msg.message;
      if (msg.step !== 3) {
        progressBarContainer.style.display = 'none';
        progressItem.style.display = 'none';
      }
      break;
    
    case 'item-progress':
      if (!itemStartTime) {
        itemStartTime = Date.now();
      }
      
      progressBarContainer.style.display = 'block';
      progressItem.style.display = 'block';
      progressTime.style.display = 'block';
      
      const percent = Math.round((msg.current / msg.total) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `Processing ${msg.current}/${msg.total} items...`;
      progressItem.textContent = msg.itemTitle ? `📝 ${msg.itemTitle}` : `Item ${msg.current}`;
      
      if (msg.current > 1) {
        const elapsed = Date.now() - itemStartTime;
        const avgTimePerItem = elapsed / msg.current;
        const remaining = msg.total - msg.current;
        const estimatedMs = avgTimePerItem * remaining;
        progressTime.textContent = `⏱️ ${formatTimeRemaining(estimatedMs)} remaining`;
      } else {
        progressTime.textContent = '⏱️ Calculating...';
      }
      break;
      
    case 'complete':
      progressStep.textContent = '✅ Complete';
      
      // Handle structured complete message
      if (typeof msg.data === 'object') {
        progressText.textContent = msg.data.message || 'Export complete!';
        
        // Store download ID for "Open folder" feature
        if (msg.data.downloadId) {
          lastDownloadId = msg.data.downloadId;
          openFolderBtn.style.display = 'block';
        }
        
        // Show warnings if any
        if (msg.data.warnings && msg.data.warnings.length > 0) {
          showWarnings(msg.data.warnings);
        }
        
        // Show type summary
        if (msg.data.typeCounts) {
          const summary = Object.entries(msg.data.typeCounts)
            .map(([t, c]) => `${t}: ${c}`)
            .join(', ');
          typeSummary.textContent = summary;
          typeSummary.style.display = 'block';
        }
      } else {
        progressText.textContent = msg.message || 'Export complete!';
      }
      
      progressArea.classList.add('success');
      exportBtn.disabled = false;
      break;
      
    case 'error':
      progressStep.textContent = '❌ Error';
      
      // Handle structured error
      if (typeof msg.data === 'object') {
        progressText.innerHTML = `
          <strong>${msg.data.reason || 'Export failed'}</strong><br>
          ${msg.data.message}<br>
          <em style="color: #666; font-size: 11px;">Fix: ${msg.data.fix || 'Try again'}</em>
        `;
      } else {
        progressText.textContent = msg.error || 'Export failed';
      }
      
      progressArea.classList.add('error');
      exportBtn.disabled = false;
      break;
  }
});

function formatTimeRemaining(ms) {
  if (ms < 1000) return 'less than 1s';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) {
    return remainingSecs > 0 ? `~${minutes}m ${remainingSecs}s` : `~${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `~${hours}h ${remainingMins}m`;
}

function showWarnings(warnings) {
  warningsArea.style.display = 'block';
  warningCount.textContent = `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`;
  
  warningsList.innerHTML = warnings.map(w => 
    `<div class="warning-item">• Q${w.questionId}: ${w.message}</div>`
  ).join('');
  
  warningsList.classList.remove('collapsed');
  warningsToggle.textContent = '▼';
}

refresh();
