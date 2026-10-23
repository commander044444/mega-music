# راهنمای راه‌اندازی، ارتقا و تأیید امنیت MEGA MUSIC

## نصب تازه (fresh)

1. ساخت پروژه Supabase و باکت‌های `covers` و `audio` (خواندن عمومی برای پخش)
2. اجرای `supabase-schema.sql`
3. اجرای `migration-001-social.sql`
4. تنظیم `config.js` (فقط URL + کلید anon)
5. Auth → Site URL و Redirect = آدرس GitHub Pages
6. ثبت‌نام یک کاربر → در SQL Editor فقط یک‌بار:
   `UPDATE public.profiles SET role = 'owner' WHERE id = 'UUID';`

## ارتقا (اگر schema پایه قبلاً اجرا شده)

1. **پشتیبان** از پروژه (Dashboard backup / dump)
2. فقط `migration-001-social.sql` را اجرا کنید
3. migration قابل اجرای مجدد است

**هرگز** بعد از migration، `supabase-schema.sql` را دوباره اجرا نکنید مگر اینکه بلافاصله دوباره `migration-001-social.sql` را هم اجرا کنید؛ فایل پایه می‌تواند تریگر/سیاست ضعیف‌تر را برگرداند.

## مدل دسترسی Storage

| عمل | سیاست |
|-----|--------|
| خواندن covers/audio | عمومی (برای پخش در GitHub Pages) |
| آپلود | مالک یا پوشهٔ `uid` خود؛ کاربر مسدود نمی‌تواند |
| به‌روزرسانی object | **فقط مالک** (جلوگیری از جابه‌جایی مسیر) |
| حذف | مالک یا پوشهٔ uid خود (مسدود هم می‌تواند فایل خود را پاک کند) |

`is_downloadable = false` جلوی دانلود URL عمومی را نمی‌گیرد.

## ماتریس نقش (مرجع)

| عمل | مهمان | کاربر | مسدود | ادمین | مالک |
|-----|-------|-------|-------|-------|------|
| خواندن published | ✓ | ✓ | ✓ | ✓ | ✓ |
| ارسال pending | | ✓ | | ✓ | ✓ |
| انتشار / reviewed_* | | | | ✓ | ✓ |
| ویرایش پروفایل عادی | | ✓ | | ✓ | ✓ |
| is_verified / is_banned | | | | | ✓ |
| role | | | | | فقط SQL Editor |
| پلی‌لیست رسمی | | | | | ✓ |
| follow / like | | ✓ | | ✓ | ✓ |

## پرس‌وجوهای فقط‌خواندنی برای تأیید

```sql
-- تریگرهای profiles و tracks
SELECT c.relname AS table_name, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles','tracks','playlists')
  AND NOT t.tgisinternal
ORDER BY 1, 2;

-- انتظار profiles: protect_profile_privileged_fields_trg
-- انتظار tracks: protect_track_moderation_trg
-- انتظار playlists: protect_playlist_official_trg

-- سیاست‌های جداول عمومی
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles','tracks','playlists','playlist_items',
    'likes','follows','listening_history','download_events','audit_logs'
  )
ORDER BY tablename, policyname;

-- سیاست‌های Storage
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- توابع SECURITY DEFINER مرتبط
SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_owner','is_staff','is_banned_user',
    'protect_profile_privileged_fields','protect_profile_role',
    'protect_track_moderation','protect_playlist_official'
  );
```

## تست در پروژهٔ disposable (نه production)

با JWT واقعی هر نقش (نه فقط تغییر ردیف profile):

```sql
-- به‌عنوان کاربر عادی باید FAIL شود:
UPDATE public.profiles SET is_verified = true WHERE id = auth.uid();
UPDATE public.profiles SET role = 'owner' WHERE id = auth.uid();
UPDATE public.profiles SET created_at = now() WHERE id = auth.uid();
```

ارسال track با `status = 'published'` توسط کاربر عادی باید توسط RLS رد شود.
تغییر `reviewed_by` روی track متعلق به خود باید توسط تریگر رد شود.

## محدودیت‌های باقی‌مانده

- بن Auth را خودکار قطع نمی‌کند؛ session موجود تا انقضا معتبر است مگر در Dashboard revoke شود.
- سیاست‌های Storage با نام دلخواه دستی در پروژه ممکن است باقی بمانند؛ با query بالا موجودی را بررسی کنید.
- این مخزن تست PostgreSQL زنده ندارد؛ تأیید نهایی روی پروژه آزمایشی شماست.
