/**
 * Caminho de volta para os catálogos que ainda estão convertendo (11/09/2026).
 *
 * Pedido do Josef: "sempre que tem um catálogo carregando e eu saio da tela do
 * dashboard de carregamento, ela não aparece mais depois — precisamos ter um
 * caminho pra voltar aos carregamentos". Com a fila agora viva fora do React
 * (core/jobs/conversionJobsStore), os jobs continuam existindo em qualquer
 * tela; faltava só EXIBIR isso e dar o clique de volta.
 *
 * Fica no rodapé de todas as páginas e some sozinho quando nada está rodando.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { useConversionJobs, contarEmAndamento } from '@/core/jobs/conversionJobsStore';

const ROTA_CONVERSAO = '/conversao';

export function ConversoesEmAndamento() {
  const jobs = useConversionJobs();
  const navigate = useNavigate();
  const location = useLocation();

  const rodando = jobs.filter(j => j.status === 'processing');
  // Na própria tela de conversão o painel já está à vista — repetir o aviso
  // ali seria só ruído em cima do que o cliente está olhando.
  if (rodando.length === 0 || location.pathname.startsWith(ROTA_CONVERSAO)) return null;

  const total = contarEmAndamento(jobs);
  const nomes = rodando.slice(0, 2).map(j => j.fornecedorNome || j.file.name).join(', ');
  const resto = rodando.length - 2;

  return (
    <button
      type="button"
      onClick={() => navigate(ROTA_CONVERSAO)}
      aria-label={`Voltar para ${total} conversão(ões) em andamento`}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-primary/30 bg-card/95 px-4 py-3 text-left shadow-lg backdrop-blur-sm transition-colors hover:bg-muted"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-foreground">
          {total === 1 ? '1 catálogo convertendo' : `${total} catálogos convertendo`}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {nomes}{resto > 0 ? ` +${resto}` : ''} — clique para acompanhar
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
