# אבטחה — "עיר הפוקימון" (pokeor.github.io/order)

**ארכיטקטורה:** אתר סטטי (GitHub Pages, ללא שרת משלנו) ← Supabase: Auth (אימייל+סיסמה), Postgres עם RLS, Storage, Realtime broadcast. אין cookies; ה-JWT נשמר ב-localStorage של supabase-js. אין שרת ולכן אין SSRF / הזרקת פקודות / CSRF קלאסי (ה-API משתמש בכותרת Authorization, לא ב-cookies).
**מידע רגיל:** מייל וסיסמת מוכרים (נשמרת מגובבת ע"י Supabase), מספרי וואטסאפ של חנויות (פומבי בכוונה), תמונות מוצרים. אין תשלומים באתר.
המפתח ב-`city/config.js` הוא *publishable* — פומבי בתכנון. אין בריפו אף מפתח סודי (נסרק: service_role / sb_secret / JWT / מפתחות פרטיים).

## ממצאים

| # | תחום | סיכון | תרחיש | סטטוס |
|---|------|-------|-------|--------|
| 1 | Realtime: ערוץ פומבי בלי הגבלה | High | תוקף שולח אלפי הודעות `hello` עם מזהים מזויפים → כל לקוח בונה אווטאר (≈9K משולשים) וזיכרון/GPU מתמוטטים, וכל לקוח עונה `hello` (הגברה) | **תוקן**: תקרת 40 אווטארים, הגבלת קצב לכל שולח (chat 1s, hello 1.5s, state 60ms), תגובת hello מוגבלת, אימות מזהה/גודל הודעה |
| 2 | Storage: אין הגבלת סוג/גודל; כל משתמש רשום יכול להעלות | High | העלאת HTML/SVG/קבצים כבדים דרך ה-API שעוקף את הדפדפן; מילוי מכסת האחסון; הדבקת תוכן מהדומיין שלנו | **תוקן ב-`hardening.sql`**: 1.5MB, jpeg/png/webp בלבד, רק לבעלי חנות, עד 80 קבצים למשתמש, בלי רשימת קבצים פומבית |
| 3 | `reports` פתוח לכתיבה אנונימית | Medium | הצפת טבלה / מילוי מכסה / דיווחי שווא | **תוקן**: רק על חנות פעילה, 20 לדקה לכלל, 30 ליום לחנות |
| 4 | חנות אחת לבעלים נאכפת רק ב-policy | Medium | race → כמה חנויות לאותו משתמש | **תוקן**: unique index |
| 5 | מוצרים ללא תקרה | Medium | ספאם של אלפי מוצרים | **תוקן**: עד 60 לחנות |
| 6 | `live_url`/`image_url` בלי בדיקת מארח בצד DB | Medium | API עוקף את ה-UI ושומר כתובת זדונית | **תוקן**: CHECK על youtube/twitch ועל ה-bucket שלנו; ה-UI ממילא בונה embed רק ממזהה שנותח |
| 7 | אין CSP | Medium | כל XSS עתידי היה יכול לגנוב את הסשן מ-localStorage | **תוקן**: CSP מחמיר ב-meta (hash ל-importmap, ספקים מותרים בלבד), `object-src none`, `base-uri none`, referrer policy, frame-buster |
| 8 | `window.cityDebug` חשוף (כולל לקוח Supabase) | Low | נוחות לתוקף אחרי XSS | **תוקן**: רק עם `?debug` |
| 9 | הרשמה ללא אימות מייל וללא CAPTCHA | Medium | בוטים פותחים חשבונות; הרשמה על מייל של אחרים | **דורש פעולה שלך** (ראו למטה) |
| 10 | סיסמה מינימלית 6 | Medium | ניחוש סיסמאות | **דורש פעולה שלך** |
| 11 | שם/משפט של חנות מאושרת ניתנים לעריכה בלי אישור מחדש | Medium | חנות נקייה מאושרת ואז משנה לשם פוגעני/התחזות | **תוקן** (`review.sql`): שינוי שם/משפט מחזיר ל-pending ומסיר לייב; סינון מילים בצד לקוח לשם, משפט ומוצר |
| 12 | צ'אט ציבורי ללא סינון תוכן | Medium | הטרדה/ספאם | **תוקן** (ראו שכבת הפיקוח למטה) |
| 13 | CDN חיצוני (jsdelivr, gstatic, Google Fonts) | Low-Med | פריצה לחבילה → סקריפט זדוני אצל כל מבקר | **תוקן**: three.js, supabase-js, מפענח Draco והפונטים מאוחסנים בריפו (`vendor/`), CSP סגור ל-`'self'` + Supabase בלבד, ו-`vendor.sha256` נבדק ב-CI |
| 14 | טופס ההזמנה הישן: PIN `1512` בצד לקוח | Low | רק מציג הזמנות מ-localStorage של אותו מכשיר — אין דליפה אמיתית; לא להשתמש בו כהגנה | ידוע |
| 15 | Realtime בחבילה החינמית | Info | כ-10–15 מטיילים במקביל ימלאו את מכסת ההודעות | זמינות, לא אבטחה |

**אומת בקוד ואין בו בעיה:** XSS — כל טקסט משתמש עובר `esc()` או `textContent` (שמות, מוצרים, דיווחים, צ'אט, tooltips); IDOR/BOLA — כל הטבלאות מוגנות ב-RLS לפי `owner`, וה-triggers מאפסים `owner/status/lot` לכל מי שאינו אדמין; העלאת הרשאות — לטבלת `profiles` אין policy לכתיבה, אי אפשר להפוך את עצמך לאדמין; הזרקות SQL — אין SQL דינמי (PostgREST עם פרמטרים); iframe של לייב — נבנה אך ורק מ-id שנותח מ-YouTube/Twitch עם `sandbox`.

## שכבה: פיקוח על צ'אט ומשתמשים (`city/moderation.js` + `supabase/moderation.sql`)
- **סינון תוכן** בשליחה ובקבלה: קללות (עברית/אנגלית, רשימה בסיסית שניתנת להרחבה), הסתרת טלפונים/מיילים/קישורים, קיצור תווים חוזרים, חסימת הודעה זהה תוך 15 שניות.
- **השתקה אישית**: לחיצה על דמות של שחקן ← "השתקה" (נשמר במכשיר, מבטל גם את הדמות).
- **דיווח על שחקן**: 4 סיבות מוכנות + 5 ההודעות האחרונות שלו כראיה, השתקה אוטומטית למדווח; מוגבל בקצב (חצי דקה לדיווח, 15 לדקה לכלל).
- **חסימה ע"י הבעלים**: פאנל 👑 ← "דיווחים על שחקנים" ← "חסום". הרשימה ב-`banned_uids` (קריאה פומבית, כתיבה לאדמין), וכל לקוח מרענן אותה כל דקה ומתעלם מהחסומים.
- **מגבלה גלויה:** הזהות היא מזהה קבוע לדפדפן (`dr_uid`), לא חשבון — מי שמנקה אחסון חוזר. לחסימה קשיחה צריך להכריח התחברות לצ'אט (אפשרי בהמשך).

## שכבה: שרשרת אספקה ובדיקות אוטומטיות
- `vendor/` — כל הקוד של צד שלישי (three.js r170 + תוספים, supabase-js 2.45.4, מפענח Draco, פונטים) מוגש מהדומיין שלנו. `vendor.sha256` הוא סכום בדיקה; אחרי כל עדכון ספרייה: `find city/vendor vendor -type f | sort | xargs shasum -a 256 > vendor.sha256`.
- `.github/workflows/security.yml` רץ בכל push ובכל יום שני: שלמות vendor, gitleaks (סודות, כולל היסטוריה), semgrep (OWASP, רק חומרה גבוהה), ו-OWASP ZAP baseline מול האתר החי. `dependabot.yml` מעדכן את ה-Actions.

## מה שאתה צריך לעשות (Supabase Dashboard)
0. להריץ את `supabase/security-all.sql` (hardening + moderation + review במכה אחת; בטוח להריץ שוב) — בלעדיו הדיווחים על שחקנים והחסימות לא נשמרים.
1. SQL Editor ← להריץ את `supabase/hardening.sql` (פעם אחת).
2. Authentication ← **Sign In / Providers ← Email**: אורך סיסמה מינימלי **10**, להפעיל "Prevent use of leaked passwords" אם קיים בתוכנית שלך.
3. Authentication ← **Attack Protection**: להפעיל CAPTCHA (Cloudflare Turnstile, חינמי) — אחרי זה אעדכן את הקוד לשלוח את הטוקן.
4. Authentication ← **URL Configuration**: Site URL = `https://pokeor.github.io/order/city/`, ולהסיר כל Redirect URL אחר.
5. Authentication ← **Multi-Factor**: להפעיל TOTP, להירשם עם אפליקציית אימות בחשבון שלך, ואז להריץ את סעיף 7 (אופציונלי) ב-hardening.sql כדי שפעולות אדמין ידרשו גורם שני.
6. כשיהיה לך SMTP משלך: להפעיל שוב **Confirm email**.
7. Project Settings ← **Security Advisor** ו-Performance: לוודא שאין אזהרות אדומות.

## צ'ק-ליסט לפני שמפרסמים לציבור
**ידני**
- [ ] בחשבון משתמש רגיל: לנסות דרך DevTools `supabase.from('shops').update({status:'approved'})` — חייב להיכשל/להתאפס.
- [ ] לנסות לקרוא/לערוך חנות או מוצרים של משתמש אחר (שני חשבונות) — חייב להיכשל.
- [ ] להעלות `.html` או קובץ של 5MB ל-bucket — חייב להידחות.
- [ ] להזין שם חנות `<img src=x onerror=alert(1)>` ו-`javascript:` כקישור לייב — מוצג כטקסט / נדחה.
- [ ] 60+ מוצרים לחנות, 20+ דיווחים בדקה — חייבים להיחסם.
- [ ] בקונסולה: אין שגיאות "Refused to ... Content Security Policy" בדפי `/` ו-`/city/`.
- [ ] טלפון אמיתי: הליכה בשוק, צ'אט, הזמנה בוואטסאפ.

**אוטומטי (מומלץ)**
- SAST: `semgrep --config p/javascript --config p/owasp-top-ten city/` ו-`npm audit` אם יתווסף package.json.
- סודות: `gitleaks detect` (ובהמשך כ-pre-commit); GitHub → Settings → Code security: Secret scanning + Dependabot.
- DAST: OWASP ZAP baseline מול האתר החי (`zap-baseline.py -t https://pokeor.github.io/order/city/`); בדיקת RLS: `supabase db lint` ובדיקות pgTAP לכל policy.
- כותרות: securityheaders.com / Mozilla Observatory (GitHub Pages לא מאפשר כותרות HTTP, לכן ה-CSP ב-meta; למעבר ל-Cloudflare/Netlify יתאפשרו HSTS ו-`frame-ancestors`).
