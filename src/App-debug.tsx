import { createRoot } from "react-dom/client";

// Versão debug para testar se o problema é no AppContext ou nas rotas
const AppDebug = () => {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🔧 DEBUG - App Carregando!</h1>
      <p>Se você vê esta mensagem, o React está funcionando.</p>
      <p>O problema está em outro componente.</p>
      <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0' }}>
        <h3>Status:</h3>
        <ul>
          <li>✅ React DOM OK</li>
          <li>✅ Componente App OK</li>
          <li>❓ Verificando outros componentes...</li>
        </ul>
      </div>
    </div>
  );
};

export default AppDebug;
