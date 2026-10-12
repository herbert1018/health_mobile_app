# AI 飲食營養分析 Skills（v1.0.0）

本套件只涵蓋三個必要分析 Skills；App 本身的
UI、相機、手機本地資料庫、每日累積、帳號及自動化開發均不在範圍內。

## 檔案

-   `meal-composition-analysis.SKILL.md`：圖片辨識與可編輯餐點構成；必須停在使用者確認關卡。
-   `nutrition-source-verification.SKILL.md`：只在使用者確認構成後查找與核對營養來源。
-   `nutrition-report-generation.SKILL.md`：用確定性計算產生單餐營養報告。
-   `nutrition-workflow.schema.json`：三階段共用 JSON Schema。

## 核心流程

1.  App 傳圖片給 composition Skill。
2.  App 將辨識結果顯示給使用者，使用者可以文字修改。
3.  App 明確送出 `status: "user_confirmed"` 的餐點構成。
4.  verification Skill
    查官方來源；未找到時查可信食品營養資料庫；再無資料才做明確標示的估算。
5.  report Skill 依確認份量和標準化營養資料計算。
6.  App 將結果保存在手機本地資料庫並負責每日累積。

## 建議來源

-   台灣食品營養成分資料集（衛福部食藥署，政府資料開放平台）：https://data.gov.tw/dataset/8543
-   食品標示諮詢服務平台／食品營養成分資料庫入口：https://foodlabel.fda.gov.tw/FdaFrontEndApp/Home/Index
-   USDA FoodData Central API Guide：https://fdc.nal.usda.gov/api-guide/
-   USDA FoodData Central：https://fdc.nal.usda.gov/

USDA 官方文件指出 FoodData Central API 可供應用程式整合營養資料，並提醒
API key 不應公開放在程式碼中。若未來使用需要 API key
的資料服務，不要把秘密金鑰直接打包在手機 App
內；可選擇由使用者自行配置、使用不含秘密的資料來源，或經過不儲存使用者餐點資料的輕量代理服務。

## JSON 契約注意事項

-   `schema_version` 是資料契約版本，不是模型版本。
-   `identification_confidence` 和 `match_confidence`
    是模型/流程的啟發式信心指標，除非經校準測試，不可解讀為統計上已校準的機率。
-   `null` 代表未知或未提供，不代表 0。
-   `official_verified`
    只用於實際檢視到、且品項與份量基準相符的官方來源。
-   `database_matched` 表示合理匹配的資料庫項目，不代表品牌官方值。
-   `estimated` 必須在報告中清楚標示。
-   範例 schema 的 `$id` 使用 `example.invalid`
    佔位符；正式部署前請換成專案維護的穩定識別 URI。
-   Schema
    驗證只驗證結構，不會驗證營養數字真實性、網址內容或來源是否可信；來源查證仍須依
    Skill 規則執行。

## 單位與計算

-   優先統一到每 100 g 可食部或明確每份基準。
-   `每項營養素攝取量 = 每 100 g 營養值 × 可食重量(g) ÷ 100`。
-   每份資料只在每份定義清楚、且已知實際食用份數時才能換算。
-   kJ 轉 kcal：除以 4.184；mg 轉 g：除以 1000。
-   體積轉重量必須有可靠的食品專屬密度或來源定義；不可一律假設 1 mL = 1
    g。
-   未知營養素維持 `null`；不可當作 0。
-   只在營養素定義和單位一致後加總，保留內部精度，顯示時才四捨五入。

## 驗收測試摘要

1.  圖片辨識階段不產生營養總量。
2.  使用者未確認時，來源查證必須停止。
3.  官方來源未找到時，必須記錄並嘗試資料庫 fallback。
4.  找不到可靠重量時不得虛構精確份量。
5.  缺失值不得轉成 0。
6.  使用者修改食物、烹調方式、產品規格或份量後，受影響的查證結果必須失效並重新查證/計算。
7.  所有營養數字都能追溯至來源或明確標示的估算。
8.  負重量、負營養值、NaN 或 Infinity 必須拒絕。
