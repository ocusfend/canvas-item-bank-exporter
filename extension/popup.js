// ========== THEME MANAGEMENT ==========

const themeToggle = document.getElementById('theme-toggle');
const THEME_KEY = 'themePreference';

// Get system preference
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Apply theme to document
function applyTheme(theme) {
  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

// Update toggle button states
function updateThemeButtons(activeTheme) {
  themeToggle.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

// Load and apply saved theme
function loadTheme() {
  chrome.storage.local.get([THEME_KEY], (result) => {
    const savedTheme = result[THEME_KEY] || 'system';
    applyTheme(savedTheme);
    updateThemeButtons(savedTheme);
  });
}

// Save theme preference
function saveTheme(theme) {
  chrome.storage.local.set({ [THEME_KEY]: theme });
}

// Listen for system theme changes (when in "system" mode)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  chrome.storage.local.get([THEME_KEY], (result) => {
    if (result[THEME_KEY] === 'system' || !result[THEME_KEY]) {
      applyTheme('system');
    }
  });
});

// Theme toggle click handler
themeToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  
  const theme = btn.dataset.theme;
  applyTheme(theme);
  updateThemeButtons(theme);
  saveTheme(theme);
});

// Initialize theme on load (call immediately)
loadTheme();

// ========== UI ELEMENT REFERENCES ==========

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

// Batch export elements
const bankListArea = document.getElementById('bank-list-area');
const bankList = document.getElementById('bank-list');
const bankCountEl = document.getElementById('bank-count');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const exportBatchBtn = document.getElementById('exportBatchBtn');
const selectionSummary = document.getElementById('selection-summary');
const floatingStatus = document.getElementById('floating-status');
const helpIcon = document.getElementById('help-icon');
const helpPopup = document.getElementById('help-popup');

let itemStartTime = null;
let currentBankId = null;
let currentBankType = null;
let currentCourseId = null;
let lastDownloadId = null;
let currentBankList = null;
let batchExportInProgress = false;

// Initialize version
versionEl.textContent = chrome.runtime.getManifest().version;

// ========== HELP CONTENT (Context-Aware) ==========

const helpContent = document.getElementById('help-content');

function updateHelpContent(mode) {
  if (mode === 'new-quiz') {
    helpContent.innerHTML = `
      <p><strong>New Quizzes Item Banks</strong> use Canvas's modern quiz system.</p>
      <p>Questions are fetched via the Canvas Item Bank API.</p>
      <p>Export saves all questions from this bank as a single JSON file.</p>
    `;
  } else if (mode === 'classic-batch') {
    helpContent.innerHTML = `
      <p><strong>Classic Quiz Question Banks</strong> are the original Canvas quiz storage system.</p>
      <p><strong>Batch export</strong> saves each selected bank as a separate JSON file.</p>
      <p>Use <kbd>Ctrl+A</kbd> to select all, <kbd>Ctrl+Enter</kbd> to export.</p>
    `;
  } else {
    // Default/no bank detected
    helpContent.innerHTML = `
      <p>Navigate to a <strong>Question Bank</strong> page in Canvas to export questions.</p>
      <p>Supports both <strong>Classic Quiz</strong> and <strong>New Quizzes</strong> Item Banks.</p>
    `;
  }
}

// Initialize help content
updateHelpContent('default');

// ========== UTILITY FUNCTIONS ==========

function humanDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} sec`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m} min ${rem} sec` : `${m} min`;
}

function animateNumber(el, start, end, duration = 300) {
  const diff = end - start;
  const startTime = performance.now();
  function frame(t) {
    const progress = Math.min((t - startTime) / duration, 1);
    el.textContent = Math.floor(start + diff * progress);
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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

// ========== AUTH STATUS ==========

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

// ========== SELECTION PERSISTENCE ==========

function restoreSelectionState() {
  chrome.storage.session.get(['selectedBankIds'], ({ selectedBankIds }) => {
    if (selectedBankIds && currentBankList) {
      const checkboxes = bankList.querySelectorAll('.bank-checkbox');
      checkboxes.forEach(cb => {
        const idx = parseInt(cb.dataset.idx, 10);
        const bank = currentBankList.banks[idx];
        if (bank && selectedBankIds.includes(bank.id)) {
          cb.checked = true;
        }
      });
      updateSelectAllState();
      updateExportBatchButton();
    }
  });
}

function saveSelectionState() {
  if (!currentBankList) return;
  const selectedBankIds = getSelectedBanks().map(b => b.id);
  chrome.storage.session.set({ selectedBankIds });
}

// ========== REFRESH & DETECTION ==========

function refresh() {
  chrome.runtime.sendMessage({ type: "REQUEST_BANK" }, (response) => {
    updateAuthStatus(response?.hasAuth, response?.authCount, response?.authDomains);
    
    // Check for bank list first (batch export mode)
    if (response?.bankList?.banks?.length > 0) {
      showBankList(response.bankList);
    } else if (response?.bank?.id) {
      // Hide batch UI, show single export
      bankListArea.style.display = 'none';
      exportBatchBtn.style.display = 'none';
      showBankDetected(response.bank);
    } else {
      bankListArea.style.display = 'none';
      exportBatchBtn.style.display = 'none';
      showNoBank();
    }
  });
}

// ========== SINGLE BANK EXPORT UI ==========

const ICONS = {
  bookClassic: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
  bookNew: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  books: '<svg class="icon icon-lg" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>',
  fileDown: '<svg class="icon" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>',
  search: '<svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  fileText: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  clock: '<svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  checkCircle: '<svg class="icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
  xCircle: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  chevronDown: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  chevronRight: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>'
};

function showBankDetected(bank) {
  const typeIcon = bank.type === 'classic' ? ICONS.bookClassic : ICONS.bookNew;
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
  
  // Update help content based on bank type
  updateHelpContent(bank.type === 'classic' ? 'classic-batch' : 'new-quiz');
}

function showNoBank() {
  statusEl.textContent = "No question bank detected. Navigate to a Question Bank in Canvas.";
  statusEl.classList.remove('detected');
  exportBtn.style.display = 'block';
  exportBtn.disabled = true;
  exportBtn.innerHTML = `${ICONS.fileDown} Export JSON`;
  
  currentBankId = null;
  currentBankType = null;
  currentCourseId = null;
  
  // Update help content for default state
  updateHelpContent('default');
}

// ========== BATCH EXPORT UI ==========

function showBankList(bankListData) {
  currentBankList = bankListData;
  const { courseId, banks } = bankListData;
  
  statusEl.innerHTML = `${ICONS.books} Course ${courseId}: <strong>${banks.length} Question Banks</strong>`;
  statusEl.classList.add('detected');
  
  // Hide single export button, show batch UI
  exportBtn.style.display = 'none';
  bankListArea.style.display = 'block';
  exportBatchBtn.style.display = 'block';
  
  // Update help content for batch mode
  updateHelpContent('classic-batch');
  
  // Animated counter
  animateNumber(bankCountEl, 0, banks.length);
  
  bankList.innerHTML = banks.map((bank, idx) => `
    <div class="bank-item" data-idx="${idx}" data-bank-id="${bank.id}">
      <label>
        <input type="checkbox" class="bank-checkbox" data-idx="${idx}">
        <span class="bank-title">${escapeHtml(bank.title)}</span>
        <span class="bank-count">${bank.questionCount} Q</span>
      </label>
      <span class="bank-preview" title="Open bank in Canvas" data-bank-id="${bank.id}">${ICONS.search}</span>
    </div>
  `).join('');
  
  // Add preview click handlers
  bankList.querySelectorAll('.bank-preview').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const bankId = el.dataset.bankId;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0]?.url || '';
        const match = currentUrl.match(/https?:\/\/([^\/]+)/);
        const host = match ? match[0] : '';
        const url = `${host}/courses/${courseId}/question_banks/${bankId}`;
        chrome.tabs.update({ url });
      });
    });
  });
  
  restoreSelectionState();
  updateExportBatchButton();
}

function updateSelectAllState() {
  const checkboxes = bankList.querySelectorAll('.bank-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  const noneChecked = Array.from(checkboxes).every(cb => !cb.checked);
  
  selectAllCheckbox.checked = allChecked;
  selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
}

function updateExportBatchButton() {
  const selected = getSelectedBanks();
  const count = selected.length;
  
  exportBatchBtn.innerHTML = `${ICONS.fileDown} Export Selected (${count})`;
  
  // Update selection summary with total questions
  if (count > 0) {
    const totalQ = selected.reduce((sum, b) => sum + b.questionCount, 0);
    selectionSummary.textContent = `${count} bank${count > 1 ? 's' : ''} selected (${totalQ} questions)`;
  } else {
    selectionSummary.textContent = '';
  }
  
  if (batchExportInProgress) {
    exportBatchBtn.disabled = true;
    exportBatchBtn.title = "Export in progress...";
  } else if (count === 0) {
    exportBatchBtn.disabled = true;
    exportBatchBtn.title = "Select at least one bank";
  } else {
    exportBatchBtn.disabled = false;
    exportBatchBtn.title = `Export ${count} bank${count > 1 ? 's' : ''} as individual JSON files`;
  }
  
  saveSelectionState();
}

function getSelectedBanks() {
  if (!currentBankList) return [];
  const checkboxes = bankList.querySelectorAll('.bank-checkbox:checked');
  return Array.from(checkboxes).map(cb => {
    const idx = parseInt(cb.dataset.idx, 10);
    return currentBankList.banks[idx];
  });
}

function startBatchExport() {
  const selected = getSelectedBanks();
  if (selected.length === 0 || batchExportInProgress) return;
  
  batchExportInProgress = true;
  
  // UI lockdown
  bankList.classList.add('disabled');
  exportBatchBtn.classList.add('in-progress');
  exportBatchBtn.disabled = true;
  exportBatchBtn.title = "Export in progress...";
  
  // Show floating status
  floatingStatus.classList.add('visible');
  
  progressArea.style.display = 'block';
  progressArea.classList.remove('success', 'error', 'shine');
  progressBarContainer.style.display = 'block';
  progressBar.style.width = '0%';
  
  chrome.runtime.sendMessage({
    type: "EXPORT_BATCH",
    banks: selected,
    courseId: currentBankList.courseId
  });
}

// ========== EVENT LISTENERS ==========

refreshBtn.addEventListener('click', refresh);

// Help toggle
helpIcon.addEventListener('click', () => {
  helpPopup.classList.toggle('hidden');
});

// Close help when clicking outside
document.addEventListener('click', (e) => {
  if (!helpIcon.contains(e.target) && !helpPopup.contains(e.target)) {
    helpPopup.classList.add('hidden');
  }
});

// Select All checkbox
selectAllCheckbox.addEventListener('change', () => {
  const checkboxes = bankList.querySelectorAll('.bank-checkbox');
  checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
  updateExportBatchButton();
});

// Bank checkbox changes
bankList.addEventListener('change', (e) => {
  if (e.target.classList.contains('bank-checkbox')) {
    updateSelectAllState();
    updateExportBatchButton();
  }
});

// Export batch button
exportBatchBtn.addEventListener('click', startBatchExport);

// Single export button
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
  warningsToggle.innerHTML = warningsList.classList.contains('collapsed') ? ICONS.chevronRight : ICONS.chevronDown;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Only when bank list is visible and not in progress
  if (bankListArea.style.display === 'none' || batchExportInProgress) return;
  
  // Ctrl/Cmd + A: Select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    selectAllCheckbox.checked = true;
    const checkboxes = bankList.querySelectorAll('.bank-checkbox');
    checkboxes.forEach(cb => cb.checked = true);
    updateSelectAllState();
    updateExportBatchButton();
  }
  
  // Ctrl/Cmd + Shift + S or Ctrl/Cmd + Enter: Export
  if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || (e.shiftKey && e.key === 's'))) {
    e.preventDefault();
    if (!exportBatchBtn.disabled) {
      startBatchExport();
    }
  }
});

// ========== MESSAGE HANDLERS ==========

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
      progressItem.innerHTML = msg.itemTitle ? `${ICONS.fileText} ${msg.itemTitle}` : `Item ${msg.current}`;
      
      if (msg.current > 1) {
        const elapsed = Date.now() - itemStartTime;
        const avgTimePerItem = elapsed / msg.current;
        const remaining = msg.total - msg.current;
        const estimatedMs = avgTimePerItem * remaining;
        progressTime.innerHTML = `${ICONS.clock} ${formatTimeRemaining(estimatedMs)} remaining`;
      } else {
        progressTime.innerHTML = `${ICONS.clock} Calculating...`;
      }
      break;
    
    case 'batch-progress':
      progressStep.textContent = `Bank ${msg.current}/${msg.total}`;
      progressText.textContent = `Exporting: ${msg.bankTitle}`;
      progressBar.style.width = `${(msg.current / msg.total) * 100}%`;
      // Update floating status
      floatingStatus.textContent = `Exporting ${msg.current}/${msg.total}…`;
      break;
    
    case 'batch-complete':
      handleBatchComplete(msg.results);
      break;
    
    case 'batch-error':
      handleBatchError(msg.error);
      break;
      
    case 'complete':
      progressStep.innerHTML = `${ICONS.checkCircle} Complete`;
      
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
      progressStep.innerHTML = `${ICONS.xCircle} Error`;
      
      // Handle structured error
      if (typeof msg.data === 'object') {
        progressText.innerHTML = `
          <strong>${msg.data.reason || 'Export failed'}</strong><br>
          ${msg.data.message}<br>
          <em style="color: var(--text-muted); font-size: 11px;">Fix: ${msg.data.fix || 'Try again'}</em>
        `;
      } else {
        progressText.textContent = msg.error || 'Export failed';
      }
      
      progressArea.classList.add('error');
      exportBtn.disabled = false;
      break;
  }
});

// ========== BATCH COMPLETE/ERROR HANDLERS ==========

function handleBatchComplete(results) {
  batchExportInProgress = false;
  const { success, failed, totalDurationMs } = results;
  
  // Unlock UI
  bankList.classList.remove('disabled');
  exportBatchBtn.classList.remove('in-progress');
  
  // Hide floating status
  floatingStatus.classList.remove('visible');
  
  // Highlight failed banks (with fade-out)
  if (failed.length > 0) {
    failed.forEach(f => {
      const bankItem = bankList.querySelector(`.bank-item[data-bank-id="${f.id}"]`);
      if (bankItem) {
        bankItem.classList.add('failed');
        // Fade out after 4 seconds
        setTimeout(() => bankItem.classList.remove('failed'), 4000);
      }
    });
  }
  
  // Summary with humanized duration
  const durationStr = humanDuration(totalDurationMs);
  progressStep.innerHTML = `${ICONS.checkCircle} Batch Complete`;
  
  let summaryText = `${success.length} exported`;
  if (failed.length) summaryText += `, ${failed.length} failed`;
  summaryText += ` in ${durationStr}`;
  
  progressText.innerHTML = summaryText;
  
  if (failed.length > 0) {
    const failedList = failed.map(f => `• ${f.title}: ${f.error}`).join('<br>');
    progressText.innerHTML += `<div class="batch-summary" style="color: var(--error-text); margin-top: 8px;">Failed:<br>${failedList}</div>`;
  }
  
  progressArea.classList.add('success');
  
  // Shine animation
  progressArea.classList.add('shine');
  setTimeout(() => progressArea.classList.remove('shine'), 1500);
  
  updateExportBatchButton();
  
  // Scroll to bottom
  document.body.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function handleBatchError(error) {
  batchExportInProgress = false;
  
  bankList.classList.remove('disabled');
  exportBatchBtn.classList.remove('in-progress');
  floatingStatus.classList.remove('visible');
  
  progressStep.innerHTML = `${ICONS.xCircle} Batch Error`;
  progressText.textContent = error;
  progressArea.classList.add('error');
  updateExportBatchButton();
  
  document.body.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function showWarnings(warnings) {
  warningsArea.style.display = 'block';
  warningCount.textContent = `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`;
  
  warningsList.innerHTML = warnings.map(w => 
    `<div class="warning-item">• Q${w.questionId}: ${w.message}</div>`
  ).join('');
  
  warningsList.classList.remove('collapsed');
  warningsToggle.innerHTML = ICONS.chevronDown;
}

// Initial refresh
refresh();
