type StageResearchReport = {
  version:string;
  researchOnly:boolean;
  exactCaptureTimeKnown:boolean;
  officialPredictionEligible:boolean;
  autoApply:boolean;
  summary:{total:number;researchEligible:number;matches:number;competitions:number;invalidOfficial:number;invalidTimingKnown:number};
  groups:Array<Record<string,unknown>>;
  generatedAt:unknown;
};

const esc=(value:unknown)=>String(value ?? '—').replace(/[&<>"']/g,(c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]!);
const pct=(value:unknown,digits=1)=>value==null?'—':`${(Number(value)*100).toFixed(digits)}%`;
const pp=(value:unknown)=>value==null?'—':`${Number(value).toFixed(2)} pp`;
const roi=(value:unknown)=>value==null?'—':`${(Number(value)*100).toFixed(1)}%`;

export function stageResearchCard(data: StageResearchReport): string {
  const rows=data.groups.slice(0,100).map((row)=>`<tr>
    <td>${esc(row.competition)}</td><td>${esc(row.marketType)}</td><td>${esc(row.line)}</td><td>${esc(row.selection)}</td>
    <td>${esc(row.movementClass)}</td><td>${esc(row.binaryExamples)}</td>
    <td>${pct(row.positiveRate)}</td><td>${pct(row.averageClosingFairProbability)}</td>
    <td>${pp(row.calibrationGapPp)}</td><td>${roi(row.referencePaperRoi)}</td>
    <td>${esc(row.evidenceLevel)}</td></tr>`).join('');
  return `<article class="panel"><div class="panel-head"><div><h3>CSV Stage Shadow Calibration</h3>
    <p>Opening→closing arşiv hareketinin sonuçlarla ilişkisini araştırır. Exact capture zamanı bilinmediği için resmi Prediction V1 kanıtı değildir.</p></div>
    <span class="badge ${data.summary.invalidOfficial||data.summary.invalidTimingKnown?'bad':'ok'}">${data.summary.invalidOfficial||data.summary.invalidTimingKnown?'ISOLATION FAIL':'RESEARCH ONLY'}</span></div>
    <div class="panel-body"><div class="grid">
      <article class="card"><strong>Shadow örnek</strong><p>${esc(data.summary.total)}</p></article>
      <article class="card"><strong>Araştırma uygun</strong><p>${esc(data.summary.researchEligible)}</p></article>
      <article class="card"><strong>Maç</strong><p>${esc(data.summary.matches)}</p></article>
      <article class="card"><strong>Lig</strong><p>${esc(data.summary.competitions)}</p></article>
    </div>
    <p><strong>Güvenlik:</strong> officialPredictionEligible=false · autoApply=false · timingKnown=false.</p>
    <div class="scroll"><table><thead><tr><th>Lig</th><th>Market</th><th>Line</th><th>Seçim</th><th>Hareket</th><th>Binary N</th><th>Pozitif</th><th>Closing fair</th><th>Gap</th><th>Paper ROI</th><th>Örnek düzeyi</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="11">Henüz araştırma için stage örneği yok.</td></tr>'}</tbody></table></div></div></article>`;
}

export function stageResearchSection(): string {
  return `<section class="section" id="stage-research"><div class="section-title"><div>
    <span class="section-kicker">Araştırma katmanı</span><h2>Shadow Kalibrasyon</h2>
    <p>CSV opening→closing hareketlerini sonuçlarla karşılaştırır; resmi tahmin kararını değiştirmez.</p>
    </div></div><p id="stage-research-error" role="status"></p><div id="stage-research-content">Shadow araştırma yükleniyor…</div></section>
    <script src="/stage-research.js" defer></script>`;
}

export const stageResearchScript=`(() => {
  if (!document.getElementById('stage-research')) return;
  async function refresh() {
    try {
      const response=await fetch('/api/research/csv-stage',{cache:'no-store'});
      if (!response.ok) throw new Error('stage research unavailable');
      const data=await response.json();
      document.getElementById('stage-research-content').innerHTML=data.html;
      document.getElementById('stage-research-error').textContent='';
    } catch {
      document.getElementById('stage-research-error').textContent='Shadow kalibrasyon şu anda okunamıyor.';
    }
    setTimeout(refresh,300000);
  }
  refresh();
})();`;
