# Google OAuth cho Kim Tuyến Production

## Callback bắt buộc

OAuth Client đang dùng ở Vercel phải là loại **Web application** và có đúng URI sau trong **Authorized redirect URIs**:

```text
https://www.vanghomnay.online/api/auth/callback/google
```

Google so sánh tuyệt đối scheme, hostname, path và dấu `/` cuối. Không thêm `/phan-tich`, không dùng callback từ deployment preview, và không dùng hostname không có `www` cho client Production.

## Cấu hình Google Cloud

1. Mở Google Cloud Console bằng project đang sở hữu OAuth Client tương ứng `AUTH_GOOGLE_ID` trên Vercel.
2. Trong **Google Auth Platform → Clients**, mở đúng Web Client và thêm callback trên. Lưu thay đổi.
3. Trong **Branding**, đặt tên ứng dụng, support email, contact email và domain `vanghomnay.online`.
4. Trong **Audience**, chọn External và đưa ứng dụng sang trạng thái phù hợp cho người dùng công khai. Với `openid`, `email`, `profile`, ứng dụng chỉ dùng dữ liệu định danh cơ bản.
5. Cập nhật `AUTH_GOOGLE_ID` và `AUTH_GOOGLE_SECRET` ở Vercel chỉ khi tạo OAuth Client mới; hai biến phải thuộc cùng một client.

Không đưa client secret vào source, trình duyệt hoặc chat. Dùng OAuth Client khác cho localhost/Preview nếu cần đăng nhập ở các môi trường đó.

## Vercel Production

```text
AUTH_URL=https://www.vanghomnay.online
AUTH_TRUST_HOST=true
SITE_URL=https://www.vanghomnay.online
B2C_AI_ENABLED=true
AI_EXPERIENCE_V2_ENABLED=true
AI_COMMUNITY_MONTHLY_LIMIT=3
SUBSCRIPTIONS_SALES_ENABLED=false
```

Sau khi thay đổi biến hoặc OAuth Client, deploy Production rồi kiểm tra từ cả `vanghomnay.online` và `www.vanghomnay.online`. Cả hai phải dẫn tới callback `www` ở trên.

## Nghiệm thu

1. User thường hoàn tất Google OAuth và quay về `/phan-tich?ai=resume` với bản nháp được khôi phục.
2. User thường thấy ba lượt AI cộng đồng trong tháng lịch Việt Nam và dùng được các chế độ đang bật cho beta.
3. Khi hết lượt, thông báo ghi rõ sẽ cấp lại vào tháng lịch Việt Nam tiếp theo.
4. Admin vẫn không giới hạn lượt; API quản trị không mở cho user thường.
