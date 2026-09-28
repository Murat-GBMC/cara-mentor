# CARA — Aylık adil kullanım limitleri (v11)

CARA her kullanıcı için takvim ayı boyunca (İstanbul saatiyle) şunları sayar:

- **Mesaj sayısı**: kullanıcıya gösterilen limit.
- **Token**: gerçek OpenAI maliyeti. Buna bilgi tabanı araması (file_search) ve PDF okuma da dahildir.
- **Dakikalık hız**: kötüye kullanıma ve döngüye giren script'lere karşı.
- **Toplam aylık token tavanı** (isteğe bağlı): tüm kullanıcılar için ortak üst sınır.

Kullanım %80'e ulaşınca sohbetin altında bir not görünür. Limit dolunca CARA, kullanıcının seçtiği dilde (EN/TR/FR/IT/ZH/AR) bilgi verir, yenilenme tarihini söyler ve giriş alanı kilitlenir. Ayın 1'inde saat 00:00'da (TR) sayaçlar kendiliğinden sıfırlanır.

## 1. Upstash Redis'i bağlayın (zorunlu)

Vercel → proje → **Storage** (Marketplace) → **Upstash Redis** → *Create* → projeye bağlayın.
Ortam değişkenleri otomatik eklenir. Kod her iki isimlendirmeyi de tanır:
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` veya `KV_REST_API_URL` / `KV_REST_API_TOKEN`.

> Bu değişkenler yoksa CARA eskisi gibi **limitsiz** çalışır. Redis'e ulaşılamazsa da CARA durmaz, hata Vercel loglarına yazılır.

## 2. LearnWorlds'te iframe adresine kullanıcı ID'sini ekleyin

```html
<iframe src="https://cara-mentor.vercel.app/?platform=coe&uid={{USER.ID}}" ...></iframe>
```

PDU Circle için `platform=pdu` yazın. Kullanıcı ID'sini veren değişkenin adını LearnWorlds editöründe kontrol edin (`{{USER.ID}}` veya benzeri). Önizlemede gerçek bir ID'ye dönüştüğünden emin olun. Dönüşmezse CARA kullanıcıyı "anonim" sayar ve IP bazlı, düşük bir limit uygular.

## 3. Limitler (Vercel env, hepsi isteğe bağlı)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `CARA_LIMIT_COE_MESSAGES` / `_TOKENS` | 200 / 3.000.000 | Execution Capacity CoE |
| `CARA_LIMIT_PDU_MESSAGES` / `_TOKENS` | 100 / 1.500.000 | PDU Circle |
| `CARA_LIMIT_DEFAULT_MESSAGES` / `_TOKENS` | 100 / 1.500.000 | platform parametresi yoksa |
| `CARA_LIMIT_ANON_MESSAGES` / `_TOKENS` | 20 / 200.000 | uid yoksa (IP bazlı) |
| `CARA_RATE_PER_MINUTE` | 8 | Dakikada en fazla istek (mesaj + dosya) |
| `CARA_WARN_PCT` | 80 | Uyarı notunun çıktığı yüzde |
| `CARA_GLOBAL_MONTHLY_TOKENS` | 0 (kapalı) | Tüm kullanıcılar için toplam aylık tavan |
| `CARA_REQUIRE_USER` | false | `true` ise uid'siz erişim tamamen kapanır |
| `CARA_QUOTA_ENABLED` | true | `false` ile limitler tek adımda kapatılır |

`0` değeri "bu boyutta limit yok" anlamına gelir. Env değiştikten sonra Vercel'de **Redeploy** yapın.

**Kalibrasyon:** Google Sheet'e iki yeni sütun yazılıyor: **I = User**, **J = Tokens**. Sheet'in ilk satırına bu başlıkları ekleyin. İlk ayın verisine bakıp token limitlerini gerçek kullanıma göre ayarlayın.

## 4. (Önerilir) LearnWorlds ile kullanıcı doğrulama

`uid` adres çubuğundan geldiği için biri uydurma ID'lerle limiti aşmaya çalışabilir. Aşağıdaki üç değişken tanımlanırsa CARA her yeni ID'yi bir kez LearnWorlds API'sine sorar. Sonuç 30 gün önbellekte tutulur ve sistemde olmayan ID'ler reddedilir:

- `LW_API_BASE`: ör. `https://<okul-alanınız>/admin/api`
- `LW_CLIENT_ID`
- `LW_ACCESS_TOKEN`

Bu bilgiler LearnWorlds → Settings → Developers → API bölümünde bulunur. İstek şu adrese gider: `GET {LW_API_BASE}/v2/users/{uid}`. LearnWorlds'e ulaşılamazsa istek engellenmez.

## 5. Güvenlik ağı

Kod tarafından bağımsız olarak OpenAI Dashboard → Project → **Limits** bölümünden aylık bütçe ve uyarı e-postası ayarlayın.

## Bir kullanıcının hakkını elle sıfırlama

Upstash konsolunda (Data Browser) şu anahtarları silin:
`cara:m:<YYYY-MM>:u:<uid>` (mesaj) ve `cara:t:<YYYY-MM>:u:<uid>` (token).

## Kapsam notu

Limitler ana sohbet için geçerlidir (`api/cara.js`). Etkinlik uç noktaları (`meeting-clinic`, `people-management-case-review`, `project-outcome-review`) henüz sayılmıyor. İstenirse aynı modülle birkaç satırda eklenebilir.
