# 🚨 RECOVERY: Restore gateway to alpha (v3.13)

O gateway OpenClaw quebrou depois de upgrade pro v3.22.
Preciso restaurar o alpha (v3.13) que estava funcionando.

**Pré-requisito:** Rodar Claude Code com acesso a `~/Projects/openclaw`:
```bash
claude-code --dir ~/Projects/openclaw
```

Tudo é local — não precisa de GitHub, npm, ou internet.

Execute estes comandos nesta ordem:

## 1. Matar o gateway

```bash
kill -TERM $(lsof -ti:18789)
```

## 2. Restaurar o dist do alpha

```bash
cd ~/Projects/openclaw
rm -rf dist
mv dist-alpha-backup dist
```

## 3. Voltar o source pro alpha

```bash
git checkout alpha
```

## 4. Reiniciar

```bash
openclaw gateway start
```

## 5. Verificar saúde

```bash
curl -s http://localhost:18789/health
```

Deve retornar JSON com status OK.

## 6. Restaurar Tailscale funnel

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:18789
```

## 7. Verificar que está funcionando

```bash
# Health check
curl -s http://localhost:18789/health | python3 -m json.tool

# Checar se WA conectou nos logs
tail -100 ~/.openclaw/logs/gateway.log | grep -i 'whatsapp\|connected\|error'
```

Se health retornar OK e não tiver erros críticos nos logs, Bob voltou. Luke pode testar mandando mensagem no WhatsApp.

---

## Contexto

- **alpha (v3.13):** estável, rodando há semanas
- **feat/rebase-3.22:** branch com 22 patches rebaseadas, build OK mas runtime não testado
- **dist-alpha-backup/:** cópia do dist/ funcional do alpha, criada antes do upgrade
- **Repo:** `~/Projects/openclaw`
- **Gateway port:** 18789
- **Tailscale funnel 443 → 18789:** MUST be restored after any restart
