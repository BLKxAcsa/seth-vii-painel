/* Seth VII — front-end do painel público.
 *
 * Regra de ouro deste arquivo: NÃO CALCULAR NADA.
 * Todo score, percentil e veredito vem pronto de data.json, produzido pelo
 * pipeline Python determinístico. O JS apenas apresenta. Se o front fizesse
 * contas, haveria duas fontes de verdade divergentes.
 *
 * Ausência de dado é exibida como ausência — nunca como zero.
 */

const state = { data: [], party: null, q: '', sort: 'attendance-desc' };

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Um score só existe se houve promessa para avaliar. */
function hasScore(p) {
  return typeof p.score === 'number' && (p.promises || []).length > 0;
}

function scoreClass(v) {
  if (v == null) return 'na';
  if (v >= 60) return 'ok';
  if (v >= 40) return 'mid';
  return 'bad';
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase();
}

function coverage(p) {
  const v = (p.viability || [])[0];
  return v && typeof v.coverage === 'number' ? v.coverage : null;
}

function findings(p) {
  return ((p.cross_reference || {}).achados) || [];
}

/* Registro mensuravel: presenca, producao legislativa, votos. Existe mesmo
   quando nenhuma promessa foi detectada -- o que e a regra, nao a excecao,
   porque discurso de plenario e quase todo procedimental. Antes o card ficava
   vazio nesse caso e o site parecia quebrado. */
function record(p) {
  return p.record || {};
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/* Faixas de presenca. Rotulo textual sempre acompanha a cor, para nao
   depender de percepcao de cor. */
function attendanceClass(v) {
  if (v == null) return 'na';
  if (v >= 90) return 'ok';
  if (v >= 75) return 'mid';
  return 'bad';
}

/* ---------------- render: cards ---------------- */

function cardHTML(p, i) {
  const pol = p.politician || {};
  const has = hasScore(p);
  const cov = coverage(p);
  const nf = findings(p).length;
  const nInc = (p.inconsistencies || []).length;
  const alerts = nf + nInc;

  const rec = record(p);
  const att = num(rec.attendance_rate);
  const sessions = num(rec.sessions_checked);
  const props = num(rec.propositions_total);
  const votes = num(rec.total_votes);

  /* A metrica destacada e a que foi de fato medida. Presenca em sessoes tem
     dado para todos; score de promessa quase nunca tem. Destacar um "—/100"
     faria o painel parecer vazio e sugeriria falha de medicao onde nao houve. */
  const headline = has
    ? { cls: scoreClass(p.score), val: p.score.toFixed(1), unit: '/100',
        pct: p.score, cap: 'viabilidade' }
    : { cls: attendanceClass(att), val: att != null ? att.toFixed(0) + '%' : '—',
        unit: att != null ? 'presença' : 'sem dado',
        pct: att != null ? att : 0, cap: 'presença' };

  return `
  <button class="card" data-i="${i}">
    <div class="card-top">
      <div class="avatar">${esc(initials(pol.name))}</div>
      <div class="card-id">
        <h3>${esc(pol.name)}</h3>
        <p>${esc(pol.party || '—')}${pol.state ? ' · ' + esc(pol.state) : ''}</p>
      </div>
      <div class="score-badge">
        <b class="s-${headline.cls}">${esc(headline.val)}</b>
        <span>${esc(headline.unit)}</span>
      </div>
    </div>
    <div class="bar"><i class="f-${headline.cls}" style="width:${headline.pct}%"></i></div>
    <div class="card-foot">
      ${att != null && sessions
        ? `<span class="tag">presença ${att.toFixed(0)}% · ${sessions} sessões</span>` : ''}
      ${props != null ? `<span class="tag">${props} proposições</span>` : ''}
      ${votes ? `<span class="tag">${votes} voto${votes > 1 ? 's' : ''}</span>` : ''}
      ${has
        ? `<span class="tag">${(p.promises || []).length} promessas</span>`
        : `<span class="tag muted">sem promessa detectada</span>`}
      ${alerts ? `<span class="tag alert">${alerts} achados</span>` : ''}
      ${cov != null ? `<span class="tag cov">cobertura ${Math.round(cov * 100)}%</span>` : ''}
    </div>
  </button>`;
}

function visible() {
  const q = state.q.toLowerCase().trim();
  let out = state.data.filter((p) => {
    const pol = p.politician || {};
    if (state.party && pol.party !== state.party) return false;
    if (!q) return true;
    return [pol.name, pol.party, pol.state]
      .some((f) => String(f || '').toLowerCase().includes(q));
  });

  const sc = (p) => (hasScore(p) ? p.score : -1);
  // Sem dado vai para o fim em qualquer ordenacao, inclusive na ascendente:
  // "sem dado" nao e o mesmo que "pior valor".
  const att = (p) => {
    const v = num(record(p).attendance_rate);
    return v == null ? null : v;
  };
  const byAtt = (dir) => (a, b) => {
    const x = att(a), y = att(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return dir === 'desc' ? y - x : x - y;
  };

  const cmp = {
    'attendance-desc': byAtt('desc'),
    'attendance-asc': byAtt('asc'),
    'props-desc': (a, b) =>
      (num(record(b).propositions_total) || 0) - (num(record(a).propositions_total) || 0),
    'score-desc': (a, b) => sc(b) - sc(a),
    'score-asc': (a, b) => sc(a) - sc(b),
    'findings-desc': (a, b) =>
      (findings(b).length + (b.inconsistencies || []).length) -
      (findings(a).length + (a.inconsistencies || []).length),
    'promises-desc': (a, b) => (b.promises || []).length - (a.promises || []).length,
    'name-asc': (a, b) =>
      String((a.politician || {}).name).localeCompare(String((b.politician || {}).name), 'pt-BR'),
  }[state.sort];

  return cmp ? out.sort(cmp) : out;
}

function renderGrid() {
  const list = visible();
  const idx = new Map(state.data.map((p, i) => [p, i]));
  $('#grid').innerHTML = list.map((p) => cardHTML(p, idx.get(p))).join('');
  $('#empty').hidden = list.length > 0;
}

function renderStats() {
  const d = state.data;
  const scored = d.filter(hasScore);
  const avg = scored.length
    ? (scored.reduce((s, p) => s + p.score, 0) / scored.length).toFixed(1) : '—';
  const totalF = d.reduce((s, p) => s + findings(p).length + (p.inconsistencies || []).length, 0);
  const totalP = d.reduce((s, p) => s + (p.promises || []).length, 0);
  const covs = d.map(coverage).filter((c) => c != null);
  const avgCov = covs.length
    ? Math.round(covs.reduce((a, b) => a + b, 0) / covs.length * 100) + '%' : '—';

  // Presenca media: metrica que tem dado para todos. O score medio costuma
  // vir "—" porque depende de promessa detectada, que e raro em plenario.
  const atts = d.map((p) => num(record(p).attendance_rate)).filter((v) => v != null);
  const avgAtt = atts.length
    ? (atts.reduce((a, b) => a + b, 0) / atts.length).toFixed(0) + '%' : '—';
  const totalProps = d.reduce((s, p) => s + (num(record(p).propositions_total) || 0), 0);

  $('#stats').innerHTML = [
    [d.length, 'analisados'],
    [avgAtt, 'presença média'],
    [totalProps, 'proposições'],
    [avg, 'score médio'],
    [totalP, 'promessas'],
    [totalF, 'achados'],
    [avgCov, 'cobertura média'],
  ].map(([v, k]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

function renderChips() {
  const parties = [...new Set(state.data.map((p) => (p.politician || {}).party).filter(Boolean))].sort();
  $('#partyChips').innerHTML =
    `<button class="chip" data-p="" aria-pressed="${!state.party}">Todos</button>` +
    parties.map((x) =>
      `<button class="chip" data-p="${esc(x)}" aria-pressed="${state.party === x}">${esc(x)}</button>`
    ).join('');
}

/* ---------------- render: modal ---------------- */

const FACTOR_LABEL = {
  viabilidade_orcamentaria: 'Viabilidade orçamentária',
  historico_politico: 'Histórico (presença e aprovação)',
  similaridade_pares: 'Posição entre pares',
  escopo_geografico: 'Escopo geográfico',
  tendencias: 'Contexto e tendências',
};

const FINDING_LABEL = {
  sem_acao_legislativa: 'Sem ação legislativa no tema',
  tema_silenciado: 'Tema recorrente sem proposição',
  voto_contrario: 'Voto divergente do discurso',
};

/* Registro mensuravel do parlamentar. Fica ANTES da viabilidade no modal de
   proposito: e a parte que tem dado apurado para todos. Viabilidade depende de
   haver promessa detectada e, na pratica, quase nunca ha.

   So entram valores medidos. Constantes de referencia que existem no dado
   bruto ("media estimada de 8 proposicoes") ficam fora: numero inventado
   apresentado como referencia foi o pior defeito ja corrigido neste projeto e
   nao volta pela interface. */
function recordHTML(p) {
  const rec = record(p);
  const att = num(rec.attendance_rate);
  const sessions = num(rec.sessions_checked);
  const props = num(rec.propositions_total);
  const decided = num(rec.propositions_decided);
  const approved = num(rec.propositions_approved);
  const ambiguous = num(rec.propositions_ambiguous);
  const votes = num(rec.total_votes);
  const fulfil = num(rec.fulfillment_rate);
  const minSample = num(rec.min_sample_required);

  const rows = [];
  if (att != null && sessions) {
    rows.push({
      label: 'Presença em sessões',
      value: att.toFixed(1) + '%',
      cls: attendanceClass(att),
      pct: att,
      note: `${sessions} sessões do plenário conferidas, uma a uma`,
    });
  }
  if (props != null) {
    rows.push({
      label: 'Proposições de autoria',
      value: String(props),
      cls: null,
      note: decided
        ? `${decided} já decididas · ${approved || 0} aprovadas`
        : 'nenhuma com tramitação concluída ainda',
    });
  }
  if (votes != null) {
    rows.push({
      label: 'Votos nominais colhidos',
      value: String(votes),
      cls: null,
      note: votes
        ? 'nas votações com registro nominal no período'
        : 'nenhuma votação nominal do período o incluiu',
    });
  }

  if (!rows.length) {
    return `<div class="m-sec"><h4>Registro mensurável</h4>
      <p style="color:var(--tx-3);font-size:13px;margin:0">
        Nenhuma métrica de registro pôde ser apurada para este parlamentar.</p></div>`;
  }

  // "Cumprimento" so aparece com amostra suficiente. Antes, proposicao em
  // tramitacao contava como promessa descumprida: qualquer parlamentar com
  // projetos pendentes levava 0/100 e "historico fraco".
  const fulfilHTML = fulfil != null
    ? `<div class="rec-note"><b>Taxa de aprovação das proposições: ${fulfil.toFixed(1)}%</b>
         (sobre as ${decided} com tramitação concluída)</div>`
    : `<div class="rec-note">Taxa de aprovação <b>não calculada</b>:
         ${decided || 0} proposição(ões) com tramitação concluída, e o mínimo é
         ${minSample || 5}. Projeto ainda em tramitação não é promessa descumprida${
           ambiguous ? `, e ${ambiguous} foi(ram) apenas arquivada(s) por fim de legislatura` : ''}.</div>`;

  return `<div class="m-sec">
    <h4>Registro mensurável</h4>
    <div class="rec-grid">
      ${rows.map((r) => `
        <div class="rec">
          <div class="rec-h">
            <span>${esc(r.label)}</span>
            <b${r.cls ? ` class="s-${r.cls}"` : ''}>${esc(r.value)}</b>
          </div>
          ${r.pct != null ? `<div class="track"><i class="f-${r.cls}" style="width:${r.pct}%"></i></div>` : ''}
          <p>${esc(r.note)}</p>
        </div>`).join('')}
    </div>
    ${fulfilHTML}
  </div>`;
}

function modalHTML(p) {
  const pol = p.politician || {};
  const has = hasScore(p);
  const cls = has ? scoreClass(p.score) : 'na';
  const v = (p.viability || [])[0] || {};
  const cov = coverage(p);

  const factors = Object.entries(v.factors || {}).map(([k, val]) => `
    <div class="factor">
      <div class="factor-h">
        <span>${esc(FACTOR_LABEL[k] || k.replace(/_/g, ' '))}</span>
        <span>${Number(val).toFixed(1)}/100</span>
      </div>
      <div class="track"><i class="f-${scoreClass(val)}" style="width:${val}%"></i></div>
    </div>`).join('');

  const missing = (v.unavailable_factors || []);
  const missHTML = missing.length ? `
    <div class="miss">
      <strong>Não foi possível medir ${missing.length} fator(es).</strong>
      Eles foram <em>excluídos</em> do cálculo — o peso foi redistribuído entre
      os medidos, e não contado como zero.
      <ul>${missing.map((m) => `<li>${esc(FACTOR_LABEL[m] || m.replace(/_/g, ' '))}</li>`).join('')}</ul>
    </div>` : '';

  const fList = findings(p);
  const findHTML = fList.length
    ? fList.map((a) => `
      <div class="finding c-${esc(a.confianca)}">
        <div class="finding-h">
          <b>${esc(FINDING_LABEL[a.tipo] || a.tipo)}</b>
          <span class="conf">confiança ${esc(a.confianca)}</span>
        </div>
        <p>${esc(a.descricao)}</p>
        ${(a.fontes || []).length ? `<div class="src">Fontes: ${esc((a.fontes || []).join(' · '))}</div>` : ''}
      </div>`).join('')
    : '<p style="color:var(--tx-3);font-size:13px;margin:0">Nenhuma divergência entre discurso e ação registrada foi encontrada nos dados analisados.</p>';

  const incHTML = (p.inconsistencies || []).length
    ? `<div class="m-sec"><h4>Pontos de atenção</h4>${
        p.inconsistencies.map((s) => `<div class="finding"><p>${esc(s)}</p></div>`).join('')
      }</div>` : '';

  const promHTML = (p.promises || []).length
    ? `<ul class="plist">${p.promises.slice(0, 12).map((pr) => `
        <li>
          ${esc(pr.text)}
          <div class="p-meta">
            <span>tema: ${esc(pr.category || 'não classificado')}</span>
            <span>confiança da extração: ${Math.round((pr.confidence || 0) * 100)}%</span>
            ${pr.is_conditional ? '<span>condicional</span>' : ''}
          </div>
        </li>`).join('')}</ul>`
    : '<p style="color:var(--tx-3);font-size:13px;margin:0">Nenhuma promessa foi extraída dos discursos analisados. Sem promessa não há o que avaliar — por isso não há score.</p>';

  const evdHTML = (p.evidence || []).length
    ? `<div class="evd">${p.evidence.slice(0, 25).map((e) =>
        `<div><b>${esc(e.source || '')}</b> — ${esc(String(e.content || '').slice(0, 190))}</div>`
      ).join('')}</div>`
    : '<p style="color:var(--tx-3);font-size:13px;margin:0">Sem evidências coletadas.</p>';

  return `
  <div class="m-head">
    <div class="avatar">${esc(initials(pol.name))}</div>
    <div>
      <h2 id="mName">${esc(pol.name)}</h2>
      <p>${esc(pol.party || '—')}${pol.state ? ' · ' + esc(pol.state) : ''}${pol.role ? ' · ' + esc(pol.role) : ''}</p>
    </div>
    <div class="m-score">
      <b class="s-${cls}">${has ? p.score.toFixed(1) : '—'}</b>
      <span>${esc(p.label || 'sem avaliação')}</span>
    </div>
  </div>

  ${recordHTML(p)}

  ${has ? `<div class="m-sec">
    <h4>Fatores medidos${cov != null ? ` — cobertura ${Math.round(cov * 100)}%` : ''}</h4>
    ${factors}
    ${v.confidence_interval ? `<p style="font-size:12px;color:var(--tx-3);margin:10px 0 0">
      Intervalo de confiança: ${v.confidence_interval[0]}% a ${v.confidence_interval[1]}% —
      alarga conforme cai a cobertura dos dados.</p>` : ''}
    ${missHTML}
  </div>` : `<div class="m-sec">${missHTML}</div>`}

  <div class="m-sec">
    <h4>Cruzamento: discurso × ação registrada</h4>
    ${findHTML}
  </div>

  ${incHTML}

  <div class="m-sec"><h4>Promessas extraídas de discursos</h4>${promHTML}</div>

  <div class="m-sec"><h4>Evidências coletadas</h4>${evdHTML}</div>

  <p class="legal">
    Análise probabilística, não acusatória. Mede viabilidade técnica, não
    honestidade nem intenção. As promessas são extraídas automaticamente de
    transcrições de discursos e podem conter falsos positivos. Fontes: API de
    Dados Abertos da Câmara dos Deputados e SICONFI (Tesouro Nacional).
  </p>`;
}

function openModal(i) {
  $('#modalBody').innerHTML = modalHTML(state.data[i]);
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('.modal-panel').scrollTop = 0;
}

function closeModal() {
  $('#modal').hidden = true;
  document.body.style.overflow = '';
}

/* ---------------- eventos ---------------- */

document.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) return openModal(Number(card.dataset.i));

  if (e.target.closest('[data-close]')) return closeModal();

  const chip = e.target.closest('.chip');
  if (chip) {
    state.party = chip.dataset.p || null;
    renderChips();
    renderGrid();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});

$('#q').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });

/* ---------------- carga ---------------- */

fetch('data.json')
  .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then((d) => {
    state.data = d.politicians || [];
    renderStats();
    renderChips();
    renderGrid();
    const when = d.generated_at
      ? new Date(d.generated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    $('#meta').textContent =
      `${state.data.length} deputados · dados de ${when} · fonte: ${d.source || 'Câmara dos Deputados'}`;
  })
  .catch((err) => {
    $('#grid').innerHTML =
      `<p class="empty">Falha ao carregar data.json (${esc(err.message)}).<br>
       Gere o arquivo com <code>python gen_site_data.py</code>.</p>`;
  });
