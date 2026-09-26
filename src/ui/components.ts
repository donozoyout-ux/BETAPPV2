// Presentation helpers only: prediction eligibility remains owned by Gate Inspector.
export const html = (value: unknown): string => String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
export const pages = [['home', 'Ana Sayfa', '⌂'], ['today', 'Bugünün Maçları', '▦'], ['official', 'Resmi Tahminler', '★'], ['review', 'İnceleme', '▤'], ['history', 'Geçmiş Veriler', '▥'], ['settings', 'Ayarlar', '⚙']] as const;
export function topNavigation(detail = false): string {
  return `<header class="product-header"><a class="product-brand" href="/" aria-label="BETAPP Ana Sayfa"><span aria-hidden="true">⚽</span> BETAPP</a><button class="menu-toggle" aria-expanded="false" aria-controls="primary-navigation" type="button">Menü ☰</button><nav id="primary-navigation" aria-label="Ana menü">${pages.map(([id, label, icon]) => `<a href="${detail ? '/' : ''}#${id}" ${detail ? '' : `data-page-link="${id}"`} ${id === (detail ? 'today' : 'home') ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav><span class="header-caption">FUTBOL ANALİZİ</span></header>`;
}
export function statCard(label: string, value: unknown, note: string, icon: string, target: string): string {
  return `<a class="summary-card" href="#${target}"><span class="summary-icon" aria-hidden="true">${icon}</span><div><span>${html(label)}</span><strong>${html(value)}</strong><small>${html(note)}</small></div><span class="summary-arrow" aria-hidden="true">↗</span></a>`;
}
export function emptyState(title: string, description: string): string {
  return `<div class="product-empty"><span aria-hidden="true">◇</span><h3>${html(title)}</h3><p>${html(description)}</p></div>`;
}
export function statusBadge(status: unknown): string {
  const labels: Record<string, string> = { OFFICIAL: 'Resmi Tahmin', LOCKED_PREDICTION: 'Resmi Tahmin', PREVIEW: 'Ön İzleme', REVIEW: 'İnceleme', WAITING: 'Bekleniyor', REJECTED: 'Reddedildi', ANALYZING: 'İnceleniyor', UNKNOWN: 'Değerlendirilmedi' };
  const key = String(status);
  return `<span class="status-badge ${key === 'OFFICIAL' || key === 'LOCKED_PREDICTION' ? 'positive' : key === 'REJECTED' ? 'negative' : ['REVIEW', 'WAITING', 'PREVIEW'].includes(key) ? 'pending' : ''}">${labels[key] ?? 'Değerlendirilmedi'}</span>`;
}
export type MatchRow = { id: string; time: string; home: unknown; away: unknown; league: unknown; status: string; candidate: string; score: unknown };
export function matchList(rows: MatchRow[], preview = false): string {
  const selected = preview ? rows.slice(0, 5) : rows;
  const action = (r: MatchRow) => `<a class="open-analysis" href="/matches/${encodeURIComponent(r.id)}" aria-label="${html(r.home)} — ${html(r.away)}: Analizi Aç">Analizi Aç <span aria-hidden="true">→</span></a>`;
  if (!selected.length) return emptyState('Bugün için desteklenen maç bulunmuyor.', 'Yeni fikstür verisi geldiğinde maçları burada görebilirsin.');
  return `<div class="desktop-matches"><table class="today-table"><caption class="sr-only">Bugünün maçları ve analiz durumları</caption><thead><tr>${['Saat', 'Maç', 'Lig', 'Durum', 'Ana Aday', 'Tahmin Skoru', 'Aksiyon'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${selected.map(r => `<tr data-search-row data-match-state="${html(r.status)}"><td>${html(r.time)}</td><td><strong>${html(r.home)}</strong><span class="team-divider">—</span><strong>${html(r.away)}</strong></td><td>${html(r.league)}</td><td>${statusBadge(r.status)}</td><td>${html(r.candidate)}</td><td>${html(r.score)}${r.score == null ? '' : ' / 100'}</td><td>${action(r)}</td></tr>`).join('')}</tbody></table></div><div class="mobile-matches">${selected.map(r => `<article class="mobile-match" data-search-row data-match-state="${html(r.status)}"><div class="mobile-match-heading"><time>${html(r.time)}</time>${statusBadge(r.status)}</div><h3>${html(r.home)}<span>—</span>${html(r.away)}</h3><p>${html(r.league)}</p><dl><div><dt>Ana aday</dt><dd>${html(r.candidate)}</dd></div><div><dt>Tahmin skoru</dt><dd>${html(r.score)}${r.score == null ? '' : ' / 100'}</dd></div></dl>${action(r)}</article>`).join('')}</div>${preview && rows.length > 5 ? `<a class="text-link" href="#today">${rows.length - 5} maç daha göster →</a>` : ''}`;
}
export function onboarding(): string {
  return `<section class="welcome-hero" data-onboarding aria-labelledby="welcome-heading"><div class="welcome-copy"><span class="eyebrow">DAHA FAZLA VERİ. DAHA İYİ BİR BAKIŞ.</span><h1 id="welcome-heading">Maç Analizine<br><em>Hazır mısın?</em></h1><p>Gerçek oranlar, geçmiş veriler ve istatistiklerle bugünün maçlarını incele.</p><button class="primary-button" data-start type="button">Hadi Başla <span aria-hidden="true">→</span></button></div><div class="pitch-art" aria-hidden="true"><div class="pitch-circle"></div><span class="hero-ball">⚽</span><div class="pitch-line"></div></div><div class="hero-benefits"><span>▥ Gerçek veriler</span><span>◈ İstatistiksel analiz</span><span>◷ Geçmiş karşılaştırmalar</span></div></section>`;
}
export function systemStatus(states: Array<{ label: string; key?: string; state: 'Aktif' | 'Bekleniyor' | 'Sorun Var' }>): string {
  return `<section class="product-panel"><div class="panel-heading"><div><h2>Sistem Durumu</h2><p>Veri akışının son bilinen durumu.</p></div></div><div class="system-items">${states.map(({ label, state, key }) => `<div><span>${html(label)}</span><b ${key ? `data-system-key="${html(key)}"` : ''} class="status-badge ${state === 'Aktif' ? 'positive' : state === 'Sorun Var' ? 'negative' : 'pending'}">${state}</b></div>`).join('')}</div></section>`;
}
export const detailTabs = [['overview', 'Genel Bakış'], ['prediction', 'Tahmin'], ['odds', 'Oran Analizi'], ['neighbors', 'Geçmiş Benzerler'], ['quality', 'Veri Kalitesi'], ['gates', 'Gate Inspector']] as const;
export function matchDetailTabs(): string {
  return `<nav class="detail-tabs" aria-label="Maç analiz bölümleri">${detailTabs.map(([id, label]) => `<a href="#${id}" data-detail-link="${id}" ${id === 'overview' ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}
