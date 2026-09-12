# 幼安雷達 — CI/CD 自動化部署指引手冊

本專案已建立完整的 GitHub Actions CI/CD 自動化部署流程，當推送符合 `deploy_*` 規則的 Git Tag 時，將自動部署至 AWS EC2 雲端主機。

---

## 1. 伺服器與架構資訊

- **雲端平台**：AWS (帳號: `112803415298`)
- **區域 (Region)**：`us-west-2` (奧勒岡)
- **執行個體 (Instance ID)**：`i-0bddfc7b03f4e232e`
- **規格**：`t3.medium`（Ubuntu 24.04 LTS，30GB gp3）
- **公開 IP (Public IP)**：`54.191.62.21`
- **公開網址**：[http://54.191.62.21/](http://54.191.62.21/)
- **網站根目錄**：`/var/www/youan-radar`
- **網頁伺服器**：Nginx (預設讀取 `preview.html` / `index.html`，並預留 `/api/` 反向代理至 `8088`)
- **開放連接埠**：`80` (HTTP), `443` (HTTPS), `22` (SSH), `8765`, `8088`

---

## 2. CI/CD 觸發機制

GitHub Actions 監聽以下條件觸發自動部署：

- **觸發條件**：推送任何以 `deploy_` 開頭的 Git Tag（例如 `deploy_v1.0.0`、`deploy_20260912`）。
- **工作流程設定檔**：[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

### 部署流程：
1. **Checkout**：拉取符合 Tag 的最新代碼。
2. **SSH Setup**：使用儲存在 GitHub Repository Secrets 的金鑰連線至 EC2。
3. **安全同步 (Rsync)**：自動將網站程式碼同步到 `/var/www/youan-radar/`，並自動排除機敏檔案（如 `.git`、`RESTORE*`、`*.pem`、`.env*`）。
4. **權限調整與服務重載**：設定檔案權限並自動 `sudo systemctl reload nginx`。
5. **健康檢查 (Health Check)**：透過 HTTP 請求確認伺服器返回狀態碼 200/304，確保服務正常。

---

## 3. 已配置之 GitHub Secrets

已透過 GitHub CLI 在 `mobinice/Hacksong` 儲存庫完成下列 Secrets 設定：

| Secret 名稱 | 內容說明 | 設定值 / 來源 |
| :--- | :--- | :--- |
| `EC2_HOST` | EC2 主機公開 IP | `54.191.62.21` |
| `EC2_USER` | SSH 登入使用者 | `ubuntu` |
| `EC2_TARGET_DIR` | 伺服器部署目標路徑 | `/var/www/youan-radar` |
| `EC2_SSH_KEY` | SSH 私鑰 (PEM) | 自動自 `~/.ssh/youan-radar-key.pem` 寫入 |

---

## 4. 如何發布與部署（操作範例）

### 步驟一：提交程式碼修改
```bash
git add .
git commit -m "feat: 更新前端雷達功能"
git push origin main
```

### 步驟二：打上 `deploy_*` Tag 並推送到 GitHub
您可以依語意化版本號或時間戳記建立 Tag：

```bash
# 方式 A：以版本號建立 Tag
git tag deploy_v1.0.0
git push origin deploy_v1.0.0

# 方式 B：以日期時間建立 Tag
git tag deploy_$(date +%Y%m%d_%H%M%S)
git push origin --tags
```

---

## 5. 監控與檢視部署狀態

1. **GitHub 網頁端**：
   進入儲存庫頁面點擊 **Actions** 分頁即可即時查看部署日誌。
2. **GitHub CLI 指令端**：
   ```bash
   gh run list --workflow="Deploy to AWS EC2"
   gh run watch
   ```
3. **驗證線上站台**：
   瀏覽器造訪：[http://54.191.62.21/](http://54.191.62.21/)

---

## 6. 本機手動連線與維護指南

本機已儲存專屬 SSH 金鑰，如需連線至主機檢查環境或日誌：

```bash
# 透過 SSH 登入主機
ssh -i ~/.ssh/youan-radar-key.pem ubuntu@54.191.62.21

# 查看 Nginx 狀態
sudo systemctl status nginx

# 查看即時訪問日誌
sudo tail -f /var/log/nginx/access.log

# 查看錯誤日誌
sudo tail -f /var/log/nginx/error.log
```
