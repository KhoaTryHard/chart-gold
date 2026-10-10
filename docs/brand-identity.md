# Kim Tuyến — Nét vàng

Bộ nhận diện dành cho dự án thông tin giá vàng Kim Tuyến. Định hướng: cơ bản, tối giản, rõ ràng; phục vụ người theo dõi và đầu tư vàng. Mở bảng mẫu tại `/brand/preview.html` khi chạy dự án, hoặc mở `public/brand/preview.html` trực tiếp. Trang mẫu dùng tài nguyên nội bộ, không theo dõi và có `noindex, nofollow`.

## Hướng được đề xuất

**K / Nét vàng** dùng chữ đầu của Kim Tuyến làm biểu tượng. Một nét đứng và hai nhánh chéo tạo cấu trúc chắc, khoảng trống rõ, nhận ra được ở kích thước favicon. Vàng trầm gợi ngành vàng; nền ngà và mực đậm giữ tính nghiêm túc của một nền tảng thông tin. Đây là hình học thiết kế riêng, không dùng biểu tượng ngân hàng phổ biến.

Hai hướng tham khảo: **V / Vàng** dễ liên tưởng đến ngành nhưng ký tự phổ biến, cần thêm yếu tố riêng; **Tuyến giá** hợp nền tảng biểu đồ nhưng gắn với tên thương hiệu ít trực tiếp hơn. Hướng K được chọn để liên kết tên, favicon và họa tiết thành một bộ thống nhất. Hai hướng còn lại là đề xuất ý tưởng, không phải bộ logo xuất kèm.

Thiết kế riêng cho dự án; chưa tra cứu đăng ký nhãn hiệu.

## Biểu tượng và chữ

Hệ tọa độ biểu tượng là `0 0 64 64`, với ba phần:

- Nét đứng: hình chữ nhật `x=12, y=12, width=9, height=40`.
- Nhánh trên: đa giác `26,27 41,12 53,12 33,32`.
- Nhánh dưới: đa giác `26,37 33,32 53,52 41,52`.

Không sửa riêng tỷ lệ hoặc khoảng cách ba nét. Logo ngang kết hợp dấu K với tên Kim Tuyến, có bản sáng, đảo màu và đơn sắc. Chữ trong các tài nguyên vector được chuyển thành đường nét, tránh thay phông khi sử dụng ở máy khác. Giao diện dự án dùng Geist; số liệu nên dùng chữ số cùng độ rộng (`font-variant-numeric: tabular-nums`). Trang mẫu độc lập dùng phông hệ thống nếu không có Geist.

## Màu sắc

| Tên | HEX | Vai trò |
| --- | --- | --- |
| Mực | `#20251F` | Nội dung chính, nền tối, bản đơn sắc |
| Vàng trầm | `#A78646` | Biểu tượng, điểm nhấn, đường trang trí, chữ lớn |
| Ngà | `#F7F6F2` | Nền sáng chính |
| Xám lá | `#73796F` | Trang trí phụ, chữ lớn thứ cấp |
| Cát | `#E8DCC2` | Mảng nền phụ, họa tiết nhẹ |
| Vàng sáng | `#D9BD80` | Biểu tượng và chữ trên nền Mực |

Mực/Ngà có tỷ lệ tương phản khoảng **14,43:1**; Vàng sáng/Mực **8,58:1**; Mực/Cát **11,48:1**. Các cặp này phù hợp cho chữ thông thường theo ngưỡng WCAG AA 4,5:1.

Vàng trầm/Ngà chỉ đạt **3,16:1** và Xám lá/Ngà **4,14:1**: không dùng cho chữ nhỏ thông thường. Chữ lớn theo WCAG là từ 24 CSS px, hoặc khoảng 18,67 CSS px khi in đậm. Dùng Mực hoặc xám đậm hỗ trợ `#62695F` cho chú thích và nội dung chữ nhỏ trên Ngà. Họa tiết nền không có vai trò truyền đạt thông tin.

Xanh/đỏ của bảng giá vẫn biểu thị tăng/giảm. Không thay toàn bộ màu trạng thái bằng vàng thương hiệu; luôn kết hợp mũi tên, dấu số hoặc nhãn để tín hiệu không chỉ phụ thuộc màu. Hình minh họa trong banner là đồ họa trang trí, không phải chuỗi dữ liệu hoặc dự báo giá.

## Liquid Glass trong giao diện

Logo, favicon, banner, họa tiết và bảng màu **Vàng trầm / Mực / Ngà** là phần nhận diện cố định. Liquid Glass chỉ là vật liệu của giao diện: lớp vỏ của header, điều hướng, menu, hộp thoại, bảng trượt và thẻ chứa nội dung. Không làm mờ, phản chiếu, đổi độ trong suốt hoặc đắp hiệu ứng kính trực tiếp lên tệp logo, favicon, banner hay họa tiết; hiệu ứng chỉ thuộc phần tử giao diện bao quanh chúng.

Các token vật liệu phải tách theo vai trò, để không dùng một độ trong suốt cho mọi bề mặt: kính thường là **70% sáng / 72% tối**; kính mờ cho menu, hộp thoại, bảng trượt và điều hướng dưới là **84% / 92%**; kính cho khối nội dung là **86% / 90%**. Bề mặt đặc là lựa chọn riêng cho ô nhập, vùng đọc số liệu và phương án dự phòng. Header dùng blur 22 px, menu/bảng trượt/hộp thoại/điều hướng dưới dùng 24 px, khối nội dung dùng 12 px; viền bắt sáng và bóng mềm chỉ hỗ trợ phân lớp, không thay thế độ tương phản chữ.

Áp dụng vật liệu này thống nhất trên iOS, Android và desktop, kèm cả `backdrop-filter` và `-webkit-backdrop-filter`. Tôn trọng vùng an toàn tai thỏ, mép xoay ngang và vùng đáy trên điện thoại. Khi trình duyệt không hỗ trợ blur, người dùng chọn giảm độ trong suốt, tăng tương phản hoặc dùng màu hệ thống ép buộc, mọi bề mặt kính phải chuyển sang nền đặc có chữ và viền dễ đọc; tín hiệu giá vẫn cần màu trạng thái kết hợp ký hiệu hoặc nhãn.

Kiểm tra bằng WebKit giả lập iPhone giúp phát hiện khác biệt công cụ dựng trang, nhưng không xác nhận Safari trên iPhone thật. Xác nhận cuối cùng về safe area, bàn phím, cuộn, độ rõ và hiệu ứng kính phải thực hiện trên thiết bị iPhone thực khi có thiết bị.

## Khoảng trống và kích thước

- Vùng trống quanh phần nhìn thấy của logo tối thiểu bằng **một bề rộng nét đứng K** (`9` đơn vị trong biểu tượng `64 × 64`). Bản xuất đã có khoảng đệm; chừa thêm khoảng cách với chữ, đường viền hoặc ảnh xung quanh nếu cần.
- Biểu tượng độc lập: nên từ **24 CSS px**; favicon chuyên dụng có thể dùng **16 CSS px**. Favicon có nền và khoảng đệm phù hợp riêng cho tab trình duyệt.
- Logo ngang đầy đủ: nên từ **180 CSS px** chiều rộng. Khi vùng hiển thị nhỏ hơn, dùng biểu tượng thay vì ép dòng chữ xuống quá nhỏ. Kiểm tra trực quan tại kích thước thực trên thiết bị đích.
- Dùng SVG cho web và khi cần thay đổi kích thước; PNG cho nền tảng yêu cầu ảnh raster. Dùng tệp maskable cho biểu tượng ứng dụng có cắt mặt nạ.
- Không kéo giãn, nghiêng hoặc xoay logo; không thêm đổ bóng, viền phát sáng, vân kim loại, gradient hoặc hiệu ứng 3D. Không đặt logo trên nền bận hoặc có độ tương phản thấp.
- Không dùng logo của các hãng vàng làm một phần dấu hiệu Kim Tuyến. Tên hãng vàng trong bảng dữ liệu vẫn có chức năng nhận diện nguồn hoặc sản phẩm.

## Bản đồ tài nguyên

Các đường dẫn bên dưới là đường dẫn phục vụ trên website. Tệp thực tương ứng nằm trong `public/`.

| Tệp | Kích thước | Mục đích |
| --- | --- | --- |
| `/brand/mark-primary.svg` | 64 × 64 | Dấu K vàng trầm, nền trong suốt |
| `/brand/mark-reverse.svg` | 64 × 64 | Dấu K vàng sáng cho nền tối |
| `/brand/mark-mono.svg` | 64 × 64 | Dấu K đơn sắc |
| `/brand/logo-primary.svg`, `/brand/logo-primary.png` | 360 × 88 | Logo ngang trên nền sáng |
| `/brand/logo-reverse.svg`, `/brand/logo-reverse.png` | 360 × 88 | Logo ngang trên nền tối |
| `/brand/logo-mono.svg`, `/brand/logo-mono.png` | 360 × 88 | Logo ngang đơn sắc |
| `/brand/avatar.svg` | Vector, viewBox 64 × 64 | Biểu tượng ảnh đại diện |
| `/brand/avatar.png` | 512 × 512 | Ảnh đại diện raster |
| `/favicon.svg` | Vector | Favicon SVG |
| `/favicon.ico` | Nhiều kích thước | Favicon trình duyệt |
| `/apple-touch-icon.png` | 180 × 180 | Biểu tượng khi lưu trên iOS |
| `/brand/icon-192.png`, `/brand/icon-512.png` | 192 / 512 vuông | Biểu tượng ứng dụng |
| `/brand/icon-maskable-192.png`, `/brand/icon-maskable-512.png` | 192 / 512 vuông | Biểu tượng cho nền tảng cắt mặt nạ |
| `/brand/banner-market.svg`, `/brand/banner-market.png` | 1600 × 560 | Banner bảng giá vàng |
| `/brand/banner-editorial.svg`, `/brand/banner-editorial.png` | 1600 × 560 | Banner nội dung Nhịp vàng |
| `/brand/banner-tools.svg`, `/brand/banner-tools.png` | 1600 × 560 | Banner Công cụ vàng |
| `/brand/social-card.svg`, `/brand/social-card.png` | 1200 × 630 | Ảnh chia sẻ đường dẫn |
| `/og.png` | 1200 × 630 | Bản ảnh Open Graph dùng trên website |
| `/brand/social-square.svg`, `/brand/social-square.png` | 1080 × 1080 | Ảnh đăng mạng xã hội vuông |
| `/brand/pattern.svg` | Vector | Họa tiết lặp từ ngôn ngữ logo |
| `/brand/motif.svg` | Vector | Đồ họa nhận diện độc lập |
| `/brand/preview.html` | Responsive HTML | Bảng mẫu, tải tài nguyên, sao chép màu |

Banner 1600 × 560 phù hợp khu vực giới thiệu và trang nội dung. Giữ toàn bộ khung khi dùng banner có chữ; không cắt giữa chữ hoặc co theo tỷ lệ sai. Không đặt banner lớn trước các số liệu ưu tiên trên màn hình theo dõi giá; nên dành banner cho khu vực giới thiệu, nội dung hoặc truyền thông. Ảnh chia sẻ dùng nội dung thương hiệu chung, tránh làm người xem hiểu giá minh họa là giá đang cập nhật.

## Tái tạo và kiểm tra

Từ thư mục gốc dự án:

```sh
node scripts/generate-brand-assets.mjs
```

Script là nguồn tái tạo logo, biểu tượng, banner và ảnh raster. Khi thay đổi, sửa nguồn thay vì chỉnh riêng tệp xuất để bộ SVG/PNG giữ nhất quán. Giữ các đường dẫn đã được cấu hình trong metadata, manifest và thành phần giao diện.

Sau khi tái tạo, mở `/brand/preview.html` trên màn hình lớn và điện thoại, kiểm tra tiếng Việt trong logo/banner, ba kích thước favicon 16/32/48 px, bản logo trên nền tối, các liên kết tải xuống và nút sao chép HEX. Trang mẫu không cần khóa API hoặc kết nối dịch vụ bên ngoài. Meta `noindex` là chỉ dẫn cho công cụ tìm kiếm, không phải cơ chế kiểm soát truy cập.
