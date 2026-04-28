exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { type, query, prompt } = body;

    if (type === "buscar") {
      return await buscarVagas(query);
    } else if (type === "analisar") {
      return await analisarMatch(prompt);
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Tipo invalido. Use 'buscar' ou 'analisar'." }) };
    }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// ── BUSCAR: DuckDuckGo → parse → retorna vagas ──────────────────────────────

async function buscarVagas(query) {
  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: "Query e obrigatoria." }) };
  }

  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;

  const resp = await fetch(ddgUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9"
    }
  });

  if (!resp.ok) {
    throw new Error(`DuckDuckGo retornou ${resp.status}`);
  }

  const html = await resp.text();
  const vagas = parseDDGResults(html);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vagas })
  };
}

function parseDDGResults(html) {
  // Extrai URLs reais do parametro uddg
  const urlMatches = [...html.matchAll(/uddg=(https?[^&"]+)/g)];
  const urls = urlMatches.map(m => {
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  });

  // Extrai titulos dos links de resultado
  const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)];
  const titles = titleMatches.map(m => m[1].replace(/<[^>]+>/g, '').trim());

  // Extrai snippets/descricoes
  const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = snippetMatches.map(m => m[1].replace(/<[^>]+>/g, '').trim());

  const adDomains = ['amazon', 'estacio', 'doubleclick', 'bing.com/aclick', 'ads.'];
  const vagas = [];

  for (let i = 0; i < Math.min(urls.length, titles.length, 15); i++) {
    const url = urls[i] || '';
    const title = titles[i] || '';
    const snippet = snippets[i] || '';

    if (!url || !title || title.length < 5) continue;
    if (adDomains.some(d => url.includes(d))) continue;

    vagas.push({
      cargo: title,
      empresa: detectSource(url),
      tipo: detectTipo(title + ' ' + snippet),
      local: 'Brasilia/DF',
      salario: 'Ver no site',
      requisitos: [],
      descricao: snippet || 'Clique em "Acessar Vaga" para ver os detalhes e se candidatar.',
      link: url,
      prazo: 'Aberto'
    });

    if (vagas.length >= 10) break;
  }

  return vagas;
}

function detectSource(url) {
  const map = {
    'linkedin': 'LinkedIn', 'indeed': 'Indeed', 'catho': 'Catho',
    'vagas.com': 'Vagas.com', 'infojobs': 'InfoJobs', 'glassdoor': 'Glassdoor',
    'jooble': 'Jooble', 'bne.com': 'BNE', 'careerjet': 'CareerJet',
    'trampos': 'Trampos', 'gupy': 'Gupy', 'sine': 'SINE',
    'empregos': 'Empregos.com.br', 'gov.br': 'Gov.br', 'trabalha': 'Trabalha Brasil'
  };
  for (const [key, name] of Object.entries(map)) {
    if (url.includes(key)) return name;
  }
  try { return new URL(url).hostname.replace('www.', '').replace('br.', ''); } catch (e) { return 'Site de vagas'; }
}

function detectTipo(text) {
  const lower = text.toLowerCase();
  if (lower.includes('concurso') || lower.includes('edital')) return 'concurso';
  if (lower.includes('estagio') || lower.includes('trainee')) return 'estagio';
  if (lower.includes(' pj ') || lower.includes('pessoa juridica')) return 'pj';
  return 'clt';
}

// ── ANALISAR: Ollama ─────────────────────────────────────────────────────────

async function analisarMatch(prompt) {
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: "Prompt e obrigatorio." }) };
  }

  const resp = await fetch('https://ollama.cpisf.com.br/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.1:8b',
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: 600 }
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Ollama retornou ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const text = data.response || '';

  if (!text) throw new Error('Ollama retornou resposta vazia');

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  };
}
