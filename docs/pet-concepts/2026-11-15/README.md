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
