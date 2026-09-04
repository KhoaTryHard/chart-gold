# Nguồn dữ liệu giá vàng

Dashboard giữ từng công ty thành một nguồn độc lập. Khi nguồn không trả được
giá hợp lệ, API trả `availability: "unavailable"` và không dùng giá SJC làm
giá thay thế.

## Nguồn đã tích hợp

- **SJC**: XML chính thức của SJC, kèm lịch sử đối chiếu từ Vàng.Today và
  dataset công khai cho chuỗi miếng.
- **PNJ**: API bảng giá chính thức của PNJ, gồm giá theo khu vực, vàng SJC tại
  PNJ, nhẫn trơn 999.9, Kim Bảo, Phúc Lộc Tài và nhóm nữ trang theo tuổi vàng
  từ 999.9 đến 8K. Lịch sử theo ngày dùng API công bố của PNJ; mỗi dòng là giá
  niêm yết theo lượng, không suy diễn giá riêng theo quy cách chỉ.
- **DOJI, Bảo Tín, VN Gold, VietinBank**: các mã sản phẩm được công bố trong
  tài liệu API Vàng.Today; đây là nguồn tổng hợp, không gắn nhãn official.
- **Bảo Tín Minh Châu (BTMC)**: bảng giá HTML chính thức tại
  `/Home/BGiaVang`; lịch sử dùng endpoint JSON chính thức
  `/ProductHome/getGoldDate?date=dd/mm/yyyy` theo từng ngày, tối đa 7 ngày để
  không tạo tải lớn lên website. Giá nguồn là nghìn đồng/chỉ, được chuẩn hóa
  sang triệu đồng/lượng. Quote hiện tại luôn được tải trước lịch sử.
- **Phú Quý**: bảng giá chính thức tại
  `https://gold.phuquy.com.vn/giavang` và lịch sử tại `/XemLai?date=YYYY-MM-DD`.
  Bảng nguồn là VNĐ/chỉ, được chuẩn hóa sang triệu đồng/lượng. Lịch sử tối đa
  7 ngày do website không công bố endpoint lịch sử hàng loạt.
- **VietinBank Gold & Jewellery (VGJ)**: bảng giá chính thức gồm vàng miếng
  SJC, nhẫn VGJ/SJC theo quy cách, và nữ trang 99.99%. Nguồn chỉ công bố
  snapshot hiện tại, nên dashboard không tạo chuỗi lịch sử giả.

## Mi Hồng

Mi Hồng vẫn được giữ trong registry để không mất lựa chọn trong tương lai,
nhưng không xuất hiện trong bộ lọc đang hoạt động. Tại thời điểm kiểm tra,
`mihong.vn` phục vụ trang thông báo tên miền hết hạn và không có endpoint chính
thức hoạt động đã xác minh. Dashboard vì vậy trả trạng thái unavailable thay vì
dùng dữ liệu của website tổng hợp.

## Kiểm soát dữ liệu

Các bộ chuyển đổi yêu cầu cả giá mua và giá bán, kiểm tra phạm vi và kiểm tra
đúng tên/key của sản phẩm. Sản phẩm chỉ có giá mua (ví dụ một số dòng nguyên
liệu hoặc sản phẩm xu) vẫn hiện trong đúng danh mục của thương hiệu nhưng bị
vô hiệu hóa trong bộ lọc, thay vì hiển thị một quote không hoàn chỉnh.
