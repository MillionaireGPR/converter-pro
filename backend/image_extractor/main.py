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

# IMPORTANTE: gemini_extractor é importado LAZY no endpoint /extract_products_ai
# (não no startup), porque google-generativeai é uma lib pesada que pode
# estourar o health check de 5s do Render durante boot.

app = FastAPI(title="Converter-Pro Image Extractor")

# CORS: combo allow_origins=['*'] + allow_credentials=True eh INVALIDO
# pela spec CORS (navegador rejeita). Usamos regex para cobrir centraldeconversao
# + preview deploys do Vercel, mantendo credentials=False (nao precisamos).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://centraldeconversao.vercel.app",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://localhost:3000",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # cobre previews do Vercel
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


SERVICE_VERSION = "2026.06.16-v31-chunk6-5workers"  # incrementa a cada deploy de feature


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "image-extractor",
        "version": SERVICE_VERSION,
    }


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


def _infer_spatial_context(pdf_path: str, skus_list: list) -> list:
    """
    Para SKUs sem spatialContext, busca o código diretamente no PDF via PyMuPDF
    (page.search_for) e injeta posição (x,y,width,height,page). Isso permite ao
    OpenCV mapear imagens mesmo quando o frontend não conseguiu extrair coords
    (caso NIX/FOLIA onde PDF.js fragmenta o texto de forma agressiva).
    """
    sem_ctx = [s for s in skus_list if not s.get("spatialContext")]
    if not sem_ctx:
        return skus_list

    print(f"[Main] Inferindo spatialContext para {len(sem_ctx)} SKUs sem coordenadas (busca no PDF)...")

    doc = fitz.open(pdf_path)
    inferidos = 0
    paginas_indexadas = {}  # cache de page -> instance

    for sku in sem_ctx:
        codigo = sku.get("sku")
        if not codigo:
            continue

        # Buscar em todas as páginas (preferindo a página declarada se houver)
        prefer_page = sku.get("page") or (sku.get("spatialContext", {}) or {}).get("page")
        pages_to_search = list(range(len(doc)))
        if isinstance(prefer_page, int) and 1 <= prefer_page <= len(doc):
            # Coloca a página preferida no início
            pages_to_search = [prefer_page - 1] + [p for p in pages_to_search if p != prefer_page - 1]

        found_rect = None
        found_page_num = None

        for pi in pages_to_search:
            if pi not in paginas_indexadas:
                paginas_indexadas[pi] = doc.load_page(pi)
            page = paginas_indexadas[pi]
            # search_for retorna lista de Rect com posições do texto
            rects = page.search_for(codigo)
            if rects:
                found_rect = rects[0]
                found_page_num = pi + 1  # 1-based
                break

        if found_rect and found_page_num:
            sku["spatialContext"] = {
                "x": (found_rect.x0 + found_rect.x1) / 2,
                "y": (found_rect.y0 + found_rect.y1) / 2,
                "width": found_rect.x1 - found_rect.x0,
                "height": found_rect.y1 - found_rect.y0,
                "page": found_page_num,
            }
            # Já está em coords PyMuPDF (Y-down) — não precisa converter
            inferidos += 1

    doc.close()
    print(f"[Main] spatialContext inferido em {inferidos}/{len(sem_ctx)} SKUs via busca textual")
    return skus_list


def _build_zip_from_matches(output_folder: str, matches: list) -> str:
    """Monta o ZIP final com as imagens renderizadas e retorna o caminho local."""
    zip_path = os.path.join(output_folder, "imagens_extraidas.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for m in matches:
            if os.path.exists(m["local_path"]):
                zipf.write(m["local_path"], arcname=m["final_image_name"])
    return zip_path


# Dicionário em memória + persistência em disco.
# IMPORTANTE: Render reinicia o serviço (idle 15min, deploy, OOM) e ZERA
# o dict em memória — frontend ficava em polling eterno sem feedback.
# Solução: cada update do status também escreve em temp/<jobId>/status.json
# e lemos do disco quando o jobId não estiver na memória.
JOB_STATUS: dict = {}
_STATUS_DIR = "temp"


def _status_file_path(job_id: str) -> str:
    return os.path.join(_STATUS_DIR, job_id, "status.json")


def _save_status(job_id: str, payload: dict) -> None:
    """Persiste o status do job em disco para sobreviver a restarts."""
    import time
    payload = {**payload, "updatedAt": time.time()}
    JOB_STATUS[job_id] = payload
    try:
        path = _status_file_path(job_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception as e:
        print(f"[Status] Falha ao persistir {job_id}: {e}")


# Job é considerado "zombie" se está como processing mas o registro de status
# é mais antigo que isso E o processo Python perdeu o BackgroundTask.
#
# Render Starter NÃO derruba por idle (só Free). Catálogos NIX/grandes com
# 285+ produtos podem levar 5-15min de Gemini (especialmente se cair em fallback
# Pro). 30min é folga generosa que cobre 99% dos casos legítimos.
ZOMBIE_PROCESSING_THRESHOLD_SEC = 60 * 30  # 30 minutos


def _load_status(job_id: str) -> dict:
    """Lê status do disco se não estiver em memória (após restart).
    Detecta jobs zombie (processing há muito tempo após restart do servidor)."""
    import time
    data = None
    if job_id in JOB_STATUS:
        data = JOB_STATUS[job_id]
    else:
        try:
            path = _status_file_path(job_id)
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    JOB_STATUS[job_id] = data  # re-popula cache
        except Exception as e:
            print(f"[Status] Falha ao ler {job_id} do disco: {e}")

    if not data:
        return {"status": "not_found"}

    # Detecção de zombie: status=processing + sem update há mais que threshold
    # + tarefa não está mais no BackgroundTasks (não temos como saber, mas se
    # passou do threshold após restart, é provável zombie).
    if data.get("status") == "processing":
        updated_at = data.get("updatedAt", 0)
        age = time.time() - updated_at
        if age > ZOMBIE_PROCESSING_THRESHOLD_SEC:
            # Marca como erro para o frontend parar de polling
            zombie_status = {
                "status": "error",
                "message": (
                    f"Job interrompido (o servidor foi reiniciado durante o "
                    f"processamento — comum no plano free do Render após "
                    f"~15min de idle ou deploy). Reenvie o arquivo."
                ),
                "wasZombie": True,
            }
            _save_status(job_id, zombie_status)
            return zombie_status

    return data

def _run_extraction_task(jobId: str, pdf_local_path: str, skus_list: list, output_folder: str, page_heights: dict, total_pages: int, supplier: str = "", use_ai_picker: bool = False):
    try:
        # 4. Converter Y dos SKUs com spatialContext (PDF.js Y-up -> PyMuPDF Y-down)
        skus_list = _convert_sku_y_coords(skus_list, page_heights)

        # 4b. Inferir spatialContext via busca textual no PDF (para SKUs sem coords).
        # Isso resgata o flow quando o frontend não conseguiu extrair posição
        # via PDF.js (caso comum em NIX/FOLIA com texto fragmentado).
        skus_list = _infer_spatial_context(pdf_local_path, skus_list)

        # 5. Extração via OpenCV: nova estratégia Column-First
        # v21: se use_ai_picker=True, Gemini Vision decide qual imagem é a do produto
        # (resolve casos heurística não cobre — DAGIA tag de preço, kit xícara, etc).
        print(f"[Main] Extração de imagens (supplier={supplier}, ai_picker={use_ai_picker})")
        matches, unmatched = extract_cells_via_cv(
            pdf_local_path, skus_list, output_folder,
            supplier_id=supplier, use_ai_picker=use_ai_picker,
        )
        total_images = len(matches)

        if not matches:
            _save_status(jobId, {
                "status": "success",
                "message": "Nenhuma imagem de produto extraída do PDF",
                "zipUrl": None,
                "matchesCount": 0,
                "totalPages": total_pages,
                "totalImages": 0,
            })
            return

        # 6. Montar ZIP com imagens extraídas
        zip_path = _build_zip_from_matches(output_folder, matches)

        # 7. Upload do ZIP para Supabase
        zip_remote_path = f"{jobId}/imagens_extraidas.zip"
        print(f"Fazendo upload do ZIP -> {zip_remote_path}")
        zip_url = upload_file_to_supabase(zip_path, zip_remote_path)
        print(f"ZIP disponivel em: {zip_url}")

        print(f"Job {jobId} concluido com sucesso!")
        _save_status(jobId, {
            "status": "success",
            "zipUrl": zip_url,
            "matchesCount": len(matches),
            "unmatchedCount": len(unmatched),
            "totalPages": total_pages,
            "totalImages": total_images,
            "unmatchedSkus": unmatched,
        })

    except Exception as e:
        import traceback
        print(f"Erro no Job {jobId}: {e}")
        print(traceback.format_exc())
        _save_status(jobId, {
            "status": "error",
            "message": str(e),
            "details": traceback.format_exc(),
        })

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
    useAiPicker: str = Form("false"),  # v21: Gemini Vision decide imagem (DAGIA)
):
    print(f"\n--- Iniciando Job: {jobId} ---")
    print(f"Arquivo: {file.filename}, Fornecedor: {supplier}")

    output_folder = f"temp/{jobId}"
    os.makedirs(output_folder, exist_ok=True)
    _save_status(jobId, {"status": "processing", "progress": 0})

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

        # AI picker flag. v24 (09/06/2026): redesenho MEMORY-SAFE reabilitou
        # o auto-on pra DAGIA. v21 causou OOM porque extraía N candidatas como
        # arrays + N miniaturas. v24 manda só a página anotada (1 imagem) e
        # extrai apenas a escolhida — footprint ~igual ao pipeline atual.
        # KILL-SWITCH: AI_PICKER_DISABLED=1 desliga sem rollback de código.
        ai_picker_flag = str(useAiPicker).strip().lower() in ("true", "1", "yes", "on")
        picker_killed = os.environ.get("AI_PICKER_DISABLED", "").lower() in ("1", "true", "on")
        if not picker_killed and not ai_picker_flag and supplier and supplier.lower() in ("dagia", "dagía"):
            ai_picker_flag = True
            print(f"[Main] AI picker v24 auto-ativado para supplier={supplier}")
        if picker_killed:
            ai_picker_flag = False
            print("[Main] AI picker DESLIGADO via kill-switch AI_PICKER_DISABLED")

        # Disparar tarefa em background
        background_tasks.add_task(
            _run_extraction_task,
            jobId,
            pdf_local_path,
            skus_list,
            output_folder,
            page_heights,
            total_pages,
            supplier,
            ai_picker_flag,
        )

        return {"status": "processing", "jobId": jobId}

    except Exception as e:
        import traceback
        print(f"Erro ao iniciar Job {jobId}: {e}")
        _save_status(jobId, {"status": "error", "message": str(e)})
        return {"status": "error", "message": str(e)}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    # Lê do disco se nao estiver em memoria (sobrevive a restarts do Render)
    return _load_status(job_id)


# ─────────────────────────────────────────────────────────────
# Endpoint AI: extração estruturada de produtos via Gemini Vision
# ─────────────────────────────────────────────────────────────

def _heartbeat_loop(ai_job_id: str, stop_event):
    """
    Heartbeat: atualiza updatedAt a cada 90s enquanto Gemini processa.
    Previne o zombie check de disparar em jobs longos legítimos.

    Roda em thread separada porque a chamada do Gemini é bloqueante.
    """
    import threading
    import time as _time

    while not stop_event.is_set():
        # Espera 90s OU stop_event (whichever first)
        if stop_event.wait(timeout=90):
            return
        try:
            # Re-grava o status atual com timestamp atualizado
            existing = JOB_STATUS.get(ai_job_id, {})
            if existing.get("status") == "processing":
                _save_status(ai_job_id, {
                    "status": "processing",
                    "stage": existing.get("stage", "ai_extraction"),
                    "elapsed": existing.get("elapsed", 0) + 90,
                })
                print(f"[AI BG Heartbeat] {ai_job_id} ainda processando...")
        except Exception as e:
            print(f"[AI BG Heartbeat] Falha (não-crítico): {e}")


def _run_ai_extraction_task(ai_job_id: str, pdf_path: str, supplier: str):
    """BackgroundTask: roda Gemini sem bloquear a request HTTP do cliente.

    Heartbeat thread mantém `updatedAt` atualizado a cada 90s, evitando
    zombie check em jobs longos (catálogos 100+ páginas podem levar 5-15min).
    """
    import threading

    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=_heartbeat_loop, args=(ai_job_id, stop_heartbeat), daemon=True
    )
    heartbeat.start()

    try:
        # LAZY IMPORT: só importa aqui, mantém startup leve
        from gemini_extractor import extract_with_fallback as gemini_extract

        print(f"[AI BG] Iniciando job {ai_job_id} (supplier={supplier})...")
        # v23: passa supplier para ativar hints específicos no prompt
        result = gemini_extract(pdf_path, supplier=supplier)

        if result.get("success"):
            print(f"[AI BG] {ai_job_id} OK: {len(result['produtos'])} produtos | confiança={result.get('confianca', 0):.0%}")
        else:
            print(f"[AI BG] {ai_job_id} FALHA: {result.get('error')}")

        _save_status(ai_job_id, {
            "status": "success" if result.get("success") else "error",
            "ai_result": result,  # contém produtos, model, confianca, etc.
        })

    except Exception as e:
        import traceback
        print(f"[AI BG] {ai_job_id} EXCEÇÃO: {e}")
        print(traceback.format_exc())
        _save_status(ai_job_id, {
            "status": "error",
            "ai_result": {
                "success": False,
                "produtos": [],
                "error": str(e),
            },
        })
    finally:
        # Para o heartbeat
        stop_heartbeat.set()
        # Limpa o arquivo temporário do PDF
        try:
            if os.path.exists(pdf_path):
                os.unlink(pdf_path)
        except OSError:
            pass


@app.post("/extract_products_ai")
async def extract_products_ai(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    supplier: str = Form(""),
    jobId: str = Form(""),
):
    """
    Inicia extração de produtos via Gemini Vision em BACKGROUND.

    Retorna IMEDIATAMENTE {status: 'processing', jobId} para evitar timeouts
    HTTP (Render mata conexões longas, gerando 502 Bad Gateway). Frontend
    deve fazer polling em GET /extract_products_ai_status/{jobId}.

    Resolve OOM e 502 com PDFs grandes (NIX 12MB / 106 páginas).
    """
    import tempfile
    import uuid

    # Gera jobId se não veio do frontend (compat com chamadas antigas)
    ai_job_id = (jobId or "").strip() or f"ai_{uuid.uuid4()}"

    print(f"\n--- AI extraction iniciada: {file.filename} (job={ai_job_id}) ---")
    print(f"Fornecedor: {supplier}")

    # Salva PDF no disco. Background task processa depois.
    try:
        output_folder = f"temp/{ai_job_id}"
        os.makedirs(output_folder, exist_ok=True)
        pdf_path = os.path.join(output_folder, "ai_input.pdf")

        content = await file.read()
        with open(pdf_path, "wb") as f:
            f.write(content)
        print(f"PDF salvo: {len(content)} bytes -> {pdf_path}")

        # Marca como processando ANTES de disparar a task
        _save_status(ai_job_id, {"status": "processing", "stage": "ai_extraction"})

        # Dispara BackgroundTask - retorna agora, processa em paralelo
        background_tasks.add_task(_run_ai_extraction_task, ai_job_id, pdf_path, supplier)

        return {"status": "processing", "jobId": ai_job_id}

    except Exception as e:
        import traceback
        print(f"Erro ao iniciar AI job {ai_job_id}: {e}")
        print(traceback.format_exc())
        _save_status(ai_job_id, {
            "status": "error",
            "ai_result": {"success": False, "produtos": [], "error": str(e)},
        })
        return {"status": "error", "message": str(e), "jobId": ai_job_id}


@app.get("/extract_products_ai_status/{job_id}")
async def get_ai_status(job_id: str):
    """Polling endpoint para o resultado da extração AI assíncrona."""
    data = _load_status(job_id)
    # Compat: se job veio do disco, retorna como está
    return data


# ─────────────────────────────────────────────────────────────
# Endpoint AI CIRÚRGICO: resgata APENAS os preços faltantes
# ARQUITETURA ASSÍNCRONA: POST retorna jobId imediato, frontend
# faz polling em GET /repair_prices_ai_status/{job_id}.
# ─────────────────────────────────────────────────────────────

def _run_repair_task(job_id: str, pdf_path: str, skus_map: dict):
    """Background task: chama Gemini para resgatar preços e persiste status."""
    import time
    import threading

    # Heartbeat: atualiza updatedAt a cada 30s para evitar zombie detection
    stop_heartbeat = threading.Event()
    def heartbeat():
        while not stop_heartbeat.is_set():
            stop_heartbeat.wait(30)
            if stop_heartbeat.is_set():
                break
            cur = _load_status(job_id)
            if cur.get("status") == "processing":
                _save_status(job_id, cur)  # apenas refresca updatedAt
    hb_thread = threading.Thread(target=heartbeat, daemon=True)
    hb_thread.start()

    try:
        from gemini_extractor import repair_prices_for_skus

        api_key_set = bool(os.environ.get("GEMINI_API_KEY", "").strip())
        api_key_len = len(os.environ.get("GEMINI_API_KEY", "").strip())

        _save_status(job_id, {
            "status": "processing",
            "stage": "calling_gemini",
            "totalSkus": sum(len(s) for s in skus_map.values()),
            "totalPages": len(skus_map),
            "debug_env": {
                "gemini_key_set": api_key_set,
                "gemini_key_len": api_key_len,
                "service_version": SERVICE_VERSION,
            },
        })

        # max_workers=3: mais conservador para evitar OOM no Render Starter (512MB)
        result = repair_prices_for_skus(pdf_path, skus_map, max_workers=3)
        result["debug_env"] = {
            "gemini_key_set": api_key_set,
            "gemini_key_len": api_key_len,
            "service_version": SERVICE_VERSION,
        }
        result["status"] = "success"
        _save_status(job_id, result)
        print(f"[RepairTask] Job {job_id} concluído: {len(result.get('precos', {}))} preços")

    except Exception as e:
        import traceback
        print(f"[RepairTask] Erro no job {job_id}: {e}")
        print(traceback.format_exc())
        _save_status(job_id, {
            "status": "error",
            "success": False,
            "precos": {},
            "error": str(e),
            "details": traceback.format_exc()[:1000],
        })
    finally:
        stop_heartbeat.set()
        try:
            os.unlink(pdf_path)
        except OSError:
            pass


@app.post("/repair_prices_ai_v2")
@app.post("/repair_prices_ai")
async def repair_prices_ai(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    skus_by_page: str = Form("{}"),
):
    """
    Resgata preços faltantes via Gemini Vision (ASSÍNCRONO).

    POST aqui dispara background task e retorna jobId imediato.
    Frontend faz polling em /repair_prices_ai_status/{job_id}.

    Por que assíncrono: 91 SKUs em 51 páginas × ~3s/page = ~150s,
    mas Render gateway mata HTTP request em ~100-300s. Síncrono = 502.
    """
    import tempfile
    import uuid

    print(f"\n--- Repair prices AI (ASYNC): {file.filename} ---")
    print(f"[DEBUG] skus_by_page (raw, len={len(skus_by_page)}): {skus_by_page[:200]!r}")

    job_id = str(uuid.uuid4())

    try:
        skus_map_raw = json.loads(skus_by_page) if skus_by_page else {}
        skus_map = {int(k): list(v) for k, v in skus_map_raw.items() if v}
        print(f"[DEBUG] skus_map final ({len(skus_map)} pgs, {sum(len(s) for s in skus_map.values())} SKUs)")

        if not skus_map:
            # Early return síncrono: nada para fazer
            return {
                "jobId": job_id,
                "status": "success",
                "success": True,
                "precos": {},
                "paginas_processadas": 0,
                "elapsed": 0,
                "debug_received": skus_by_page[:200],
            }

        # Persiste PDF em temp (job worker vai ler depois)
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        content = await file.read()
        tmp.write(content)
        tmp.close()
        pdf_path = tmp.name

        # Status inicial
        _save_status(job_id, {
            "status": "processing",
            "stage": "queued",
            "totalSkus": sum(len(s) for s in skus_map.values()),
            "totalPages": len(skus_map),
        })

        # Dispara background task
        background_tasks.add_task(_run_repair_task, job_id, pdf_path, skus_map)

        return {
            "jobId": job_id,
            "status": "processing",
            "totalSkus": sum(len(s) for s in skus_map.values()),
            "totalPages": len(skus_map),
        }

    except Exception as e:
        import traceback
        print(f"Erro repair_prices_ai: {e}")
        print(traceback.format_exc())
        return {
            "jobId": job_id,
            "status": "error",
            "success": False,
            "precos": {},
            "error": str(e),
        }


@app.get("/repair_prices_ai_status/{job_id}")
async def get_repair_status(job_id: str):
    """Polling endpoint para o resultado do repair AI assíncrono."""
    data = _load_status(job_id)
    return data


if __name__ == "__main__":
    if "--serve" in sys.argv:
        # Porta vem da env var PORT (Render/Heroku injetam) ou 8000 local
        port = int(os.environ.get("PORT", 8000))
        uvicorn.run(app, host="0.0.0.0", port=port)
