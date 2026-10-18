/** Current data behavior, grounded in repository/storage contracts (DP-118).
 * Read-only native disclosure; it never changes data, session or consent state.
 */
export function DataPrivacyCard() {
  return (
    <>
      <div className="dp-section-label">資料與隱私</div>
      <div className="dp-account-blocks">
        <details className="data-privacy-card">
          <summary>資料如何保存與刪除</summary>
          <div>
            <h3>遊客與帳號資料</h3>
            <p>
              遊客資料只存在目前瀏覽器，換裝置不會自動轉移。清除網站資料前，請先匯出備份。
              若畫面提示資料只維持到關閉分頁，請先匯出未保存的內容，避免重新載入後失去變更。
            </p>
            <p>
              登入後，行程、待辦、貼圖與設定保存至 Supabase，這台裝置也會保留帳號快取。
              遊客資料不會自動上傳。行程與待辦仍只供本人存取；目前可管理家庭與邀請，日曆分享尚未開放。
            </p>
            <p>
              帳號驗證使用 Supabase Auth；選擇 Google 登入時，會連到 Google 完成驗證。
            </p>
            <h3>附件與備份</h3>
            <p>
              附件需登入後才能使用，保存於私人儲存空間；下載連結會到期。
              JSON 備份不含附件，附件需另行下載。匯出檔案未加密，請妥善保存及分享。
            </p>
            <h3>家庭與邀請</h3>
            <p>
              建立家庭或邀請時，群名、成員關係與受邀 Email 會保存至 Supabase。
              成員名單只顯示名稱與角色；受邀 Email 只供家庭擁有者及對應受邀者查看。
              App 不會寄出家庭邀請信；連結須由相符且已驗證 Email 的帳號確認接受。
            </p>
            <p>
              為銜接登入，待確認的邀請連結會暫存在這個分頁的工作階段儲存空間，不進日曆備份或帳號快取。
              接受、拒絕或關閉邀請後會清除；超過七天的紀錄不再使用。
              退出或解散家庭不會刪除任何人的日曆內容。
            </p>
            <h3>登出與刪除</h3>
            <p>
              登出不會刪除雲端資料，瀏覽器仍可能保留遊客資料、帳號快取與上次匯出的時間和筆數。
              使用共用裝置時，請留意瀏覽器內保存的資料。
            </p>
            <p>
              可在日曆內逐筆刪除行程、待辦和貼圖；刪除父待辦也會刪除其子項。
              刪除日曆時，內容會移到預設日曆，不會一併刪除。
              目前尚未提供一鍵清空全部資料或刪除帳號。
            </p>
            <p>
              下載的備份與附件副本由你自行管理；App 內刪除資料不會刪除這些檔案。
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
