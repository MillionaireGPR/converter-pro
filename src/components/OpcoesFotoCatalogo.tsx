import { Checkbox } from "@/components/ui/checkbox";
import type { OpcoesCatalogo } from "@/context/types";

const OPCOES: { campo: keyof OpcoesCatalogo; titulo: string; ajuda: string }[] = [
  {
    campo: "fotoComposta",
    titulo: "Foto do produto é montada por várias imagens",
    ajuda: "Marque quando cada produto aparece como caixa + brinquedo + acessórios juntos. Assim a foto sai completa, não só uma peça.",
  },
  {
    campo: "iaEscolheFoto",
    titulo: "IA escolhe a foto de cada produto",
    ajuda: "Para catálogos confusos (várias fotos soltas, etiqueta de preço desenhada). Mais lento e consome IA a cada página.",
  },
];

/** Opções de foto do catálogo PDF, salvas no cadastro do fornecedor. */
export function OpcoesFotoCatalogo({
  value,
  onChange,
}: {
  value: OpcoesCatalogo;
  onChange: (next: OpcoesCatalogo) => void;
}) {
  return (
    <div className="space-y-2 pt-1">
      {OPCOES.map(({ campo, titulo, ajuda }) => (
        <label key={campo} className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={!!value[campo]}
            onCheckedChange={checked => onChange({ ...value, [campo]: checked === true })}
            className="mt-0.5"
          />
          <span className="space-y-0.5">
            <span className="block text-xs font-medium text-foreground">{titulo}</span>
            <span className="block text-[11px] text-muted-foreground">{ajuda}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
