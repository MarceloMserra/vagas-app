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

// ── BUSCAR: scraping direto do Vagas.com.br ───────────────────────────────────

async function buscarVagas({ tipo, area, kw }) {
  // Paths do vagas.com.br mapeados por tipo e area
  // Cada path retorna vagas individuais com links reais
  const paths = buildPaths(tipo, area, kw);

  const results = await Promise.allSettled(
    paths.map(p => scrapeVagasCom(p))
  );

  const all = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Deduplica por link
  const seen = new Set();
  const vagas = all.filter(v => {
    if (!v.link || seen.has(v.link)) return false;
    seen.add(v.link);
    return true;
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vagas: vagas.slice(0, 40) }),
  };
}

function buildPaths(tipo, area, kw) {
  // Paths base por area — sempre incluidos
  const basePaths = {
    geral:           ["/vagas-de-gestao-publica-em-brasilia", "/vagas-de-assistente-administrativo-em-brasilia", "/vagas-de-analista-administrativo-em-brasilia"],
    politicas:       ["/vagas-de-gestao-publica-em-brasilia", "/vagas-de-analista-de-politicas-publicas-em-brasilia"],
    orcamento:       ["/vagas-de-analista-de-orcamento-em-brasilia", "/vagas-de-financas-em-brasilia"],
    "gestao-pessoas":["/vagas-de-recursos-humanos-em-brasilia", "/vagas-de-gestao-de-pessoas-em-brasilia"],
    controle:        ["/vagas-de-auditoria-em-brasilia", "/vagas-de-controle-interno-em-brasilia"],
    licitacoes:      ["/vagas-de-licitacao-em-brasilia", "/vagas-de-compras-em-brasilia"],
    transparencia:   ["/vagas-de-analista-de-dados-em-brasilia", "/vagas-de-gestao-publica-em-brasilia"],
  }[area] || ["/vagas-de-gestao-publica-em-brasilia", "/vagas-de-assistente-administrativo-em-brasilia", "/vagas-de-analista-administrativo-em-brasilia"];

  // Adiciona paths por tipo
  const tipoPaths = {
    estagio:  ["/vagas-de-estagio-em-brasilia", "/vagas-de-estagio-em-administracao-em-brasilia"],
    concurso: ["/vagas-de-concurso-publico-em-brasilia"],
    clt:      ["/vagas-de-analista-administrativo-em-brasilia", "/vagas-de-assistente-administrativo-em-brasilia"],
    pj:       ["/vagas-de-consultoria-em-brasilia"],
    ong:      ["/vagas-de-ong-em-brasilia", "/vagas-de-terceiro-setor-em-brasilia"],
    todas:    [],
  }[tipo] || [];

  // Se tem keyword, adiciona busca especifica
  const kwPath = kw ? [`/vagas-de-${kw.toLowerCase().replace(/\s+/g, "-")}-em-brasilia`] : [];

  return [...new Set([...basePaths, ...tipoPaths, ...kwPath])];
}

async function scrapeVagasCom(path) {
  const url = "https://www.vagas.com.br" + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    return parseVagasCom(html);
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseVagasCom(html) {
  const vagas = [];

  // Estrutura: <a class="link-detalhes-vaga" title="CARGO" href="/vagas/vID/slug">
  //            <span class="emprVaga">EMPRESA</span>
  //            <span class="localidade">LOCAL</span>
  const pattern = /class="link-detalhes-vaga"[^>]*title="([^"]+)"[^>]*href="(\/vagas\/[^"]+)"[\s\S]*?<span class="emprVaga">\s*([^<]+)[\s\S]*?<span class="localidade">\s*([^<]*)/g;

  let m;
  while ((m = pattern.exec(html)) !== null) {
    const cargo   = m[1].trim();
    const link    = "https://www.vagas.com.br" + m[2];
    const empresa = m[3].trim();
    const local   = m[4].trim() || "Brasília/DF";

    if (!cargo || !link) continue;

    // Detecta tipo pelo cargo
    const tipo = detectTipo(cargo);

    vagas.push({
      cargo,
      empresa,
      tipo,
      local: local || "Brasília/DF",
      salario: "Ver no site",
      requisitos: [],
      descricao: `Vaga em ${empresa}. Clique em "Acessar Vaga" para ver requisitos completos e se candidatar diretamente.`,
      link,
      prazo: "Aberto",
    });

    if (vagas.length >= 15) break;
  }
  return vagas;
}

function detectTipo(cargo) {
  const t = cargo.toLowerCase();
  if (t.includes("estagi") || t.includes("trainee") || t.includes("aprendiz")) return "estagio";
  if (t.includes("concurso") || t.includes("edital")) return "concurso";
  if (t.includes("consultor") || t.includes("pj")) return "pj";
  return "clt";
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
    if (err.name === "AbortError") throw new Error("Analise demorou mais que o esperado. Tente novamente.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
