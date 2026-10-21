# HospCheck — Dossiê técnico

Data: 20/10/2026 · Ambiente de **demonstração** (dados fictícios, sem pessoas reais).

## 1. Causa da interrupção e o que foi feito

A sessão anterior foi interrompida durante a depuração de uma aparente falha de
digitação na tela de login. A inspeção do estado preservado confirmou que **todos os
arquivos, dados (`data/`), build (`dist/`) e resultados de teste estavam intactos** —
nada precisou ser recriado nem reiniciado.

A "falha" de digitação era **limitação do ambiente de teste, não bug do app**: o
Chromium headless não tinha `fontconfig`, e sem ele o `SkFontMgr` morria com
`FATAL: SkFontMgr_FontConfigInterface Not implemented`. Consequência: as teclas
chegavam (`keydown`/`keypress` disparavam), mas **nenhum evento `input` era gerado** —
os campos controlados pelo React nunca recebiam `onChange`. Instalando `fontconfig` e
fontes no ambiente (extraídos localmente, sem root), digitação e `page.fill` voltaram a
funcionar e as 3 falhas da verificação de interface desapareceram.

## 2. O erro real encontrado (corrigido)

Com o ambiente de teste saneado, a verificação de interface passou a detectar tráfego
HTTP e expôs um **bug real**: `POST /api/inspecoes/rascunho` retornava **404**. Causa:
as rotas `/equipamentos/:id/inspecionar` e `/inspecoes/:id` usavam o **mesmo** nome `id`;
ao redirecionar para `/inspecoes/<uuid>`, a tela tratava o **ID da inspeção como ID de
equipamento** e chamava `POST /rascunho` com um equipamento inexistente. Corrigido
separando os parâmetros de rota.

Correções adicionais aplicadas nesta sessão:
- **Regra de não conformidade** (`server/rotas-inspecoes.js`): toda não conformidade
  agora exige descrição — alinhado ao requisito (não apenas itens marcados).
- **Botão "Concluir"**: passou a checar `fotos.length`, não ficando habilitado sem foto.
- **Acentuação**: mensagem de status exibida como "Inspeção concluída".
- **Rota `/config`**: ganhou guarda de perfil (menu já a escondia para `consulta`;
  antes a rota acessível direto era incoerente).

## 3. Resultado dos testes

| Verificação | Resultado | Comando |
|---|---|---|
| Backend fim a fim (API) | **90/90 · exit 0** | `npm run test:e2e` |
| Interface (navegador headless) | **50/50 · falhas 0** | `node scripts/ui-test.js` |
| Tipo (`tsc --noEmit`) + build (`vite`) | **exit 0** | `npm run build` |

Artefatos: `resultados-e2e.json` (90 casos), `resultados-ui.json` (50 casos),
`capturas/` (mobile e desktop).

## 4. Backend testado (cobertura real — 90 casos)

- **Autenticação/perfis**: login dos 5 perfis, cookie httpOnly, sessão+permissões,
  senha errada rejeitada, multi-hospital isolado.
- **Regras de negócio**: QR estável sem dados privados, PNG de QR real, etiqueta PDF,
  rascunho/autosave, foto obrigatória no servidor (`FOTO_OBRIGATORIA`), conclusão sem
  respostas bloqueada, inspeção imutável, retificação auditada e restrita.
- **Agendas independentes**: próxima inspeção calculada (quinzenal), checklist **não**
  renova calibração nem manutenção; periodicidades semanal/quinzenal/mensal; atraso
  histórico preservado em dias.
- **Integridade de dados**: valor negativo, data mal formatada, validade anterior,
  e-mail duplicado, código único imposto, 404 para equipamento inexistente.
- **Permissões**: `consulta` não cria/interdita/vê auditoria; `inspetor` não interdita
  nem lista usuários; interdição exige motivo.
- **Ocorrências**: não conformidade gera ocorrência com prioridade/prazo; resolução
  exige evidência.
- **Relatórios/exportação**: 5 PDFs reais (tamanho e conteúdo verificados), 7 CSVs com
  BOM UTF-8 e separador `;`, filtros por setor/status/responsável/período, dashboard com
  gráficos.
- **Segurança**: backup JSON sem hash de senha; rotina de e-mail **não finge envio**.

## 5. Frontend (mobile-first, PWA)

22 arquivos em `src/` (React 18 + React Router 6 + Vite 6 + TypeScript). Layout
mobile-first azul/verde, barra inferior com 5 destinos e botão central verde de QR,
painel desktop com menu lateral. Telas: login, painel, equipamentos, ficha (QR),
novo/editar, inspeção (com câmera e foto obrigatória), inspeções, ocorrências,
manutenções, calibrações, alertas, relatórios, configurações, mais, escanear.
Verificado em navegador headless (50/50) e capturas em 360–430px e desktop.

## 6. Integrações pendentes (sem simulação — estado honesto e explícito)

O app **não simula** integrações externas. Sem credenciais, o estado fica explícito:

- **Google (Sheets/Drive)** — `server/integracoes.js`: exige
  `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_ID`, `GOOGLE_DRIVE_FOLDER_ID` (+
  `GOOGLE_SCOPES` opcional). Sem elas a API responde `desconectado` e **lista as
  pendências**; nada é fingido.
- **E-mail (resumo)** — `server/rotinas-email.js`: requer `HC_SMTP_URL` e
  `HC_EMAIL_RESUMO`. Sem provedor, cada envio é gravado como **`pendente`** com o motivo
  explícito (`emails_pendentes`), nunca como enviado.

Variáveis definidas no ambiente do servidor; nenhum serviço foi comprado.

## 7. Como executar

```bash
npm install
npm run dev:api      # API em :3000 (Node 22.5+)
npm run dev:web      # Vite (dev) com proxy para a API
npm run build        # tsc --noEmit && vite build
npm start            # produção: API serve dist/ em :3000
npm run test:e2e     # 90 casos de API
node scripts/ui-test.js   # 50 verificações de interface
```

## 8. Limitações desta verificação

- Integrações Google e SMTP **não exercitadas** por falta de credenciais reais
  (comportamento de "pendente/desconectado" simbólicamente correto e verificado).
- Verificações interativas de navegador (login manual do usuário, permissão de câmera
  real em dispositivo físico) ficam **pendentes de confirmação do usuário**; o que foi
  coberto aqui é a UI em navegador headless + chamadas HTTP reais.
- Ambiente headless depende de `fontconfig`/fontes extraídas localmente no workspace;
  isso não faz parte do app, apenas do ambiente de teste.
