import sys

# Forca UTF-8 no stdout/stderr para evitar UnicodeEncodeError no console Windows (CP1252)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import os
import json
import zipfile
import uvicorn
import fitz
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from cv_extractor import extract_cells_via_cv
from storage import upload_file_to_supabase

app = FastAPI(title="Converter-Pro Image Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "image-extractor"}


# ─────────────────────────────────────────────────────────────
# Funções auxiliares
# ─────────────────────────────────────────────────────────────

def _get_page_heights(pdf_path: str) -> dict:
    """Retorna dict {page_num (1-based): altura em pontos}."""
    doc = fitz.open(pdf_path)
    page_heights = {}
    for i in range(len(doc)):
        page = doc.load_page(i)
        page_heights[i + 1] = page.rect.height
    doc.close()
    return page_heights


def _convert_sku_y_coords(skus_list: list, page_heights: dict) -> list:
    """
    Converte coordenadas Y dos SKUs do sistema PDF.js (origem inferior-esquerda,
    Y cresce para cima) para o sistema PyMuPDF (origem superior-esquerda, Y cresce
    para baixo).
    Formula: pymupdf_y = page_height - pdfjs_y
    """
    converted = 0
    for sku in skus_list:
        sc = sku.get("spatialContext")
        if not sc or sc.get("y") is None:
            continue
        sku_page = sc.get("page", sku.get("page", 1))
        page_h = page_heights.get(sku_page, 842)
        sc["y"] = page_h - sc["y"]
        converted += 1

    print(f"[Main] Coordenadas Y convertidas em {converted} SKUs (PDF.js -> PyMuPDF)")
    return skus_list


def _build_zip_from_matches(output_folder: str, matches: list) -> str:
    """Monta o ZIP final com as imagens renderizadas e retorna o caminho local."""
    zip_path = os.path.join(output_folder, "imagens_extraidas.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for m in matches:
            if os.path.exists(m["local_path"]):
                zipf.write(m["local_path"], arcname=m["final_image_name"])
    return zip_path


# Dicionário global em memória para guardar status das extrações
JOB_STATUS = {}

def _run_extraction_task(jobId: str, pdf_local_path: str, skus_list: list, output_folder: str, page_heights: dict, total_pages: int):
    try:
        # 4. Converter Y dos SKUs: PDF.js (Y-up) -> PyMuPDF (Y-down)
        skus_list = _convert_sku_y_coords(skus_list, page_heights)

        # 5. Extração via OpenCV: nova estratégia Column-First
        print("[Main] Extração de imagens (Estratégia Column-First)")
        matches, unmatched = extract_cells_via_cv(pdf_local_path, skus_list, output_folder)
        total_images = len(matches)

        if not matches:
            JOB_STATUS[jobId] = {
                "status": "success",
                "message": "Nenhuma imagem de produto extraída do PDF",
                "zipUrl": None,
                "matchesCount": 0,
                "totalPages": total_pages,
                "totalImages": 0,
            }
            return

        # 6. Montar ZIP com imagens extraídas
        zip_path = _build_zip_from_matches(output_folder, matches)

        # 7. Upload do ZIP para Supabase
        zip_remote_path = f"{jobId}/imagens_extraidas.zip"
        print(f"Fazendo upload do ZIP -> {zip_remote_path}")
        zip_url = upload_file_to_supabase(zip_path, zip_remote_path)
        print(f"ZIP disponivel em: {zip_url}")

        print(f"Job {jobId} concluido com sucesso!")
        JOB_STATUS[jobId] = {
            "status": "success",
            "zipUrl": zip_url,
            "matchesCount": len(matches),
            "unmatchedCount": len(unmatched),
            "totalPages": total_pages,
            "totalImages": total_images,
            "unmatchedSkus": unmatched,
        }

    except Exception as e:
        import traceback
        print(f"Erro no Job {jobId}: {e}")
        print(traceback.format_exc())
        JOB_STATUS[jobId] = {
            "status": "error",
            "message": str(e),
            "details": traceback.format_exc(),
        }

# ─────────────────────────────────────────────────────────────
# Endpoint principal
# ─────────────────────────────────────────────────────────────

@app.post("/process")
async def process_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    jobId: str = Form(...),
    supplier: str = Form(...),
    totalProducts: str = Form("0"),
    skus: str = Form("[]"),
):
    print(f"\n--- Iniciando Job: {jobId} ---")
    print(f"Arquivo: {file.filename}, Fornecedor: {supplier}")
    
    JOB_STATUS[jobId] = {"status": "processing", "progress": 0}

    output_folder = f"temp/{jobId}"
    os.makedirs(output_folder, exist_ok=True)

    try:
        # 1. Salvar PDF localmente
        pdf_local_path = os.path.join(output_folder, "input.pdf")
        content = await file.read()
        with open(pdf_local_path, "wb") as f:
            f.write(content)
        print(f"Arquivo salvo: {len(content)} bytes -> {pdf_local_path}")

        # 2. Parse dos SKUs
        skus_list = json.loads(skus) if skus else []
        print(f"SKUs recebidos: {len(skus_list)}")

        # 3. Obter altura das páginas (rápido)
        page_heights = _get_page_heights(pdf_local_path)
        total_pages = len(page_heights)

        # Disparar tarefa em background
        background_tasks.add_task(
            _run_extraction_task,
            jobId,
            pdf_local_path,
            skus_list,
            output_folder,
            page_heights,
            total_pages
        )

        return {"status": "processing", "jobId": jobId}

    except Exception as e:
        import traceback
        print(f"Erro ao iniciar Job {jobId}: {e}")
        JOB_STATUS[jobId] = {"status": "error", "message": str(e)}
        return {"status": "error", "message": str(e)}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    # Se o job não existir na memória (servidor reiniciou ou id errado), retorna not_found
    return JOB_STATUS.get(job_id, {"status": "not_found"})


if __name__ == "__main__":
    if "--serve" in sys.argv:
        # Porta vem da env var PORT (Render/Heroku injetam) ou 8000 local
        port = int(os.environ.get("PORT", 8000))
        uvicorn.run(app, host="0.0.0.0", port=port)
