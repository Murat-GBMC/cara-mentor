# CARA — Aylık kullanım limitleri (v11 + v12 CoE paketleri)

CARA her kullanıcı için takvim ayı boyunca (İstanbul saatiyle) şunları sayar:

- **Mesaj sayısı**: kullanıcıya gösterilen limit.
- **Token**: gerçek OpenAI maliyeti. Buna bilgi tabanı araması (file_search) ve PDF okuma da dahildir.
- **Dakikalık hız**: kötüye kullanıma ve döngüye giren script'lere karşı.
- **Toplam aylık token tavanı** (isteğe bağlı): tüm kullanıcılar için ortak üst sınır.

**v12:** Execution Capacity CoE kullanıcıları için iki paket vardır: **adil kullanım** (varsayılan) ve **yüksek limit**. Paket, iframe adresinden değil, kullanıcının **LearnWorlds etiketinden** okunur (bkz. bölüm 4a). Bu yüzden kullanıcı adresi değiştirerek kendine yüksek limit veremez. PDU Circle'da tek paket vardır.

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
| `CARA_LIMIT_COE_MESSAGES` / `_TOKENS` | 150 / 1.000.000 | CoE — adil kullanım paketi |
| `CARA_LIMIT_COE_HIGH_MESSAGES` / `_TOKENS` | 400 / 2.500.000 | CoE — yüksek limit paketi |
| `CARA_LIMIT_PDU_MESSAGES` / `_TOKENS` | 100 / 1.000.000 | PDU Circle |
| `CARA_HIGH_TAGS` | `cara-yuksek` | Yüksek limit veren LearnWorlds etiketleri (virgülle ayrılmış liste olabilir) |
| `CARA_PLAN_CACHE_HOURS` | 24 | Paket bilgisinin önbellek süresi (saat) |
| `CARA_LIMIT_DEFAULT_MESSAGES` / `_TOKENS` | 100 / 1.500.000 | platform parametresi yoksa |
| `CARA_LIMIT_ANON_MESSAGES` / `_TOKENS` | 20 / 200.000 | uid yoksa (IP bazlı) |
| `CARA_RATE_PER_MINUTE` | 8 | Dakikada en fazla istek (mesaj + dosya) |
| `CARA_WARN_PCT` | 80 | Uyarı notunun çıktığı yüzde |
| `CARA_GLOBAL_MONTHLY_TOKENS` | 0 (kapalı) | Tüm kullanıcılar için toplam aylık tavan |
| `CARA_REQUIRE_USER` | false | `true` ise uid'siz erişim tamamen kapanır |
| `CARA_QUOTA_ENABLED` | true | `false` ile limitler tek adımda kapatılır |

`0` değeri "bu boyutta limit yok" anlamına gelir. Env değiştikten sonra Vercel'de **Redeploy** yapın.

**Kalibrasyon:** Google Sheet'e şu sütunlar yazılıyor: **I = User**, **J = Tokens**, **K = Plan** (`adil` / `yuksek`). Sheet'in ilk satırına bu başlıkları ekleyin. İlk ayın verisine bakıp iki paketin limitlerini ayrı ayrı ayarlayın.

## 4. LearnWorlds ile kullanıcı doğrulama (v12'den itibaren zorunlu)

`uid` adres çubuğundan geldiği için biri uydurma ID'lerle limiti aşmaya çalışabilir. Aşağıdaki üç değişken tanımlanırsa CARA her yeni ID'yi bir kez LearnWorlds API'sine sorar. Sonuç 30 gün önbellekte tutulur ve sistemde olmayan ID'ler reddedilir:

- `LW_API_BASE`: ör. `https://<okul-alanınız>/admin/api`
- `LW_CLIENT_ID`
- `LW_ACCESS_TOKEN`

Bu bilgiler LearnWorlds → Settings → Developers → API bölümünde bulunur. İstek şu adrese gider: `GET {LW_API_BASE}/v2/users/{uid}`. LearnWorlds'e ulaşılamazsa istek engellenmez.

Paket bilgisi de bu istekten okunduğu için v12'de bu adım zorunludur. Bu değişkenler tanımlı değilse bütün CoE kullanıcıları adil kullanım paketinde kalır.

## 4a. Paket etiketi (v12)

1. LearnWorlds'te yüksek limit alacak kullanıcılara (Olgunluk ve Mükemmellik müşterileri) **`cara-yuksek`** etiketini verin. Etiket adı büyük/küçük harfe duyarlı değildir.
2. CARA, kullanıcının etiketlerinde `CARA_HIGH_TAGS` listesindeki bir etiket bulursa paketi **yuksek** yapar, bulamazsa **adil** yapar. Paket yalnızca `platform=coe` sayfalarında geçerlidir.
3. **Güvenli varsayılan:** LearnWorlds'e ulaşılamazsa ya da etiketler okunamazsa kullanıcı adil kullanım paketine düşer, istek engellenmez. Bu durumda paket 15 dakika sonra yeniden sorgulanır.
4. **Önbellekler:** Kullanıcının LearnWorlds'te var olduğu bilgisi 30 gün (`cara:lw:<uid>`), paket bilgisi `CARA_PLAN_CACHE_HOURS` süresince (varsayılan 24 saat, `cara:plan:<uid>`) saklanır. Etiket değişirse yeni limit en geç ertesi gün geçerli olur.

**Etiketin doğru okunduğunu kontrol etme:** Etiketli bir kullanıcıyla CARA'ya bir soru sorun, sonra Vercel → Deployments → Logs bölümünde şu satırı arayın:

```
LearnWorlds plan: uid=… plan=yuksek tags=["cara-yuksek", …] fields=…
```

`plan=adil` ve `tags=[]` görünüyorsa etiketler beklenen alanda gelmiyor demektir. `fields=` kısmındaki alan adlarını geliştiriciye iletin.

### Bir kullanıcının paketini elle değiştirme

1. LearnWorlds'te kullanıcıya `cara-yuksek` etiketini ekleyin (yükseltme) ya da etiketi kaldırın (düşürme).
2. Değişikliğin hemen geçerli olmasını istiyorsanız Upstash Data Browser'da **`cara:plan:<uid>`** anahtarını silin. Silmezseniz değişiklik en geç `CARA_PLAN_CACHE_HOURS` sonra geçerli olur.
3. O ay kullanılan mesaj ve token sayaçları değişmez; yalnızca limit değişir.

## 5. Güvenlik ağı

Kod tarafından bağımsız olarak OpenAI Dashboard → Project → **Limits** bölümünden aylık bütçe ve uyarı e-postası ayarlayın.

## Bir kullanıcının hakkını elle sıfırlama

Upstash konsolunda (Data Browser) şu anahtarları silin:
`cara:m:<YYYY-MM>:u:<uid>` (mesaj) ve `cara:t:<YYYY-MM>:u:<uid>` (token).

## Kapsam notu

Limitler ana sohbet için geçerlidir (`api/cara.js`). Etkinlik uç noktaları (`meeting-clinic`, `people-management-case-review`, `project-outcome-review`) henüz sayılmıyor. Kurum bazında ortak kullanım havuzu da yok. İkisi de bu aşamanın kapsamı dışında.
