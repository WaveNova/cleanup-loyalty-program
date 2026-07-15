# WaveNova 會員系統 MVP — Product Requirements Document

**版本：** v1.2（2026-07-15 晚間）
**基準程式版本：** `staging` branch @ `25f3d93`
**閱讀對象：** Claude Code
**語言慣例：** 文件繁體中文；程式碼、識別字、commit message 一律英文

> **v1.2 變更說明：** 本版取代 v1.1 與 BUGFIX_TASKS.md，為唯一權威文件。新增第 0 節「現況盤點」——staging 已完成 html5-qrcode 掃描引擎、冷卻機制與 stale closure 修正（原 T3/T4），但**反查端點的根因（原 T1）未修**，掃碼功能仍不可用。請先讀第 0 節，按 P0 → P1 → P2 順序開發。

---

## 0. 現況盤點與優先序（先讀這裡）

### ✅ 已完成（staging @ 25f3d93，勿重工）

- html5-qrcode 掃描引擎（iOS Safari / Android Chrome 皆可解碼），含預載處理 user-gesture 限制
- 同一 pk 3 秒冷卻、scansRef 修正重複掃碼判斷的 stale closure
- 離線佇列骨架（localStorage + client_uuid 冪等 + online 事件觸發 flush）
- Supabase v1.0 schema、submit / resolve / guests / events API routes、GitHub Action 部署 staging

### 🔴 P0 — 唯一 Blocker：Luma 反查端點參數錯誤（今晚必修）

**現象：** 掃碼成功解出 pk，但 alert「找不到此 QR 對應的報名者」。
**根因：** `lib/luma.ts` `getGuestByPk()` 把 QR 的 `g-` key 當 `api_id` 傳入。`api_id` 是 `gst-` 開頭的 guest ID，兩者不是同一種識別碼。

**修正（依 Luma 官方外部報到整合文件）：** 呼叫

```
GET https://public-api.luma.com/v1/events/guests/get?event_id={event_id}&id={pk}
```

此端點自動偵測傳入的是 guest key（g-）或 ticket key，兩者皆可反查。

```ts
// lib/luma.ts
const LUMA_BASE = 'https://public-api.luma.com';  // base 統一改用 luma.com

export async function getGuestByPk(eventId: string, pk: string): Promise<LumaGuest> {
  const qs = new URLSearchParams({ event_id: eventId, id: pk });
  const data = await lumaFetch(`/v1/events/guests/get?${qs}`);
  return (data.guest ?? data) as LumaGuest;  // 實測 response 結構後擇一定案
}
```

其餘端點（get-guests / list-events）若在新 base 下舊 path 失效，對照 docs.luma.com/reference 更新 path。

**P0 完成的定義：用真實票券 QR 在 staging 掃出姓名。未達成前不進行 P1。**

### 🟠 P1 — 驗證欠帳與資料層修正

1. **產出 `verification-report.md`**（repo 根目錄，P0 修完立刻重跑 `verify-luma.ts`，探測清單需含 P0 的正確端點）。報告必須回答：
   - a. 團體報名的同行票在 response 中的結構（有無獨立 email？與主報名者的關聯欄位？）
   - b. get-guests 的 entry 是 guest 本體還是巢狀於 `entry.guest`（現有 `getAllGuests` 假設 entry 層，未驗證）
   - c. guest 物件是否含 `check_in_qr_code`（決定 2. 的走向）
   - d. list-events 是否含歷史場次（決定 backfill 走 API 或 CSV）
2. **離線快取依 1c 修正**：有 `check_in_qr_code` → 維持 pk-key 快取；沒有 → 快取僅供姓名/email 搜尋備援，離線掃碼降級為「記錄原始 pk 排入佇列，連線後補反查」
3. **錯誤訊息分流**：`/api/resolve` 將 Luma 404 與其他錯誤分開回傳；前端顯示「此票券不屬於本場活動」vs「連線異常，請改用搜尋備援」
4. **alert 全面改為非阻塞 inline toast**；掃描成功加 `navigator.vibrate?.(100)` 回饋

### 🟡 P2 — v1.1 功能規格（組號制 + 戰況頁，7/17 凍結前完成）

repo 仍為 v1.0 單次過磅流程，依第 5–7 節實作：groups 資料模型、新組報到／回秤雙按鈕主流程、撤銷、戰況頁、station 移出 UI、finalize 結算腳本。

---

## 1. 背景與目標

WaveNova 每月於台灣舉辦多場淨灘活動（單場最高 350 人），報名透過 Luma（Luma Plus，具 API）。**現行現場流程（系統須貼合它）：** 直接入場 → 自行分組（2–4 人）→ 各組**多次**拿垃圾回秤重站過磅 → 首次過磅發組別號碼 → 之後每次報組號累加。

**MVP 交付：**
1. Luma API 資料管線（報名資料流入 Supabase）
2. 秤重站 App：首次過磅「掃全組 QR = 報到 + 建組發號」；回秤「報組號 + 輸重量」
3. 活動戰況頁：即時總重量、組數、前三名排行
4. 歷史回溯：0.01–0.16 全部報名者視為出席

**不做：** 點數、等級、徽章、LINE、官網會員中心、Webhook、回寫 Luma 報到狀態。

### 近期場次

| 日期 | 場地 | App 角色 |
|---|---|---|
| 7/18 | 港南風景區 | 影子測試（單站試掃，結果不計，全體報名者照舊視為出席） |
| 7/25 | 桃園豬鼻子 | 正式試點（紙本備援並行） |
| 7/26 | 台南黃金海岸 | 同版本複測（兩天間不改版） |
| 8/1 | 新北石門風箏公園 | 全面實戰 |
| 8/2 | 瑞芳大鼻尾平台 | 全面實戰 |

---

## 2. 工作原則

1. **驗證先於假設**：所有未實測的 Luma API 行為先跑驗證腳本、產出報告，再依結果實作
2. 本 PRD 範圍外一律不做
3. 秤重站 App 為獨立專案，不動 wavenova-web
4. 秘密只存在 server 端環境變數，不進前端 bundle、不 commit
5. **不排隊是最高原則**：首次過磅（含掃碼）單組 ≤ 30 秒；回秤 ≤ 10 秒
6. 主流程優先，備援與美化其次；每個里程碑完成即請 Andrew 手機實測

---

## 3. 技術棧與架構

TypeScript / Next.js（App Router）/ Supabase（server 經 service role，前端不直連）/ html5-qrcode / Vercel。

```
[Luma Cloud]
   │ ① 同步 guest list            ② 掃碼即時反查 (P0 端點)
   ▼                               ▲
[Next.js API routes (server)] ────┘
   │ service role
   ▼
[Supabase PostgreSQL]
   ▲                    ▲
   │ ③ 秤重站 App        │ ④ 戰況頁
[工作人員手機]        [任一裝置/投影]
```

資料庫為唯一事實來源（source of truth）。

---

## 4. Luma API 整合

- 認證 header `x-luma-api-key`；key 以 calendar 為單位；速率限制以官方文件為準（同步腳本節流 ≤ 120 req/min + 429 exponential backoff）
- QR 內容：`https://luma.com/check-in/<event_api_id>?pk=<key>`（`lu.ma` 網域亦須支援解析）
- 出示的是 guest key（`g-`）；CSV 匯出為 ticket key，兩者不同，離線 CSV 比對不可行
- **反查端點見第 0 節 P0**（`/v1/events/guests/get?event_id=&id=`，自動偵測 key 類型）

---

## 5. 資料模型（migrations/002_group_model.sql；staging 可直接重建）

```sql
create table members (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,          -- lowercase + trim
  name text,
  luma_user_id text,
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  luma_event_id text unique,
  code text,                           -- '0.16'
  name text not null,
  event_date date not null,
  location text,
  synced_at timestamptz
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) not null,
  group_no int not null,               -- 場內流水號，發實體號碼牌
  headcount int not null,              -- 實到人數（重量除數），首掃時定案
  is_shadow boolean not null default false,
  created_at timestamptz default now(),
  unique (event_id, group_no)
);

create table attendances (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) not null,
  member_id uuid references members(id),                      -- null = 無 email 同行票
  registrant_member_id uuid references members(id) not null,
  group_id uuid references groups(id),
  luma_guest_key text,
  source text not null check (source in ('backfill','luma_sync','scan','manual')),
  checked_in boolean not null default false,
  final_weight_kg numeric(7,2) not null default 0,            -- 結算時寫入
  created_at timestamptz default now(),
  unique (event_id, member_id),
  unique (event_id, luma_guest_key)
);

create table weigh_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) not null,
  station text not null default 'A',    -- schema 保留，UI 不詢問
  weight_kg numeric(7,2) not null,      -- 單次過磅重量（非總重）
  client_uuid text unique not null,     -- 離線補傳冪等
  voided boolean not null default false,
  created_at timestamptz default now()
);
```

**衍生統計（view / 查詢時計算）：** 組累計 = 該組非 voided 過磅加總；全場總重 = 非 shadow 組累計之和；排行榜 = 組累計降冪；個人 final_weight = 組累計 ÷ headcount（`finalize-event.ts` 結算寫入）。

---

## 6. 業務規則

**6.1 歸戶（Group Registration）**

| 情境 | 處理 |
|---|---|
| 票有 email | 對應該 email 的 member，attendance.member_id 指向本人 |
| 票無 email（小朋友等） | member_id = null，registrant_member_id 指向報名者 |
| 報名者本人票 | member_id = registrant_member_id |

**6.2 重量：** 個人 = 組整場累計 ÷ headcount；headcount = 首掃時工作人員確認之實到人數；未報名臨時參加者計入 headcount、不建 attendance。

**6.3 歷史回溯：** 0.01–0.16 全部報名者視為出席（source='backfill', checked_in=true, weight=0）；7/25 起掃碼才算出席；7/18 影子資料以 `groups.is_shadow=true` 完全隔離。

**6.4 防呆：** 同 key 同場重掃 → toast「已在第 N 組」不重複入帳；email normalize；client_uuid 冪等；過磅可撤銷（voided=true，不物理刪除）。

**6.5 組號制：** 組號為場內流水號，首次過磅由系統配發並發實體號碼牌；掃碼只發生在首次過磅；一人只能屬於一組。

---

## 7. 秤重站 App

**7.1 存取：** 非公開網址 + 當日通行碼（env）→ 短效 session（httpOnly cookie）。

**7.2 主流程：** 開站（預設今日場次）→ 預載 guest list 本機快取 → 主畫面兩大按鈕：

- **新組報到（≤ 30 秒）**：連續掃描組員 QR（每掃即時顯示「王小明 ✓（名下 3 張票）」；團體票 stepper 確認實到人數）→ 輸入首磅重量 → 送出 → **全螢幕大字顯示組號**（照號發實體號碼牌）
- **回秤（≤ 10 秒）**：數字鍵盤輸組號 → 確認卡「第 12 組・4 人・已累計 8.7 kg」→ 輸本次重量 → 送出顯示新累計

**7.3 備援：** 姓名/email 本機搜尋（可離線，點選視同掃碼）；「只報到不秤重」快速模式；「撤銷」列本站最近 5 筆過磅可標記 voided；影子模式頂部顯著標示。

**7.4 離線（硬需求）：** 回秤完全離線可用（組號與累計以本機狀態為準）；掃碼離線行為依 P1-2；所有寫入先落本機佇列 → 背景重試 → 成功標記；UI 常駐連線狀態 + 待傳筆數。**驗收：飛航模式完成「新組報到 + 兩次回秤」，恢復連線 30 秒內全數補傳。**

**7.5 介面：** 直式、大字大按鈕（烈日 + 手套）、淺色底、Navy #0A1628 / Teal #24B5CB、繁體中文、無阻塞 alert。

**7.6 戰況頁 `/stats`：** 同通行碼保護；10–15 秒輪詢：全場總重量（特大字）、組數、報到人數、全組排行（前三名金銀銅突出）；一鍵閉幕全螢幕模式（只剩總重 + 前三名，投影字級）；影子組永不出現。

---

## 8. 腳本

- `verify-luma.ts` — P1-1 驗證（探測清單含 P0 端點）
- `sync-event.ts --event <id>` — 單場名單 upsert（歸戶規則）
- `backfill.ts` — 歷史匯入（API 或 CSV，依驗證 1d）
- `import-csv.ts <file> --event <code>` — CSV 備援
- `finalize-event.ts --event <code>` — 結算 final_weight_kg

## 9. 環境變數

```
LUMA_API_KEY=                 # server only
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # server only
STATION_PASSCODE=
SHADOW_MODE=true|false        # 7/18 = true
```

---

## 10. 驗收標準（Definition of Done）

| 項目 | 驗收 |
|---|---|
| P0 | Android + iPhone 以真實票券 QR 掃出姓名；掃他場票券顯示「此票券不屬於本場活動」 |
| P1 | `verification-report.md` 在 repo 根目錄，四問皆有實測答案；alert 全數換為 toast |
| 新組報到 | 4 人一組 ≤ 30 秒；同 QR 對準 10 秒僅加入一次；重掃顯示所屬組號 |
| 回秤 | ≤ 10 秒；輸錯組號有確認卡攔截 |
| 離線 | 飛航模式「新組報到 + 兩次回秤」→ 恢復連線 30 秒內補傳 |
| 撤銷 | 撤銷後組累計與戰況頁同步更新 |
| 戰況頁 | 新過磅 15 秒內反映；總重 = 各組累計和；前三名正確；影子組不出現 |
| 結算 | finalize 後每人 final_weight_kg = 組累計 ÷ headcount |

---

## 11. 時程（7/17 晚凍結）

| 時間 | 交付 |
|---|---|
| 7/15 晚 | **P0 修正 + 真機掃通** + P1-1 驗證報告 |
| 7/16 | P1-2/3/4 + P2 schema（002 migration）+ 新組報到/回秤主流程真機可測 |
| 7/17 白天 | 戰況頁、撤銷、影子模式、全項驗收、Andrew 演練 |
| 7/17 晚 | 版本凍結（7/25–26 兩場之間亦不改版） |
| 7/18 | 港南影子測試 → 問題清單 |
| 7/19–24 | backfill 歷史資料、修正收斂、7/25 部署準備 |

## 12. 待確認清單

- [ ] P1-1 四項（同行票結構 / entries 巢狀 / check_in_qr_code / 歷史場次）
- [ ] 新 base 下 get-guests、list-events 的 path 是否需更新
- [ ] 秤重站手機機型盤點（7/18 前確認；iOS 已支援但需真機驗證）
- [ ] 實體號碼牌採購（防水卡或大號碼曬衣夾 ≥ 120 組）
