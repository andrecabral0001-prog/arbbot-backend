# 🤖 ArbBot — Guia Completo Render.com + Lovable

## 📁 Arquivos
```
render-arbbot/
├── main.py          ← Backend Python (sobe no Render)
├── requirements.txt ← Dependências Python
├── render.yaml      ← Configuração Render
├── ArbBot.jsx       ← Componente React para o Lovable
└── README.md
```

---

## PARTE 1 — Deploy no Render.com

### Passo 1 — Criar conta
Acesse https://render.com → "Get Started for Free" (pode entrar com GitHub)

### Passo 2 — Subir arquivos no GitHub
1. Acesse https://github.com e crie um repositório (ex: arbbot-backend)
2. Clique em "Add file" → "Upload files"
3. Faça upload de: main.py, requirements.txt, render.yaml

### Passo 3 — Criar serviço no Render
1. No Render → "New +" → "Web Service"
2. Conecte o repositório arbbot-backend
3. Preencha:
   - Name: arbbot
   - Runtime: Python 3
   - Build Command: pip install -r requirements.txt
   - Start Command: uvicorn main:app --host 0.0.0.0 --port $PORT
   - Instance Type: Free
4. Clique em "Create Web Service"

### Passo 4 — Pegar a URL
Quando aparecer "Live" em verde, copie a URL:
Ex: https://arbbot.onrender.com
Guarde essa URL!

---

## PARTE 2 — Frontend no Lovable

### Passo 1 — Criar projeto em lovable.dev

### Passo 2 — Colar ArbBot.jsx como componente principal

### Passo 3 — Trocar a URL (linha 3 do ArbBot.jsx)
DE: const RAILWAY_WS_URL = "wss://SEU-PROJETO.up.railway.app/ws";
PARA: const RAILWAY_WS_URL = "wss://arbbot.onrender.com/ws";

⚠️ Use sempre wss:// e adicione /ws no final!

### Passo 4 — Publicar ✅

---

## ⚠️ Aviso Render gratuito
O plano free "dorme" após 15min sem uso.
Na primeira abertura pode demorar 30-60s para acordar.
Após isso, funciona em tempo real normalmente.

---

## 📊 Cálculos

Entrada: (Fut BID - Spot ASK) / Spot ASK × 100  → ENTRAR quando > 0.05%
Saída:   (Spot BID - Fut ASK) / Fut ASK × 100   → SAIR quando > 0.02%
