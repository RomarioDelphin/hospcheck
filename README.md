# HospCheck

Gestão de equipamentos hospitalares: cadastro com QR Code, inspeções com checklist e
fotos, ocorrências, manutenções, calibrações, alertas de vencimento, relatórios em PDF
e exportação CSV/Excel, com trilha de auditoria e perfis de acesso.

**Stack:** Node.js 22 (SQLite embutido `node:sqlite`) + Express no back-end; React + Vite +
TypeScript no front-end; PWA instalável.

## Rodar em desenvolvimento

```bash
npm ci
npm run build          # tsc --noEmit + vite build
npm run dev:api        # API em http://127.0.0.1:3100
npm run dev:web        # Vite em http://127.0.0.1:3000 (proxy de /api para 3100)
```

## Testes

```bash
npm run test:e2e                    # 90 verificações de API (script próprio, sem Playwright)
node scripts/ui-test.js             # 50 verificações de interface em navegador real
node scripts/verificar-producao.mjs # 27 verificações do modo produção (master, troca de senha)
node scripts/auditoria-mobile.mjs   # auditoria somente-leitura em 4 viewports
```

Os testes de interface usam `playwright-core` com um Chromium do sistema (`libs/`, ignorado
pelo Git) e as contas fictícias `*@demo.hospcheck.local`, criadas apenas quando o servidor
sobe com `HC_SEED_DEMO=1`.

## Produção

O app **não roda em hospedagem serverless**: precisa de processo Node contínuo e disco
persistente (arquivo SQLite + anexos). Veja **[PRODUCAO.md](PRODUCAO.md)** para publicação
com systemd ou Docker, HTTPS com proxy, backup/restore e o primeiro acesso.

Variáveis relevantes: `PORT`, `HOSPCHECK_DB`, `HOSPCHECK_FORCAR_HTTPS`, `HC_SEED_DEMO`
(nunca em produção), `HC_HOSPITAL_NOME`, `HC_MASTER_USUARIO`, `HC_MASTER_SENHA`.

Sem `HC_SEED_DEMO=1` o servidor não semeia nenhum dado fictício: ele provisiona o acesso
master, desativa logins de demonstração e bloqueia a API enquanto a senha provisória não for
trocada. O primeiro acesso leva à tela **Trocar senha**; depois, a troca fica disponível em
*Mais → Trocar minha senha*.

## Estrutura

```
server/   API Express, schema SQLite, regras de negócio, PDF, QR Code, e-mail
src/      front-end React (telas, componentes, estilos, sessão)
scripts/  verificações automatizadas (API, interface, produção, auditoria mobile)
public/   ícones, manifest PWA
```

## Limites conhecidos

- Manutenção não tem rastreabilidade por peça: as peças e quantidades ficam no texto livre
  de `descricao` e nos custos agregados (`pecas_centavos`, `mao_obra_centavos`,
  `outros_centavos`, `total_centavos`). Não há tabela de itens, quantidade numérica,
  série/lote ou custo unitário por peça; NF/recibos são anexos da **manutenção**.
- E-mail diário e integração com Google só funcionam com `HC_SMTP_URL`/`HC_EMAIL_RESUMO` e
  `GOOGLE_SERVICE_ACCOUNT_JSON` configurados — sem isso o status aparece como não configurado.
