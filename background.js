// Service Worker - 處理 Notion API 請求
console.log('Gmail to Notion: Service Worker loaded');

const NOTION_API_KEY = 'ntn_u96502413373KH8i0EPOZg64ksFSD12rkTTyL9LvnyU86E';
const MAIL_DATABASE_ID = '2d523f32ff398079a229c5c934fac033';

// 監聽來自 popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  if (request.action === 'saveToNotion') {
    handleSaveToNotion(request.data, request.mode)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持 sendResponse 有效
  }

  if (request.action === 'getNotionOptions') {
    getNotionDatabaseOptions(request.databaseId)
      .then(options => sendResponse({ success: true, data: options }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// 取得資料庫的選項（用於下拉選單）
async function getNotionDatabaseOptions(databaseId) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch database');
  }

  const data = await response.json();
  const options = {};

  // 擷取各個 multi_select 欄位的選項
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
}

// 儲存到 Notion
async function handleSaveToNotion(data, mode) {
  if (mode === 'mail') {
    return saveMailToNotion(data);
  } else if (mode === 'bill') {
    // 之後實作帳單模式
    throw new Error('帳單模式尚未實作');
  }
}

// 儲存郵件備存
async function saveMailToNotion(data) {
  // 1. 建立 page
  const pageData = {
    parent: { database_id: MAIL_DATABASE_ID },
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

  // 加入選填的 multi_select 欄位
  if (data.mailCategory && data.mailCategory.length > 0) {
    pageData.properties['郵件分類'] = {
      multi_select: data.mailCategory.map(name => ({ name }))
    };
  }

  if (data.tagCategory && data.tagCategory.length > 0) {
    pageData.properties['標籤分類'] = {
      multi_select: data.tagCategory.map(name => ({ name }))
    };
  }

  if (data.processStatus && data.processStatus.length > 0) {
    pageData.properties['處理狀況'] = {
      multi_select: data.processStatus.map(name => ({ name }))
    };
  }

  if (data.readStatus && data.readStatus.length > 0) {
    pageData.properties['閱讀狀況'] = {
      multi_select: data.readStatus.map(name => ({ name }))
    };
  }

  // 建立 page
  const createResponse = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(pageData)
  });

  if (!createResponse.ok) {
    const error = await createResponse.json();
    console.error('Notion API error:', error);
    throw new Error(error.message || 'Failed to create page');
  }

  const page = await createResponse.json();
  console.log('Page created:', page.id);

  // 2. 加入內文到 page body
  if (data.body) {
    await addContentToPage(page.id, data.body);
  }

  // 3. 上傳附件（如果有）
  if (data.attachments && data.attachments.length > 0) {
    await uploadAttachments(page.id, data.attachments);
  }

  return { pageId: page.id, url: page.url };
}

// 加入內文到 page
async function addContentToPage(pageId, bodyText) {
  // Notion block 有字數限制，需要分段
  const chunks = splitTextIntoChunks(bodyText, 2000);

  const blocks = chunks.map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: chunk } }]
    }
  }));

  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ children: blocks })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Failed to add content:', error);
    // 不中斷流程，只記錄錯誤
  }
}

// 分割文字
function splitTextIntoChunks(text, maxLength) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    chunks.push(remaining.substring(0, maxLength));
    remaining = remaining.substring(maxLength);
  }

  return chunks.length > 0 ? chunks : [''];
}

// 上傳附件到 page
async function uploadAttachments(pageId, attachments) {
  // Notion API 不支援直接上傳檔案到 page
  // 只能用 external URL 或 file block
  // 這裡我們用 file block 加上附件資訊作為備註

  const blocks = attachments.map(att => ({
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{
        type: 'text',
        text: { content: `📎 附件: ${att.name}` }
      }],
      icon: { type: 'emoji', emoji: '📎' }
    }
  }));

  if (blocks.length === 0) return;

  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ children: blocks })
  });

  if (!response.ok) {
    console.error('Failed to add attachments info');
  }
}
