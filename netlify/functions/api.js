exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const body = JSON.parse(event.body);
    if (body.type === "buscar")   return await buscarVagas(body);
    if (body.type === "analisar") return await analisarMatch(body);
    return { statusCode: 400, body: JSON.stringify({ error: "Tipo invalido." }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── BUSCAR ────────────────────────────────────────────────────────────────────

async function buscarVagas({ tipo, area, kw }) {
  const extra = kw ? `"${kw}"` : "";
  const tipoExtra = {
    concurso: 'concurso edital inscricoes abertas',
    clt:      'vaga emprego contratacao CLT',
    pj:       'vaga PJ consultoria',
    estagio:  'estagio oportunidade',
    ong:      'ONG "terceiro setor"',
  }[tipo] || 'vaga emprego oportunidade';

  const areaExtra = {
    politicas:       '"politicas publicas"',
    orcamento:       '"orcamento" OR "financas publicas"',
    'gestao-pessoas':'"gestao de pessoas" OR "RH publico"',
    controle:        '"controle interno" OR "auditoria"',
    licitacoes:      '"licitacao" OR "contratos administrativos"',
    transparencia:   '"transparencia" OR "dados abertos"',
  }[area] || '"gestao publica" OR "administracao publica" OR "apoio administrativo"';

  // 10 queries paralelas — cada uma com angulo diferente para maximizar resultados
  const queries = [
    // Vagas de estagio (perfil cursando)
    `estagio ${areaExtra} "Brasilia" OR "DF" OR "Distrito Federal" 2025 ${extra} -curso -graduacao -pos-graduacao`,
    // Assistente/analista em orgaos publicos
    `"assistente administrativo" OR "analista administrativo" ${areaExtra} Brasilia DF emprego 2025 ${extra}`,
    // Apoio a gestao em governo/secretarias
    `"apoio administrativo" OR "assistente de gestao" governo brasilia DF vaga 2025 ${extra}`,
    // Orgaos federais (compativel com exp Policia Federal)
    `vaga ${tipoExtra} "orgao federal" OR "governo federal" OR "secretaria" brasilia 2025 ${extra}`,
    // SEI — habilidade especifica da candidata
    `vaga emprego "SEI" "sistema eletronico" administracao brasilia DF 2025 ${extra}`,
    // Concursos na area
    `concurso publico ${areaExtra} Brasilia DF edital 2025 ${extra} -curso -graduacao`,
    // Catho — plataforma brasileira popular
    `site:catho.com.br ${areaExtra} brasilia ${tipoExtra} ${extra}`,
    // Vagas.com
    `site:vagas.com.br ${areaExtra} brasilia ${extra}`,
    // Gupy — usado por orgaos e empresas
    `site:gupy.io ${areaExtra} brasilia ${extra}`,
    // InfoJobs
    `site:infojobs.com.br ${areaExtra} brasilia ${extra}`,
  ];

  const settled = await Promise.allSettled(queries.map(q => searchDDG(q)));
  const all = settled
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Deduplica por URL e remove cursos
  const seen = new Set();
  const vagas = all.filter(v => {
    if (!v.link || !v.cargo) return false;
    if (seen.has(v.link)) return false;
    seen.add(v.link);
    return isJobPosting(v.link, v.cargo);
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vagas: vagas.slice(0, 35) }),
  };
}

// ── Verifica se o resultado e uma vaga de emprego (nao curso/faculdade) ───────
function isJobPosting(url, title) {
  const lower = (url + " " + title).toLowerCase();
  const courseTerms = [
    "pos-graduacao", "pos_graduacao", "posgraduacao",
    "graduacao", "/curso", "curso-de", "formacao",
    "matricula", "ifb.edu", "unb.br", ".edu.br",
    "faculdade", "universidade", "inscricao-curso",
    "especializacao", "mba", "certificacao-em",
    "vagas-para-pos", "vagas para pos", "45 vagas para",
    "bolsa de estudos",
  ];
  return !courseTerms.some(t => lower.includes(t));
}

// ── Busca no DuckDuckGo HTML ──────────────────────────────────────────────────
async function searchDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!resp.ok) return [];
    return parseDDG(await resp.text());
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseDDG(html) {
  const urls  = [...html.matchAll(/uddg=(https?[^&"]+)/g)]
    .map(m => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } });
  const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const snips  = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, "").trim());

  // Dominios de anuncios a ignorar
  const adSkip = ["amazon.", "estacio.", "doubleclick.", "/aclick", "kroton.", "anhanguera."];
  const vagas = [];

  for (let i = 0; i < Math.min(urls.length, titles.length, 15); i++) {
    const link  = urls[i]   || "";
    const cargo = titles[i] || "";
    const desc  = snips[i]  || "";

    if (!link || cargo.length < 5) continue;
    if (adSkip.some(s => link.includes(s))) continue;

    vagas.push({
      cargo,
      empresa: detectSource(link),
      tipo:    detectTipo(cargo + " " + desc),
      local:   "Brasilia/DF",
      salario: "Ver no site",
      requisitos: extractReqs(desc),
      descricao: desc || "Clique em Acessar Vaga para ver os detalhes e se candidatar.",
      link,
      prazo: "Aberto",
    });
  }
  return vagas;
}

function detectSource(url) {
  const m = {
    linkedin: "LinkedIn", indeed: "Indeed", catho: "Catho",
    "vagas.com": "Vagas.com", infojobs: "InfoJobs", glassdoor: "Glassdoor",
    jooble: "Jooble", "bne.com": "BNE", careerjet: "CareerJet",
    trampos: "Trampos", gupy: "Gupy", sine: "SINE",
    empregos: "Empregos.com.br", "gov.br": "Gov.br",
  };
  for (const [k, v] of Object.entries(m)) if (url.includes(k)) return v;
  try { return new URL(url).hostname.replace(/^www\.|^br\./, ""); } catch { return "Site de vagas"; }
}

function detectTipo(text) {
  const t = text.toLowerCase();
  if (t.includes("concurso") || t.includes("edital")) return "concurso";
  if (t.includes("estagi") || t.includes("trainee")) return "estagio";
  if (t.includes(" pj ") || t.includes("pessoa jur")) return "pj";
  return "clt";
}

function extractReqs(text) {
  const kws = ["excel", "word", "sei", "pacote office", "licitacao", "gestao",
    "administracao", "contabilidade", "orcamento", "auditoria", "ingles",
    "espanhol", "ensino superior", "nivel medio", "cnh", "experiencia"];
  return kws.filter(k => text.toLowerCase().includes(k)).slice(0, 4);
}

// ── ANALISAR: Ollama compara CV com vagas ─────────────────────────────────────

async function analisarMatch({ prompt }) {
  if (!prompt) return { statusCode: 400, body: JSON.stringify({ error: "Prompt obrigatorio." }) };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch("https://ollama.cpisf.com.br/api/generate", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1:8b",
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 500 },
      }),
    });
    if (!resp.ok) throw new Error(`Ollama retornou ${resp.status}`);
    const data = await resp.json();
    const text = data.response || "";
    if (!text) throw new Error("Ollama retornou resposta vazia");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("A analise demorou mais que o esperado. Tente novamente — o modelo pode estar carregando.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
