# 🏛️ VagasGP — Gestão Pública Brasília

App PWA para busca inteligente de vagas de Gestão Pública em Brasília/DF com análise de currículo por IA.

---

## 📁 Arquivos do projeto

```
vagas-app/
├── index.html       ← App principal (tudo aqui)
├── manifest.json    ← Configuração PWA
├── sw.js            ← Service Worker (funciona offline)
├── icons/           ← Ícones do app (criar antes de publicar)
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## 🚀 Como hospedar (grátis)

### Opção 1 — Netlify (MAIS FÁCIL, recomendado)
1. Acesse https://netlify.com e crie conta grátis
2. Clique em **"Add new site" → "Deploy manually"**
3. Arraste a pasta `vagas-app` para a área indicada
4. Pronto! Você receberá um link como `https://nome-aleatorio.netlify.app`
5. Pode personalizar o domínio em "Site settings"

### Opção 2 — GitHub Pages
1. Crie conta em https://github.com
2. Crie repositório novo (público)
3. Faça upload dos arquivos
4. Vá em Settings → Pages → Branch: main
5. Link: `https://seuusuario.github.io/nome-repo`

### Opção 3 — Vercel
1. Acesse https://vercel.com
2. Importe o repositório GitHub ou arraste a pasta
3. Deploy automático com link personalizado

---

## 📱 Como virar PWA no celular

Após hospedar e acessar o link no celular:
- **Android (Chrome):** Menu (3 pontos) → "Adicionar à tela inicial"
- **iPhone (Safari):** Botão compartilhar → "Adicionar à Tela de Início"

O app vai aparecer como ícone na tela, igual a um app normal!

---

## 🔑 Chave da API (IMPORTANTE)

O app usa a API da Anthropic (Claude) para buscar vagas e analisar currículos.

Para funcionar em produção, você precisa adicionar sua chave de API.

### Como adicionar:
1. Crie conta em https://console.anthropic.com
2. Gere uma API Key
3. No `index.html`, substitua no JavaScript:
   ```javascript
   // Adicione um backend simples ou use um proxy
   ```

**⚠️ NUNCA coloque a chave diretamente no HTML** (qualquer pessoa pode ver).

### Solução recomendada (backend simples):
Use o **Netlify Functions** ou **Vercel Edge Functions** para criar um endpoint seguro:

```javascript
// netlify/functions/api.js
exports.handler = async (event) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: event.body
  });
  const data = await response.json();
  return { statusCode: 200, body: JSON.stringify(data) };
};
```

E configure a variável de ambiente `ANTHROPIC_API_KEY` no painel do Netlify.

---

## ✨ Funcionalidades

- 🔍 Busca de vagas por tipo (concurso, CLT, PJ, estágio, ONG)
- 🗂️ Filtros por área (políticas públicas, orçamento, RH público, etc.)
- 📄 Salva currículo localmente (não vai para servidor)
- ✨ Análise de compatibilidade currículo × vagas por IA
- 📱 PWA — funciona como app no celular
- 🌐 Funciona offline após primeiro acesso

---

## 💬 Suporte

Desenvolvido com Claude (Anthropic) — VagasGP v1.0
