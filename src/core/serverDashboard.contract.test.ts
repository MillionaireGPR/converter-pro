import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backend = readFileSync('backend/image_extractor/main.py', 'utf8');
const dashboard = readFileSync('backend/image_extractor/static/admin_dashboard.html', 'utf8');

describe('painel central — detalhes por servidor', () => {
  it('expõe um endpoint protegido para o servidor selecionado', () => {
    expect(backend).toContain('@app.get("/admin/server/{server_id}/details")');
    expect(backend).toContain('admin_token: str = Depends(_require_admin)');
  });

  it('não reutiliza a senha da Integrator nos servidores remotos', () => {
    expect(backend).toContain('def _read_monitor_token(server_id: str)');
    expect(backend).toContain('headers={"X-Admin-Token": monitor_token}');
    expect(backend).not.toContain('headers={"X-Admin-Token": admin_token}');
  });

  it('transforma os cartões em seletores dos detalhes e históricos', () => {
    expect(dashboard).toContain("onclick=\"selectServer('${server.id}')\"");
    expect(dashboard).toContain('/admin/server/${encodeURIComponent(requestedServerId)}/details');
    expect(dashboard).toContain('Histórico de trabalhos do servidor selecionado');
  });
});
