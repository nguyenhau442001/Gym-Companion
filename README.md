<p align="center">
  <img src="icons/icon-192.png" width="96" alt="Lên Cân icon">
</p>

<h1 align="center">Lên Cân</h1>

<p align="center">
  PWA cá nhân theo dõi calo, macro và cân nặng cho <b>lean bulk</b>.<br>
  Không backend, không đăng nhập, chạy offline, dữ liệu nằm trên máy.
</p>

<p align="center">
  <a href="https://nguyenhau442001.github.io/Gym-Companion/"><b>Mở app →</b></a>
</p>

<p align="center">
  <img src="docs/screenshots/today.png" width="230" alt="Hôm nay">
  <img src="docs/screenshots/weight.png" width="230" alt="Cân nặng">
  <img src="docs/screenshots/add-food.png" width="230" alt="Thêm món">
</p>

## Tính năng

- **Hôm nay**: vòng calo, thanh Protein / Carb / Fat, protein theo từng bữa (Sáng, Trưa, Chiều, Tối), bữa nào dưới 0,25 g/kg protein sẽ được đánh dấu.
- **Thêm món**: khoảng 50 món Sài Gòn có sẵn (cơm tấm, phở, xôi, bánh mì, whey…). Tìm kiếm không cần gõ dấu. Mục "Hay ăn" lấy 8 món ăn nhiều nhất trong 30 ngày. Thêm một món quen chỉ cần **2 chạm**.
- **Món tự tạo**: thêm, sửa, xoá. Nếu để trống calo thì app tự tính từ macro. Sửa món không làm thay đổi các ngày đã ghi, vì mỗi lần ghi lưu lại macro tại thời điểm đó.
- **Cân nặng**: biểu đồ cân hằng ngày kèm đường trung bình 7 ngày (xem 4 hoặc 8 tuần), thay đổi/tuần so với mục tiêu, và gợi ý tăng/giảm calo.
- **Cài đặt**: tuổi, chiều cao, cân nặng, số buổi tập, mức dư calo (+300 / +400 / +500), tốc độ tăng mục tiêu (0,25–0,75 %/tuần). Mục tiêu cập nhật ngay khi gõ.
- **Export / Import JSON**: trên iOS dùng Share sheet. Khi import, app kiểm tra file và hiện số lượng bản ghi trước khi ghi đè.
- **PWA**: cài lên Màn hình chính, chạy offline, có banner "Có bản mới — tải lại" khi có bản cập nhật.
- Có giao diện Sáng và Tối.

<p align="center">
  <img src="docs/screenshots/settings.png" width="230" alt="Cài đặt">
  <img src="docs/screenshots/today-dark.png" width="230" alt="Hôm nay (tối)">
  <img src="docs/screenshots/weight-dark.png" width="230" alt="Cân nặng (tối)">
</p>

## Công thức

| | |
|---|---|
| BMR (Mifflin-St Jeor, nam) | `10·kg + 6,25·cm − 5·tuổi + 5` |
| Hệ số vận động | 0–1 buổi: 1,2 · 2–3: 1,375 · 4–5: 1,55 · 6+: 1,725 |
| Calo mục tiêu | `TDEE + dư calo` (mặc định +400) |
| Protein / Fat | 1,8 g/kg · 0,9 g/kg |
| Carb | `(kcal − protein·4 − fat·9) / 4` |
| Protein mỗi bữa | protein / 4. Bữa bị đánh dấu thấp khi < 0,25 g/kg |
| TB 7 ngày | trung bình các lần cân trong 7 ngày gần nhất, cần ít nhất 3 lần |
| Thay đổi / tuần | `TB7(hôm nay) − TB7(7 ngày trước)` |
| Mục tiêu / tuần | `TB7 × tốc độ` (mặc định 0,5 %) |

Cân nặng dùng để tính mục tiêu là TB 7 ngày. Nếu chưa đủ dữ liệu thì dùng lần cân gần nhất. Ngày luôn tính theo giờ Việt Nam (`Asia/Ho_Chi_Minh`).

## Cài lên iPhone

1. Mở link app bằng **Safari**.
2. Bấm nút Chia sẻ → **Thêm vào MH chính**.
3. Mở app từ icon trên Màn hình chính. Sau lần mở đầu tiên, app chạy được cả khi không có mạng.

> Dữ liệu nằm trong IndexedDB của Safari. Nên **Export** định kỳ để sao lưu.

## Phát triển

Dùng vanilla JS (ES modules), không framework, không bước build, không tải gì từ CDN.

```bash
python3 -m http.server 8000   # mở http://localhost:8000
npm test                      # = node --test (Node 20+)
node scripts/make-icons.mjs   # tạo lại icons/*.png
```

```
index.html            giao diện (từ design/, đã nối dữ liệu thật)
css/app.css
js/calc.js            hàm thuần: công thức, ngày, validate backup
js/db.js              IndexedDB "bulk-tracker" v1
js/ui.js              render + xử lý sự kiện
js/app.js             khởi động, service worker
data/foods.seed.js    danh mục món ăn (ước lượng)
sw.js                 cache-first, CACHE_VERSION
tests/calc.test.js
design/               bản export gốc từ Claude Design
```

**Phát hành bản mới:** tăng `CACHE_VERSION` trong `sw.js` rồi push lên `main`. Lần mở app tiếp theo sẽ hiện banner "Có bản mới — tải lại".

Macro trong danh mục món là **số ước lượng** cho một khẩu phần thường gặp ở Sài Gòn, chỉ dùng để tham khảo.
