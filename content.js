// Content Script - 從 Gmail DOM 抓取郵件資料
console.log('Gmail to Notion: Content Script loaded');

// 抓取當前開啟郵件的資料
async function getEmailData() {
  try {
    // 主旨
    const subjectEl = document.querySelector('h2[data-thread-perm-id]') ||
                      document.querySelector('h2.hP');
    const subject = subjectEl ? subjectEl.textContent.trim() : '';

    // 寄件人郵件
    const senderEl = document.querySelector('span[email]');
    const senderEmail = senderEl ? senderEl.getAttribute('email') : '';
    const senderName = senderEl ? senderEl.getAttribute('name') || senderEl.textContent.trim() : '';

    // 收件日期
    const dateEl = document.querySelector('span.g3') ||
                   document.querySelector('td.gH span[title]');
    let receivedDate = '';
    if (dateEl) {
      receivedDate = dateEl.getAttribute('title') || dateEl.textContent.trim();
    }

    // 內文
    const bodyEl = document.querySelector('div.a3s.aiL') ||
                   document.querySelector('div.a3s');
    const body = bodyEl ? bodyEl.innerText.trim() : '';
    const bodyHtml = bodyEl ? bodyEl.innerHTML : '';

    // 附件（嘗試取得 base64）
    const attachments = await extractAttachmentsWithData();

    // 內嵌圖片（嘗試取得 base64）
    const inlineImages = await extractInlineImagesWithData(bodyEl);

    const emailData = {
      subject,
      senderEmail,
      senderName,
      receivedDate,
      body,
      bodyHtml,
      attachments,
      inlineImages,
      isEmailOpen: !!(subject || senderEmail)
    };

    console.log('Gmail to Notion: Email data extracted', emailData);
    return emailData;

  } catch (error) {
    console.error('Gmail to Notion: Error extracting email data', error);
    return {
      error: error.message,
      isEmailOpen: false
    };
  }
}

// 擷取附件（含下載連結）- 嚴格限制只抓真實檔案附件
async function extractAttachmentsWithData() {
  const attachments = [];
  const seen = new Set();

  // 允許的檔案副檔名
  const validExtensions = [
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
    'zip', 'rar', '7z', 'tar', 'gz',
    'txt', 'csv', 'rtf', 'md',
    'mp3', 'wav', 'mp4', 'mov', 'avi',
    'html', 'htm', 'xml', 'json'
  ];

  // 檢查是否為有效檔名（必須有副檔名）
  function isValidFilename(name) {
    if (!name || name.length < 3) return false;
    const ext = name.split('.').pop()?.toLowerCase();
    if (!ext || ext === name.toLowerCase()) return false;
    return validExtensions.includes(ext);
  }

  // Gmail 附件區塊的精確選擇器（只在郵件內容區域內搜尋）
  // 找到郵件主體容器
  const messageContainer = document.querySelector('div.adn') || // 完整郵件視圖
                           document.querySelector('div[role="listitem"]') || // 郵件項目
                           document.querySelector('div.gs'); // 郵件內容區

  if (!messageContainer) {
    console.log('Gmail to Notion: No message container found');
    return [];
  }

  // 只在郵件容器內搜尋附件
  // Gmail 附件通常在 .aQH (附件卡片) 或包含 view=att 連結的區域
  const attachmentLinks = messageContainer.querySelectorAll('a[href*="view=att"], a[href*="attid="]');

  for (const link of attachmentLinks) {
    const href = link.href;
    if (!href || !href.includes('mail.google.com')) continue;

    // 找附件名稱 - 從連結本身或其父元素
    let name = '';

    // 嘗試從連結的 download 屬性取得
    name = link.getAttribute('download') || '';

    // 嘗試從附近的 span 取得檔名
    if (!name) {
      const container = link.closest('div.aQH') || link.closest('div.aZo') || link.parentElement;
      if (container) {
        const nameEl = container.querySelector('span.aV3') ||
                       container.querySelector('span.aQA span') ||
                       container.querySelector('span[title]');
        if (nameEl) {
          name = nameEl.textContent.trim() || nameEl.getAttribute('title') || '';
        }
      }
    }

    // 嘗試從連結文字取得
    if (!name) {
      name = link.textContent.trim();
    }

    // 驗證檔名
    if (!isValidFilename(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    // 處理 URL
    let downloadUrl = href;
    if (downloadUrl.includes('disp=safe')) {
      downloadUrl = downloadUrl.replace('disp=safe', 'disp=inline');
    }

    attachments.push({
      name,
      downloadUrl,
      mimeType: getMimeType(name),
      type: getFileType(name)
    });

    console.log('Gmail to Notion: Found valid attachment:', name);
  }

  return attachments;
}

// 擷取內嵌圖片（含 base64 資料）
async function extractInlineImagesWithData(bodyEl) {
  if (!bodyEl) return [];

  const images = [];
  const imgElements = bodyEl.querySelectorAll('img');

  for (let i = 0; i < imgElements.length; i++) {
    const img = imgElements[i];
    const src = img.src || img.getAttribute('src');
    if (!src) continue;

    // 跳過追蹤像素和小圖標
    const width = img.width || img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
    const height = img.height || img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
    if (width < 20 || height < 20) continue;

    // 跳過空白圖片
    if (src.includes('spacer') || src.includes('blank') || src.includes('1x1')) continue;

    const imageInfo = {
      src: src,
      alt: img.alt || `image_${i + 1}`,
      width: width,
      height: height
    };

    // 如果是 base64 圖片
    if (src.startsWith('data:')) {
      const match = src.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        imageInfo.mimeType = match[1];
        imageInfo.base64Data = match[2];
      }
    }
    // 如果是外部 URL，嘗試下載轉 base64
    else if (src.startsWith('http')) {
      imageInfo.isExternal = true;
      try {
        const base64 = await fetchAsBase64(src);
        if (base64) {
          imageInfo.base64Data = base64;
          imageInfo.mimeType = getMimeTypeFromUrl(src);
        }
      } catch (e) {
        console.log('Cannot fetch image as base64:', src, e.message);
      }
    }

    images.push(imageInfo);
  }

  return images;
}

// 嘗試將 URL 轉為 base64
async function fetchAsBase64(url) {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      mode: 'cors'
    });

    if (!response.ok) return null;

    const blob = await response.blob();

    // 限制大小（5MB）
    if (blob.size > 5 * 1024 * 1024) {
      console.log('File too large:', url);
      return null;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

// 取得 MIME type
function getMimeType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mimeTypes = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
    'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
    'txt': 'text/plain', 'csv': 'text/csv',
    'html': 'text/html', 'htm': 'text/html',
    'json': 'application/json', 'xml': 'application/xml'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getMimeTypeFromUrl(url) {
  const ext = url.split('.').pop().split('?')[0].toLowerCase();
  return getMimeType(ext);
}

// 取得檔案類型
function getFileType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const types = {
    'pdf': 'pdf',
    'doc': 'document', 'docx': 'document',
    'xls': 'spreadsheet', 'xlsx': 'spreadsheet',
    'ppt': 'presentation', 'pptx': 'presentation',
    'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image', 'webp': 'image',
    'zip': 'archive', 'rar': 'archive', '7z': 'archive',
    'mp3': 'audio', 'wav': 'audio',
    'mp4': 'video', 'mov': 'video'
  };
  return types[ext] || 'other';
}

// 監聯來自 popup 的訊息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Gmail to Notion: Received message', request);

  if (request.action === 'getEmailData') {
    // 非同步處理
    getEmailData().then(data => {
      sendResponse(data);
    }).catch(error => {
      sendResponse({ error: error.message, isEmailOpen: false });
    });
    return true; // 保持 sendResponse 有效
  }
});
