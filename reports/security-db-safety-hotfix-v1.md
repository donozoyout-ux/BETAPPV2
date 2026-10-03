# BETAPPV2 — Production Security & DB Safety Hotfix V1

Generated: 2026-10-03
Scope: read-only audit bulgularının production güvenliği ve DB emniyeti için düzeltilmesi.
Constraint compliance: prediction logic, prediction thresholds, odds analysis logic, odds collector scheduling, AI provider, Google Sheets, historical backfill logic, ve domain tablo şemaları **değiştirilmedi**. Production DB'ye bağlanılmadı, secret okunmadı/yazdırılmadı, push yapılmadı.

---

## Değiştirilen dosyalar

| Dosya | Değişiklik | İlgili bulgu |
|---|---|---|
| `src/db/migrator.ts` | Startup `TRUNCATE` ve `pg_terminate_backend` kaldırıldı; advisory lock korundu | FIX 1, FIX 4 |
| `src/app.ts` | `GET /api/db-cleanup` kaldırıldı; `POST /api/db-cleanup` ve `GET /api/db-diagnostics` production guard arkasına alındı | FIX 2 |
| `src/config.ts` | Opsiyonel `ADMIN_API_TOKEN` eklendi | FIX 2 |
| `src/providers/nowgoal.ts` | `new Function` eval kaldırıldı; deterministik array parser + zod schema eklendi | FIX 3 |
| `test/unit/nowgoal.test.ts` | Kullanılmayan değişken lint düzeltmesi (`entries` -> kaldırıldı) | Test hijyeni |
| `test/unit/migrator-startup-safety.test.ts` | Yeni: startup’ta TRUNCATE/terminate yok | FIX 1, FIX 4 |
| `test/unit/security-source-regression.test.ts` | Yeni: kaynak seviyesinde eval/terminate/truncate yok | FIX 1, FIX 3, FIX 4 |
| `test/unit/db-admin-guard.test.ts` | Yeni: production’da anonim erişim engeli | FIX 2 |
| `test/unit/nowgoal-safe-parser.test.ts` | Yeni: remote JS execute edilmiyor | FIX 3 |

---

## FIX 1 — Startup TRUNCATE kaldırıldı

**BEFORE** — `src/db/migrator.ts` (runMigrations, advisory lock’tan önce):
```ts
await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE pid <> pg_backend_pid() AND datname = current_database()`).catch(() => undefined);
await client.query("SET lock_timeout = '10s'").catch(() => undefined);
await client.query('TRUNCATE TABLE data_observations, source_payloads').catch(() => undefined);
```

**AFTER**:
```ts
// Migration serialization is handled by the advisory lock below. Never terminate
// other application connections (web/worker/health/backfill) and never truncate
// observability/provenance tables on startup. Bounded lock wait is retained so a
// concurrent migration holder surfaces as a normal PostgreSQL lock error.
await client.query("SET lock_timeout = '10s'").catch(() => undefined);
```

**Migration davranışı (korundu):** `schema_migrations` idempotent döngüsü, `pg_advisory_lock`, `BEGIN/COMMIT` ve mevcut error handling aynen bırakıldı. `020_data_retention_and_cleanup.sql` değiştirilmedi; yalnızca `schema_migrations` ile kayıtlı olmadığında bir kez çalışır.

**Güvenlik/veri etkisi:** Her deploy/restart’ta (render preDeploy + Docker CMD ile ≥3 kez) `data_observations` ve `source_payloads` silinmesi durduruldu. Provenance/consensus girdisi artık başlangıçta kaybolmuyor.

---

## FIX 2 — DB cleanup/diagnostics endpoint’leri güvenli hale getirildi

**BEFORE** — `src/app.ts`:
```ts
app.get('/api/db-diagnostics', async () => repository.dbDiagnostics());
app.get('/api/db-cleanup', async () => repository.dbCleanup());       // destructive GET
app.post('/api/db-cleanup', async () => repository.dbCleanup());
```

**AFTER**:
```ts
const isProduction = config.NODE_ENV === 'production';
const adminToken = config.ADMIN_API_TOKEN?.trim();
const adminRouteAllowed = (request: FastifyRequest): boolean => {
  if (!isProduction) return true;
  if (!adminToken) return false;
  return request.headers['x-admin-token'] === adminToken;
};

app.get('/api/db-diagnostics', async (request, reply) => {
  if (!adminRouteAllowed(request)) return reply.code(404).send({ error: 'not_found' });
  return repository.dbDiagnostics();
});
app.post('/api/db-cleanup', async (request, reply) => {
  if (!adminRouteAllowed(request)) return reply.code(404).send({ error: 'not_found' });
  return repository.dbCleanup();
});
```

**Production cleanup endpoint davranışı:**
- `GET /api/db-cleanup` route’u tamamen **kaldırıldı** (artık 404; destructive GET yok).
- `POST /api/db-cleanup` production’da yalnızca `ADMIN_API_TOKEN` tanımlıysa ve `x-admin-token` header’ı eşleşiyorsa çalışır; aksi halde `404 not_found` döner ve `repository.dbCleanup()` **çağrılmaz**.
- `GET /api/db-diagnostics` production’da aynı guard’a tabidir; anonim erişim `404`.
- Development/test’te mevcut debug kullanımı korunur (`isProduction=false`).
- `ADMIN_API_TOKEN` tanımlı değilse production’da endpoint tamamen devre dışıdır (güvenli varsayılan). Token loglanmaz (logger redaction + hiçbir log satırı token içermez).

---

## FIX 3 — Nowgoal remote JS execution kaldırıldı

**BEFORE** — `src/providers/nowgoal.ts` `getPrematchOddsDirect`:
```ts
const rawData = matchRequest.payload?.Data ?? '';
const sandbox = { ShowBf: () => {} };
const fn = new Function('sandbox', `var ShowBf = sandbox.ShowBf; ${rawData}; sandbox.A = A; sandbox.B = B;`);
fn(sandbox);
const rawMatches = (sandbox.A || []).filter(Boolean) as unknown[][];
```

**AFTER:** `new Function` tamamen kaldırıldı. Yerine:
- `nowgoalDirectResponseSchema` (zod) ile yanıt `{ ErrCode?: number; Data?: string }` şemasına göre doğrulanır; uymazsa yapılandırılmış `PREMATCH_FIXTURE_PARSE / PARSE_ERROR` log’u ve `[]` dönüşü.
- `parseNowgoalFixtureDiary(data)` deterministik parser; yalnızca `A[i]=[...]` / `B[i]=[...]` array literallerini okur, **hiçbir token’ı çalıştırmaz**. String kaçışları, iç içe array, sayı/bool/null desteklenir.
- `ShowBf(...)` gibi diğer tüm ifadeler yok sayılır (parse edilmez, execute edilmez).

**Nowgoal parser davranışı:**
- Mevcut format (`var A=Array(n);var B=Array(n);A[i]=[...];B[i]=[...];`) korunur; fixture/league/odds alanları ve indeksler aynı şekilde eşlenir (mevcut `nowgoal.test.ts` direct test hâlâ geçer).
- Geçerli array bulunamazsa (ör. sadece serbest JS veya bozuk payload) `NO_DATA` log’u ile `[]` döner; collector crash etmez, sahte odds üretilmez.
- `parseNowgoalType4Odds` (odds diary) zaten string-split tabanlıydı; değiştirilmedi.

**Güvenlik etkisi:** Remote provider yanıtındaki `Data` alanı artık Node process içinde kod olarak çalıştırılamaz; RCE primitifi kaldırıldı. Upstream ele geçirilse dahi yalnızca veri parse edilir/reddedilir.

---

## FIX 4 — pg_terminate_backend kaldırıldı

**BEFORE** — `src/db/migrator.ts`:
```ts
await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE pid <> pg_backend_pid() AND datname = current_database()`).catch(() => undefined);
```

**AFTER:** Query tamamen kaldırıldı.

**pg_terminate_backend durumu:** Artık kaynakta ve çalışma zamanı sorgu setinde yok (regression testi ile garanti altında). Migration yarışı yalnızca `pg_advisory_lock` ile serileştirilir; web pool, worker pool, health check, backfill ve diğer servis bağlantıları artık startup’ta sonlandırılmaz. Eşzamanlı migration durumunda normal PostgreSQL lock/error davranışı geçerlidir (`lock_timeout = 10s` korundu).

---

## Testler

Yeni regression testleri (mevcut vitest altyapısı):

1. `test/unit/migrator-startup-safety.test.ts` — fake pool ile `runMigrations` çağrısındaki sorgu setinde `TRUNCATE TABLE` ve `pg_terminate_backend` **yok**, `pg_advisory_lock` **var**.
2. `test/unit/security-source-regression.test.ts` — `migrator.ts` kaynağında `TRUNCATE TABLE`/`pg_terminate_backend` yok; `nowgoal.ts` kaynağında `new Function`/`eval(`/`vm.*` yok.
3. `test/unit/db-admin-guard.test.ts` — production’da anonim `POST /api/db-cleanup` ve `GET /api/db-diagnostics` → `404`, repository çağrılmıyor; destructive GET route yok; doğru `x-admin-token` ile diagnostics → `200`.
4. `test/unit/nowgoal-safe-parser.test.ts` — malicious fixture’daki `globalThis.__nowgoalExecuted=true;` **execute edilmiyor**; fixture’lar yine parse ediliyor; hostile/non-array payload `[]` döner ve throw etmez; non-object yanıt schema ile reddedilir.
5. Yukarıdaki source-regression testi `pg_terminate_backend`’in startup sorgu setinde kullanılmadığını garanti eder.

### Sonuçlar

| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **PASS** — 58 test dosyası, 317 test geçti |
| `npm test` (unit + integration) | **KISMEN** — integration testleri Docker/Testcontainers gerektirir |
| `npm run test:integration:db` | **ÇALIŞTIRILAMADI** — Docker daemon erişilemez |
| `npm run typecheck` | **PASS** (exit 0) |
| `npm run lint` | **PASS** (0 problem) |
| `npm run build` | **PASS** |
| `npm ci` | **ABORTED** — kullanıcı tarafından iptal edildi; mevcut `node_modules` korundu ve typecheck/lint/test/build bu kurulumla çalıştırıldı |

**Docker/Testcontainers notu:** `docker ps` → `failed to connect to the docker API ... dockerDesktopLinuxEngine ... The system cannot find the file specified`. Docker daemon çalışmadığı için `test/integration/repository.test.ts` ve `test/integration/nowgoal-live-odds.test.ts` çalıştırılamadı. Testler sahte şekilde PASS gösterilmedi.

---

## Kalan riskler

1. **Integration testleri doğrulanmadı:** FIX 1/FIX 4’ün gerçek PostgreSQL davranışı (migration idempotency, advisory lock) yalnızca unit + kaynak regression ile kanıtlandı; Docker olmadan Testcontainers senaryoları çalıştırılamadı. CI’da `npm run test:integration:db` çalıştırılmalı.
2. **Nowgoal gerçek format riski:** Deterministik parser array-literal formatını hedefler. Provider `A`/`B`’yi başka bir ifade biçimiyle (ör. `A=A.concat(...)`) dönerse parser güvenli şekilde `NO_DATA` verir ve odds üretmez; bu durumda prematch odds kapsamı düşer (güvenlik tercih edildi). Canlı gözlem/qualification ile izlenmeli.
3. **`ADMIN_API_TOKEN` yapılandırılmazsa** production’da diagnostics/cleanup tamamen erişilemez; operasyon ekibi gerekiyorsa Render env’ine `ADMIN_API_TOKEN` (sync:false) eklemeli.
4. **`020` migration’ı `schema_migrations`’a kayıtlı değilse** ilk uygulanışta bir kez TRUNCATE çalıştırır (tasarım gereği). Bu hotfix onu değiştirmedi.
5. **npm ci** tamamlanmadı; temiz ortam kurulum doğrulaması yapılmadı.

---

## Constraint doğrulaması

```
PREDICTION_LOGIC_CHANGED: NO
ODDS_ANALYSIS_CHANGED: NO
ODDS_SCHEDULING_CHANGED: NO
AI_CHANGED: NO
HISTORICAL_BACKFILL_CHANGED: NO
DOMAIN_SCHEMA_CHANGED: NO
```

---

## Özet

```
COMMIT: fix: harden production db and provider execution paths (NO PUSH)
SECURITY_FIX_STATUS: 4/4 CONFIRMED bulgu düzeltildi (startup truncate, anon destructive endpoint, remote JS execution, pg_terminate_backend)
TEST_STATUS: unit PASS (58 files / 317 tests), typecheck/lint/build PASS; integration NOT RUN (Docker unavailable); npm ci ABORTED by user
```
