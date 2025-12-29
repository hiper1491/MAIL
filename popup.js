// Popup 邏輯
const MAIL_DATABASE_ID = '2d523f32ff398079a229c5c934fac033';

let emailData = null;
let notionOptions = null;

// 已選擇的 tags
let selectedMailCategory = [];
let selectedTagCategory = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    // 1. 檢查是否在 Gmail
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || !tab.url.includes('mail.google.com')) {
      showError('請在 Gmail 頁面使用此擴充功能');
      return;
    }

    // 2. 抓取郵件資料
    emailData = await chrome.tabs.sendMessage(tab.id, { action: 'getEmailData' });
    if (!emailData || !emailData.isEmailOpen) {
      showError('請先打開一封郵件');
      return;
    }

    // 3. 取得 Notion 選項
    const optionsResponse = await chrome.runtime.sendMessage({
      action: 'getNotionOptions',
      databaseId: MAIL_DATABASE_ID
    });

    if (optionsResponse.success) {
      notionOptions = optionsResponse.data;
    } else {
      console.error('Failed to get Notion options:', optionsResponse.error);
      notionOptions = {};
    }

    // 4. 顯示模式選擇
    showModeSelect();

  } catch (error) {
    console.error('Init error:', error);
    if (error.message.includes('Receiving end does not exist')) {
      showError('請重新整理 Gmail 頁面後再試');
    } else {
      showError('發生錯誤: ' + error.message);
    }
  }
}

function showError(msg) {
  hideAll();
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('error-msg').textContent = msg;
}

function hideAll() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('mode-select').classList.add('hidden');
  document.getElementById('mail-form').classList.add('hidden');
  document.getElementById('saving').classList.add('hidden');
  document.getElementById('success').classList.add('hidden');
}

function showModeSelect() {
  hideAll();
  document.getElementById('mode-select').classList.remove('hidden');

  document.getElementById('btn-mail').onclick = showMailForm;
  document.getElementById('btn-bill').onclick = showBillForm;
}

function showMailForm() {
  hideAll();
  document.getElementById('mail-form').classList.remove('hidden');

  // 填入自動帶入的欄位
  document.getElementById('mail-subject').value = emailData.subject || '';
  document.getElementById('mail-sender').value = emailData.senderEmail || '';
  document.getElementById('mail-date').value = emailData.receivedDate || '';

  // 設定郵件分類選項
  setupTagField(
    'mail-category-container',
    'mail-category-input',
    notionOptions['郵件分類'] || [],
    selectedMailCategory,
    true // 可新增
  );

  // 設定標籤分類選項
  setupTagField(
    'tag-category-container',
    'tag-category-input',
    notionOptions['標籤分類'] || [],
    selectedTagCategory,
    true // 可新增
  );

  // 設定處理狀況下拉選單
  setupSelect('mail-process-status', notionOptions['處理狀況'] || []);

  // 設定閱讀狀況下拉選單
  setupSelect('mail-read-status', notionOptions['閱讀狀況'] || []);

  // 顯示附件
  const attachmentsEl = document.getElementById('mail-attachments');
  if (emailData.attachments && emailData.attachments.length > 0) {
    attachmentsEl.innerHTML = emailData.attachments.map(att =>
      `<div class="attachment-item">📎 ${att.name}</div>`
    ).join('');
  } else {
    attachmentsEl.innerHTML = '<div class="no-attachments">無附件</div>';
  }

  // 按鈕事件
  document.getElementById('btn-back').onclick = showModeSelect;
  document.getElementById('btn-save-mail').onclick = saveMail;
}

function showBillForm() {
  // 之後實作
  alert('帳單模式尚未實作');
}

// 設定 tag 欄位（可選/可新增）
function setupTagField(containerId, inputId, existingOptions, selectedArray, allowNew) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);

  function render() {
    container.innerHTML = '';

    // 顯示現有選項
    existingOptions.forEach(opt => {
      const tag = document.createElement('span');
      tag.className = 'tag' + (selectedArray.includes(opt.name) ? ' selected' : '');
      tag.textContent = opt.name;

      if (selectedArray.includes(opt.name)) {
        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.textContent = '×';
        remove.onclick = (e) => {
          e.stopPropagation();
          const idx = selectedArray.indexOf(opt.name);
          if (idx > -1) selectedArray.splice(idx, 1);
          render();
        };
        tag.appendChild(remove);
      } else {
        tag.onclick = () => {
          selectedArray.push(opt.name);
          render();
        };
      }

      container.appendChild(tag);
    });

    // 顯示新增的 tags（不在現有選項中的）
    selectedArray.forEach(name => {
      if (!existingOptions.find(opt => opt.name === name)) {
        const tag = document.createElement('span');
        tag.className = 'tag selected';
        tag.textContent = name + ' (新)';

        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.textContent = '×';
        remove.onclick = (e) => {
          e.stopPropagation();
          const idx = selectedArray.indexOf(name);
          if (idx > -1) selectedArray.splice(idx, 1);
          render();
        };
        tag.appendChild(remove);

        container.appendChild(tag);
      }
    });
  }

  render();

  // 輸入新增
  if (allowNew) {
    input.classList.remove('hidden');
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value.trim();
        if (value && !selectedArray.includes(value)) {
          selectedArray.push(value);
          render();
        }
        input.value = '';
      }
    };
  } else {
    input.classList.add('hidden');
  }
}

// 設定下拉選單（只選不新增）
function setupSelect(selectId, options) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">-- 選擇 --</option>';

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.name;
    option.textContent = opt.name;
    select.appendChild(option);
  });
}

// 解析中文日期格式
function parseChineseDate(dateStr) {
  if (!dateStr) return null;

  // 格式：2025年12月29日下午10:35
  const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(上午|下午)?(\d{1,2}):(\d{2})/);
  if (match) {
    let [, year, month, day, ampm, hour, minute] = match;
    hour = parseInt(hour);

    if (ampm === '下午' && hour !== 12) {
      hour += 12;
    } else if (ampm === '上午' && hour === 12) {
      hour = 0;
    }

    // 回傳 ISO 格式
    const date = new Date(year, month - 1, day, hour, minute);
    return date.toISOString().split('T')[0]; // 只取日期部分
  }

  return null;
}

// 儲存郵件
async function saveMail() {
  hideAll();
  document.getElementById('saving').classList.remove('hidden');

  try {
    const processStatus = document.getElementById('mail-process-status').value;
    const readStatus = document.getElementById('mail-read-status').value;

    const data = {
      subject: emailData.subject,
      senderEmail: emailData.senderEmail,
      receivedDate: parseChineseDate(emailData.receivedDate),
      body: emailData.body,
      reason: document.getElementById('mail-reason').value,
      mailCategory: selectedMailCategory,
      tagCategory: selectedTagCategory,
      processStatus: processStatus ? [processStatus] : [],
      readStatus: readStatus ? [readStatus] : [],
      attachments: emailData.attachments || []
    };

    const response = await chrome.runtime.sendMessage({
      action: 'saveToNotion',
      mode: 'mail',
      data: data
    });

    if (response.success) {
      showSuccess(response.data.url);
    } else {
      showError('儲存失敗: ' + response.error);
    }

  } catch (error) {
    console.error('Save error:', error);
    showError('儲存失敗: ' + error.message);
  }
}

function showSuccess(notionUrl) {
  hideAll();
  document.getElementById('success').classList.remove('hidden');
  document.getElementById('notion-link').href = notionUrl;
  document.getElementById('btn-close').onclick = () => window.close();
}
