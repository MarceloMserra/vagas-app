exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const prompt = body.prompt;

    if (!prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: "Prompt is required" }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "GEMINI_API_KEY nao configurada no servidor" }) };
    }

    // Tenta modelos em ordem — se um estiver sobrecarregado, usa o proximo
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let data, lastError;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1 }
        })
      });

      data = await response.json();

      if (response.ok) break; // sucesso, sai do loop

      lastError = data.error?.message || "Erro na API do Gemini";
      const isOverloaded = lastError.includes("high demand") || lastError.includes("overloaded") || response.status === 503;
      if (!isOverloaded) throw new Error(lastError); // erro diferente, nao tenta outro modelo
      // se sobrecarregado, tenta o proximo modelo
    }

    if (!data?.candidates) throw new Error(lastError || "Todos os modelos estao indisponiveis. Tente novamente em instantes.");

    // Concatena todos os parts (Gemini pode dividir o texto em multiplos parts)
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('');

    if (!text) {
      throw new Error("A API retornou resposta sem texto");
    }

    // Extrai URLs das fontes do Google Search (groundingMetadata)
    const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .map(c => c.web)
      .filter(Boolean);

    return {
      statusCode: 200,
      body: JSON.stringify({ text, sources })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
