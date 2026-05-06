import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Carrega variáveis do .env na raiz do projeto (ajustado para subir 3 níveis se necessário)
# O backend está em /backend/image_extractor, o .env está na raiz /
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env"))
load_dotenv(env_path)

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") # Usando Service Role para bypass de RLS se necessário

if not url or not key:
    print(f"ERRO: Variáveis de ambiente Supabase não encontradas no path: {env_path}")

supabase: Client = create_client(url, key)

BUCKET_NAME = "source-files"

def update_job_status(job_id: str, updates: dict):
    """
    Atualiza o status/progresso na tabela image_extraction_jobs.
    """
    try:
        # Removido campo 'message' pois não existe na tabela do usuário
        if "message" in updates:
            del updates["message"]
        supabase.table("image_extraction_jobs").update(updates).eq("id", job_id).execute()
    except Exception as e:
        print(f"Erro ao atualizar status do job: {e}")

def download_file_from_supabase(remote_path: str, local_path: str):
    """
    Baixa o PDF original do bucket do Supabase.
    remote_path: caminho completo no bucket (ex: jobId/arquivo.pdf)
    """
    try:
        # Se o remote_path vier como URL completa, extraímos apenas a parte após o bucket
        if "storage/v1/object/public/" in remote_path:
            remote_path = remote_path.split(f"{BUCKET_NAME}/")[-1]
            
        with open(local_path, 'wb') as f:
            res = supabase.storage.from_(BUCKET_NAME).download(remote_path)
            f.write(res)
        return True
    except Exception as e:
        print(f"Erro no download Supabase: {e}")
        raise e

def upload_file_to_supabase(local_path: str, remote_path: str):
    """
    Sobe o arquivo ZIP para o bucket e retorna a URL pública.
    Trata erro 413 (Payload too large) com mensagem acionável.
    """
    import time
    max_retries = 3

    file_size = os.path.getsize(local_path)
    file_size_mb = file_size / (1024 * 1024)
    print(f"[Upload] Arquivo: {local_path} | Tamanho: {file_size_mb:.1f} MB")

    for attempt in range(max_retries):
        try:
            print(f"[Upload] Tentativa {attempt + 1}/{max_retries}...")

            with open(local_path, 'rb') as f:
                supabase.storage.from_(BUCKET_NAME).upload(
                    path=remote_path,
                    file=f,
                    file_options={"content-type": "application/zip", "x-upsert": "true"}
                )

            # Gera URL pública
            res = supabase.storage.from_(BUCKET_NAME).get_public_url(remote_path)
            print(f"[Upload] Sucesso! URL: {res[:60]}...")
            return res
            
        except Exception as e:
            err_str = str(e)
            print(f"[Upload] Erro na tentativa {attempt + 1}: {err_str[:200]}")

            # 413 = Payload Too Large: erro definitivo, não adianta retentar
            if "413" in err_str or "Payload too large" in err_str or "exceeded the maximum" in err_str:
                print(f"[Upload] ABORT: ZIP de {file_size_mb:.1f}MB excede o limite do bucket Supabase.")
                print(f"[Upload] Solucao: aumentar 'File size limit' do bucket '{BUCKET_NAME}' no Supabase Dashboard.")
                raise RuntimeError(
                    f"ZIP_TOO_LARGE: Arquivo gerado ({file_size_mb:.1f}MB) excede o limite "
                    f"de upload do bucket '{BUCKET_NAME}'. Aumente 'File size limit' no painel Supabase "
                    f"(Storage -> Buckets -> {BUCKET_NAME} -> Settings)."
                )

            if attempt < max_retries - 1:
                time.sleep(2)
            else:
                print(f"[Upload] Todas as tentativas falharam.")
                raise e

def insert_image_results(job_id: str, matches: list, zip_url: str):
    """
    Insere os registros das imagens extraídas e atualiza o Job com o link do ZIP.
    """
    try:
        # 1. Inserir os matches individuais na tabela 'image_extraction_results'
        if matches:
            formatted_matches = []
            for m in matches:
                formatted_matches.append({
                    "job_id": job_id,
                    "sku": m["sku"],
                    "original_image_name": m["original_image_name"],
                    "final_image_name": m["final_image_name"],
                    "match_confidence": m["match_confidence"],
                    "match_type": m["match_type"],
                    "status": "matched"
                })
            
            supabase.table("image_extraction_results").insert(formatted_matches).execute()

        # 2. Atualizar o job principal com o link do ZIP e status concluído
        update_job_status(job_id, {
            "status": "completed",
            "progress": 100,
            "matched_images": len(matches),
            "zip_url": zip_url,
            "completed_at": "now()" # O Supabase lida com timestamps se configurado, ou usamos a função local
        })
        
    except Exception as e:
        print(f"Erro ao persistir resultados no banco: {e}")
