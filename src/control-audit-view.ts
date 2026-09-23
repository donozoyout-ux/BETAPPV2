import type { ControlAuditCheck } from './control-audit.js';

function esc(value: unknown): string {
  return String(value ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function controlAuditCard(audit: Record<string, unknown> | null): string {
  if (!audit) return '<article class="card"><strong>Henüz audit çalışmadı</strong><p>Worker ilk kontrol döngüsünden sonra sonuç burada görünecek.</p></article>';
  const checks = Array.isArray(audit.checks) ? audit.checks as ControlAuditCheck[] : [];
  const status = String(audit.status ?? 'UNKNOWN');
  const badge = status === 'PASS' ? 'ok' : status === 'WARN' ? 'partial' : 'bad';
  return `<article class="panel"><div class="panel-head"><h3>CONTROL_AUDIT_V1</h3><span class="badge ${badge}">${esc(status)}</span></div>
    <div class="panel-body"><p>Son kontrol: ${esc(audit.checked_at ?? audit.checkedAt)}</p>
    <div class="grid">${checks.map((check) => `<article class="card"><div class="row"><strong>${esc(check.key)}</strong>
      <span class="badge ${check.status === 'PASS' ? 'ok' : check.status === 'WARN' ? 'partial' : 'bad'}">${esc(check.status)}</span></div>
      <p>${esc(check.message)}</p></article>`).join('')}</div></div></article>`;
}

export function controlAuditSection(): string {
  return `<section class="section" id="control-audit"><div class="section-title"><div>
    <span class="section-kicker">İkinci doğrulama katmanı</span><h2>Kontrolün Kontrolü</h2>
    <p>Maç kayıtları, resmi tahmin bütünlüğü, canlı kaynak tazeliği, event tekrarları ve settlement durumu ayrıca denetlenir.</p>
    </div></div><p id="control-audit-error" role="status"></p>
    <div id="control-audit-card">Audit yükleniyor…</div></section>
    <script src="/control-audit-poll.js" defer></script>`;
}

export const controlAuditPollScript = `(() => {
  const root = document.getElementById('control-audit');
  if (!root) return;
  async function refresh() {
    try {
      const response = await fetch('/api/control-audit', {cache: 'no-store'});
      if (!response.ok) throw new Error('control audit fetch');
      const data = await response.json();
      document.getElementById('control-audit-card').innerHTML = data.html;
      document.getElementById('control-audit-error').textContent = '';
    } catch {
      document.getElementById('control-audit-error').textContent = 'Kontrol auditi okunamadı.';
    }
    setTimeout(refresh, 60000);
  }
  refresh();
})();`;
