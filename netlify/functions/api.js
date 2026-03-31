exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const prompt = body.prompt;

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        tools: [
          { googleSearch: {} }
        ],
        generationConfig: {
            temperature: 0.1,
        }
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error?.message || "Erro na API do Gemini");
    }

    const text = data.candidates[0].content.parts[0].text;

    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
