# HospCheck — colocar em produção

Aplicação Node 22 + SQLite (arquivo) + anexos em disco. **Não roda em hospedagem serverless**
(Cloudflare Workers, Vercel Functions, etc.): precisa de processo Node contínuo e disco persistente.

## 1. O que mudou para produção

- **Sem demonstração por padrão.** Os dados fictícios (Hospital São Lucas, usuários `@demo.hospcheck.local`)
  só são criados com `HC_SEED_DEMO=1`. Sem essa variável, o servidor provisiona apenas o **acesso master**.
- **Logins de exemplo removidos da tela.** O login aceita usuário ou e-mail; não há mais botões
  de credenciais de demonstração nem tarja "dados de demonstração" quando o hospital não é demo.
- **Acesso master** (`romario` / `romario` por padrão, configurável por env) com **troca de senha
  obrigatória no primeiro acesso**. Enquanto a senha provisória não for trocada, o servidor
  bloqueia toda a API (`403 SENHA_TROCA_OBRIGATORIA`), não só a interface.
- **Troca de senha pelo próprio usuário** em `Mais → Trocar minha senha` (mín. 8 caracteres,
  encerra as outras sessões daquele usuário).
- **Administrador redefine senha** em `Configurações → Usuários → Redefinir senha`. A senha
  definida é provisória: o usuário é obrigado a trocá-la no acesso seguinte.
- Cookie de sessão com `Secure` automático em HTTPS (ou `HOSPCHECK_FORCAR_HTTPS=1`).
- `GET /api/health` para monitoramento/hospedagem (sem dados sensíveis).

## 2. Subir direto no servidor (systemd)

```bash
# requisitos: Node >= 22.5 (usa node:sqlite)
npm ci
npm run build

# variáveis (ajuste os valores)
export NODE_ENV=production
export PORT=3100
export TZ=America/Sao_Paulo
export HOSPCHECK_DB=/var/lib/hospcheck/hospcheck.db
export HOSPCHECK_FORCAR_HTTPS=1
export HC_HOSPITAL_NOME="Hospital São Lucas"
export HC_MASTER_USUARIO=romario
export HC_MASTER_SENHA=romario          # troque no primeiro acesso pela tela
export HC_MASTER_NOME="Romário (master)"

node server/index.js
```

O diretório de `HOSPCHECK_DB` também guarda `uploads/` (fotos, NF, laudos). **Faça backup do
diretório inteiro** (banco + uploads) — é o estado completo da aplicação.

### systemd (exemplo)

```ini
[Unit]
Description=HospCheck
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/hospcheck
EnvironmentFile=/etc/hospcheck.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
User=hospcheck

[Install]
WantedBy=multi-user.target
```

## 3. Docker

```bash
docker build -t hospcheck .
docker run -d --name hospcheck \
  -p 3100:3100 \
  -e HOSPCHECK_FORCAR_HTTPS=1 \
  -e HC_HOSPITAL_NOME="Hospital São Lucas" \
  -v hospcheck-dados:/app/data \
  hospcheck
```

## 4. HTTPS (obrigatório para uso real)

Coloque um proxy com TLS na frente (nginx, Caddy, Traefik). Exemplo nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name hospcheck.suahospital.com.br;
  ssl_certificate     /etc/letsencrypt/live/hospcheck.suahospital.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/hospcheck.suahospital.com.br/privkey.pem;
  client_max_body_size 30m;          # fotos/PDF de até 15 MB por anexo

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

O app já usa `trust proxy`, então `X-Forwarded-Proto: https` liga o cookie `Secure`.

## 5. Primeiro acesso

1. Abra o site, entre com `romario` / `romario`.
2. O sistema leva direto para **Trocar senha** e não libera nada antes da troca.
3. Defina a senha definitiva (mín. 8 caracteres).
4. Em `Configurações → Hospital`, ajuste nome/CNPJ/endereço e as antecedências de alerta.
5. Em `Configurações → Setores` e `→ Usuários`, cadastre a equipe (perfis: administrador, gestor,
   inspetor, manutenção, consulta).
6. Em `Configurações → Checklists`, publique o modelo de checklist usado nas inspeções.

## 6. Operação e verificação

```bash
curl -s https://SEU-DOMINIO/api/health      # {"ok":true,"modo":"producao",...}
```

- **Backup**: copie o diretório de dados (SQLite em WAL + `uploads/`) com o serviço parado ou
  usando `sqlite3 hospcheck.db ".backup backup.db"`.
- **Restore**: devolva banco + `uploads/` no mesmo caminho e reinicie.
- **Atualização**: `git pull && npm ci && npm run build && systemctl restart hospcheck`.
- **Logs**: stdout/stderr do processo (journald no systemd).

## 7. Limites conhecidos (não são "pendências de deploy")

- **Peças de manutenção não têm rastreabilidade por item.** O banco guarda `descricao` (texto livre,
  onde o técnico escreve peças e quantidades) e custos agregados (`pecas_centavos`, `mao_obra_centavos`,
  `outros_centavos`, `total_centavos`). Não existe tabela de itens, quantidade numérica, série/lote ou
  custo unitário por peça. NF/recibos são anexos vinculados à **manutenção**, não à peça.
- **E-mail diário** só é enviado se `HC_SMTP_URL` e `HC_EMAIL_RESUMO` estiverem configurados; sem isso
  os resumos ficam registrados como pendentes (nada é simulado).
- **Google** (Drive/agenda) só com `GOOGLE_SERVICE_ACCOUNT_JSON`; sem isso o status aparece como
  não configurado.
- **Demo** (para treinamento/apresentação): rode com `HC_SEED_DEMO=1` em um banco separado
  (`HOSPCHECK_DB=/tmp/hospcheck-demo.db`) — nunca no banco de produção.
