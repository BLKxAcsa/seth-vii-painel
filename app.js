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
        <p>${esc(pol.party || '—')}${pol.state ? ' · ' + esc(pol.state) : ''}${
          pol.role === 'Senador(a)' ? ' · <span class="casa-badge casa-senado">Senado</span>' : ''
        }</p>
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
      ${p.ao_vivo ? `<span class="tag vivo">apurado agora · ${p.duration_s}s</span>` : ''}
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
  if (!list.length) {
    // Sem parlamentar carregado (site limpo) e sem resultado de filtro sao
    // duas situacoes diferentes -- a primeira pede um convite a buscar, a
    // segunda so avisa que o filtro atual nao bateu com nada.
    $('#empty').innerHTML = state.data.length === 0
      ? 'Nenhum parlamentar pré-carregado ainda. <strong>Busque o nome de um deputado ou senador acima</strong> para uma análise ao vivo, com dados do minuto.'
      : 'Nenhum resultado para esse filtro.';
  }
}

function renderStats() {
  const d = state.data;
  if (!d.length) {
    // Uma barra de estatisticas cheia de zero/traco parece painel quebrado.
    // Sem parlamentar carregado e o estado normal agora (o site vive de
    // busca ao vivo) -- entao o convite substitui a barra em vez de
    // conviver com ela zerada.
    $('#stats').innerHTML =
      '<div class="stats-empty">Nenhum parlamentar pré-carregado — use a busca acima para analisar qualquer deputado ou senador ao vivo, com dados do minuto.</div>';
    return;
  }
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
    const analisadas = num(rec.propositions_analyzed);
    rows.push({
      label: 'Proposições de autoria',
      value: String(props),
      cls: null,
      note: decided != null
        ? `${decided} já decididas · ${approved || 0} aprovadas`
        : (analisadas != null && analisadas < props
            ? `contagem exata; ${analisadas} lidas em detalhe nesta análise`
            : 'contagem exata de autoria'),
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
    : (decided == null
        ? `<div class="rec-note">Situação de tramitação <b>não conferida</b> nesta
             análise — custa uma consulta por proposição. Não é o mesmo que
             “nenhuma aprovada”, e por isso nenhum número é exibido no lugar.</div>`
        : `<div class="rec-note">Taxa de aprovação <b>não calculada</b>:
             ${decided} proposição(ões) com tramitação concluída, e o mínimo é
             ${minSample || 5}. Projeto ainda em tramitação não é promessa descumprida${
               ambiguous ? `, e ${ambiguous} foi(ram) apenas arquivada(s) por fim de legislatura` : ''}.</div>`);

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

const EVIDENCE_GROUP_LABEL = {
  projeto: 'Proposi\u00e7\u00f5es de autoria',
  discurso: 'Discursos em plen\u00e1rio',
  despesa: 'Despesas (cota parlamentar)',
  vinculo: 'Comiss\u00f5es e frentes',
};
const EVIDENCE_GROUP_ORDER = ['projeto', 'discurso', 'vinculo', 'despesa'];
const EVIDENCE_GROUP_CAP = 8;

/* Antes era uma lista \u00fanica cortada em 25 itens no total -- com
   proposi\u00e7\u00f5es agora coletando muito mais que antes, elas sozinhas
   enchiam o corte e escondiam discursos, despesas e v\u00ednculos. Agrupar por
   tipo com um teto por grupo (e contagem real ao lado) resolve os dois
   problemas: nada some em sil\u00eancio, e fica organizado por categoria. */
function evidenceGroupsHTML(evidence) {
  if (!evidence.length) {
    return '<p style="color:var(--tx-3);font-size:13px;margin:0">Sem evid\u00eancias coletadas.</p>';
  }
  const grupos = {};
  for (const e of evidence) {
    const t = e.type || 'outro';
    (grupos[t] = grupos[t] || []).push(e);
  }
  const ordem = [...EVIDENCE_GROUP_ORDER, ...Object.keys(grupos).filter((k) => !EVIDENCE_GROUP_ORDER.includes(k))];
  return ordem.filter((t) => (grupos[t] || []).length).map((t) => {
    const itens = grupos[t];
    const mostrados = itens.slice(0, EVIDENCE_GROUP_CAP);
    const resto = itens.length - mostrados.length;
    // Aberto por padrão sempre -- um acordeão fechado por padrão foi
    // exatamente a origem da queixa de "análise cortada". O teto de itens
    // por grupo já evita que a lista fique gigante; fechar por cima disso
    // só esconderia de novo.
    return `
      <details class="evd-group" open>
        <summary>${esc(EVIDENCE_GROUP_LABEL[t] || t)} <span class="evd-count">${itens.length}</span></summary>
        <div class="evd">
          ${mostrados.map((e) => `<div>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">` : ''}<b>${esc(e.source || '')}</b>${e.url ? '</a>' : ''} \u2014 ${esc(String(e.content || '').slice(0, 240))}</div>`).join('')}
          ${resto > 0 ? `<p class="evd-more">+ ${resto} n\u00e3o exibido(s) aqui.</p>` : ''}
        </div>
      </details>`;
  }).join('');
}

/* Resumo final: recombina n\u00fameros j\u00e1 calculados acima em uma frase curta.
   N\u00e3o calcula nada novo -- s\u00f3 reapresenta o que j\u00e1 est\u00e1 no dossi\u00ea, para
   quem quer o essencial sem ler a an\u00e1lise inteira. */
function resumoHTML(p) {
  const rec = record(p);
  const att = num(rec.attendance_rate);
  const props = num(rec.propositions_total);
  const nPromises = (p.promises || []).length;
  const nAlerts = findings(p).length + (p.inconsistencies || []).length;
  const has = hasScore(p);

  const partes = [];
  if (att != null) partes.push(`presen\u00e7a de ${att.toFixed(0)}% nas sess\u00f5es conferidas`);
  if (props != null) partes.push(`${props} proposi\u00e7\u00e3o(\u00f5es) de autoria`);
  partes.push(has
    ? `viabilidade de ${p.score.toFixed(0)}/100 para ${nPromises} promessa(s) identificada(s)`
    : 'nenhuma promessa identificada nos discursos analisados');
  if (nAlerts) partes.push(`${nAlerts} ponto(s) de aten\u00e7\u00e3o no cruzamento`);

  return `
  <div class="m-sec resumo">
    <h4>Resumo</h4>
    <p>${esc((p.politician || {}).name || 'Este parlamentar')} tem ${partes.join(', ')}.</p>
    <p class="resumo-aviso">Resumo autom\u00e1tico a partir dos dados acima \u2014 n\u00e3o
      substitui a an\u00e1lise completa e o conte\u00fado mais extenso desta p\u00e1gina.</p>
  </div>`;
}

/* Pontos de atenção (despesas) vêm em dois formatos possíveis: string
   pronta (dossiês antigos publicados pelo pipeline Python, que ainda não
   foi atualizado) ou objeto estruturado (análise ao vivo, engine.js
   atualizado). Os dois precisam renderizar sem quebrar. O objeto usa
   <details> para o nome do fornecedor funcionar como "clique para ver a
   investigação" -- mesmo padrão já usado em evidenceGroupsHTML, sem
   precisar de handler de clique novo. */
function anomalyHTML(a, p) {
  if (typeof a === 'string') {
    return `<div class="finding"><p>${esc(a)}</p></div>`;
  }
  const sev = a.severity === 'alta' ? 'alta' : 'media';
  const amount = typeof a.amount === 'number'
    ? `R$ ${a.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;

  // Detalhamento usa despesas já coletadas NESTA análise -- não é busca
  // nova nem cruzamento com outros parlamentares (isso é escopo da Análise
  // Profunda, que tem orçamento de tempo maior).
  const itens = (p.expenses || []).filter((d) => d.fornecedor === a.supplier);
  const detalheHTML = itens.length
    ? itens.slice(0, 20).map((d) => `
        <div class="anomaly-item">
          <span>${esc((d.data || '').slice(0, 10) || '—')}</span>
          <span>${esc(d.tipo || '—')}</span>
          <span>${typeof d.valor === 'number' ? 'R$ ' + d.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</span>
          ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">comprovante</a>` : '<span>—</span>'}
        </div>`).join('')
    : '<p style="color:var(--tx-3);font-size:12px;margin:6px 0 0">Detalhamento não disponível nesta análise.</p>';

  return `
    <details class="finding anomaly sev-${sev}">
      <summary>
        <span>⚠️ ${esc(a.supplier || 'fornecedor não identificado')}${a.cnpjCpf ? ` <span class="anomaly-doc">${esc(a.cnpjCpf)}</span>` : ''}</span>
        ${amount ? `<b>${amount}</b>` : ''}
      </summary>
      <p>${esc(a.description || '')}</p>
      <div class="anomaly-detail">${detalheHTML}</div>
    </details>`;
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
      <strong>${missing.length} fator(es) sem dado público</strong>, excluído(s) do
      cálculo (peso redistribuído entre os demais).
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
    : '<p style="color:var(--tx-3);font-size:13px;margin:0">Nenhuma divergência encontrada entre discurso e ação registrada.</p>';

  const incHTML = (p.inconsistencies || []).length
    ? `<div class="m-sec"><h4>Pontos de atenção</h4>${
        p.inconsistencies.map((a) => anomalyHTML(a, p)).join('')
      }</div>` : '';

  // Só aparece quando a análise coletou a lista completa de despesas (hoje,
  // análise ao vivo do engine.js atualizado). Dossiês antigos do pipeline
  // Python ainda não têm esse campo -- não fabrica o botão sem o dado real.
  const nAnomaliasObj = (p.inconsistencies || []).filter((a) => typeof a === 'object' && a).length;
  const gastosBtnHTML = (p.expenses && p.expenses.length)
    ? `<div class="m-sec">
        <h4>Gastos</h4>
        <button type="button" class="gastos-btn" data-gastos>
          💰 Ver todos os gastos (${p.expenses.length})${nAnomaliasObj ? ` · ${nAnomaliasObj} sinalizado(s)` : ''}
        </button>
      </div>` : '';

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
    : '<p style="color:var(--tx-3);font-size:13px;margin:0">Nenhuma promessa identificada nos discursos analisados.</p>';

  const evdHTML = evidenceGroupsHTML(p.evidence || []);

  const news = p.noticias_publicas || [];
  const newsHTML = news.length
    ? `<div class="evd">${news.map((n) => `<div><b>${esc(n.fonte || 'Notícia pública')}</b> — ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title || '')}</a>` : esc(n.title || '')}<br><span style="color:var(--tx-3)">${esc((n.resumo || '').slice(0, 280))}</span></div>`).join('')}</div>`
    : '<p style="color:var(--tx-3);font-size:13px;margin:0">Nenhuma notícia pública recente encontrada.</p>';

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

  ${gastosBtnHTML}

  ${incHTML}

  <div class="m-sec"><h4>Promessas extraídas de discursos</h4>${promHTML}</div>

  <div class="m-sec"><h4>Notícias públicas encontradas</h4>${newsHTML}</div>

  <div class="m-sec"><h4>Evidências coletadas</h4>${evdHTML}</div>

  ${resumoHTML(p)}

  <p class="legal">
    Análise probabilística, não acusatória. Mede viabilidade técnica, não
    honestidade nem intenção. Promessas extraídas automaticamente de discursos
    podem conter falsos positivos. Fontes: Câmara dos Deputados, SICONFI e
    feeds de notícia pública.
  </p>`;
}

/* Visão dedicada de Gastos -- lista completa (não o recorte de 10 usado em
   "Evidências coletadas"), com fornecedor sinalizado em destaque quando
   bate com um dos Pontos de atenção. Reaproveita o mesmo #modalBody da
   análise principal (troca de conteúdo, não abre modal novo) para não
   duplicar overlay/scroll/foco. */
function gastosViewHTML(p) {
  const pol = p.politician || {};
  const despesas = (p.expenses || []).slice().sort((a, b) => (b.valor || 0) - (a.valor || 0));
  const anomalias = (p.inconsistencies || []).filter((a) => typeof a === 'object' && a && a.supplier);
  const fornecedoresSinalizados = new Set(anomalias.map((a) => a.supplier));
  const total = despesas.reduce((s, d) => s + (d.valor || 0), 0);

  const rows = despesas.map((d) => {
    const flagged = d.fornecedor && fornecedoresSinalizados.has(d.fornecedor);
    return `
      <tr class="${flagged ? 'gasto-flag' : ''}">
        <td>${esc((d.data || '').slice(0, 10) || '—')}</td>
        <td>${esc(d.tipo || '—')}</td>
        <td>${flagged ? '⚠️ ' : ''}${esc(d.fornecedor || 'não identificado')}${d.cnpjCpf ? `<br><span class="gasto-doc">${esc(d.cnpjCpf)}</span>` : ''}</td>
        <td class="gasto-valor">${typeof d.valor === 'number' ? 'R$ ' + d.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
        <td>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">comprovante</a>` : (d.numDocumento ? esc(d.numDocumento) : '—')}</td>
      </tr>`;
  }).join('');

  return `
  <div class="m-head">
    <div class="avatar">${esc(initials(pol.name))}</div>
    <div>
      <h2>${esc(pol.name)}</h2>
      <p>Gastos da cota parlamentar coletados nesta análise</p>
    </div>
  </div>

  <button type="button" class="voltar-btn" data-voltar>&larr; Voltar à análise</button>

  <div class="m-sec">
    <h4>${despesas.length} registro${despesas.length === 1 ? '' : 's'} · R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h4>
    ${anomalias.length ? `<p class="gastos-note">${anomalias.length} padrão(ões) sinalizado(s) (linhas destacadas abaixo) — ver "Pontos de atenção" na análise para o detalhamento de cada um.</p>` : ''}
    ${despesas.length ? `
      <div class="table-wrapper">
        <table class="gastos-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Fornecedor</th><th>Valor líquido</th><th>Documento</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<p style="color:var(--tx-3);font-size:13px;margin:0">Nenhuma despesa coletada nesta análise.</p>'}
  </div>

  <button type="button" class="voltar-btn" data-voltar>&larr; Voltar à análise</button>`;
}

async function openModal(i) {
  const p = state.data[i];
  modalAtual = slugify((p.politician || {}).name);
  modalDossieAtual = p;
  $('#modalBody').innerHTML = modalHTML(p);
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('.modal-panel').scrollTop = 0;

  // Card pré-gerado (não veio de busca ao vivo): confere se já existe dossiê
  // profundo publicado para este nome e mostra o selo, sem refazer a análise.
  if (!p._deep) {
    const deep = await buscarAnaliseProfunda((p.politician || {}).name);
    if (deep && modalAtual === slugify((p.politician || {}).name)) {
      p._deep = deep;
      $('#modalBody').innerHTML = deepBadgeHTML(deep) + modalHTML(p);
    }
  }
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

  if (e.target.closest('[data-gastos]')) {
    if (!modalDossieAtual) return;
    $('#modalBody').innerHTML = gastosViewHTML(modalDossieAtual);
    $('.modal-panel').scrollTop = 0;
    return;
  }

  if (e.target.closest('[data-voltar]')) {
    if (!modalDossieAtual) return;
    const deep = modalDossieAtual._deep;
    $('#modalBody').innerHTML = (deep ? deepBadgeHTML(deep) : '') + modalHTML(modalDossieAtual);
    $('.modal-panel').scrollTop = 0;
    return;
  }

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

$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });

/* ---------------- busca ao vivo ----------------
   O painel deixa de ser vitrine. Digitar um nome consulta a API oficial na
   hora e analisa qualquer um dos 513 deputados, não só os pré-gerados.
   Só é possível porque as fontes respondem com CORS liberado — foi medido
   antes de desenhar isto. */

let buscaTimer = null;
let ultimaBusca = '';
let buscaSeq = 0;  // impede resposta antiga de sobrescrever busca mais recente

$('#q').addEventListener('input', (e) => {
  const termo = e.target.value.trim();
  clearTimeout(buscaTimer);
  if (termo.length < 3) { $('#live').hidden = true; return; }
  // Espera a digitação parar: sem isso, cada tecla vira uma requisição.
  buscaTimer = setTimeout(() => buscarNaCamara(termo), 400);
});

async function buscarNaCamara(termo) {
  if (termo === ultimaBusca) return;
  ultimaBusca = termo;
  const seq = ++buscaSeq;

  const box = $('#live');
  box.hidden = false;
  box.innerHTML = `<div class="live-h">Procurando "${esc(termo)}" na Câmara e no Senado…</div>`;

  let achados = [];
  try {
    const { buscarParlamentares } = await import('./engine.js');
    achados = await buscarParlamentares(termo);
  } catch (err) {
    if (seq !== buscaSeq) return;
    box.innerHTML = `<div class="live-h">Não foi possível consultar a API oficial
      (${esc(err.message)}). Os cards abaixo continuam disponíveis.</div>`;
    return;
  }

  // A busca é assíncrona; se o usuário digitou outro nome enquanto a API
  // respondia, esta resposta antiga não pode sobrescrever a busca nova.
  if (seq !== buscaSeq) return;

  if (!achados.length) {
    box.innerHTML = `<div class="live-h"><b>Nenhum deputado ou senador em exercício</b>
      encontrado para "${esc(termo)}".</div>
      <div class="live-note">O painel ao vivo consulta a Câmara dos Deputados e o Senado
      Federal. Se for candidato, dirigente partidário, ex-parlamentar ou influenciador
      político sem mandato federal atual, ele não aparece nessa base. Ex.: Jones Manoel
      não consta como deputado federal em exercício.</div>`;
    return;
  }

  const modoBusca = [...new Set(achados.map((d) => d._busca).filter(Boolean))].join(' · ');
  box.innerHTML = `
    <div class="live-h">${achados.length} encontrado(s) na API oficial${modoBusca ? ` (${esc(modoBusca)})` : ''} —
      clique para analisar <b>agora</b>, com dados do minuto</div>
    <div class="live-list">
      ${achados.map((d) => `
        <button class="live-item" data-dep='${esc(JSON.stringify({
          id: d.id, nome: d.nome, siglaPartido: d.siglaPartido,
          siglaUf: d.siglaUf, urlFoto: d.urlFoto, casa: d.casa,
        }))}'>
          <img src="${esc(d.urlFoto || '')}" alt="" loading="lazy">
          <span><b>${esc(d.nome)}</b><em>${esc(d.siglaPartido || '—')} · ${esc(d.siglaUf || '')}
            <span class="casa-badge${d.casa === 'senado' ? ' casa-senado' : ''}">${d.casa === 'senado' ? 'Senado' : 'Câmara'}</span></em></span>
        </button>`).join('')}
    </div>`;
}

/* ---------------- Análise Profunda (beta) ----------------
   Não roda no navegador: usa 2 modelos locais (1-2GB cada) + feeds sem CORS.
   Por segurança, NENHUM token fica no código do site -- então o disparo real
   hoje é feito pelo mantenedor via GitHub Actions, não por clique anônimo.
   O que o visitante PODE fazer sem token nenhum: abrir uma issue pública no
   repositório do painel pedindo a análise. É gratuito, não expõe credencial,
   e não depende de nenhum serviço novo. */

function slugify(nome) {
  return String(nome || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'sem-nome';
}

const deepCache = new Map();
async function buscarAnaliseProfunda(nome) {
  const slug = slugify(nome);
  if (deepCache.has(slug)) return deepCache.get(slug);
  try {
    const r = await fetch(`deep/${slug}.json`, { cache: 'no-store' });
    const val = r.ok ? await r.json() : null;
    deepCache.set(slug, val);
    return val;
  } catch {
    deepCache.set(slug, null);
    return null;
  }
}

/* Selo mostrado quando já existe um dossiê de Análise Profunda publicado
   para o nome buscado. `deep.dossie` tem o schema completo do CLI Python
   (mesmo formato de data.json), então reaproveita subbrain/noticias_publicas
   já presentes ali -- sem duplicar leitura de campo em dois lugares. */
function deepBadgeHTML(deep) {
  const d = deep.dossie || {};
  const noticias = d.noticias_publicas || [];
  const divergencias = (d.subbrain || {}).divergencias || [];
  const quando = d.generated_at
    ? new Date(d.generated_at).toLocaleDateString('pt-BR')
    : null;
  return `
  <div class="deep-badge">
    <span>🔬</span>
    <span>
      <b>Análise profunda disponível</b>${quando ? ` · ${esc(quando)}` : ''}
      ${noticias.length ? `· ${noticias.length} notícia(s) oficial(is)` : ''}
      ${divergencias.length ? `· ${divergencias.length} ponto(s) revisado(s) por segunda análise` : ''}
    </span>
  </div>`;
}

// Clicar num resultado da busca dispara a análise ao vivo. Este handler foi
// perdido numa edição anterior (substituído sem ser copiado de volta) e só
// foi achado porque testei clique de verdade, não só sintaxe do arquivo.
document.addEventListener('click', async (e) => {
  const item = e.target.closest('.live-item');
  if (!item) return;
  const dep = JSON.parse(item.dataset.dep);
  const deep = await buscarAnaliseProfunda(dep.nome);
  await analisar(dep, deep);
});


const WORKER_URL = 'https://seth-vii-deep-trigger.angst.workers.dev';

// Slug do dossiê profundo sendo exibido no momento -- evita que uma resposta
// de polling atualize o modal depois que o usuário já abriu outra pessoa.
let modalAtual = null;

// Dossiê inteiro exibido no modal agora (não só o slug) -- permite trocar
// entre a análise principal e a visão de Gastos sem reprocessar nada, e sem
// precisar re-localizar o item em state.data (funciona igual para um card
// pré-carregado e para um resultado de busca ao vivo recém-analisado).
let modalDossieAtual = null;

async function solicitarAnaliseProfunda(nome) {
  try {
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    });
    return await r.json();
  } catch {
    return { erro: 'não foi possível contatar o serviço de análise profunda' };
  }
}

// Pollings de Análise Profunda em andamento, por slug -- independentes do
// modal. Antes, sair do card ou abrir outro parlamentar parava o
// acompanhamento em silêncio (a checagem "modalAtual !== slug" desistia).
// Agora o polling roda até o fim (ou até os ~15min esgotarem) mesmo se o
// usuário navegar para outro lugar, e atualiza o card assim que o dossiê
// fica pronto -- a tela só é redesenhada se ainda fizer sentido mostrar.
const pollsEmAndamento = new Set();

async function aguardarDossieProfundo(slug, dossieRef) {
  if (pollsEmAndamento.has(slug)) return; // já existe um polling para este slug
  pollsEmAndamento.add(slug);
  const intervaloMs = 20000;
  const maxTentativas = 45; // ~15 min
  try {
    for (let i = 0; i < maxTentativas; i++) {
      await new Promise((r) => setTimeout(r, intervaloMs));
      const deep = await buscarAnaliseProfunda(slug);
      if (deep) {
        dossieRef._deep = deep;
        renderGrid(); // card some/aparece com o selo mesmo se o modal estiver fechado
        if (modalAtual === slug && modalDossieAtual === dossieRef) {
          $('#modalBody').innerHTML = deepBadgeHTML(deep) + modalHTML(dossieRef);
        }
        return;
      }
    }
  } finally {
    pollsEmAndamento.delete(slug);
  }
}

function progressoProfundoHTML(estado) {
  if (estado === 'aguardando') {
    return `<div class="deep-progress"><span class="spin"></span>
      Análise profunda em andamento — geralmente 5 a 15 minutos. Esta janela
      atualiza sozinha quando terminar.</div>`;
  }
  if (estado === 'limite') {
    return `<div class="deep-progress warn">Limite de pedidos por hora atingido.
      Tente novamente mais tarde.</div>`;
  }
  return `<div class="deep-progress warn">Não foi possível iniciar a análise
      profunda agora.</div>`;
}

async function analisar(dep, deepDossieExistente) {
  const body = $('#modalBody');
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  const slug = slugify(dep.nome);
  modalAtual = slug;

  const passos = [];
  const pintar = (atual) => {
    body.innerHTML = `
      <div class="m-head">
        <div class="avatar">${esc(initials(dep.nome))}</div>
        <div><h2 id="mName">${esc(dep.nome)}</h2>
          <p>${esc(dep.siglaPartido || '—')} · ${esc(dep.siglaUf || '')}</p></div>
      </div>
      ${deepDossieExistente ? deepBadgeHTML(deepDossieExistente) : ''}
      <div class="m-sec">
        <h4>Analisando fontes oficiais</h4>
        <div class="steps">
          ${passos.map((p) => `<div class="step done">✓ ${esc(p)}</div>`).join('')}
          <div class="step doing"><span class="spin"></span> ${esc(atual)}</div>
        </div>
        <p class="steps-note">Geralmente 20 a 60 segundos.</p>
      </div>`;
  };

  pintar('iniciando');

  try {
    const { analisarAoVivo, analisarSenadorAoVivo } = await import('./engine.js');
    const funcaoAnalise = dep.casa === 'senado' ? analisarSenadorAoVivo : analisarAoVivo;
    const dossie = await funcaoAnalise(dep, (msg) => {
      if (passos[passos.length - 1] !== msg) {
        const anterior = document.querySelector('.step.doing');
        if (anterior && passos.length < 8) passos.push(anterior.textContent.trim().replace(/^\s*/, ''));
      }
      pintar(msg);
    });
    dossie._deep = deepDossieExistente || null;
    modalDossieAtual = dossie;

    // Entra no mesmo estado dos demais para reusar card, modal e ordenação.
    state.data.unshift(dossie);
    renderStats(); renderChips(); renderGrid();

    const querProfunda = $('#deepToggle')?.checked;
    const renderizarModal = (extra = '') =>
      (deepDossieExistente ? deepBadgeHTML(deepDossieExistente) : extra) + modalHTML(dossie);

    body.innerHTML = renderizarModal();
    $('.modal-panel').scrollTop = 0;
    $('#live').hidden = true;

    // Modo profundo ligado e ainda sem dossiê publicado: dispara e acompanha
    // sem travar a análise instantânea, que já está na tela.
    if (querProfunda && !deepDossieExistente) {
      const resp = await solicitarAnaliseProfunda(dep.nome);
      // Efeito (guardar o dossiê profundo, iniciar o polling) não depende de
      // o modal ainda estar aberto nesta análise -- só a atualização da tela
      // depende disso. Antes, sair do modal logo após pedir a análise
      // profunda descartava o pedido "iniciado" sem nunca acompanhar.
      if (resp.status === 'ja_existe') {
        dossie._deep = resp;
        if (modalAtual === slug) body.innerHTML = deepBadgeHTML(resp) + modalHTML(dossie);
      } else if (resp.status === 'iniciado') {
        if (modalAtual === slug) body.innerHTML = progressoProfundoHTML('aguardando') + modalHTML(dossie);
        aguardarDossieProfundo(slug, dossie);
      } else if (modalAtual === slug) {
        body.innerHTML = progressoProfundoHTML(resp.erro?.includes('limite') ? 'limite' : 'erro') + modalHTML(dossie);
      }
    }
  } catch (err) {
    body.innerHTML = `
      <div class="m-head"><div class="avatar">${esc(initials(dep.nome))}</div>
        <div><h2>${esc(dep.nome)}</h2><p>análise interrompida</p></div></div>
      <div class="m-sec"><h4>Não foi possível concluir</h4>
        <div class="rec-note">Fonte oficial indisponível no momento. Tente novamente
          em alguns instantes.<br><span style="color:var(--tx-3);font-size:12px">${esc(err.message)}</span></div></div>`;
  }
}


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
    $('#meta').textContent = state.data.length
      ? `${state.data.length} deputados · dados de ${when} · fonte: ${d.source || 'Câmara dos Deputados'}`
      : 'Nenhum parlamentar pré-carregado · use a busca acima para analisar ao vivo';
  })
  .catch((err) => {
    $('#grid').innerHTML =
      `<p class="empty">Falha ao carregar data.json (${esc(err.message)}).<br>
       Gere o arquivo com <code>python gen_site_data.py</code>.</p>`;
  });
