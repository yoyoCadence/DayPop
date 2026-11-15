# DayPop 四款夥伴原生素材

橘白柑橘貓（分層 SVG）、果粒貓（40 px 像素格）、星輪精靈（紫金機械）與栗尾熊貓（絨布小熊貓）。兩款 3D 以 .blend 原生分件、控制器、材質與可播放時間軸交付。每款使用固定取景，七態順序為 idle、walk、sit、sleep、jump、look、grab；walk 在 App 中由既有的漫遊控制平移。單次播放為 look／jump，其餘為循環。

## 重建

從 repo 根目錄執行，下列變數指向此資料夾與暫存輸出位置。Blender 4.3.2、Inkscape 1.4、Python 3 與 Pillow 13.0.0 為製作環境。打包器讀取 repo 原本的圖片預算。

```bash
pet_source=docs/pet-concepts/2026-11-15
pet_frames=/tmp/daypop-pets
python "$pet_source/manga-cat/draw.py" "$pet_frames/manga-cat"
python "$pet_source/pixel-cat/draw.py" "$pet_frames/pixel-cat" --svg "$pet_source/pixel-cat/sprite-atlas.svg"
for pet_kind in mecha-spirit red-panda; do
  blender -b --factory-startup --python-exit-code 1 --python "$pet_source/create_3d.py" -- "$pet_kind" "$pet_frames/$pet_kind" --source "$pet_source/$pet_kind/character.blend"
done
# 依 manifest 填入本機實際使用的版本，四款各執行一次
python "$pet_source/package_pets.py" manga-cat --frames "$pet_frames/manga-cat" --proof "$pet_source/manga-cat" --assets src/assets/pet-directions --tool-version "$(inkscape -V)"
```

每款的 manifest 有編碼版本、尺寸、幀數、循環、徽章邊距、來源與成品雜湊。PNG 是 120×120 RGBA，WebP 在解碼後再逐影格檢查尺寸、透明範圍及時間。編碼器可合併連續同幀，驗證以時間軸比對原始透明通道。跨版本重建後使用新雜湊，尤其 Blender 渲染可隨架構而有細小色差。

## DayPop 接線驗證

設定共九款，沿原本的 v5 偏好／備份 v2 保存。新值用既有的 `pet_kind`，有獨立的資料庫 migration 候選，放寬既有五值約束及 replace RPC 的清單。原五款、預設值、RLS、舊備份補值流程、游標定位及拋棄舊版本寫入的行為由原有路徑支援。已發布的舊 App 解析新值時會走既有未知值防護。帶此功能的前端部署之前應先驗證並套用 migration。此交付不涉及正式環境。

四款每態各有獨立 PNG 與動畫 WebP，共 56 檔。建置以每角色內容 SHA-256 前 12 碼做 URL 後綴；App 組合相同角色的七態 URL，驗證腳本逐檔比對輸出位元組，避免圖片內嵌。延用 84 CSS px、192 KiB／款、JS gzip 240,640 bytes。果粒貓使用瀏覽器 pixelated 渲染。

Chromium 手機／桌面和 WebKit 共六個目標案例通過，涵蓋九款切換、重載、84px、PNG／WebP 解碼、reduced-motion 與真正走路影格變化。另以 production fixture 在 Chromium 手機／桌面通過四例，驗證月光貓及栗尾熊貓僅快取已使用素材、離線缺 PNG 時回 CSS，並核對保存資料。瀏覽器實際時區 Asia/Taipei。

本機 PostgreSQL（PGlite）重播 23 份 migration，確認九值 owner 直寫／備份 RPC、舊 client 省略保留、非法／null 回滾、匿名及跨帳號隔離。此測試使用最小 Auth／Storage fixture，pg_cron／pg_net 跳過，由 repo 完整 Supabase CI 驗證。
