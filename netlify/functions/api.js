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

// ── BUSCAR: busca em paralelo em 6 plataformas via DuckDuckGo site: ──────────

async function buscarVagas({ tipo, area, kw }) {
  const base = buildTerms(tipo, area, kw);

  // Cada busca usa site: especifico para retornar vagas INDIVIDUAIS (nao paginas de busca)
  const queries = [
    `site:catho.com.br/vagas ${base} brasilia`,
    `site:vagas.com.br/vagas ${base} brasilia`,
    `site:infojobs.com.br ${base} brasilia`,
    `site:gupy.io ${base} brasilia`,
    `site:br.indeed.com/ver-vaga ${base} brasilia`,
    `site:bne.com.br/vaga ${base} brasilia`,
    `site:empregos.com.br ${base} brasilia`,
    `${base} vaga emprego brasilia DF 2025 -site:amazon -site:estacio`,
  ];

  // Busca todas em paralelo (DuckDuckGo aguenta bem)
  const results = await Promise.allSettled(queries.map(q => searchDDG(q)));

  // Junta todos os resultados
  const all = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Deduplica por URL
  const seen = new Set();
  const unique = all.filter(v => {
    if (!v.link || seen.has(v.link)) return false;
    seen.add(v.link);
    return true;
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vagas: unique.slice(0, 30) }),
  };
}

function buildTerms(tipo, area, kw) {
  const tipoMap = {
    concurso: "concurso publico edital",
    clt: "emprego CLT contratacao",
    pj: "vaga PJ consultoria",
    estagio: "estagio trainee",
    ong: "ONG terceiro setor",
  };
  const areaMap = {
    politicas: "politicas publicas",
    orcamento: "orcamento financas publicas",
    "gestao-pessoas": "gestao pessoas RH publico",
    controle: "controle auditoria",
    licitacoes: "licitacoes contratos",
    transparencia: "transparencia dados abertos",
  };
  const parts = [];
  if (tipo && tipo !== "todas") parts.push(tipoMap[tipo] || tipo);
  parts.push(areaMap[area] || "gestao publica administracao");
  if (kw) parts.push(kw);
  return parts.join(" ");
}

async function searchDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
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
    const html = await resp.text();
    return parseDDG(html);
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseDDG(html) {
  // Extrai URLs reais do parametro uddg (URLs codificadas nos links do DDG)
  const urlMatches   = [...html.matchAll(/uddg=(https?[^&"]+)/g)];
  const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)];
  const snipMatches  = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

  const urls     = urlMatches.map(m => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } });
  const titles   = titleMatches.map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const snippets = snipMatches.map(m => m[1].replace(/<[^>]+>/g, "").trim());

  const skip = ["amazon.", "estacio.", "doubleclick.", "bing.com/aclick", "google.com/aclk"];
  const vagas = [];

  for (let i = 0; i < Math.min(urls.length, titles.length, 12); i++) {
    const link  = urls[i] || "";
    const cargo = titles[i] || "";
    const desc  = snippets[i] || "";

    if (!link || !cargo || cargo.length < 5) continue;
    if (skip.some(s => link.includes(s))) continue;

    vagas.push({
      cargo,
      empresa: detectSource(link),
      tipo: detectTipo(cargo + " " + desc),
      local: "Brasilia/DF",
      salario: "Ver no site",
      requisitos: extractRequisitos(desc),
      descricao: desc || "Clique em Acessar Vaga para ver os detalhes.",
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

function extractRequisitos(text) {
  // Tenta extrair palavras-chave tecnicas do snippet como requisitos
  const keywords = ["excel", "word", "sei", "pacote office", "licitacao", "gestao", "administracao",
    "contabilidade", "orcamento", "auditoria", "ingles", "espanhol", "ensino superior",
    "nivel medio", "nivel superior", "experiencia", "cnh"];
  const found = keywords.filter(k => text.toLowerCase().includes(k));
  return found.slice(0, 4);
}

// ── ANALISAR: Ollama compara CV com vagas e aponta compatibilidade ────────────

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
      throw new Error("Analise demorou mais que o esperado. Tente novamente — o modelo pode estar carregando.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
