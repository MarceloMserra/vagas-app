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
  const tipoTermo = {
    concurso: "concurso publico edital",
    clt:      "vaga emprego CLT",
    pj:       "vaga PJ consultoria",
    estagio:  "estagio",
    ong:      "ONG voluntario",
  }[tipo] || "vaga emprego estagio";

  const areaTermo = {
    politicas:        "politicas publicas",
    orcamento:        "orcamento financas publicas",
    "gestao-pessoas": "gestao pessoas RH",
    controle:         "auditoria controle",
    licitacoes:       "licitacao contratos",
    transparencia:    "transparencia dados",
  }[area] || "gestao publica administracao publica";

  const kwTermo = kw || "";

  // 3 queries focadas — rapidas e dentro do timeout do Netlify
  const queries = [
    `${tipoTermo} "${areaTermo}" "Brasilia" OR "Distrito Federal" 2025 ${kwTermo}`,
    `estagio assistente analista administracao publica brasilia DF site:catho.com.br OR site:vagas.com.br OR site:gupy.io`,
    `${areaTermo} brasilia DF vaga emprego 2025 ${kwTermo} site:linkedin.com OR site:indeed.com OR site:infojobs.com.br`,
  ];

  // Log para debug
  console.log("Queries:", JSON.stringify(queries));

  const results = await Promise.allSettled(
    queries.map(q => searchDDG(q))
  );

  const debug = results.map((r, i) => ({
    query: queries[i].substring(0, 60),
    ok: r.status === "fulfilled",
    count: r.status === "fulfilled" ? r.value.length : 0,
    error: r.status === "rejected" ? r.reason?.message : undefined,
  }));
  console.log("Debug:", JSON.stringify(debug));

  const all = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  const seen = new Set();
  const vagas = all.filter(v => {
    if (!v.link || !v.cargo || seen.has(v.link)) return false;
    seen.add(v.link);
    return !isCurso(v.link, v.cargo);
  });

  console.log("Total vagas antes dedup:", all.length, "Apos filtro:", vagas.length);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vagas: vagas.slice(0, 30), debug }),
  };
}

function isCurso(url, title) {
  const lower = url.toLowerCase();
  const titleLow = title.toLowerCase();
  // So bloqueia padroes muito especificos de cursos/faculdades nas URLs
  const urlPatterns = [
    "ifb.edu", "unb.br", ".edu.br", "/pos-graduacao", "/posgraduacao",
    "/curso-de", "/graduacao/", "faculdade", "universidade",
  ];
  const titlePatterns = [
    "pós-graduação", "pos-graduacao", "mba em ", "curso de ",
    "formação em ", "bolsa de estudo",
  ];
  return urlPatterns.some(p => lower.includes(p)) ||
         titlePatterns.some(p => titleLow.includes(p));
}

// ── DuckDuckGo HTML search ────────────────────────────────────────────────────

async function searchDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!resp.ok) {
      console.log("DDG status:", resp.status, "para query:", query.substring(0, 50));
      return [];
    }
    const html = await resp.text();
    console.log("DDG html size:", html.length, "web-result:", html.includes("web-result"));
    return parseDDG(html);
  } catch (e) {
    console.log("DDG erro:", e.message, "query:", query.substring(0, 50));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseDDG(html) {
  const vagas = [];
  // Divide em blocos por resultado organico (web-result) — exclui ads automaticamente
  const blocks = html.split('class="result results_links');

  for (const block of blocks) {
    if (!block.includes("web-result")) continue;

    const hrefM = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    if (!hrefM) continue;
    const uddgM = hrefM[1].match(/uddg=([^&"]+)/);
    if (!uddgM) continue;

    let url;
    try { url = decodeURIComponent(decodeURIComponent(uddgM[1])); }
    catch { try { url = decodeURIComponent(uddgM[1]); } catch { url = uddgM[1]; } }
    if (!url || url.includes("duckduckgo.com")) continue;

    const titleM = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const cargo  = titleM ? titleM[1].replace(/<[^>]+>/g, "").trim() : "";
    if (!cargo || cargo.length < 5) continue;

    const snipM = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const desc  = snipM ? snipM[1].replace(/<[^>]+>/g, "").trim() : "";

    vagas.push({
      cargo,
      empresa: detectSource(url),
      tipo:    detectTipo(cargo + " " + desc),
      local:   "Brasilia/DF",
      salario: "Ver no site",
      requisitos: extractReqs(desc),
      descricao: desc || "Clique em Acessar Vaga para ver os detalhes.",
      link: url,
      prazo: "Aberto",
    });

    if (vagas.length >= 12) break;
  }
  return vagas;
}

function detectSource(url) {
  const map = {
    linkedin: "LinkedIn", indeed: "Indeed", catho: "Catho",
    "vagas.com": "Vagas.com", infojobs: "InfoJobs", glassdoor: "Glassdoor",
    jooble: "Jooble", "bne.com": "BNE", careerjet: "CareerJet",
    trampos: "Trampos", gupy: "Gupy", sine: "SINE",
    empregos: "Empregos.com.br", "gov.br": "Gov.br",
    ciee: "CIEE", talentin: "Talentin", talentbrand: "TalentBrand",
    folhadeemprego: "Folha de Emprego", estagiosbrasiliadf: "Estágios Brasília",
  };
  for (const [k, v] of Object.entries(map)) if (url.includes(k)) return v;
  try { return new URL(url).hostname.replace(/^www\.|^br\./, ""); }
  catch { return "Site de vagas"; }
}

function detectTipo(text) {
  const t = text.toLowerCase();
  if (t.includes("concurso") || t.includes("edital")) return "concurso";
  if (t.includes("estagi") || t.includes("trainee")) return "estagio";
  if (t.includes(" pj ") || t.includes("pessoa jur")) return "pj";
  return "clt";
}

function extractReqs(text) {
  const kws = ["excel", "word", "sei", "pacote office", "licitacao",
    "administracao", "contabilidade", "ingles", "espanhol",
    "ensino superior", "nivel medio", "experiencia"];
  return kws.filter(k => text.toLowerCase().includes(k)).slice(0, 4);
}

// ── ANALISAR: Ollama ──────────────────────────────────────────────────────────

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
      throw new Error("Analise demorou mais que o esperado. Tente novamente.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
