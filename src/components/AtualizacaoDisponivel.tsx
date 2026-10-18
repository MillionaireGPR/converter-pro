/**
 * Aviso de "tem versão nova" + selo da versão (mesmo padrão do Central
 * Pirralhos, pedido do Gabriel em 17/10/2026; cópia do que roda na Nunê).
 *
 * `__APP_BUILD__` vai embutido no bundle na hora do build (vite.config.ts) e
 * `/build-version.json` é o mesmo id lido do servidor SEM cache (vercel.json).
 * Os dois só divergem quando houve deploy depois que esta aba abriu.
 * Clicar recarrega com um parâmetro novo na URL — o equivalente ao Ctrl+F5,
 * sem depender de tecla nenhuma.
 *  - `BannerAtualizacao`: barra amarela de largura total, piscando, só quando há versão nova.
 *  - `VersaoBadge`: selo pequeno sempre visível ("v295"); vira amarelo piscando junto.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { VERSAO } from "@/lib/versao";

const INTERVALO_MS = 3 * 60_000;

async function versaoPublicada(): Promise<string | null> {
  try {
    const res = await fetch(`/build-version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.build === "string" ? json.build : null;
  } catch {
    return null;
  }
}

function useVersaoCheck() {
  const [disponivel, setDisponivel] = useState(false);
  useEffect(() => {
    let ativo = true;
    const checar = async () => {
      const publicada = await versaoPublicada();
      // null = não deu para checar (offline, ambiente local) — não muda nada.
      if (ativo && publicada) setDisponivel(publicada !== __APP_BUILD__);
    };
    checar();
    const id = setInterval(checar, INTERVALO_MS);
    // Voltou para a aba depois de um tempo? Confere na hora.
    const aoVoltar = () => { if (document.visibilityState === "visible") checar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { ativo = false; clearInterval(id); document.removeEventListener("visibilitychange", aoVoltar); };
  }, []);
  return disponivel;
}

/** Recarrega buscando tudo de novo do servidor (o "Ctrl+F5"). */
export function atualizarAgora() {
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString(36));
  window.location.replace(url.toString());
}

export function BannerAtualizacao() {
  const disponivel = useVersaoCheck();
  if (!disponivel) return null;
  return (
    <button
      type="button"
      onClick={atualizarAgora}
      className="print:hidden flex w-full animate-pulse items-center justify-center gap-2 bg-amber-400 px-3 py-2 text-[13px] font-bold text-black hover:bg-amber-300"
    >
      <RefreshCw className="size-4" />
      Nova atualização disponível — clique aqui para atualizar
    </button>
  );
}

export function VersaoBadge() {
  const disponivel = useVersaoCheck();
  return (
    <button
      type="button"
      onClick={atualizarAgora}
      title={disponivel ? "Nova atualização disponível — clique para atualizar" : `Versão v${VERSAO} — clique para recarregar mesmo assim`}
      aria-label={disponivel ? "Nova atualização disponível" : `Versão v${VERSAO}`}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-md px-2 transition-colors",
        disponivel ? "animate-pulse bg-amber-400 text-black hover:bg-amber-300" : "bg-foreground text-background hover:bg-foreground/85",
      )}
    >
      <RefreshCw className="size-3.5 shrink-0" />
      <span className="text-[11px] font-bold leading-none">{disponivel ? "Atualizar" : `v${VERSAO}`}</span>
    </button>
  );
}
