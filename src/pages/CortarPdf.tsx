import { useState, useCallback, useRef } from "react";
import { PDFDocument } from "pdf-lib";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Scissors, FileUp, Download, X } from "lucide-react";
import { toast } from "sonner";

// Converte "1-3, 5, 10-12" em lista de páginas 1-based, validada e ordenada.
function parseIntervalo(texto: string, total: number): number[] {
  const paginas = new Set<number>();
  for (const parte of texto.split(",")) {
    const t = parte.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let ini = parseInt(m[1], 10);
      let fim = parseInt(m[2], 10);
      if (ini > fim) [ini, fim] = [fim, ini];
      for (let p = ini; p <= fim; p++) if (p >= 1 && p <= total) paginas.add(p);
    } else if (/^\d+$/.test(t)) {
      const p = parseInt(t, 10);
      if (p >= 1 && p <= total) paginas.add(p);
    }
  }
  return Array.from(paginas).sort((a, b) => a - b);
}

export default function CortarPdf() {
  const [nomeArquivo, setNomeArquivo] = useState<string>("");
  const [totalPaginas, setTotalPaginas] = useState<number>(0);
  const [intervalo, setIntervalo] = useState<string>("");
  const [gerando, setGerando] = useState(false);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const paginasSelecionadas = totalPaginas ? parseIntervalo(intervalo, totalPaginas) : [];

  const carregarArquivo = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Selecione um arquivo PDF.");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      bytesRef.current = bytes;
      setNomeArquivo(file.name);
      setTotalPaginas(doc.getPageCount());
      setIntervalo("");
      toast.success(`${file.name}: ${doc.getPageCount()} páginas carregadas.`);
    } catch (e) {
      toast.error("Não foi possível ler este PDF (pode estar protegido/corrompido).");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) carregarArquivo(file);
  }, [carregarArquivo]);

  const gerar = useCallback(async () => {
    if (!bytesRef.current || paginasSelecionadas.length === 0) return;
    setGerando(true);
    try {
      const origem = await PDFDocument.load(bytesRef.current, { ignoreEncryption: true });
      const novo = await PDFDocument.create();
      // pdf-lib usa índice 0-based; nossas páginas são 1-based.
      const indices = paginasSelecionadas.map((p) => p - 1);
      const copiadas = await novo.copyPages(origem, indices);
      copiadas.forEach((pg) => novo.addPage(pg));
      const out = await novo.save();
      const base = nomeArquivo.replace(/\.pdf$/i, "");
      const blob = new Blob([out], { type: "application/pdf" });
      saveAs(blob, `${base} (cortado ${paginasSelecionadas.length}p).pdf`);
      toast.success(`PDF gerado com ${paginasSelecionadas.length} página(s).`);
    } catch (e) {
      toast.error("Erro ao gerar o PDF cortado.");
    } finally {
      setGerando(false);
    }
  }, [paginasSelecionadas, nomeArquivo]);

  const limpar = () => {
    bytesRef.current = null;
    setNomeArquivo("");
    setTotalPaginas(0);
    setIntervalo("");
  };

  const atalho = (tipo: "primeiras" | "ultimas", n: number) => {
    if (!totalPaginas) return;
    if (tipo === "primeiras") setIntervalo(`1-${Math.min(n, totalPaginas)}`);
    else setIntervalo(`${Math.max(1, totalPaginas - n + 1)}-${totalPaginas}`);
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center">
          <Scissors className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Cortar PDF</h1>
          <p className="text-sm text-muted-foreground">
            Extraia apenas as páginas de novidades/atualizações antes de converter — reduz custo e tempo.
          </p>
        </div>
      </div>

      {!nomeArquivo ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-2xl p-10 text-center cursor-pointer hover:border-primary/50 transition-colors bg-card"
        >
          <FileUp className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-foreground font-medium">Arraste um PDF aqui ou clique para selecionar</p>
          <p className="text-xs text-muted-foreground mt-1">O corte é feito no seu navegador — nada é enviado para servidores.</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && carregarArquivo(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="bg-card rounded-2xl p-6 space-y-5 shadow-card-hover">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{nomeArquivo}</p>
              <p className="text-xs text-muted-foreground">{totalPaginas} páginas</p>
            </div>
            <Button variant="ghost" size="sm" onClick={limpar}>
              <X className="h-4 w-4 mr-1" /> Trocar arquivo
            </Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Páginas a extrair</label>
            <Input
              placeholder='ex: 1-3, 5, 10-12'
              value={intervalo}
              onChange={(e) => setIntervalo(e.target.value)}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => atalho("primeiras", 3)}>Primeiras 3</Button>
              <Button variant="outline" size="sm" onClick={() => atalho("primeiras", 5)}>Primeiras 5</Button>
              <Button variant="outline" size="sm" onClick={() => atalho("ultimas", 3)}>Últimas 3</Button>
              <Button variant="outline" size="sm" onClick={() => atalho("ultimas", 5)}>Últimas 5</Button>
              <Button variant="outline" size="sm" onClick={() => setIntervalo(`1-${totalPaginas}`)}>Todas</Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              {paginasSelecionadas.length > 0
                ? `${paginasSelecionadas.length} página(s) selecionada(s): ${paginasSelecionadas.join(", ")}`
                : "Nenhuma página válida selecionada."}
            </p>
          </div>

          <Button
            onClick={gerar}
            disabled={paginasSelecionadas.length === 0 || gerando}
            className="w-full gradient-primary text-primary-foreground font-semibold"
          >
            <Download className="h-4 w-4 mr-2" />
            {gerando ? "Gerando..." : "Gerar e baixar PDF cortado"}
          </Button>
        </div>
      )}
    </div>
  );
}
