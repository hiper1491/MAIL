// Service Worker - 支援直接模式和 Backend 模式
console.log('Gmail to Notion: Service Worker loaded');

const NOTION_API_VERSION = '2022-06-28';

// 取得設定
async function getSettings() {
  const stored = await chrome.storage.local.get(['mode', 'notionKey', 'databaseId', 'billDatabaseId', 'backendUrl']);
  return {
    mode: stored.mode || 'direct',
    notionKey: stored.notionKey || '',
    databaseId: stored.databaseId || '',
    billDatabaseId: stored.billDatabaseId || '',
    backendUrl: stored.backendUrl || ''
  };
}

// 監聽訊息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Background received:', request.action);

  if (request.action === 'saveToNotion') {
    handleSave(request.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getNotionOptions') {
    handleGetOptions()
      .then(options => sendResponse({ success: true, data: options }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    getSettings()
      .then(settings => sendResponse({ success: true, data: settings }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 帳單相關
  if (request.action === 'getBillOptions') {
    handleGetBillOptions()
      .then(options => sendResponse({ success: true, data: options }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'saveBillToNotion') {
    handleSaveBill(request.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// ============ 儲存郵件 ============
async function handleSave(data) {
  const settings = await getSettings();

  if (settings.mode === 'direct') {
    return await saveDirectToNotion(data, settings);
  } else {
    return await saveViaBackend(data, settings);
  }
}

// 直接模式：Extension 直接呼叫 Notion API
async function saveDirectToNotion(data, settings) {
  if (!settings.notionKey || !settings.databaseId) {
    throw new Error('請先到設定頁面填入 Notion API Key 和 Database ID');
  }

  // 1. 建立 Page
  const pageData = {
    parent: { database_id: settings.databaseId },
    icon: { type: 'emoji', emoji: '📧' },
    properties: {
      '名稱': {
        title: [{ text: { content: data.subject || '無主旨' } }]
      },
      '寄件人郵件': {
        email: data.senderEmail || null
      },
      '收件日期': {
        date: data.receivedDate ? { start: data.receivedDate } : null
      },
      '為什麼要存？': {
        rich_text: data.reason ? [{ text: { content: data.reason } }] : []
      }
    }
  };

  // 選填屬性
  if (data.mailCategory) {
    pageData.properties['郵件分類'] = { select: { name: data.mailCategory } };
  }
  if (data.tagCategory && data.tagCategory.length > 0) {
    pageData.properties['標籤分類'] = { multi_select: data.tagCategory.map(name => ({ name })) };
  }
  if (data.processStatus) {
    pageData.properties['處理狀況'] = { select: { name: data.processStatus } };
  }
  if (data.readStatus) {
    pageData.properties['閱讀狀況'] = { select: { name: data.readStatus } };
  }

  console.log('[Direct] Creating page...');

  const createRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.notionKey}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(pageData)
  });

  if (!createRes.ok) {
    const error = await createRes.json();
    console.error('[Direct] Create page error:', error);
    throw new Error(error.message || '建立頁面失敗');
  }

  const page = await createRes.json();
  console.log('[Direct] Page created:', page.id);

  // 2. 加入內容
  const blocks = [];

  // 信件摘要
  blocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: '信件摘要' } }],
      icon: { type: 'emoji', emoji: '📋' },
      color: 'blue_background',
      children: [
        createParagraph(`📌 主旨：${data.subject || '無主旨'}`),
        createParagraph(`✉️ 寄件人：${data.senderEmail || '未知'}`),
        createParagraph(`📅 收件日期：${data.receivedDate || '未知'}`)
      ]
    }
  });

  // 為什麼要存
  if (data.reason) {
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: data.reason } }],
        icon: { type: 'emoji', emoji: '💭' },
        color: 'yellow_background'
      }
    });
  }

  // 分隔線
  blocks.push({ object: 'block', type: 'divider', divider: {} });

  // 郵件內文
  if (data.body) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: '📧 郵件內文' } }] }
    });

    // 分段處理長文字（Notion 限制 2000 字元）
    const bodyChunks = splitText(data.body, 2000);
    bodyChunks.forEach(chunk => {
      blocks.push(createParagraph(chunk));
    });
  }

  // 圖片區（內嵌圖片放在內文後面）
  let imageCount = 0;
  if (data.inlineImages && data.inlineImages.length > 0) {
    for (const img of data.inlineImages) {
      if (img.src && img.src.startsWith('http')) {
        blocks.push({
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url: img.src }
          }
        });
        imageCount++;
      }
    }
  }

  // 附件區（只處理有有效 URL 的附件）
  let attachmentCount = 0;
  const validAttachments = (data.attachments || []).filter(
    att => att.downloadUrl && att.downloadUrl.startsWith('http')
  );

  if (validAttachments.length > 0) {
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: '📎 附件' } }] }
    });

    for (const att of validAttachments) {
      const icon = getFileIcon(att.name);
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: att.name,
                link: { url: att.downloadUrl }
              },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: ' ← 點擊開啟' }
            }
          ],
          icon: { type: 'emoji', emoji: icon },
          color: 'blue_background'
        }
      });
      attachmentCount++;
    }
  }

  // 加入 blocks
  if (blocks.length > 0) {
    await addBlocksToPage(page.id, blocks, settings.notionKey);
  }

  return {
    pageId: page.id,
    url: page.url,
    attachmentCount,
    imageCount
  };
}

// Backend 模式
async function saveViaBackend(data, settings) {
  if (!settings.backendUrl) {
    throw new Error('請先到設定頁面填入 Backend URL');
  }

  const response = await fetch(`${settings.backendUrl}/api/save-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '儲存失敗');
  }

  const result = await response.json();
  return { pageId: result.pageId, url: result.url };
}

// ============ 取得選項 ============
async function handleGetOptions() {
  const settings = await getSettings();

  if (settings.mode === 'direct') {
    return await getOptionsDirectly(settings);
  } else {
    return await getOptionsViaBackend(settings);
  }
}

async function getOptionsDirectly(settings) {
  if (!settings.notionKey || !settings.databaseId) {
    return {};
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${settings.databaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.notionKey}`,
        'Notion-Version': NOTION_API_VERSION
      }
    });

    if (!response.ok) {
      console.warn('Failed to fetch options');
      return {};
    }

    const data = await response.json();
    const options = {};

    for (const [name, prop] of Object.entries(data.properties)) {
      if (prop.type === 'multi_select' || prop.type === 'select') {
        options[name] = prop[prop.type].options.map(opt => ({
          id: opt.id,
          name: opt.name,
          color: opt.color
        }));
      }
    }

    return options;
  } catch (error) {
    console.warn('Get options error:', error);
    return {};
  }
}

async function getOptionsViaBackend(settings) {
  if (!settings.backendUrl) {
    return {};
  }

  try {
    const response = await fetch(`${settings.backendUrl}/api/options`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    return data.options || {};
  } catch (error) {
    console.warn('Get options via backend error:', error);
    return {};
  }
}

// ============ 帳單功能 ============
async function handleGetBillOptions() {
  const settings = await getSettings();

  if (!settings.notionKey || !settings.billDatabaseId) {
    throw new Error('請先設定帳單資料庫 ID');
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${settings.billDatabaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.notionKey}`,
        'Notion-Version': NOTION_API_VERSION
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || '無法取得帳單資料庫');
    }

    const data = await response.json();
    const options = {};

    for (const [name, prop] of Object.entries(data.properties)) {
      if (prop.type === 'select' || prop.type === 'multi_select') {
        options[name] = prop[prop.type].options.map(opt => ({
          id: opt.id,
          name: opt.name,
          color: opt.color
        }));
      }
    }

    return options;
  } catch (error) {
    console.warn('Get bill options error:', error);
    throw error;
  }
}

async function handleSaveBill(data) {
  const settings = await getSettings();

  if (!settings.notionKey || !settings.billDatabaseId) {
    throw new Error('請先到設定頁面填入帳單資料庫 ID');
  }

  // 建立帳單頁面（只處理指定的 4 個欄位）
  const pageData = {
    parent: { database_id: settings.billDatabaseId },
    icon: { type: 'emoji', emoji: '💳' },
    properties: {}
  };

  // 標題：使用 Gmail 信件主旨
  pageData.properties['名稱'] = {
    title: [{ text: { content: data.emailSubject || '帳單' } }]
  };

  // 1. 月消費金額（number，可空）
  if (data.amount !== null && data.amount !== undefined) {
    pageData.properties['月消費金額'] = { number: data.amount };
  }

  // 2. 帳單月份（date，存為該月 1 號）
  if (data.billMonth) {
    pageData.properties['帳單月份'] = { date: { start: data.billMonth } };
  }

  // 3. 付款方式（select）
  if (data.paymentMethod) {
    pageData.properties['付款方式'] = { select: { name: data.paymentMethod } };
  }

  // 4. 文字備註（rich_text）
  if (data.note) {
    pageData.properties['文字備註'] = {
      rich_text: [{ text: { content: data.note } }]
    };
  }

  console.log('[Bill] Creating page...');

  const createRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.notionKey}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(pageData)
  });

  if (!createRes.ok) {
    const error = await createRes.json();
    console.error('[Bill] Create page error:', error);
    throw new Error(error.message || '建立帳單頁面失敗');
  }

  const page = await createRes.json();
  console.log('[Bill] Page created:', page.id);

  // 加入內容區塊（附件與圖片）
  const blocks = [];

  // 圖片
  let imageCount = 0;
  if (data.inlineImages && data.inlineImages.length > 0) {
    for (const img of data.inlineImages) {
      if (img.src && img.src.startsWith('http')) {
        blocks.push({
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url: img.src }
          }
        });
        imageCount++;
      }
    }
  }

  // 附件
  let attachmentCount = 0;
  const validAttachments = (data.attachments || []).filter(
    att => att.downloadUrl && att.downloadUrl.startsWith('http')
  );

  if (validAttachments.length > 0) {
    if (imageCount > 0) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    }
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: '📎 附件' } }] }
    });

    for (const att of validAttachments) {
      const icon = getFileIcon(att.name);
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: att.name,
                link: { url: att.downloadUrl }
              },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: ' ← 點擊開啟' }
            }
          ],
          icon: { type: 'emoji', emoji: icon },
          color: 'blue_background'
        }
      });
      attachmentCount++;
    }
  }

  if (blocks.length > 0) {
    await addBlocksToPage(page.id, blocks, settings.notionKey);
  }

  return {
    pageId: page.id,
    url: page.url,
    attachmentCount,
    imageCount
  };
}

// ============ 工具函數 ============
function createParagraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] }
  };
}

function splitText(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.substring(0, maxLength));
    remaining = remaining.substring(maxLength);
  }
  return chunks.length > 0 ? chunks : [''];
}

async function addBlocksToPage(pageId, blocks, notionKey) {
  // Notion 一次最多 100 個 blocks
  for (let i = 0; i < blocks.length; i += 100) {
    const chunk = blocks.slice(i, i + 100);

    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionKey}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ children: chunk })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Add blocks error:', error);
    }
  }
}

function getFileIcon(filename) {
  const ext = (filename?.split('.').pop() || '').toLowerCase();
  const icons = {
    'pdf': '📄',
    'doc': '📝', 'docx': '📝',
    'xls': '📊', 'xlsx': '📊',
    'ppt': '📽️', 'pptx': '📽️',
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
    'zip': '📦', 'rar': '📦', '7z': '📦',
    'mp3': '🎵', 'wav': '🎵',
    'mp4': '🎬', 'mov': '🎬'
  };
  return icons[ext] || '📎';
}
