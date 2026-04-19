import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { toast } from "sonner";
import { Loader2, RefreshCw, Settings, TestTube, Bug, Zap, Eye } from "lucide-react";

export default function FeatureFlagsPage() {
  const { flags, isLoading, toggleFlag, refresh } = useFeatureFlags();
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggle = async (key: string, currentValue: boolean) => {
    setToggling(key);
    const success = await toggleFlag(key, !currentValue);
    
    if (success) {
      toast.success(`Feature "${key}" ${!currentValue ? 'ativada' : 'desativada'}!`);
    } else {
      toast.error("Falha ao atualizar feature flag");
    }
    
    setToggling(null);
  };

  const getIcon = (key: string) => {
    if (key.includes('teste') || key.includes('beta')) return <TestTube className="h-4 w-4" />;
    if (key.includes('debug') || key.includes('log')) return <Bug className="h-4 w-4" />;
    if (key.includes('novo') || key.includes('engine')) return <Zap className="h-4 w-4" />;
    return <Eye className="h-4 w-4" />;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Feature Flags
          </h1>
          <p className="text-muted-foreground mt-1">
            Controle funcionalidades em desenvolvimento sem afetar os usuários
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funcionalidades em Desenvolvimento</CardTitle>
          <CardDescription>
            Ative as flags para testar novas funcionalidades. Quando estiverem prontas, 
            o código será "hardcoded" e a flag removida.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : flags.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Nenhuma feature flag configurada ainda.
            </p>
          ) : (
            <div className="space-y-4">
              {flags.map((flag) => (
                <div
                  key={flag.key}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-md ${flag.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {getIcon(flag.key)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{flag.name}</h3>
                        <Badge variant={flag.enabled ? "default" : "secondary"}>
                          {flag.enabled ? "ATIVO" : "INATIVO"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {flag.description}
                      </p>
                      <code className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded mt-2 inline-block">
                        {flag.key}
                      </code>
                    </div>
                  </div>
                  
                  <Switch
                    checked={flag.enabled}
                    onCheckedChange={() => handleToggle(flag.key, flag.enabled)}
                    disabled={toggling === flag.key}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <TestTube className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-900">Como usar Feature Flags</h4>
              <p className="text-sm text-amber-800 mt-1">
                1. Desenvolva a nova funcionalidade protegida por uma flag<br/>
                2. Ative a flag aqui para testar<br/>
                3. Quando estiver 100% pronta, removemos a flag do código<br/>
                4. A funcionalidade fica sempre ativa
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
