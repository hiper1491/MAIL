// Content Script - 從 Gmail DOM 抓取郵件資料
console.log('Gmail to Notion: Content Script loaded');

// 抓取當前開啟郵件的資料
function getEmailData() {
  try {
    // 主旨 - Gmail 用 h2 顯示主旨
    const subjectEl = document.querySelector('h2[data-thread-perm-id]') ||
                      document.querySelector('h2.hP');
    const subject = subjectEl ? subjectEl.textContent.trim() : '';

    // 寄件人郵件 - 從 email 屬性抓取
    const senderEl = document.querySelector('span[email]');
    const senderEmail = senderEl ? senderEl.getAttribute('email') : '';
    const senderName = senderEl ? senderEl.getAttribute('name') || senderEl.textContent.trim() : '';

    // 收件日期 - Gmail 的日期在 span.g3 內
    const dateEl = document.querySelector('span.g3') ||
                   document.querySelector('td.gH span[title]');
    let receivedDate = '';
    if (dateEl) {
      // 優先使用 title 屬性（完整日期）
      receivedDate = dateEl.getAttribute('title') || dateEl.textContent.trim();
    }

    // 內文 - Gmail 郵件內容在 div.a3s 內
    const bodyEl = document.querySelector('div.a3s.aiL') ||
                   document.querySelector('div.a3s');
    const body = bodyEl ? bodyEl.innerText.trim() : '';
    const bodyHtml = bodyEl ? bodyEl.innerHTML : '';

    // 附件 - 抓取附件資訊
    const attachments = [];
    const attachmentEls = document.querySelectorAll('div.aQH span.aV3');
    attachmentEls.forEach(el => {
      const name = el.textContent.trim();
      // 找到對應的下載連結
      const container = el.closest('div.aQH');
      const downloadLink = container ? container.querySelector('a[download]') : null;

      attachments.push({
        name: name,
        downloadUrl: downloadLink ? downloadLink.href : null
      });
    });

    // 另一種附件選擇器 (舊版 Gmail 或不同視圖)
    if (attachments.length === 0) {
      const altAttachments = document.querySelectorAll('div.aZo');
      altAttachments.forEach(el => {
        const nameEl = el.querySelector('span.aV3') || el.querySelector('span');
        if (nameEl) {
          attachments.push({
            name: nameEl.textContent.trim(),
            downloadUrl: null
          });
        }
      });
    }

    const emailData = {
      subject,
      senderEmail,
      senderName,
      receivedDate,
      body,
      bodyHtml,
      attachments,
      // 用於判斷是否在讀信頁面
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

// 監聽來自 popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Gmail to Notion: Received message', request);

  if (request.action === 'getEmailData') {
    const data = getEmailData();
    sendResponse(data);
  }

  return true; // 保持 sendResponse 有效
});
