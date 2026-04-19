import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import logo from "@/assets/logo-nunes.png";
import { Save } from "lucide-react";
import { toast } from "sonner";

export default function Configuracoes() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie as configurações da plataforma</p>
      </div>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Dados da Empresa</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <img src={logo} alt="Logo" className="w-16 h-16 rounded-full" />
            <Button variant="outline" size="sm">Alterar Logo</Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome da Empresa</label>
              <Input defaultValue="Nunes Representações" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">CNPJ</label>
              <Input defaultValue="12.345.678/0001-90" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">E-mail</label>
              <Input defaultValue="contato@nunesrep.com.br" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Telefone</label>
              <Input defaultValue="(11) 98765-4321" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Configurações de Catálogo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome padrão da exportação</label>
              <Input defaultValue="Catalogo_Nunes_{{fornecedor}}_{{data}}" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cor principal do catálogo</label>
              <Input type="color" defaultValue="#7c3aed" className="h-10" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Integrações</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Mercos</p>
              <p className="text-xs text-muted-foreground">Integração via importação de planilha</p>
            </div>
            <span className="text-xs font-medium text-success">Ativo</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">JaWeb ERP</p>
              <p className="text-xs text-muted-foreground">Conversão de pedidos</p>
            </div>
            <span className="text-xs font-medium text-warning">Em breve</span>
          </div>
        </CardContent>
      </Card>

      <Button className="gradient-primary text-primary-foreground" onClick={() => toast.success("Configurações salvas!")}>
        <Save className="h-4 w-4 mr-1" /> Salvar Configurações
      </Button>
    </div>
  );
}
