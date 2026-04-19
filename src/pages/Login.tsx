import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import logo from "@/assets/logo-nunes.png";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="absolute inset-0 gradient-primary opacity-5" />
      <div className="relative w-full max-w-md mx-4">
        <div className="bg-card rounded-2xl shadow-card-hover p-8 space-y-6">
          <div className="flex flex-col items-center gap-3">
            <img src={logo} alt="Nunes Representações" className="w-20 h-20 rounded-full" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground">Central de Conversão Comercial</h1>
              <p className="text-xs text-muted-foreground mt-1">Padronize tabelas, aplique descontos e gere arquivos prontos para venda</p>
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">E-mail</label>
              <Input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Senha</label>
              <Input type="password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" />
                <label htmlFor="remember" className="text-xs text-muted-foreground cursor-pointer">Lembrar acesso</label>
              </div>
              <a href="#" className="text-xs text-primary hover:underline">Esqueci a senha</a>
            </div>
            <Button type="submit" className="w-full gradient-primary text-primary-foreground font-semibold">
              Entrar
            </Button>
          </form>
          <p className="text-center text-[10px] text-muted-foreground">Nunes Representações © 2026</p>
        </div>
      </div>
    </div>
  );
}
