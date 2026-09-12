# 幼安雷達｜教保機構風險預警平台

黑客松互動原型：整合園所資料、追溯來源、辨識異常，協助承辦人從風險排序一路處理到查核結案。

## 本機啟動

使用 Python 3 啟動同源 Demo API 與靜態檔案：

```bash
python3 server.py
```

瀏覽器開啟 <http://127.0.0.1:8088/preview.html>。不需要 npm 安裝或前端建置。若要改用其他埠，可設定 `PORT` 或 `YOUAN_PORT`。

只需檢視不含 API 的基本介面時，也可執行：

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

此模式會改用瀏覽器內的 Demo AI fallback。

## Demo 功能

- 園所資料工作台、來源追溯、欄位選擇與 Excel 匯出。
- Excel／CSV／JSON／固定格式文件匯入，以及可解釋的 Demo AI 語意欄位對應、信心分數與人工覆核。
- 評鑑文件文字擷取、Demo OCR、待改善事項、法規對照與風險影響回寫。
- 公開線索去重、負向嚴重度、來源連結與「未經查證」標示。
- 稽核管理 Kanban、待查核／調查中／待補件／已結案流程、行動追蹤與結果回填。
- PNG／JPG 承辦人簽名匯入，以及包含案件、行動、查核結果和簽名的 A4 PDF 下載。
- AWS Bedrock 查核建議；未設定 AWS 時會安全回退到本機示範建議。
- 私有 S3、SSE-S3、短效預簽下載、PII 遮罩與憑證掃描範本。

內建園所、評鑑與輿情資料均為合成示範資料。AI 與公開線索只協助排序和查核，不構成違法認定或裁處依據。

## 展示狀態

匯入、覆核、案件、簽名、文件、規則與門檻會同步保存於瀏覽器及後端資料庫；重新整理後仍會保留。需要重新開始展示時，使用側邊欄或設定頁的「重設為初始示範資料」按鈕。後端優先使用 AWS RDS PostgreSQL，未設定時以 SQLite 備援。

## 驗證

```bash
python3 -m unittest discover -s tests
python3 scripts/security_scan.py
```

## 專案結構

- `preview.html`：原型入口。
- `assets/`：JavaScript、CSS、PDF / Excel 處理依賴與授權文件，請完整保留。
- `assets/vendor/leaflet/`：Leaflet 1.9.4（BSD-2-Clause）地圖套件，本機載入不走 CDN。
- `assets/vendor/leaflet-markercluster/`：Leaflet.markercluster 1.5.3（MIT），標記聚合。
- `assets/real-schools.js`：真實園所模式，讀後端 `/api/schools`（同步自教育部全國教保資訊網）供風險總覽地圖、清單、摘要與詳情彈窗使用；API 不可用時自動退回內建示範資料。
- `assets/ntpc-districts.js`：新北市 29 個行政區界 GeoJSON（WGS84），來源為內政部鄉鎮市區界（經 g0v/twgeojson 整理、mapshaper 簡化），供地圖聚焦與快速縮放。
- `assets/logo-team.png`：登入畫面用的隊伍標誌縮圖，原檔在 `design/logos/`。
- `docs/presentations/`：原始提案 PPTX、PDF，以及隊伍資訊版 PPTX。PDF 對應原始版，不是隊伍資訊版的輸出。
- `docs/architecture/`：功能爆炸圖的 Mermaid 原始檔、SVG 與 PNG。
- `docs/competition/`：主辦單位服務清單與環境規範。
- `design/logos/`：Bug 不過夜隊伍圖的原版、v2 與透明背景版，保留原檔名。
- `design/reference/`：原資料夾中的圖片參考素材。

## 目前功能與限制

- 登入畫面為展示模式：輸入任意帳號與密碼即可進入，僅保存在瀏覽器 sessionStorage，未串接真實身分驗證。
- 風險總覽提供「真實園所／示範資料」切換：真實園所來自後端 API（含真實園名、地址、分數、評鑑六大類別），示範資料保留給規則設定、資料工作台與查核流程展示。
- 風險總覽地圖使用 Leaflet 與 OpenStreetMap 圖磚（需要網路才能顯示底圖），園所以 WGS84 經緯度標記並依風險等級上色；可用行政區按鈕或篩選快速縮放，點標記開啟摘要卡片。內建園所座標為示範資料，落在對應行政區內但不是真實園所位置。
- 園所資料工作台、欄位選擇與 Excel 匯出。
- 每生人事成本＝同年度人事費 ÷ 實際學生數；缺值、衝突或學生數為 0 時不計算。
- 規則權重設定、分數計算與來源證據。啟用權重合計 100%，裁罰按次累加，累計風險分數可超過 100。
- 評鑑年度切換、本機文件上傳與下載；查看彈窗共用使用者提供的檢核表，非上傳文件自動解析結果。
- 欄位管理、資料匯入、風險判斷規則及資料來源說明。
- 本機原型，未串接 AWS、AI 或正式登入服務。內建園所資料為合成示範資料，風險分數不是違法認定。
- Demo 持久化模式：規則、匯入、覆核、案件、簽名與評鑑文件會保存；需要重新開始展示時，可使用介面上的手動重設功能。
- 稽核交辦 PDF 等部分功能仍為示範，應以畫面上的提示為準。

## 準備上傳新 Git Repository

將本資料夾作為新 repository 根目錄，不要上傳外層工作目錄。尚未初始化 Git、建立提交或設定遠端。

`.gitignore` 已排除憑證、環境設定、快取、測試輸出與 Office 暫存檔。不要加入 AWS 金鑰、Session Token、真實敏感資料或瀏覽器資料備份。先前曾在對話中分享的憑證不要存入此專案。

競賽規範、簡報與圖片的公開授權尚未核實；若上傳公開 repository，請先確認可公開，否則使用私人 repository。

本資料夾是整理時的獨立副本，之後請以此資料夾持續開發；外層原檔不會自動同步。
