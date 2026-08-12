import { useEffect, useState } from "react";

/**
 * Endereço FIXO pro painel do servidor (/admin/dashboard).
 *
 * Motivação (12/08/2026): o backend hoje roda por trás de um Cloudflare
 * Quick Tunnel — o endereço muda a cada restart do servidor (a automação
 * de VITE_BACKEND_URL cuida disso pro SITE continuar funcionando, mas um
 * link salvo do painel fica velho e quebra sem aviso). Esta página lê o
 * mesmo VITE_BACKEND_URL (sempre atualizado) e redireciona pro painel
 * certo -- então o bookmark de verdade é SÓ este endereço, que nunca muda.
 */
interface PainelServidorProps {
  // Props existem só pra o teste conseguir injetar valores sem depender de
  // vi.stubEnv em chaves de ambiente novas (import.meta.env não deixa
  // stubar uma chave que nunca existiu antes). Uso real (rota /servidor)
  // nunca passa props -- cai no valor real do ambiente.
  backendUrl?: string;
  adminToken?: string;
}

export default function PainelServidor({ backendUrl, adminToken }: PainelServidorProps = {}) {
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const backend = backendUrl ?? ((import.meta as any).env?.VITE_BACKEND_URL as string | undefined);
    const token = adminToken ?? ((import.meta as any).env?.VITE_ADMIN_TOKEN as string | undefined);

    if (!backend) {
      setErro("VITE_BACKEND_URL não configurado neste ambiente.");
      return;
    }
    if (!token) {
      setErro("VITE_ADMIN_TOKEN não configurado neste ambiente (peça pro Gabriel adicionar no Vercel).");
      return;
    }

    window.location.replace(`${backend}/admin/dashboard?token=${encodeURIComponent(token)}`);
  }, []);

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      {erro ? (
        <p style={{ color: "#c0392b" }}>{erro}</p>
      ) : (
        <p>Redirecionando para o painel do servidor...</p>
      )}
    </div>
  );
}
