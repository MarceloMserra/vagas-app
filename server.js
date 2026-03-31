const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve arquivos estaticos do proprio diretorio
app.use(express.static(path.join(__dirname)));

// Endpoint do proxy para a API do Gemini
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    console.log("Iniciando requisicao ao Gemini...");

    // Removemos qualquer limite de tempo artificial (o padrao do fetch do node eh sem limite de timeout)
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
        console.error("Erro da API Gemini:", data);
        throw new Error(data.error?.message || "Erro interno na API do Gemini");
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
        throw new Error("A API retornou um formato inesperado sem texto");
    }

    console.log("Requisicao concluida com sucesso!");
    res.json({ text });
  } catch (error) {
    console.error("Erro na rota /api/chat:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
