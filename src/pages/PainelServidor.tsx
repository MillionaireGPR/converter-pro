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
 *
 * NÃO passa o token de admin na URL de propósito: qualquer variável com
 * prefixo VITE_ fica embutida em texto puro no bundle público do site --
 * visível a QUALQUER visitante (não só usuários logados no app), já que é
 * um arquivo estático servido sem autenticação. Descoberto ao tentar fazer
 * isso mesmo (o próprio `vercel env add` avisou). O painel do servidor já
 * tem seu próprio portão (pede o token, lembra em sessionStorage do
 * domínio dele) -- deixamos ele cuidar disso.
 */
export default function PainelServidor({ backendUrl }: { backendUrl?: string } = {}) {
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const backend = backendUrl ?? ((import.meta as any).env?.VITE_BACKEND_URL as string | undefined);

    if (!backend) {
      setErro("VITE_BACKEND_URL não configurado neste ambiente.");
      return;
    }

    window.location.replace(`${backend}/admin/dashboard`);
  }, [backendUrl]);

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
