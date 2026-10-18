# CARA RM-1: authenticated LearnWorlds launch

Permanent content URL: https://cara-mentor.vercel.app/api/risk-workshop
Login initiation: https://cara-mentor.vercel.app/api/risk-lti-login
Launch/redirect URI: https://cara-mentor.vercel.app/api/risk-lti-launch
JWKS: https://cara-mentor.vercel.app/api/risk-keys
Deep Linking: not implemented; leave blank. Grade return: not implemented.

Register under LearnWorlds Settings → Integrations → LTI Tools.
Then set RM1_LTI_PLATFORM (server-only JSON) with issuer, clientId,
deploymentId, authorizationUrl, jwksUrl; optionally allowedContextIds.
All platform URLs are allowlisted to HTTPS LearnWorlds domains. No automatic registration.
If school-generated URLs use another official domain, review and add that exact host explicitly.

Use a non-graded Multimedia → LTI activity, content link above. Ordinary HTML
embedding does not prove a LearnWorlds session. No API secret belongs in HTML.
Existing LearnWorlds authentication, main CARA chat and other cases are unchanged.

Server requirements: OPENAI_API_KEY, RM1_CASE_JSON, RM1_GUIDE_JSON,
RM1_TOOL_PRIVATE_JWK, KV_REST_API_URL, KV_REST_API_TOKEN.
Case and rubric JSON stay in private Vercel environment values; never commit them.

Flow: registered issuer → browser-bound 5 minute state+nonce → RS256 verified launch
(issuer/audience/azp/nonce/expiry/deployment/resource/role/target) → 2 hour random
session in Redis → bearer-authenticated CARA requests. User existence alone is not auth.
State is consumed atomically. Session and rate records use a hashed platform subject,
not name/email. No participant answers are persisted on the server in this version.
Browser drafts are keyed by verified subject hash. No background cross-device sync.
Third party/partitioned cookies are needed for login CSRF binding; launch in a new
window if the browser blocks the binding. No cookie-check bypass or URL session tokens.

Names: signed custom cf_certification_name takes precedence, then signed full name.
Optional school API enrichment is attempted only if the signed subject matches the
returned school user id exactly. No lookup by a browser-provided name, email or uid.
Display data is not sent to the model; participant-written answers may contain names.

Tests: node --test test/rm-auth.test.mjs. Synthetic issuer keys only. Live school
handshake needs the actual school-generated registration data. No LTI certification claimed.

## 18 Ekim 2026 — katılımcı testi düzeltmeleri

- Değişiklik sınırı: yalnızca rm-* / risk-* dosyaları ve bu belge. Her yayından önce `git diff --stat` ve korunan dosyaların blob SHA karşılaştırması yapılır. Ana CARA ayarları değiştirilmez.
- Akış: aynı commit önce önizlemede denenir, ardından production main'e taşınır; ana CARA kısa sohbetle doğrulanır. Ayrı Vercel projesine taşıma sonraki iş olarak değerlendirilir.
- Hitap: arayüz ve CARA'da siz. Belgelerde kişisel isimler korunur. CARA geri bildiriminde isim kullanılmaz.
- Kapsam: referans havuzu eksiksiz liste şartı değildir. 8+ risk / 5+ kategori / bir fırsat kategori kapsamı için Yetkin; 8+ / 3–4 kategori / fırsat Gelişen; 8'den az veya 1–2 kategori Başlangıç. Dayanak ve yazım ayrı değerlendirilir. Boş kategoriler gelişim sorusuyla hatırlatılır; zorunlu doldurma şartı değildir.
- Eski geri bildirim taslakta etiketle korunur, geçiş ve rapor için geçerli sayılmaz. Model çağrısına eski değerlendirme eklenmez.
- Örnek ilk beş: A5 incelemesi başarıyla bittikten sonra, aynı oturumda ve aynı risk/puan/öncelik cevapları için açılır. Sunucu özeti RM1_GUIDE_JSON içinden çıkarır. Yeni anahtar ortam değişkeni gerekmez. Yeni LTI oturumunda örneği açmak için A5 değerlendirmesini yenilemek gerekir.
- Sponsor özetleri: canlı 25 kelime sayacı, kullanıcı tarafından seçilip düzenlenebilen risk cümlesi taslağı.
- Rapor: açılır pencere, aynı sayfada yazdırılabilir görünüm ve UTF-8 HTML indirme. HTML dosyası başka tarayıcıda açılıp PDF olarak kaydedilebilir. Kişisel notlar rapora girmez.
- Safari/iPad: gerçek Safari ve fiziksel iPad testi ayrıca yapılmalıdır; Chromium mobil görünümü bunun yerine geçmez.
