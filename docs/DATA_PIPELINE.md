# 新北市園所與評鑑資料

## 下載及啟動

```bash
# 使用 Python 標準函式庫下載（需可驗證政府網站的 CA 憑證）
python3 scripts/crawl_moe.py

# Python CA 不完整的主機可使用系統 curl，仍驗證 HTTPS 憑證
python3 scripts/crawl_moe.py --transport curl

# 啟動 API 與前端
python3 server.py
```

開啟 http://127.0.0.1:8088/preview.html，預設頁面為「新北市真實園所」。

爬蟲會依序讀完新北市 API 的零起算分頁、教育部全部新北市搜尋頁、每間園所的「前期評鑑」，再下載可公開檢視的評鑑網頁。最多四個下載工作同時執行，每次請求有間隔、逾時及重試。沒有停用 TLS 憑證驗證。

## 本次下載結果（2026-09-12）

- 市府名錄 1,111 筆，教育部 1,099 筆，涵蓋 29 個行政區。
- 精確配對 1,088 筆；市府未配對 23 筆、教育部未配對 11 筆，合計保留 1,122 筆紀錄。未配對可能涉及名稱／委辦單位變更，不能把整合筆數直接解讀為互不重複的現行立案園所數。
- 評鑑歷史 3,320 筆；公開報告 3,244 份全部下載，另 76 筆來源未提供報告連結。
- 1,099 筆有核定人數；立案字號、每生月費與實際在園人數未提供，保留空值。
- 已通過 19 項離線測試、全部報告檔案與來源園名核對，以及瀏覽器分頁／行政區／名稱／類型篩選與報告查看。

## 來源與欄位

- [新北市公私立立案幼兒園資料 API](https://data.ntpc.gov.tw/api/datasets/f563b4cd-b850-41f5-9709-b910f2d147e9/json?page=0&size=100)：園名、資料集類型、行政區及代碼、電話、郵遞區號、地址。
- [全國教保資訊網評鑑查詢](https://ap.ece.moe.edu.tw/webecems/evaSearch.aspx)：設立別、核定人數、地址、電話、兼辦課後服務、評鑑年度／完成日期／結果及報告。

資料以「行政區＋標準化完整園名」精確配對。統一全半形、空白及臺／台；不刪除分班名稱，不以模糊搜尋結果自動歸戶。未配對者保留，`matchStatus` 為 `unmatched` 或 `moe_only`。教育部獨有紀錄的 `registryStatus` 為 `not_matched`，不能直接當作市府現行立案名錄。

`type` 為教育部設立別（公立／私立／非營利）；`serviceType` 保留市府資料集類型，包含準公共。兩者不互相覆蓋。

| 欄位 | 意義 |
|---|---|
| `id` / `schoolId` | 行政區與園名產生的穩定識別碼；不是官方立案字號，改名會改變 ID |
| `registrationNumber` | 立案字號；本次兩個來源未提供，值為 `null` |
| `capacity` | 教育部核定招生人數，單位為人；未配對或缺值為 `null` |
| `studentCount` | 實際在園人數；未提供為 `null`，不能用核定人數代替 |
| `monthlyFee` / `tuition` | 每生月費，單位為新臺幣／生／月；未提供為 `null`，不能套用補助標準或類型推估 |
| `evaluations` | 最新與前期評鑑陣列；學年度保留民國年，日期轉為西元 `YYYY-MM-DD` |
| `fieldMetadata` | 欄位中文標籤、單位、來源、`available`／`missing` 與缺值說明 |
| `sources` | 原始來源 URL 與園所原始欄位，保留不同來源的地址等差異 |
| `evaluationStatus` | `published`、`not_evaluated`、`not_published` 或 `unmatched`；未配對不等於未受評 |
| `historyComplete` | 是否已完成歷史展開，或來源沒有可展開的前期紀錄 |

本資料管線不生成模擬座標、承辦人、期限、財務／輿情風險。`totalScore=null`、`riskLevel=incomplete`。`completeness` 僅是本資料集欄位填值比例，不是原型規則引擎的可評估權重。

## 查詢 API

```text
GET /api/schools?page=0&size=25&q=莒光&district=板橋區&type=公立
```

- `page`：從 0 起算，非負整數。
- `size`：1–100，預設 25。
- `q`：園名、地址、行政區、立案字號的部分文字；園名另外支援依序省略字元與三字以上的近似比對。最多 100 字。
- `district`：行政區精確篩選。
- `type`：設立別或市府資料集類型精確篩選（可使用準公共）。
- 先篩選再分頁，穩定排序；沒有結果或超出頁數時 `data=[]`。無效參數回傳 HTTP 400。

```json
{
  "data": [],
  "page": 0,
  "size": 25,
  "total": 0,
  "totalPages": 0,
  "hasNext": false,
  "districts": ["板橋區"],
  "filters": {"q": "莒光", "district": "板橋區", "type": "公立"},
  "metadata": {}
}
```

回應形狀由原本陣列改為分頁物件；舊消費端可暫用 `GET /api/schools?format=legacy` 取得完整陣列。`mode=demo` 保留 `use_demo` 回應。`GET /api/insights` 只提供真實資料統計，不再輸出推估風險敘述。

`POST /api/crawl-live` 保留即時抽樣能力，`pages` 上限 5；回傳當次教育部欄位與歷史，不寫入全量快照、不下載報告。完整更新使用 CLI。

## 輸出與斷點續抓

| 輸出 | 內容 |
|---|---|
| `data/real_schools.json` | 整合後的完整園所陣列 |
| `data/moe_insights.json` | 數量、行政區、設立別、配對與缺值統計 |
| `data/crawl_metadata.json` | 執行資訊、來源數量、欄位定義、報告下載結果 |
| `data/reports/<id>.json` | 每份報告的表格、儲存格文字、rowSpan／colSpan、完整文字、來源及下載時間 |
| `.cache/crawl-moe/` | 市府原始 JSON 及已完成的教育部分頁；不提交 Git |

評鑑報告原始形式為網頁檢核表，不保證存在 PDF。報告 JSON 保留「符合／不符合／免檢核」的原始欄位位置、勾選文字與備註；前端安全地重新渲染文字，不執行來源網頁程式。

每筆評鑑的 `reportStatus`：

- `downloaded`：已下載並核對園名；`reportPath` 指向本機 JSON。
- `not_published`：來源沒有提供報告連結。
- `pending`：使用 `--skip-reports` 跳過下載，或即時 API 尚未下載。
- `failed`：下載或內容驗證失敗；保留 `reportError`，CLI 以非零狀態結束。重新執行會重試失敗報告。

預設重用快取以便中斷續抓。要取得新的來源快照，指定新的快取資料夾；同一輪失敗後使用相同路徑重試。已下載的同年度／日期／結果報告預設重用；若要更新報告內容，加 `--refresh-reports`。

```bash
python3 scripts/crawl_moe.py --transport curl --cache-dir .cache/crawl-moe/new-snapshot --refresh-reports
```

爬蟲檢查分頁號、總數與重複園所；來源不完整時不覆蓋既有正式園所快照。單檔 JSON 採原子替換；三份輸出不是跨檔交易，重新載入期間應等 CLI 完成。

`--max-pages 1` 用於開發，只產出 `sample_*.json`，不覆蓋完整資料。`--output-dir` 可改變儲存根目錄，但前端的報告相對 URL 預設部署於 `data/reports/`。

## 驗證

```bash
python3 -m unittest discover -s tests -v
```

測試使用政府頁面的固定樣本，不對外發出請求，涵蓋歷史、日期、報告、配對、缺值、分頁、搜尋和來源格式異常。
