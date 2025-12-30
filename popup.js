// Popup 邏輯 - 直接模式支援
let emailData = null;
let notionOptions = null;
let billOptions = null;

// 分類狀態（郵件用）
const categoryState = {
  mailCategory: { selected: null, options: [], newItems: [] },
  tagCategory: { selected: [], options: [], newItems: [] }
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 設定按鈕
  document.getElementById('btn-settings').onclick = () => {
    chrome.runtime.openOptionsPage();
  };

  try {
    // 1. 檢查設定狀態
    const settingsResult = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsResult.data || {};

    // 顯示模式狀態
    showModeStatus(settings);

    // 檢查是否已設定
    if (settings.mode === 'direct' && (!settings.notionKey || !settings.databaseId)) {
      showError('請先點右上角 ⚙️ 設定 Notion API Key');
      return;
    }

    // 2. 檢查是否在 Gmail
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || !tab.url.includes('mail.google.com')) {
      showError('請在 Gmail 頁面使用此擴充功能');
      return;
    }

    // 3. 抓取郵件資料
    emailData = await chrome.tabs.sendMessage(tab.id, { action: 'getEmailData' });
    if (!emailData || !emailData.isEmailOpen) {
      showError('請先打開一封郵件');
      return;
    }

    // 4. 取得 Notion 選項
    await loadNotionOptions();

    // 5. 顯示模式選擇
    showModeSelect();

  } catch (error) {
    console.error('Init error:', error);
    if (error.message && error.message.includes('Receiving end does not exist')) {
      showError('請重新整理 Gmail 頁面後再試');
    } else {
      showError('發生錯誤: ' + (error.message || '未知錯誤'));
    }
  }
}

// ============ 模式狀態顯示 ============
function showModeStatus(settings) {
  const statusEl = document.getElementById('connection-status');
  const textEl = document.getElementById('connection-text');

  statusEl.classList.remove('hidden', 'success', 'error', 'warning');

  if (settings.mode === 'direct') {
    if (settings.notionKey && settings.databaseId) {
      statusEl.classList.add('success');
      textEl.textContent = '直接模式（已設定）';
    } else {
      statusEl.classList.add('warning');
      textEl.textContent = '直接模式（尚未設定）';
    }
  } else {
    statusEl.classList.add('warning');
    textEl.textContent = 'Backend 模式';
  }
}

async function loadNotionOptions() {
  try {
    const optionsResponse = await chrome.runtime.sendMessage({ action: 'getNotionOptions' });

    if (optionsResponse && optionsResponse.success) {
      notionOptions = optionsResponse.data;
      categoryState.mailCategory.options = (notionOptions['郵件分類'] || []).map(o => o.name);
      categoryState.tagCategory.options = (notionOptions['標籤分類'] || []).map(o => o.name);
    } else {
      notionOptions = {};
    }
  } catch (optErr) {
    console.warn('取得選項失敗:', optErr.message);
    notionOptions = {};
  }
}

function showError(msg) {
  hideAll();
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('error-msg').textContent = msg;
}

function hideAll() {
  ['loading', 'error', 'mode-select', 'mail-form', 'bill-form', 'saving', 'success'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showModeSelect() {
  hideAll();
  document.getElementById('mode-select').classList.remove('hidden');
  document.getElementById('btn-mail').onclick = showMailForm;
  document.getElementById('btn-bill').onclick = showBillForm;
}

async function showMailForm() {
  hideAll();
  document.getElementById('mail-form').classList.remove('hidden');

  // 每次打開表單都重新讀取選項
  await loadNotionOptions();

  // 重置狀態
  categoryState.mailCategory.selected = null;
  categoryState.mailCategory.newItems = [];
  categoryState.tagCategory.selected = [];
  categoryState.tagCategory.newItems = [];

  // 填入郵件資訊
  document.getElementById('mail-subject').value = emailData.subject || '';
  document.getElementById('mail-sender').value = emailData.senderEmail || '';
  document.getElementById('mail-date').value = emailData.receivedDate || '';

  // 重設下拉選單
  document.getElementById('process-status-select').value = '待處理';
  document.getElementById('read-status-select').value = '未讀';

  // 初始化 Combobox
  initMailCategoryCombobox();
  initTagCategoryCombobox();

  // 顯示附件
  renderAttachments();

  // 按鈕事件
  document.getElementById('btn-back').onclick = showModeSelect;
  document.getElementById('btn-save-mail').onclick = saveMail;

  // 點擊外部關閉下拉選單
  document.removeEventListener('click', closeAllDropdowns);
  document.addEventListener('click', closeAllDropdowns);
}

// ============ 郵件分類 Combobox（單選） ============
function initMailCategoryCombobox() {
  const input = document.getElementById('mail-category-input');
  const dropdown = document.getElementById('mail-category-dropdown');
  const selectedContainer = document.getElementById('mail-category-selected');

  let highlightIndex = -1;

  function filterOptions(query) {
    const q = query.toLowerCase().trim();
    const options = categoryState.mailCategory.options;
    if (!q) return options;
    return options.filter(opt => opt.toLowerCase().includes(q));
  }

  function renderDropdown(query = '') {
    const filtered = filterOptions(query);
    const selected = categoryState.mailCategory.selected;
    const newItems = categoryState.mailCategory.newItems;

    dropdown.innerHTML = '';
    highlightIndex = -1;

    filtered.forEach((opt, index) => {
      const item = document.createElement('div');
      item.className = 'combobox-item';
      if (selected === opt) item.classList.add('selected');

      const isNew = newItems.includes(opt);
      item.innerHTML = `<span class="item-text">${isNew ? '✨ ' : ''}${opt}</span>`;

      item.onclick = (e) => {
        e.stopPropagation();
        categoryState.mailCategory.selected = opt;
        input.value = '';
        dropdown.classList.add('hidden');
        renderSelected();
      };

      item.onmouseenter = () => {
        highlightIndex = index;
        updateHighlight();
      };

      dropdown.appendChild(item);
    });

    const q = query.trim();
    if (q && !categoryState.mailCategory.options.some(o => o.toLowerCase() === q.toLowerCase())) {
      const addItem = document.createElement('div');
      addItem.className = 'combobox-item add-new';
      addItem.innerHTML = `<span class="item-text">✨ 新增「${q}」</span>`;
      addItem.onclick = (e) => {
        e.stopPropagation();
        if (!categoryState.mailCategory.options.includes(q)) {
          categoryState.mailCategory.options.push(q);
        }
        categoryState.mailCategory.newItems.push(q);
        categoryState.mailCategory.selected = q;
        input.value = '';
        dropdown.classList.add('hidden');
        renderSelected();
      };
      dropdown.appendChild(addItem);
    }

    if (dropdown.children.length === 0) {
      dropdown.innerHTML = '<div class="combobox-empty">沒有符合的選項</div>';
    }
  }

  function updateHighlight() {
    const items = dropdown.querySelectorAll('.combobox-item');
    items.forEach((item, i) => {
      item.classList.toggle('highlighted', i === highlightIndex);
    });
  }

  function renderSelected() {
    selectedContainer.innerHTML = '';
    const selected = categoryState.mailCategory.selected;
    if (!selected) return;

    const isNew = categoryState.mailCategory.newItems.includes(selected);
    const tag = document.createElement('span');
    tag.className = 'selected-tag' + (isNew ? ' new-tag' : '');
    tag.innerHTML = `${isNew ? '✨ ' : ''}${selected}<span class="remove-tag">×</span>`;

    tag.querySelector('.remove-tag').onclick = (e) => {
      e.stopPropagation();
      categoryState.mailCategory.selected = null;
      renderSelected();
    };

    selectedContainer.appendChild(tag);
  }

  input.onfocus = () => {
    renderDropdown(input.value);
    dropdown.classList.remove('hidden');
  };

  input.oninput = () => {
    renderDropdown(input.value);
    dropdown.classList.remove('hidden');
  };

  input.onkeydown = (e) => {
    const items = dropdown.querySelectorAll('.combobox-item');
    const count = items.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, count - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].click();
      } else if (input.value.trim()) {
        const q = input.value.trim();
        if (!categoryState.mailCategory.options.includes(q)) {
          categoryState.mailCategory.options.push(q);
        }
        categoryState.mailCategory.newItems.push(q);
        categoryState.mailCategory.selected = q;
        input.value = '';
        dropdown.classList.add('hidden');
        renderSelected();
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  };

  renderSelected();
}

// ============ 標籤分類 Combobox（多選） ============
function initTagCategoryCombobox() {
  const input = document.getElementById('tag-category-input');
  const dropdown = document.getElementById('tag-category-dropdown');
  const selectedContainer = document.getElementById('tag-category-selected');

  let highlightIndex = -1;

  function filterOptions(query) {
    const q = query.toLowerCase().trim();
    const options = categoryState.tagCategory.options;
    if (!q) return options;
    return options.filter(opt => opt.toLowerCase().includes(q));
  }

  function renderDropdown(query = '') {
    const filtered = filterOptions(query);
    const selected = categoryState.tagCategory.selected;
    const newItems = categoryState.tagCategory.newItems;

    dropdown.innerHTML = '';
    highlightIndex = -1;

    filtered.forEach((opt, index) => {
      const item = document.createElement('div');
      item.className = 'combobox-item';
      if (selected.includes(opt)) item.classList.add('selected');

      const isNew = newItems.includes(opt);
      item.innerHTML = `<span class="item-text">${isNew ? '✨ ' : ''}${opt}</span>`;

      item.onclick = (e) => {
        e.stopPropagation();
        if (selected.includes(opt)) {
          categoryState.tagCategory.selected = selected.filter(v => v !== opt);
        } else {
          categoryState.tagCategory.selected.push(opt);
        }
        input.value = '';
        renderDropdown('');
        renderSelected();
      };

      item.onmouseenter = () => {
        highlightIndex = index;
        updateHighlight();
      };

      dropdown.appendChild(item);
    });

    const q = query.trim();
    if (q && !categoryState.tagCategory.options.some(o => o.toLowerCase() === q.toLowerCase())) {
      const addItem = document.createElement('div');
      addItem.className = 'combobox-item add-new';
      addItem.innerHTML = `<span class="item-text">✨ 新增「${q}」</span>`;
      addItem.onclick = (e) => {
        e.stopPropagation();
        if (!categoryState.tagCategory.options.includes(q)) {
          categoryState.tagCategory.options.push(q);
        }
        categoryState.tagCategory.newItems.push(q);
        categoryState.tagCategory.selected.push(q);
        input.value = '';
        renderDropdown('');
        renderSelected();
      };
      dropdown.appendChild(addItem);
    }

    if (dropdown.children.length === 0) {
      dropdown.innerHTML = '<div class="combobox-empty">沒有符合的選項</div>';
    }
  }

  function updateHighlight() {
    const items = dropdown.querySelectorAll('.combobox-item');
    items.forEach((item, i) => {
      item.classList.toggle('highlighted', i === highlightIndex);
    });
  }

  function renderSelected() {
    selectedContainer.innerHTML = '';
    const selected = categoryState.tagCategory.selected;
    const newItems = categoryState.tagCategory.newItems;

    selected.forEach(value => {
      const isNew = newItems.includes(value);
      const tag = document.createElement('span');
      tag.className = 'selected-tag' + (isNew ? ' new-tag' : '');
      tag.innerHTML = `${isNew ? '✨ ' : ''}${value}<span class="remove-tag">×</span>`;

      tag.querySelector('.remove-tag').onclick = (e) => {
        e.stopPropagation();
        categoryState.tagCategory.selected = categoryState.tagCategory.selected.filter(v => v !== value);
        renderSelected();
        renderDropdown(input.value);
      };

      selectedContainer.appendChild(tag);
    });
  }

  input.onfocus = () => {
    renderDropdown(input.value);
    dropdown.classList.remove('hidden');
  };

  input.oninput = () => {
    renderDropdown(input.value);
    dropdown.classList.remove('hidden');
  };

  input.onkeydown = (e) => {
    const items = dropdown.querySelectorAll('.combobox-item');
    const count = items.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, count - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].click();
      } else if (input.value.trim()) {
        const q = input.value.trim();
        if (!categoryState.tagCategory.options.includes(q)) {
          categoryState.tagCategory.options.push(q);
        }
        categoryState.tagCategory.newItems.push(q);
        categoryState.tagCategory.selected.push(q);
        input.value = '';
        renderDropdown('');
        renderSelected();
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  };

  renderSelected();
}

function closeAllDropdowns(e) {
  if (!e.target.closest('.combobox')) {
    document.querySelectorAll('.combobox-dropdown').forEach(d => d.classList.add('hidden'));
  }
}

// ============ 附件渲染（簡化版：只顯示數量提示）============
function renderAttachments() {
  const container = document.getElementById('mail-attachments');
  const attachmentCount = (emailData.attachments || []).length;
  const imageCount = (emailData.inlineImages || []).length;

  if (attachmentCount === 0 && imageCount === 0) {
    container.innerHTML = '<div class="attachment-summary">這封信沒有附件或圖片</div>';
    return;
  }

  const parts = [];
  if (attachmentCount > 0) {
    parts.push(`${attachmentCount} 個附件`);
  }
  if (imageCount > 0) {
    parts.push(`${imageCount} 張圖片`);
  }

  container.innerHTML = `<div class="attachment-summary">已偵測到 ${parts.join('、')}，將一併存入 Notion</div>`;
}

// ============ 日期解析 ============
function parseChineseDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(上午|下午)?(\d{1,2}):(\d{2})/);
  if (match) {
    let [, year, month, day, ampm, hour] = match;
    hour = parseInt(hour);
    if (ampm === '下午' && hour !== 12) hour += 12;
    else if (ampm === '上午' && hour === 12) hour = 0;
    return new Date(year, month - 1, day, hour).toISOString().split('T')[0];
  }
  return null;
}

// ============ 儲存郵件 ============
async function saveMail() {
  hideAll();
  document.getElementById('saving').classList.remove('hidden');

  try {
    const data = {
      subject: emailData.subject,
      senderEmail: emailData.senderEmail,
      receivedDate: parseChineseDate(emailData.receivedDate),
      body: emailData.body,
      reason: document.getElementById('mail-reason').value,
      mailCategory: categoryState.mailCategory.selected,
      tagCategory: categoryState.tagCategory.selected,
      processStatus: document.getElementById('process-status-select').value,
      readStatus: document.getElementById('read-status-select').value,
      attachments: emailData.attachments || [],
      inlineImages: emailData.inlineImages || []
    };

    const response = await chrome.runtime.sendMessage({
      action: 'saveToNotion',
      mode: 'mail',
      data: data
    });

    if (response && response.success) {
      showSuccess(response.data);
    } else {
      showError('儲存失敗: ' + (response?.error || '未知錯誤'));
    }

  } catch (error) {
    console.error('Save error:', error);
    showError('儲存失敗: ' + (error.message || '連線失敗'));
  }
}

function showSuccess(result) {
  hideAll();
  document.getElementById('success').classList.remove('hidden');
  document.getElementById('notion-link').href = result.url;
  document.getElementById('btn-close').onclick = () => window.close();

  // 顯示附件統計
  const statsEl = document.getElementById('success-stats');
  if (statsEl) {
    const parts = [];
    if (result.attachmentCount > 0) {
      parts.push(`${result.attachmentCount} 個附件連結`);
    }
    if (result.imageCount > 0) {
      parts.push(`${result.imageCount} 張圖片`);
    }
    if (parts.length > 0) {
      statsEl.textContent = `已附上 ${parts.join('、')}`;
      statsEl.classList.remove('hidden');
    } else {
      statsEl.classList.add('hidden');
    }
  }
}

// ============ 帳單表單 ============
async function showBillForm() {
  hideAll();
  document.getElementById('bill-form').classList.remove('hidden');

  // 載入帳單資料庫選項
  await loadBillOptions();

  // 設定預設帳單月份為本月
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('bill-month').value = monthStr;

  // 清空其他欄位
  document.getElementById('bill-amount').value = '';
  document.getElementById('bill-note').value = '';

  // 顯示附件數量
  renderBillAttachments();

  // 按鈕事件
  document.getElementById('btn-bill-back').onclick = showModeSelect;
  document.getElementById('btn-save-bill').onclick = saveBill;
}

// 載入帳單資料庫選項
async function loadBillOptions() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getBillOptions' });

    if (response && response.success) {
      billOptions = response.data;
    } else {
      billOptions = {};
      if (response?.error) {
        console.warn('載入帳單選項失敗:', response.error);
      }
    }
  } catch (err) {
    console.warn('載入帳單選項失敗:', err.message);
    billOptions = {};
  }

  // 只填充「付款方式」下拉選單
  populateBillSelect('bill-payment-method', billOptions['付款方式'] || []);
}

// 填充帳單下拉選單（只能選，不能新增）
function populateBillSelect(selectId, options) {
  const select = document.getElementById(selectId);
  if (!select) return;

  // 保留第一個空選項
  select.innerHTML = '<option value="">-- 選擇 --</option>';

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.name;
    option.textContent = opt.name;
    select.appendChild(option);
  });
}

// 帳單附件顯示
function renderBillAttachments() {
  const container = document.getElementById('bill-attachments');
  const attachmentCount = (emailData.attachments || []).length;
  const imageCount = (emailData.inlineImages || []).length;

  if (attachmentCount === 0 && imageCount === 0) {
    container.innerHTML = '<div class="attachment-summary">這封信沒有附件或圖片</div>';
    return;
  }

  const parts = [];
  if (attachmentCount > 0) {
    parts.push(`${attachmentCount} 個附件`);
  }
  if (imageCount > 0) {
    parts.push(`${imageCount} 張圖片`);
  }

  container.innerHTML = `<div class="attachment-summary">已偵測到 ${parts.join('、')}，將一併存入 Notion</div>`;
}

// 儲存帳單
async function saveBill() {
  hideAll();
  document.getElementById('saving').classList.remove('hidden');

  try {
    // 處理帳單月份（轉成該月 1 號）
    const monthValue = document.getElementById('bill-month').value;
    let billMonth = null;
    if (monthValue) {
      billMonth = `${monthValue}-01`;
    }

    // 處理金額
    const amountValue = document.getElementById('bill-amount').value;
    const amount = amountValue ? parseFloat(amountValue) : null;

    // 只傳送指定的 4 個欄位 + 附件 + 郵件主旨（作為標題）
    const data = {
      emailSubject: emailData.subject || '',
      amount: amount,
      billMonth: billMonth,
      paymentMethod: document.getElementById('bill-payment-method').value || null,
      note: document.getElementById('bill-note').value || '',
      // 附件（沿用郵件版邏輯）
      attachments: emailData.attachments || [],
      inlineImages: emailData.inlineImages || []
    };

    const response = await chrome.runtime.sendMessage({
      action: 'saveBillToNotion',
      data: data
    });

    if (response && response.success) {
      showSuccess(response.data);
    } else {
      showError('儲存失敗: ' + (response?.error || '未知錯誤'));
    }

  } catch (error) {
    console.error('Save bill error:', error);
    showError('儲存失敗: ' + (error.message || '連線失敗'));
  }
}
