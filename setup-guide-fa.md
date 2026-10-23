# راهنمای راه‌اندازی و امنیت MEGA MUSIC

## ترتیب اجرا

1. اگر هنوز اجرا نشده: `supabase-schema.sql`
2. سپس **حتماً**: `migration-001-social.sql` (قابل اجرای مجدد)

Migration جدول‌ها را حذف نمی‌کند و حساب مالک و داده‌های موجود را حفظ می‌کند.

## پیش‌نیاز

- باکت‌های Storage: `covers` و `audio`
- در `config.js` فقط Project URL و کلید **anon**
- Site URL / Redirect در Auth = آدرس GitHub Pages

## چه کسی چه کاری می‌تواند بکند

| عمل | مهمان | کاربر | مسدود | ادمین (غیرمالک) | مالک |
|-----|-------|-------|-------|------------------|------|
| دیدن آهنگ published | بله | بله | بله | بله | بله |
| ارسال آهنگ pending | خیر | بله | خیر | بله | بله |
| انتشار مستقیم | خیر | خیر | خیر | بله* | بله |
| تغییر reviewed_* / moderation_note | خیر | خیر | خیر | بله | بله |
| ویرایش username/bio خود | خیر | بله | خیر | بله | بله |
| تغییر is_verified / is_banned | خیر | خیر | خیر | **خیر** | **بله** |
| تغییر role | خیر | خیر | خیر | خیر | فقط SQL Editor |
| پلی‌لیست عادی | خیر | بله | خیر† | بله | بله |
| پلی‌لیست رسمی (is_official) | خیر | خیر | خیر | خیر | بله |
| دنبال کردن | خیر | بله | خیر | بله | بله |
| آپلود Storage در پوشه خود | خیر | بله | خیر | بله | بله |

\* ادمین از طریق سیاست staff و تریگر moderation  
† کاربر مسدود: insert follow/like/track و update پروفایل مسدود است

## تأیید بعد از Migration (فقط خواندنی)

```sql
-- باید protect_profile_privileged_fields_trg باشد (نه protect_profile_role_trg)
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;

SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.tracks'::regclass AND NOT tgisinternal;

SELECT polname FROM pg_policy WHERE polrelid = 'public.tracks'::regclass;
```

## تست‌های پیشنهادی در پروژهٔ آزمایشی (نه production)

به‌عنوان کاربر عادی:

```sql
-- باید خطا بدهد
UPDATE public.profiles SET is_verified = true WHERE id = auth.uid();
UPDATE public.profiles SET is_banned = true WHERE id = auth.uid();
UPDATE public.profiles SET role = 'owner' WHERE id = auth.uid();
```

ارسال آهنگ با `status = 'published'` توسط کاربر عادی باید توسط RLS رد شود.

## محدودیت‌ها

- باکت audio در صورت public بودن، URL قابل دانلود است؛ `is_downloadable` فقط متادیتاست.
- محیط PostgreSQL محلی در CI این مخزن اجرا نشده؛ تست‌های نقش را در پروژه disposable خود اجرا کنید.
