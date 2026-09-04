import { useEffect } from "react";

const SERVER_DASHBOARD_URL = "https://conversor-vps.metodoiqc.com.br/admin/dashboard";

/**
 * Endereço FIXO pro painel do servidor (/admin/dashboard).
 *
 * Motivação (12/08/2026): o backend hoje roda por trás de um Cloudflare
 * Quick Tunnel — o endereço muda a cada restart do servidor (a automação
 * de VITE_BACKEND_URL cuida disso pro SITE continuar funcionando, mas um
 * link salvo do painel fica velho e quebra sem aviso). Esta página lia
 * direto VITE_BACKEND_URL e redirecionava pro painel certo -- então o
 * bookmark de verdade seria SÓ este endereço, que nunca muda.
 *
 * Atualização (04/09/2026): o painel central passou a morar na VPS
 * Integrator e monitora Integrator, Wesley e Render ao mesmo tempo. Por isso
 * esta rota NÃO acompanha mais o backend que processa conversões: se um
 * servidor cair, o painel de diagnóstico precisa continuar abrindo.
 *
 * NÃO passa o token de admin na URL de propósito: qualquer variável com
 * prefixo VITE_ fica embutida em texto puro no bundle público do site --
 * visível a QUALQUER visitante (não só usuários logados no app), já que é
 * um arquivo estático servido sem autenticação. Descoberto ao tentar fazer
 * isso mesmo (o próprio `vercel env add` avisou). O painel do servidor já
 * tem seu próprio portão (pede o token, lembra em sessionStorage do
 * domínio dele) -- deixamos ele cuidar disso.
 */
export default function PainelServidor() {
  useEffect(() => {
    window.location.replace(SERVER_DASHBOARD_URL);
  }, []);

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      <p>Redirecionando para a Central dos Servidores...</p>
    </div>
  );
}
