# راهنمای راه‌اندازی MEGA MUSIC

کاتالوگ از ابتدا **خالی** است. هیچ آهنگ نمونه‌ای وجود ندارد.

## ۱. پروژه Supabase

1. در [supabase.com](https://supabase.com) یک پروژه بسازید.
2. از Settings → API مقدار **Project URL** و **anon public** key را کپی کنید.
3. در فایل `config.js` در ریشهٔ مخزن این دو مقدار را قرار دهید و commit/push کنید.

## ۲. اجرای SQL

در SQL Editor به‌ترتیب محتوای فایل `supabase-schema.sql` را اجرا کنید.

هیچ دادهٔ نمونه (seed) درج نمی‌شود.

## ۳. Storage

در بخش Storage دو باکت بسازید:

| باکت   | دسترسی پیشنهادی |
|--------|------------------|
| covers | Public           |
| audio  | Public (یا private + signed URL در فاز بعدی) |

سیاست‌های ساده برای آپلود توسط کاربر احرازهویت‌شده:

```sql
-- مثال برای covers (در صورت نیاز تنظیم کنید)
CREATE POLICY "Auth upload covers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'covers');

CREATE POLICY "Public read covers" ON storage.objects
  FOR SELECT USING (bucket_id = 'covers');

CREATE POLICY "Auth upload audio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audio');

CREATE POLICY "Public read audio" ON storage.objects
  FOR SELECT USING (bucket_id = 'audio');
```

## ۴. احراز هویت

- Authentication → Providers → Email را فعال کنید.
- در صورت تمایل تأیید ایمیل را روشن کنید.
- Redirect URLها را با آدرس GitHub Pages تنظیم کنید:  
  `https://commander044444.github.io/mega-music/`

## ۵. اولین مالک (امن)

1. یک‌بار از طریق سایت ثبت‌نام کنید.
2. در Supabase → Authentication → Users شناسهٔ UUID خود را کپی کنید.
3. در SQL Editor فقط یک‌بار اجرا کنید:

```sql
UPDATE public.profiles
SET role = 'owner'
WHERE id = 'YOUR_USER_UUID';
```

هرگز این به‌روزرسانی را عمومی یا از طریق کلاینت انجام ندهید.

## ۶. بارگذاری اولین آهنگ واقعی

1. با حساب مالک وارد شوید.
2. از نوار پایین «بیشتر» را باز کنید.
3. فرم «بارگذاری آهنگ» را پر کنید (عنوان، هنرمند، فایل صوتی الزامی است).
4. پس از موفقیت، آهنگ در صفحهٔ اصلی و جستجو ظاهر می‌شود.

## ۷. Google OAuth (اختیاری)

در Authentication → Providers → Google تنظیمات را انجام دهید و Redirect URL صفحات را اضافه کنید.

## ۸. بررسی نهایی

- سایت بدون config فقط حالت خالی و بنر پیکربندی را نشان می‌دهد.
- پس از config و SQL، کاتالوگ همچنان خالی است تا شما آهنگ واقعی اضافه کنید.
- جستجو روی داده‌های واقعی کار می‌کند.
- پخش‌کننده فقط وقتی آهنگ منتشرشده وجود دارد فعال می‌شود.
