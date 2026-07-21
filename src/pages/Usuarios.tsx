import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Users, UserPlus, KeyRound, Trash2, ShieldCheck, RefreshCw, Lock } from "lucide-react";
import { toast } from "sonner";

interface UsuarioRow {
  username: string;
  is_admin: boolean;
  created_at: string;
}

// Traduz os códigos de retorno das RPCs para mensagens ao usuário.
const MSG: Record<string, string> = {
  NAO_AUTORIZADO: "Senha de admin incorreta ou sem permissão.",
  JA_EXISTE: "Já existe um usuário com esse nome.",
  NAO_ENCONTRADO: "Usuário não encontrado.",
  NAO_PODE_EXCLUIR_SI: "Você não pode excluir o próprio usuário.",
  DADOS_INVALIDOS: "Preencha usuário e senha corretamente.",
};

export default function Usuarios() {
  const { usuario, isAdmin } = useAuth();
  const [adminPass, setAdminPass] = useState("");
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Form de novo usuário
  const [novoUser, setNovoUser] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novoAdmin, setNovoAdmin] = useState(false);

  // Alterar senha
  const [alvoSenha, setAlvoSenha] = useState("");
  const [senhaTrocada, setSenhaTrocada] = useState("");

  const exigeSenha = () => {
    if (!adminPass) { toast.error("Digite sua senha de admin no topo para autorizar."); return false; }
    return true;
  };

  const carregar = useCallback(async () => {
    if (!adminPass) { toast.error("Digite sua senha de admin para carregar a lista."); return; }
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc("app_list_users", {
        p_admin_user: usuario, p_admin_pass: adminPass,
      });
      if (error) { toast.error("Erro ao carregar usuários."); return; }
      const rows = (data || []) as UsuarioRow[];
      setUsuarios(rows);
      if (rows.length === 0) toast.error("Senha de admin incorreta (ou sem usuários).");
      else toast.success(`${rows.length} usuário(s) carregado(s).`);
    } finally {
      setCarregando(false);
    }
  }, [adminPass, usuario]);

  const criar = async () => {
    if (!exigeSenha()) return;
    if (!novoUser.trim() || !novaSenha) { toast.error("Preencha usuário e senha."); return; }
    const { data, error } = await supabase.rpc("app_create_user", {
      p_admin_user: usuario, p_admin_pass: adminPass,
      p_username: novoUser.trim(), p_password: novaSenha, p_is_admin: novoAdmin,
    });
    if (error) { toast.error("Erro ao criar usuário."); return; }
    if (data === "OK") {
      toast.success(`Usuário "${novoUser.trim()}" criado.`);
      setNovoUser(""); setNovaSenha(""); setNovoAdmin(false);
      carregar();
    } else {
      toast.error(MSG[data as string] || "Não foi possível criar.");
    }
  };

  const trocarSenha = async () => {
    if (!exigeSenha()) return;
    if (!alvoSenha || !senhaTrocada) { toast.error("Escolha o usuário e a nova senha."); return; }
    const { data, error } = await supabase.rpc("app_change_password", {
      p_admin_user: usuario, p_admin_pass: adminPass,
      p_username: alvoSenha, p_new_password: senhaTrocada,
    });
    if (error) { toast.error("Erro ao alterar senha."); return; }
    if (data === "OK") {
      toast.success(`Senha de "${alvoSenha}" alterada.`);
      setSenhaTrocada("");
    } else {
      toast.error(MSG[data as string] || "Não foi possível alterar.");
    }
  };

  const excluir = async (alvo: string) => {
    if (!exigeSenha()) return;
    const { data, error } = await supabase.rpc("app_delete_user", {
      p_admin_user: usuario, p_admin_pass: adminPass, p_username: alvo,
    });
    if (error) { toast.error("Erro ao excluir."); return; }
    if (data === "OK") {
      toast.success(`Usuário "${alvo}" excluído.`);
      carregar();
    } else {
      toast.error(MSG[data as string] || "Não foi possível excluir.");
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card className="shadow-card">
          <CardContent className="p-12 text-center">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Acesso restrito</h3>
            <p className="text-sm text-muted-foreground">Apenas administradores podem gerenciar usuários.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center">
          <Users className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground">Crie usuários e altere senhas — salvo no banco de dados.</p>
        </div>
      </div>

      {/* Autorização */}
      <Card className="shadow-card border-l-4 border-l-primary">
        <CardContent className="p-4 space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Sua senha de admin (obrigatória para qualquer ação)
          </label>
          <div className="flex gap-2">
            <Input type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} placeholder="senha do admin logado (" className="flex-1" />
            <Button onClick={carregar} disabled={carregando} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-1 ${carregando ? 'animate-spin' : ''}`} /> Carregar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Logado como <strong>{usuario}</strong>. A senha não é armazenada — é usada só para autorizar cada ação.</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Criar usuário */}
        <Card className="shadow-card">
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" /> Novo usuário</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Usuário" value={novoUser} onChange={e => setNovoUser(e.target.value)} />
            <Input type="password" placeholder="Senha" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={novoAdmin} onChange={e => setNovoAdmin(e.target.checked)} className="w-4 h-4" />
              É administrador (pode gerenciar usuários)
            </label>
            <Button onClick={criar} className="w-full gradient-primary text-primary-foreground">
              <UserPlus className="h-4 w-4 mr-1" /> Criar usuário
            </Button>
          </CardContent>
        </Card>

        {/* Alterar senha */}
        <Card className="shadow-card">
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Alterar senha</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Usuário alvo" value={alvoSenha} onChange={e => setAlvoSenha(e.target.value)} />
            <Input type="password" placeholder="Nova senha" value={senhaTrocada} onChange={e => setSenhaTrocada(e.target.value)} />
            <Button onClick={trocarSenha} className="w-full" variant="outline">
              <KeyRound className="h-4 w-4 mr-1" /> Alterar senha
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Lista */}
      <Card className="shadow-card">
        <CardHeader className="py-3"><CardTitle className="text-sm">Usuários cadastrados ({usuarios.length})</CardTitle></CardHeader>
        <CardContent>
          {usuarios.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Digite sua senha de admin e clique em "Carregar".</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usuarios.map(u => (
                    <TableRow key={u.username}>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell>
                        {u.is_admin
                          ? <span className="text-xs font-semibold text-primary">Admin</span>
                          : <span className="text-xs text-muted-foreground">Usuário</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{String(u.created_at).slice(0, 10)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={u.username.toLowerCase() === (usuario || '').toLowerCase()}
                          onClick={() => excluir(u.username)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
