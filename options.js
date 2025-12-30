// Options 頁面邏輯
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 載入已儲存的設定
  const stored = await chrome.storage.local.get(['mode', 'notionKey', 'databaseId', 'billDatabaseId', 'backendUrl']);

  // 設定模式
  const mode = stored.mode || 'direct';
  document.querySelector(`input[value="${mode}"]`).checked = true;
  updateModeUI(mode);

  // 填入已儲存的值
  document.getElementById('notion-key').value = stored.notionKey || '';
  document.getElementById('database-id').value = stored.databaseId || '';
  document.getElementById('bill-database-id').value = stored.billDatabaseId || '';
  document.getElementById('backend-url').value = stored.backendUrl || '';

  // 模式選擇事件
  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateModeUI(e.target.value);
    });
  });

  // 儲存按鈕
  document.getElementById('btn-save').addEventListener('click', saveSettings);
}

function updateModeUI(mode) {
  // 更新選項樣式
  document.getElementById('option-direct').classList.toggle('selected', mode === 'direct');
  document.getElementById('option-backend').classList.toggle('selected', mode === 'backend');

  // 顯示對應設定區塊
  document.getElementById('direct-settings').classList.toggle('show', mode === 'direct');
  document.getElementById('backend-settings').classList.toggle('show', mode === 'backend');
}

async function saveSettings() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const notionKey = document.getElementById('notion-key').value.trim();
  const databaseId = document.getElementById('database-id').value.trim();
  const billDatabaseId = document.getElementById('bill-database-id').value.trim();
  const backendUrl = document.getElementById('backend-url').value.trim().replace(/\/+$/, '');

  // 驗證
  if (mode === 'direct') {
    if (!notionKey) {
      showStatus('error', '請輸入 Notion API Key');
      return;
    }
    if (!databaseId) {
      showStatus('error', '請輸入郵件資料庫 ID');
      return;
    }
  }

  // 儲存
  await chrome.storage.local.set({
    mode,
    notionKey,
    databaseId,
    billDatabaseId,
    backendUrl
  });

  showStatus('success', '設定已儲存！可以關閉此頁面。');
}

function showStatus(type, message) {
  const status = document.getElementById('status');
  status.className = type;
  status.textContent = message;
}
