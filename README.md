# autobifree

Userscript **Chill chill đổ số 1.6**, bản sửa **1.6.1**, dành cho trang báo cáo ĐMX và CRM TGDĐ. Tên script, namespace và tác giả Bi được giữ theo bản gốc.

[Cài đặt hoặc cập nhật trong Tampermonkey](https://raw.githubusercontent.com/nnnluv7/autobifree/refs/heads/chill-chill-1.6/baocao.user.js). Mở liên kết và chọn **Cập nhật/Cài đặt**, sau đó tải lại trang báo cáo. Bản đã cài trước đây cần cập nhật qua liên kết này một lần để nhận đúng nguồn cập nhật của nhánh `chill-chill-1.6`.

Mã đã được giải mã bảng chuỗi và định dạng lại để đọc, với các module chính có tên `AUTH`, `DATA`, `UTILS`, `UI`, `APP` và `CONSTANTS`.

Các thay đổi trong 1.6.1:

- Giữ đúng doanh thu, target, số lượng và tỷ lệ đọc từ trang nguồn, ở mọi trạng thái giấy phép.
- Nút lưu/tải báo đúng khi chưa xác thực quyền sử dụng. Lưu Cloud cần phản hồi HTTP thành công cùng JSON có `status: "success"`; khi đồng bộ lỗi, cấu hình lưu trên máy vẫn được giữ và nút lưu cho phép thử lại.
- Xác thực đúng tài khoản, đọc CSV có dấu phẩy, dấu ngoặc kép và xuống dòng trong ô. Cache được kiểm tra cấu trúc, giới hạn ba ngày và cập nhật số ngày còn hạn theo ngày hiện tại.
- Sửa lỗi biến `href` chưa khai báo ở màn hình tải và bổ sung xử lý hết thời gian chờ khi lấy tên tài khoản, lưu/tải cấu hình.
- Đường dẫn cập nhật trỏ về kho `nnnluv7/autobifree`, nhánh `chill-chill-1.6`.

Cơ chế cấp quyền từ Google Sheet vẫn được sử dụng, theo `CONSTANTS.GSHEET.AUTH`:

| Cột | Ý nghĩa |
| --- | --- |
| A hoặc B | Mã tài khoản được đối chiếu với người dùng đang đăng nhập |
| I | Số ngày còn hạn; ô trống giữ quy tắc không giới hạn ngày, số âm là hết hạn |
| M | Mã kích hoạt có ít nhất 8 ký tự |

Cloud, theme và công cụ mở rộng tiếp tục dùng các Google Sheet/Apps Script đang khai báo trong mã.

Chạy kiểm tra bằng Node.js:

```sh
node --check baocao.user.js
node --test tests/license.test.cjs
```

32 bài kiểm tra bao phủ cấp quyền, cache, đổi tài khoản, lỗi mạng/CSV, kết quả lưu Cloud và tính chính xác số liệu sau khi bị từ chối quyền. Đã đối chiếu DOM/CSS của bảng khai báo với bản gốc và kiểm tra các nhánh lưu/tải bằng dữ liệu mô phỏng. Việc xác thực với Google Sheet và tài khoản báo cáo thực tế cần được kiểm tra trong phiên đăng nhập đang sử dụng.
