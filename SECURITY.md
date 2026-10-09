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
| 11 | שם/משפט/מוצרים של חנות מאושרת ניתנים לעריכה בלי אישור מחדש | Medium | חנות נקייה מאושרת ואז משנה לשם פוגעני/התחזות | פתוח — מנוהל כרגע ע"י דיווח + השעיה. אפשר להוסיף "שינוי שם ← חזרה ל-pending" |
| 12 | צ'אט ציבורי ללא סינון תוכן | Medium | הטרדה/ספאם; קישורים מוסרים, אבל לא קללות | פתוח — מגבלת קצב כן, אין חסימת משתמשים |
| 13 | CDN חיצוני (jsdelivr, gstatic) | Low-Med | פריצה לחבילה → סקריפט זדוני | מוגבל ע"י גרסאות נעוצות ו-CSP. מומלץ בהמשך: להוריד את three.js ו-supabase-js לריפו (vendor) |
| 14 | טופס ההזמנה הישן: PIN `1512` בצד לקוח | Low | רק מציג הזמנות מ-localStorage של אותו מכשיר — אין דליפה אמיתית; לא להשתמש בו כהגנה | ידוע |
| 15 | Realtime בחבילה החינמית | Info | כ-10–15 מטיילים במקביל ימלאו את מכסת ההודעות | זמינות, לא אבטחה |

**אומת בקוד ואין בו בעיה:** XSS — כל טקסט משתמש עובר `esc()` או `textContent` (שמות, מוצרים, דיווחים, צ'אט, tooltips); IDOR/BOLA — כל הטבלאות מוגנות ב-RLS לפי `owner`, וה-triggers מאפסים `owner/status/lot` לכל מי שאינו אדמין; העלאת הרשאות — לטבלת `profiles` אין policy לכתיבה, אי אפשר להפוך את עצמך לאדמין; הזרקות SQL — אין SQL דינמי (PostgREST עם פרמטרים); iframe של לייב — נבנה אך ורק מ-id שנותח מ-YouTube/Twitch עם `sandbox`.

## מה שאתה צריך לעשות (Supabase Dashboard)
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
