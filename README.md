# Gmail to Notion

個人用 Chrome Extension，一鍵將 Gmail 郵件存到 Notion。

> **注意**：此工具僅供個人使用，非商業用途。

## 功能

- **郵件備存**：將 Gmail 郵件存到 Notion（含附件、內嵌圖片）
- **帳單備存**：將帳單類郵件存到獨立資料庫，記錄消費金額與付款方式
- **直連模式**：直接呼叫 Notion API，無需架設後端

## 安裝

1. 下載或 clone 此專案
2. 開啟 Chrome `chrome://extensions/`
3. 啟用「開發人員模式」
4. 點擊「載入未封裝項目」，選擇專案資料夾

## 設定

安裝後點擊擴充功能圖示右上角的齒輪，進入設定頁面：

| 欄位 | 說明 |
|------|------|
| Notion API Key | 你的 Notion Integration Token |
| 郵件資料庫 ID | 用於存放郵件備存的 Notion Database ID |
| 帳單資料庫 ID | 用於存放帳單的 Notion Database ID（選填） |

## Notion 資料庫欄位

### 郵件備存資料庫

| 欄位名稱 | 類型 | 說明 |
|---------|------|------|
| 名稱 | Title | 郵件主旨 |
| 寄件人郵件 | Email | 寄件人 |
| 收件日期 | Date | 收件日期 |
| 郵件分類 | Select | 單選分類 |
| 標籤分類 | Multi-select | 多選標籤 |
| 處理狀況 | Select | 待處理 / 已處理 / 追蹤中 |
| 閱讀狀況 | Select | 未讀 / 已讀 |
| 為什麼要存？ | Rich text | 備註 |

### 帳單資料庫

| 欄位名稱 | 類型 | 說明 |
|---------|------|------|
| 名稱 | Title | 郵件主旨 |
| 月消費金額 | Number | 消費金額 |
| 帳單月份 | Date | 帳單所屬月份 |
| 付款方式 | Select | 付款方式選項 |
| 文字備註 | Rich text | 備註說明 |

## 使用方式

1. 在 Gmail 開啟一封郵件
2. 點擊擴充功能圖示
3. 選擇「存成郵件備存」或「存成帳單」
4. 填寫表單後點擊「儲存到 Notion」

## 檔案結構

```
├── manifest.json     # Extension 設定
├── popup.html/js/css # 彈出視窗 UI
├── content.js        # Gmail 資料擷取
├── background.js     # Notion API 呼叫
├── options.html/js   # 設定頁面
└── icons/            # 擴充功能圖示
```

## 注意事項

- 請勿將 Notion API Key 上傳至公開儲存庫
- 附件大小限制 5MB（Notion API 限制）
- 僅支援在 Gmail 網頁版使用

## License

MIT - 僅供個人使用
