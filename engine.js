/* Seth VII — motor de análise AO VIVO, executado no navegador do usuário.
 *
 * Por que no navegador
 * --------------------
 * GitHub Pages serve arquivo estático: não executa Python, não tem backend.
 * Um painel de dados pré-gravados era a consequência disso.
 *
 * A saída veio de uma medição: as fontes oficiais respondem com
 * `Access-Control-Allow-Origin`, então o próprio navegador pode chamá-las.
 *
 *   API Câmara .......... ACAO: *                          -> liberado
 *   SICONFI ............. ACAO: <origem do site>           -> liberado
 *   Agência Câmara RSS .. ACAO: *                          -> liberado
 *
 * Com isso a análise roda na máquina de quem acessa: custo zero de servidor,
 * qualquer um dos 513 deputados, dado do minuto e não de um arquivo velho.
 *
 * Uma fonte de verdade
 * --------------------
 * As REGRAS de julgamento (o que conta como promessa, o que rejeitar, quais
 * temas existem, quanto pesa cada fator) NÃO estão escritas aqui. Vêm de
 * rules.json, exportado do Python por export_rules.py. Este arquivo é só o
 * motor que aplica a regra. Reescrever as regras aqui criaria dois
 * julgamentos divergentes sobre a mesma pessoa.
 */

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const SICONFI = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt';

/* ------------------------------------------------------------------ *
 * Camada de rede
 * ------------------------------------------------------------------ */

/* A análise dispara dezenas de requisições (uma por sessão, para presença).
   Sem limite, o navegador abre tudo de uma vez e a API responde 429. Seis
   simultâneas foi o teto que se mostrou estável. */
class Limiter {
  constructor(max = 6) { this.max = max; this.ativos = 0; this.fila = []; }
  async run(fn) {
    if (this.ativos >= this.max) await new Promise((r) => this.fila.push(r));
    this.ativos++;
    try { return await fn(); }
    finally {
      this.ativos--;
      const proximo = this.fila.shift();
      if (proximo) proximo();
    }
  }
}

const limiter = new Limiter(6);

/* Cache por aba. Reanalisar o mesmo deputado não deve bater na API de novo, e
   a lista de presentes de uma sessão é a mesma para qualquer deputado — é o
   que torna a comparação com pares gratuita em requisições. */
const cache = new Map();

async function getJSON(url, { tentativas = 3 } = {}) {
  if (cache.has(url)) return cache.get(url);

  const exec = async () => {
    let ultimoErro;
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (r.status === 429 || r.status >= 500) {
          // Recuo exponencial: 0.6s, 1.2s, 2.4s
          await new Promise((s) => setTimeout(s, 600 * 2 ** i));
          ultimoErro = new Error(`HTTP ${r.status}`);
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        cache.set(url, j);
        return j;
      } catch (e) { ultimoErro = e; }
    }
    throw ultimoErro || new Error('falha de rede');
  };

  return limiter.run(exec);
}

/* Falha de UMA fonte não pode derrubar a análise inteira: são APIs públicas de
   terceiros que mudam sem aviso. O dado que faltou é declarado ausente — nunca
   convertido em zero. */
async function tentar(url, padrao = null) {
  try { return await getJSON(url); }
  catch (e) { console.warn('fonte indisponível:', url, e.message); return padrao; }
}

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

const hoje = () => new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const diasAtras = (n) => { const d = hoje(); d.setDate(d.getDate() - n); return iso(d); };

/* ------------------------------------------------------------------ *
 * Regras (carregadas do JSON exportado pelo Python)
 * ------------------------------------------------------------------ */

let RULES = null;

export async function carregarRegras() {
  if (RULES) return RULES;
  const r = await fetch('rules.json');
  if (!r.ok) throw new Error('rules.json não encontrado');
  RULES = await r.json();

  // Flag 'u' é obrigatória: os padrões usam \p{L} para reconhecer acento.
  // Sem ela, "construídas" e "ação" não casariam.
  RULES._promise = RULES.promise_patterns.map((p) => new RegExp(p, 'iu'));
  RULES._reject = RULES.reject_patterns.map((p) => new RegExp(p, 'iu'));
  RULES._cats = Object.fromEntries(Object.entries(RULES.categories).map(
    ([cat, kws]) => [cat, kws.map((k) => new RegExp(
      '(?<![0-9\\p{L}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'))]));
  RULES._stems = RULES.action_stems.map((s) => new RegExp('(?<![0-9\\p{L}])' + s, 'iu'));
  RULES._exact = new Set(RULES.action_exact);
  return RULES;
}

/* ------------------------------------------------------------------ *
 * Extração de promessas — espelha src/seth_vii/services/nlp.py
 * ------------------------------------------------------------------ */

const ABREV = /\b(Sr|Sra|Srs|Sras|Dr|Dra|Exmo|Exma|art|arts|inc|p|pág|séc|etc|Av|Prof|Dep|Sen|Min|n|nº|no)\./gi;

export function dividirSentencas(texto) {
  if (!texto || !texto.trim()) return [];
  let s = texto.trim().replace(/\s+/g, ' ');
  // Protege abreviação e decimal: "Sr. Presidente" e "Lei nº 15.318" não podem
  // virar quebra de sentença, senão a frase é picada no meio.
  s = s.replace(ABREV, (m) => m.slice(0, -1) + '\u0000');
  s = s.replace(/(\d)\.(\d)/g, '$1\u0000$2');
  return s.split(/(?<=[.!?;])\s+/)
    .map((p) => p.replace(/\u0000/g, '.').trim())
    .filter(Boolean);
}

function categorizar(frase) {
  let melhor = null, melhorN = 0;
  for (const [cat, res] of Object.entries(RULES._cats)) {
    const n = res.reduce((acc, rx) => acc + (rx.test(frase) ? 1 : 0), 0);
    if (n > melhorN) { melhorN = n; melhor = cat; }
  }
  return melhor;
}

function temVerboDeAcao(frase) {
  const palavras = (frase.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []);
  if (palavras.some((w) => RULES._exact.has(w))) return true;
  return RULES._stems.some((rx) => rx.test(frase));
}

function motivoRejeicao(frase) {
  if (frase.trimEnd().endsWith('?')) return 'pergunta retórica';
  for (const rx of RULES._reject) {
    if (rx.test(frase)) return 'padrão de rejeição';
  }
  if (!categorizar(frase)) return 'sem tema de política pública';
  if (!temVerboDeAcao(frase)) return 'sem verbo de ação de política pública';
  return null;
}

function confianca(frase, condicional, negativa) {
  let s = 0.5;
  if (/\d+/.test(frase)) s += 0.15;
  if (/\b(?:at[ée]?\s+\d{4}|em\s+\d+\s+(?:meses|anos|dias))\b/i.test(frase)) s += 0.10;
  if (/\b(?:em|no|na|de)\s+[A-ZÀ-Ú][a-zà-ú]+/.test(frase)) s += 0.05;
  if (temVerboDeAcao(frase)) s += 0.15;
  if (condicional) s -= 0.20;
  if (negativa) s -= 0.30;
  const palavras = new Set(frase.toLowerCase().match(/[\p{L}]+/gu) || []);
  if (RULES.vague_words.some((v) => palavras.has(v))) s -= 0.15;
  return Math.max(0, Math.min(1, Math.round(s * 100) / 100));
}

export function extrairPromessas(texto) {
  const promessas = [], descartes = [], vistas = new Set();

  for (const frase of dividirSentencas(texto)) {
    if (frase.length < 15) continue;
    if (!RULES._promise.some((rx) => rx.test(frase))) continue;

    const chave = frase.toLowerCase();
    if (vistas.has(chave)) continue;
    vistas.add(chave);

    const motivo = motivoRejeicao(frase);
    if (motivo) { descartes.push({ text: frase, reason: motivo }); continue; }

    const cond = /\b(?:se|caso)\s+(?:eleit[oa]s?|escolhid[oa])\b/i.test(frase);
    const neg = /\bn[ãa]o\s+(?:vou|irei|vamos|iremos|pretendo|prometo)\b/i.test(frase);

    promessas.push({
      text: frase,
      category: categorizar(frase),
      confidence: confianca(frase, cond, neg),
      is_conditional: cond,
      is_negative: neg,
      entities: {},
    });
  }

  // Deduplicação por Jaccard, igual ao Python
  const unicas = [];
  for (const p of promessas) {
    const wp = new Set(p.text.toLowerCase().split(/\s+/));
    const dup = unicas.some((u) => {
      const wu = new Set(u.text.toLowerCase().split(/\s+/));
      const inter = [...wp].filter((w) => wu.has(w)).length;
      const uniao = new Set([...wp, ...wu]).size;
      return uniao && inter / uniao > 0.70;
    });
    if (!dup) unicas.push(p);
  }
  return { promessas: unicas, descartes };
}

/* ------------------------------------------------------------------ *
 * Coleta nas fontes oficiais
 * ------------------------------------------------------------------ */

const ALIASES_BUSCA = {
  // Correções de grafia que apareceram no uso real do painel.
  // A API oficial é literal: "Nicolas" não acha "Nikolas"; "Kataguire" não
  // acha "Kataguiri". O painel não deve parecer que a pessoa não existe por
  // uma letra errada.
  'nicolas ferreira': 'Nikolas Ferreira',
  'nicolás ferreira': 'Nikolas Ferreira',
  'nikolas ferreira': 'Nikolas Ferreira',
  'kim kataguire': 'Kim Kataguiri',
  'kim kataguiri': 'Kim Kataguiri',
};

function normalizarBusca(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function distanciaLevenshtein(a, b) {
  a = normalizarBusca(a); b = normalizarBusca(b);
  if (!a || !b) return 999;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + custo);
    }
  }
  return dp[a.length][b.length];
}

let todosDeputadosCache = null;
async function todosDeputados() {
  if (todosDeputadosCache) return todosDeputadosCache;
  // A API da Câmara não aceita itens=1000; pagina. Buscamos páginas de 100
  // até acabar. Sem isso o fuzzy fallback falhava exatamente quando a busca
  // direta não achava nada.
  const todos = [];
  for (let pagina = 1; pagina <= 8; pagina++) {
    const d = await tentar(`${API}/deputados?${qs({
      itens: 100, pagina, ordem: 'ASC', ordenarPor: 'nome',
    })}`);
    const dados = (d && d.dados) || [];
    todos.push(...dados);
    if (dados.length < 100) break;
  }
  todosDeputadosCache = todos;
  return todosDeputadosCache;
}

export async function buscarDeputados(nome) {
  const termoOriginal = String(nome || '').trim();
  const chave = normalizarBusca(termoOriginal);
  const tentativas = [termoOriginal];
  if (ALIASES_BUSCA[chave] && ALIASES_BUSCA[chave] !== termoOriginal) {
    tentativas.unshift(ALIASES_BUSCA[chave]);
  }

  // 1. Busca oficial direta, incluindo alias quando a grafia conhecida difere.
  for (const termo of tentativas) {
    const d = await tentar(`${API}/deputados?${qs({
      nome: termo, ordem: 'ASC', ordenarPor: 'nome', itens: 15,
    })}`);
    const dados = (d && d.dados) || [];
    if (dados.length) {
      return dados.map((x) => ({ ...x, _busca: termo === termoOriginal ? 'direta' : `alias: ${termo}` }));
    }
  }

  // 2. Fallback fuzzy na lista completa dos deputados em exercício. Corrige
  // erros pequenos sem criar falso positivo grosseiro: exige distância baixa
  // OU inclusão forte do termo normalizado.
  const todos = await todosDeputados();
  const ranqueados = todos.map((d) => {
    const n = normalizarBusca(d.nome);
    const dist = distanciaLevenshtein(chave, n);
    const inclui = n.includes(chave) || chave.includes(n);
    const score = inclui ? 0 : dist;
    return { ...d, _scoreBusca: score, _busca: 'aproximação' };
  }).filter((d) => d._scoreBusca <= Math.max(2, Math.floor(chave.length * 0.18)))
    .sort((a, b) => a._scoreBusca - b._scoreBusca || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 8);

  return ranqueados;
}

async function coletarPresenca(depId, prog, maxSessoes = 20) {
  // Não existe endpoint de presença. O caminho é listar as sessões
  // deliberativas (codTipoEvento=110) e conferir a lista de presentes de cada
  // uma. Sem esse filtro, /eventos devolve os 100 eventos mais recentes de
  // todos os tipos e as sessões somem no meio.
  const lst = await tentar(`${API}/eventos?${qs({
    dataInicio: diasAtras(180), dataFim: iso(hoje()),
    codTipoEvento: 110, itens: 100, ordem: 'DESC', ordenarPor: 'dataHoraInicio',
  })}`);
  const sessoes = ((lst && lst.dados) || []).slice(0, maxSessoes);
  if (!sessoes.length) {
    return { rate: null, sessions_total: 0, available: false,
             reason: 'nenhuma sessão deliberativa no período' };
  }

  let presente = 0, conferidas = 0;
  const listas = new Map();
  let feitas = 0;

  await Promise.all(sessoes.map(async (ev) => {
    const d = await tentar(`${API}/eventos/${ev.id}/deputados`);
    feitas++;
    prog(`conferindo presença — ${feitas}/${sessoes.length} sessões`);
    const presentes = (d && d.dados) || [];
    if (!presentes.length) return;
    conferidas++;
    listas.set(ev.id, presentes.map((x) => x.id));
    if (presentes.some((x) => x.id === depId)) presente++;
  }));

  return {
    rate: conferidas ? Math.round((presente / conferidas) * 1000) / 10 : null,
    sessions_total: conferidas,
    sessions_present: presente,
    available: conferidas > 0,
    _listas: listas,   // reaproveitado na comparação com pares, sem custo extra
  };
}

async function coletarProposicoes(depId, limite = 20) {
  const d = await tentar(`${API}/proposicoes?${qs({
    idDeputadoAutor: depId, itens: limite, ordem: 'DESC', ordenarPor: 'id',
  })}`);
  return ((d && d.dados) || []).map((p) => ({
    id: p.id, type: p.siglaTipo, number: p.numero, year: p.ano,
    summary: p.ementa,
  }));
}

async function contarProposicoes(depId) {
  // A contagem exata vem do link de última página. Usar itens=100 saturava:
  // todo deputado produtivo dava exatamente 100 e a comparação não media nada.
  const d = await tentar(`${API}/proposicoes?${qs({
    idDeputadoAutor: depId, itens: 1, ordem: 'DESC', ordenarPor: 'id',
  })}`);
  const last = ((d && d.links) || []).find((l) => l.rel === 'last');
  if (!last) return ((d && d.dados) || []).length;
  const m = last.href.match(/pagina=(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

async function coletarDespesas(depId) {
  const ano = hoje().getFullYear();
  const d = await tentar(`${API}/deputados/${depId}/despesas?${qs({
    ano, itens: 100, ordem: 'DESC', ordenarPor: 'dataDocumento',
  })}`);
  return ((d && d.dados) || []).map((x) => ({
    valor: x.valorLiquido, tipo: x.tipoDespesa, fornecedor: x.nomeFornecedor,
    data: x.dataDocumento,
  }));
}

async function coletarDiscursos(depId) {
  // dataInicio/dataFim são obrigatórios: sem eles a API responde 200 com zero
  // registros, o que parece "deputado sem discurso" e não é.
  const d = await tentar(`${API}/deputados/${depId}/discursos?${qs({
    dataInicio: diasAtras(365), dataFim: iso(hoje()),
    itens: 20, ordem: 'DESC', ordenarPor: 'dataHoraInicio',
  })}`);
  return ((d && d.dados) || []).map((s) => ({
    data: s.dataHoraInicio, transcricao: s.transcricao, sumario: s.sumario,
    tipo: s.tipoDiscurso,
  }));
}

/* Comissões, frentes e ocupações: contexto declarado do parlamentar. É o que
   permite perguntar se o discurso bate com o posto que ele de fato ocupa. */
async function coletarContexto(depId) {
  const [org, fre, ocu] = await Promise.all([
    tentar(`${API}/deputados/${depId}/orgaos?${qs({ itens: 40 })}`),
    tentar(`${API}/deputados/${depId}/frentes`),
    tentar(`${API}/deputados/${depId}/ocupacoes`),
  ]);
  return {
    comissoes: ((org && org.dados) || [])
      .filter((o) => !o.dataFim)
      .map((o) => ({ sigla: o.siglaOrgao, nome: o.nomeOrgao, titulo: o.titulo })),
    frentes: ((fre && fre.dados) || []).map((f) => f.titulo),
    ocupacoes: ((ocu && ocu.dados) || [])
      .map((o) => ({ titulo: o.titulo, entidade: o.entidade, ano: o.anoInicio })),
  };
}

async function coletarNoticiasPublicas(nome) {
  // Notícias oficiais/públicas que o navegador consegue ler por CORS.
  // Google News e redes sociais comuns não entram aqui: sem proxy/backend, o
  // navegador bloqueia por CORS ou a plataforma exige API autenticada. Agência
  // Brasil/EBC é pública, sem chave e com ACAO=* medido.
  const feeds = [
    'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',
    'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
  ];
  const nomeNorm = normalizarBusca(nome);
  const partes = nomeNorm.split(' ').filter((x) => x.length >= 3);
  const achados = [];

  for (const url of feeds) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/rss+xml, text/xml' } });
      if (!r.ok) continue;
      const xml = await r.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      for (const item of [...doc.querySelectorAll('item')]) {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const desc = item.querySelector('description')?.textContent || '';
        const pubDate = item.querySelector('pubDate')?.textContent || '';
        const texto = normalizarBusca(`${title} ${desc}`);
        const bate = partes.length >= 2
          ? partes.every((p) => texto.includes(p))
          : texto.includes(nomeNorm);
        if (bate && !achados.some((n) => n.link === link)) {
          achados.push({ fonte: 'Agência Brasil/EBC', title, link, pubDate,
                         resumo: desc.replace(/<[^>]+>/g, '').slice(0, 220) });
        }
      }
    } catch (e) {
      console.warn('RSS público indisponível:', url, e.message);
    }
  }
  return achados.slice(0, 8);
}

async function coletarOrcamento(uf) {
  if (!uf || !UF_IBGE[uf]) return null;
  // Prioriza exercício fechado: no meio do ano a despesa empenhada cobre o ano
  // inteiro e produz margem negativa artificial.
  const ano = hoje().getFullYear() - 1;
  // A resposta do SICONFI para um RREO completo passa de 250 KB e chega a
  // 1,7 MB. Disputando as 6 conexões com as ~26 requisições da presença, ela
  // é derrubada pelo navegador (ERR_FAILED). Sai do limitador compartilhado e
  // ganha caminho próprio.
  const url = `${SICONFI}/rreo?${qs({
    an_exercicio: ano, nr_periodo: 6, co_tipo_demonstrativo: 'RREO',
    no_anexo: 'RREO-Anexo 01', id_ente: UF_IBGE[uf],
  })}`;
  let d = null;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    d = await r.json();
  } catch (e) {
    console.warn('SICONFI indisponível:', e.message);
    return null;
  }
  const itens = (d && d.items) || [];
  if (!itens.length) return null;
  const soma = (rot) => itens
    .filter((i) => (i.coluna || '').includes('Até o Bimestre') &&
                   (i.conta || '').toUpperCase().includes(rot))
    .reduce((a, i) => a + (Number(i.valor) || 0), 0);
  const receita = soma('RECEITAS CORRENTES');
  const despesa = soma('DESPESAS CORRENTES');
  if (!receita) return null;
  return { ano, total_revenue: receita, total_expense: despesa,
           margem: receita ? (receita - despesa) / receita : null };
}

const UF_IBGE = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
};

/* ------------------------------------------------------------------ *
 * Cruzamento: o que disse × o que fez × onde está
 * ------------------------------------------------------------------ */

function temasDoTexto(textos) {
  const contagem = {};
  for (const t of textos) {
    const cat = categorizar(t || '');
    if (cat) contagem[cat] = (contagem[cat] || 0) + 1;
  }
  return contagem;
}

function cruzar({ discursos, proposicoes, contexto, promessas }) {
  const falados = temasDoTexto(discursos.map((d) => d.transcricao || d.sumario || ''));
  const legislados = temasDoTexto(proposicoes.map((p) => p.summary || ''));

  // Tema de comissão e de frente conta como atuação declarada no assunto.
  const atuacao = temasDoTexto([
    ...contexto.comissoes.map((c) => c.nome),
    ...contexto.frentes,
  ]);

  const achados = [];

  // 1. Fala muito de um tema e não legisla nele
  for (const [tema, n] of Object.entries(falados)) {
    if (n >= 3 && !legislados[tema]) {
      achados.push({
        tipo: 'tema_silenciado',
        confianca: atuacao[tema] ? 'média' : 'alta',
        descricao: `"${tema}" aparece ${n}x nos discursos e em nenhuma das `
          + `${proposicoes.length} proposições de autoria analisadas`
          + (atuacao[tema] ? ', embora ele atue em comissão/frente do tema' : ''),
        fontes: ['discursos', 'proposições', 'comissões e frentes'],
      });
    }
  }

  // 2. Promessa sobre um tema sem nenhuma proposição no tema
  for (const p of promessas) {
    if (p.category && !legislados[p.category]) {
      achados.push({
        tipo: 'sem_acao_legislativa',
        confianca: 'média',
        descricao: `Promessa sobre "${p.category}" sem proposição de autoria `
          + 'no mesmo tema entre as analisadas',
        fontes: ['discursos', 'proposições'],
      });
    }
  }

  // 3. Legisla num tema em que nunca falou — o inverso, e não é defeito:
  //    registra-se como observação, não como acusação.
  for (const [tema, n] of Object.entries(legislados)) {
    if (n >= 3 && !falados[tema]) {
      achados.push({
        tipo: 'acao_sem_discurso',
        confianca: 'baixa',
        descricao: `${n} proposições sobre "${tema}", tema que não aparece nos `
          + 'discursos analisados do período',
        fontes: ['proposições', 'discursos'],
      });
    }
  }

  return {
    achados,
    temas_falados: falados,
    temas_legislados: legislados,
    temas_atuacao: atuacao,
    cobertura: {
      promessas_analisadas: promessas.length,
      discursos_analisados: discursos.length,
      proposicoes_analisadas: proposicoes.length,
      comissoes: contexto.comissoes.length,
      frentes: contexto.frentes.length,
    },
  };
}

function detectarAnomalias(despesas) {
  if (despesas.length < 5) return [];
  const vals = despesas.map((d) => d.valor).filter((v) => v > 0);
  if (!vals.length) return [];
  const media = vals.reduce((a, b) => a + b, 0) / vals.length;
  const dp = Math.sqrt(vals.reduce((a, v) => a + (v - media) ** 2, 0) / vals.length);
  const limite = media + 2 * dp;
  return despesas.filter((d) => d.valor > limite).slice(0, 5).map((d) =>
    `⚠️ Despesa atípica: R$ ${d.valor.toLocaleString('pt-BR',
      { minimumFractionDigits: 2 })} — ${d.tipo} — ${d.fornecedor}`);
}

/* ------------------------------------------------------------------ *
 * Orquestração
 * ------------------------------------------------------------------ */

export async function analisarAoVivo(deputado, onProgress = () => {}) {
  await carregarRegras();
  const t0 = performance.now();
  const prog = (m) => onProgress(m);
  const id = deputado.id;

  /* O detalhe /deputados/{id} e o UNICO endpoint da API que NAO envia
     Access-Control-Allow-Origin -- medido: a colecao /deputados?nome= envia
     "*", o detalhe nao envia nada. Chamar de dentro do navegador da erro de
     CORS garantido.
     Como o resultado da busca ja traz nome, partido, UF e foto, o detalhe e
     dispensavel. Nao pedimos o que sabemos que sera recusado. */
  const perfil = {
    id,
    name: deputado.nome,
    party: deputado.siglaPartido || null,
    state: deputado.siglaUf || null,
    role: 'Deputado Federal',
    photo: deputado.urlFoto || null,
  };

  prog('coletando discursos, proposições, despesas e vínculos');
  const [discursos, proposicoes, despesas, contexto, nProps, noticias] = await Promise.all([
    coletarDiscursos(id),
    coletarProposicoes(id),
    coletarDespesas(id),
    coletarContexto(id),
    contarProposicoes(id),
    coletarNoticiasPublicas(perfil.name),
  ]);

  prog('conferindo presença sessão a sessão');
  const presenca = await coletarPresenca(id, prog);

  prog('extraindo promessas dos discursos');
  const textoDiscursos = discursos
    .map((d) => d.transcricao || d.sumario || '').join('\n');
  const { promessas, descartes } = extrairPromessas(textoDiscursos);

  /* O orçamento estadual só serve para aferir viabilidade DE PROMESSA. Sem
     promessa detectada, ninguém consome esse dado -- e ele custa uma resposta
     de centenas de KB. Buscar assim mesmo seria gastar a paciência de quem
     está esperando por um número que não vai aparecer. */
  let orcamento = null;
  if (promessas.length) {
    prog('consultando orçamento estadual no SICONFI');
    orcamento = await coletarOrcamento(perfil.state);
  }

  prog('cruzando discurso, ação registrada e vínculos');
  const cross = cruzar({ discursos, proposicoes, contexto, promessas });
  const anomalias = detectarAnomalias(despesas);

  const evidencias = [
    ...despesas.slice(0, 10).map((d) => ({
      source: 'Cota Parlamentar', type: 'despesa',
      content: `R$ ${(d.valor || 0).toLocaleString('pt-BR',
        { minimumFractionDigits: 2 })} — ${d.tipo} — ${d.fornecedor}`,
    })),
    ...proposicoes.map((p) => ({
      source: 'Proposição', type: 'projeto',
      content: `${p.type} ${p.number}/${p.year}: ${(p.summary || '').slice(0, 180)}`,
    })),
    ...discursos.slice(0, 10).map((d) => ({
      source: 'Discurso', type: 'discurso',
      content: `${(d.data || '').slice(0, 10)} — ${(d.sumario || '').slice(0, 180)}`,
    })),
    ...contexto.comissoes.map((c) => ({
      source: 'Comissão', type: 'vinculo',
      content: `${c.titulo} — ${c.nome}`,
    })),
    ...contexto.frentes.slice(0, 10).map((f) => ({
      source: 'Frente parlamentar', type: 'vinculo', content: f,
    })),
    ...noticias.map((n) => ({
      source: n.fonte, type: 'noticia_publica',
      content: `${n.title}${n.pubDate ? ' — ' + n.pubDate : ''}`,
      url: n.link,
    })),
  ];

  return {
    politician: perfil,
    // Sem promessa não há score: não houve o que avaliar. Nunca 0, que seria
    // lido como "avaliado e reprovado".
    score: null,
    label: promessas.length ? null : 'Sem promessas detectadas',
    promises: promessas,
    discarded: descartes,
    evidence: evidencias,
    viability: [],
    inconsistencies: anomalias,
    cross_reference: cross,
    contexto,
    noticias_publicas: noticias,
    record: {
      attendance_rate: presenca.rate,
      sessions_checked: presenca.sessions_total,
      // Contagem EXATA de autoria (via link de paginação) e quantas foram
      // efetivamente lidas. São números diferentes e nomeá-los igual faria o
      // painel comparar coisas distintas entre si.
      propositions_total: nProps || proposicoes.length,
      propositions_analyzed: proposicoes.length,
      // null, não 0: a situação de tramitação não foi conferida nesta análise
      // (custa 1 requisição por proposição). "0 decididas" afirmaria uma
      // apuração que não houve.
      propositions_decided: null,
      propositions_approved: null,
      total_votes: null,
      inconsistencies: anomalias.length,
    },
    orcamento,
    ao_vivo: true,
    duration_s: Math.round((performance.now() - t0) / 100) / 10,
    coletado_em: new Date().toISOString(),
  };
}
