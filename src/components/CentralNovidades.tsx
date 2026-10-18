/**
 * Central de novidades: o que mudou em cada versão e onde testar — para a
 * equipe (Josef) ver, no próprio conversor, o que foi corrigido e implementado (em vez de
 * depender só da mensagem do Gabriel no WhatsApp). Mesmo padrão do Central
 * Pirralhos. Pontinho amarelo = tem versão que este navegador ainda não abriu.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOVIDADES, type TipoNovidade } from "@/data/novidades";
import { marcarComoVistas, temNovidadeNaoVista, versaoVista } from "@/lib/novidadesLidas";
import { VERSAO } from "@/lib/versao";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ROTULO: Record<TipoNovidade, string> = { novo: "Novo", corrigido: "Corrigido", ajustado: "Ajustado" };
const COR: Record<TipoNovidade, string> = {
  novo: "bg-emerald-100 text-emerald-800",
  corrigido: "bg-sky-100 text-sky-800",
  ajustado: "bg-muted text-muted-foreground",
};
const fmtData = (iso: string) => iso.split("-").reverse().join("/");

export function CentralNovidades() {
  const [aberta, setAberta] = useState(false);
  // O que já tinha sido visto ANTES de abrir: marca "novo" nas entradas certas.
  const [vistaAoAbrir, setVistaAoAbrir] = useState(0);
  const [vista, setVista] = useState(versaoVista);
  const naoVista = temNovidadeNaoVista(NOVIDADES, vista);

  const abrir = (v: boolean) => {
    if (v) {
      setVistaAoAbrir(vista);
      const maisNova = NOVIDADES[0]?.versao ?? 0;
      marcarComoVistas(maisNova);
      setVista(maisNova);
    }
    setAberta(v);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => abrir(true)}
        title={naoVista ? "Tem novidade que você ainda não viu" : "O que mudou em cada versão"}
        aria-label={naoVista ? "Central de novidades — há novidades" : "Central de novidades"}
        className="relative inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
      >
        <Sparkles className="size-4" />
        {naoVista && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-amber-400 ring-2 ring-background" />}
      </button>

      <Dialog open={aberta} onOpenChange={abrir}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Central de novidades</DialogTitle>
            <DialogDescription>O que mudou em cada versão e onde testar. Você está na versão v{VERSAO}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {NOVIDADES.map(n => (
              <section key={n.versao} aria-label={`Versão ${n.versao}`}>
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  v{n.versao}
                  <span className="text-xs font-normal text-muted-foreground">{fmtData(n.data)}</span>
                  {n.versao > vistaAoAbrir && (
                    <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-black">novo</span>
                  )}
                </h3>
                <ul className="mt-1.5 space-y-2.5">
                  {n.itens.map((it, i) => (
                    <li key={i} className="text-[13px] leading-snug">
                      <span className={cn("mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", COR[it.tipo])}>{ROTULO[it.tipo]}</span>
                      {it.texto}
                      {it.testar && (
                        <p className="mt-1 border-l-2 border-amber-400/70 pl-2 text-xs text-muted-foreground">
                          <strong className="font-semibold text-foreground">Como testar: </strong>{it.testar}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
