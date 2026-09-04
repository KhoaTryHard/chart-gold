# Nguồn dữ liệu giá vàng

Dashboard giữ từng công ty thành một nguồn độc lập. Khi nguồn không trả được
giá hợp lệ, API trả `availability: "unavailable"` và không dùng giá SJC làm
giá thay thế.

## Nguồn đã tích hợp

- **SJC**: XML chính thức của SJC, kèm lịch sử đối chiếu từ Vàng.Today và
  dataset công khai cho chuỗi miếng.
- **PNJ, DOJI, Bảo Tín, VN Gold, VietinBank**: các mã sản phẩm được công bố
  trong tài liệu API Vàng.Today; đây là nguồn tổng hợp, không gắn nhãn official.
- **Bảo Tín Minh Châu (BTMC)**: bảng giá HTML chính thức tại
  `/Home/BGiaVang`; lịch sử dùng endpoint JSON chính thức
  `/ProductHome/getGoldDate?date=dd/mm/yyyy` theo từng ngày, tối đa 7 ngày để
  không tạo tải lớn lên website. Giá nguồn là nghìn đồng/chỉ, được chuẩn hóa
  sang triệu đồng/lượng. Quote hiện tại luôn được tải trước lịch sử.
- **Phú Quý**: bảng giá chính thức tại
  `https://gold.phuquy.com.vn/giavang` và lịch sử tại `/XemLai?date=YYYY-MM-DD`.
  Bảng nguồn là VNĐ/chỉ, được chuẩn hóa sang triệu đồng/lượng. Lịch sử tối đa
  7 ngày do website không công bố endpoint lịch sử hàng loạt.

## Mi Hồng

Mi Hồng vẫn được giữ trong registry để không mất lựa chọn trong tương lai,
nhưng không xuất hiện trong bộ lọc đang hoạt động. Tại thời điểm kiểm tra,
`mihong.vn` phục vụ trang thông báo tên miền hết hạn và không có endpoint chính
thức hoạt động đã xác minh. Dashboard vì vậy trả trạng thái unavailable thay vì
dùng dữ liệu của website tổng hợp.

## Kiểm soát dữ liệu

Các bộ chuyển đổi yêu cầu cả giá mua và giá bán, kiểm tra phạm vi và kiểm tra
đúng tên/key của sản phẩm. Sản phẩm chỉ có giá mua (ví dụ một số dòng nguyên
liệu hoặc sản phẩm xu) không được hiển thị thành một quote hoàn chỉnh.
