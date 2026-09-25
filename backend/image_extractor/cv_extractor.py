"""
Extrator de imagens de catálogos PDF — abordagem padrão-ouro.

ESTRATÉGIA:
1. Detecta grid via OpenCV (linhas pontilhadas → células)
2. Para cada SKU, identifica a célula correta (foto na célula atual ou acima)
3. Encontra TODAS as imagens embedadas cujo centro está na célula
4. Pega a MAIOR (resolve variações de cor: pega a foto principal)
5. Extrai via doc.extract_image() — bytes raw do PDF, qualidade perfeita
6. Decodifica corretamente (handle JPEG, PNG, BGRA, grayscale, CMYK)
7. Fallback: crop do raster apenas se extract_image falhar

SAÍDA: {sku}.jpg contendo APENAS a foto do produto (sem textos, bordas, grid)
"""
import os
import math
import re
import cv2
import numpy as np
import fitz
from typing import List, Tuple, Dict, Optional


# ─────────────────────────────────────────────────────────────
# Ponto de entrada público
# ─────────────────────────────────────────────────────────────

def extract_cells_via_cv(
    pdf_path: str,
    skus_list: list,
    output_folder: str,
    scale: float = 1.0,  # Reduzido de 1.5 → 1.2 (28/05/2026) → 1.0 (22/06/2026):
                        # OOM DAGIA 215 págs: cada redução de 0.2 poupa ~30% de RAM.
                        # scale=1.5 → 3.3MB/pág | scale=1.2 → 2.2MB/pág | scale=1.0 → 1.5MB/pág.
                        # Sem impacto em qualidade: imagens são extraídas via xref (PDF raw),
                        # não do raster. O raster serve só pra grid detection e fallback.
    supplier_id: Optional[str] = None,  # v21: usado para ativar Gemini Vision
                                        # como decisor de imagem (DAGIA).
    use_ai_picker: bool = False,        # v21: se True, Gemini decide qual
                                        # imagem entre candidatos representa
                                        # cada SKU (substitui heurística).
    foto_composta: bool = False,        # opção do cadastro do fornecedor: a
                                        # foto do produto é montada por várias
                                        # imagens (caixa + brinquedo...).
) -> Tuple[List[Dict], List[Dict]]:
    """
    Extrai a imagem do produto para cada SKU.

    Estratégia adaptativa por página:
    - Grid     : 1-10 V-lines internas → CellMap → imagem estrutural na célula
    - Embedded : 0 ou >10 V-lines → imagem mais próxima por Y-proximity

    Em ambos os casos, usa doc.extract_image() para qualidade perfeita.

    Memória (otimizado para Render Starter 512MB):
      - 1 página A4 raster @ scale=1.2 = ~2.2MB (era 3.3MB @ 1.5)
      - gc.collect() a cada 5 páginas (era a cada 10) — mais agressivo
      - del raster/pix explícito após cada página
      - Limite hard: se >300 páginas, aborta com erro claro em vez de OOM
    """
    import gc

    # Limita o store MuPDF a 50MB — default é 256MB que, somado ao heap Python
    # (~150MB), ultrapassa os 512MB do Render Starter em catálogos com fotos
    # high-res. Com 50MB o MuPDF evicta agressivamente em vez de acumular.
    fitz.TOOLS.store_maxsize = 50 * 1024 * 1024
    fitz.TOOLS.store_shrink(100)  # começa limpo

    doc = fitz.open(pdf_path)
    matches: List[Dict] = []
    unmatched: List[Dict] = []

    logo_xrefs, logo_digests = _detect_logo_xrefs(doc)

    # Deduplica SKUs por (sku, page)
    seen_keys: set = set()
    deduped: list = []
    for sku in skus_list:
        sc = sku.get("spatialContext")
        key = (sku.get("sku"), sc.get("page") if sc else None)
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(sku)
    skus_list = deduped

    # Catálogo em que cada produto é UM card-imagem e o código não existe como
    # texto (achado na Folia). Medido no próprio arquivo, não pelo nome.
    grade_de_cards = _detectar_grade_de_cards(doc, skus_list, logo_xrefs, logo_digests)
    if grade_de_cards:
        _assign_folia_card_positions(
            doc, skus_list, logo_xrefs, logo_digests,
        )

    skus_by_page: Dict[int, list] = {}
    for sku in skus_list:
        sc = sku.get("spatialContext")
        if not sc:
            continue
        skus_by_page.setdefault(sc.get("page", 1), []).append(sku)

    total_pages = len(skus_by_page)
    print(f"[CV] {total_pages} páginas | {len(skus_list)} SKUs | logos filtrados: {len(logo_xrefs)} xref + {len(logo_digests)} conteúdo")

    # Hard limit: catálogos com >300 páginas com SKUs estouram 512MB do Render
    # mesmo com gc agressivo. Falha rápido com erro claro em vez de OOM
    # (que mata o container e perde o job).
    if total_pages > 300:
        doc.close()
        raise RuntimeError(
            f"Catálogo muito grande: {total_pages} páginas com SKUs excede o limite "
            f"de 300 do plano Render Starter (512MB RAM). Considere processar em "
            f"lotes ou upgrade para plano com mais RAM."
        )

    # Onde fica a foto em relacao ao codigo? Medido no proprio arquivo, uma vez
    # por catalogo, em vez de assumido. Ver _detectar_orientacao_do_catalogo.
    orientacao = _detectar_orientacao_do_catalogo(
        doc, skus_by_page, logo_xrefs, logo_digests,
    )

    sorted_pages = sorted(skus_by_page.keys())
    for page_idx, page_num in enumerate(sorted_pages):
        page_skus = skus_by_page[page_num]
        page = doc.load_page(page_num - 1)

        # Renderizar para detecção de grid (e fallback de crop)
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        raster = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        height, width = raster.shape[:2]

        # Detectar grade
        h_lines, v_lines = _detect_lines(raster, width, height)
        h_coords = _finalize_coords([l[0] for l in h_lines], 40, min_count=2,
                                    boundary_lo=0.0, boundary_hi=float(height))
        v_coords = _finalize_coords([l[0] for l in v_lines], 40, min_count=2,
                                    boundary_lo=0.0, boundary_hi=float(width))
        n_interior_v = len(v_coords) - 2

        page_imgs = _get_page_embedded_images(page, logo_xrefs, logo_digests)
        # Na grade de cards cada imagem já é o card de UM produto — costurar
        # juntava 3 cards encostados de 190/190/192pt (FOLIA pág. 12, Josef
        # 24/09/2026: JRF-50.0111, 0020 e 0113 sem foto).
        if not grade_de_cards:
            page_imgs = _costurar_tiles(page_imgs)

        pct = int((page_idx + 1) / total_pages * 100)
        print(f"[CV] [{page_idx+1}/{total_pages} {pct}%] Pág {page_num}: {n_interior_v} V-int | {len(page_imgs)} imgs", end="")

        if grade_de_cards:
            print(" → GRADE DE CARDS")
            pm, pu = _match_folia_cards(
                doc, page, raster, page_skus, page_imgs,
                scale, output_folder, page_num,
            )
        elif 1 <= n_interior_v <= 10:
            print(f" → GRID ({len(h_coords)}H×{len(v_coords)}V)")
            pm, pu = _match_via_grid(doc, page, raster, h_coords, v_coords,
                                     page_skus, page_imgs, scale, output_folder, page_num,
                                     orientacao=orientacao, foto_composta=foto_composta)
        else:
            print(f" → EMBEDDED")
            pm, pu = _match_via_embedded(doc, raster, page_skus, page_imgs,
                                         scale, output_folder, page_num,
                                         orientacao=orientacao)

        # ─── v24: GEMINI VISION PICKER memory-safe (substitui heurística) ───
        # Quando use_ai_picker=True (opção "IA escolhe a foto" no cadastro do
        # fornecedor — nasceu na DAGIA; custa 1 chamada por página), manda a página JÁ
        # renderizada (1 imagem, com números desenhados nas candidatas) pro
        # Gemini decidir qual número é a foto de cada SKU. Extrai SÓ a escolhida.
        #
        # MEMÓRIA (vs v21 que causou OOM): NÃO extrai todas as candidatas como
        # arrays. Passa só os rects + o raster que já existe. 1 cópia anotada
        # downscalada + 1 chamada Gemini por página. Footprint ~igual ao atual.
        if use_ai_picker and page_skus:
            try:
                from gemini_image_picker import pick_images_for_page

                # Candidatas para o AI Picker: lista PERMISSIVA (allow_fullpage)
                # — inclui a foto principal quando ela cobre quase a página
                # inteira (caso DAGIA pg 14, copos). Logos seguem filtrados.
                ai_page_imgs = _get_page_embedded_images(page, logo_xrefs, logo_digests, allow_fullpage=True)

                # Candidatas = rects (NÃO arrays). Filtra fragmentos minúsculos
                # por área do rect (sem extrair pixels ainda).
                candidates_for_ai: List[Dict] = []
                for img_info in ai_page_imgs:
                    r = img_info["rect"]
                    area_px = (r.width * scale) * (r.height * scale)
                    if area_px >= 5000:
                        candidates_for_ai.append({"xref": img_info["xref"], "rect": r})

                if candidates_for_ai:
                    skus_for_ai = [
                        {"sku": s.get("sku"), "name": s.get("name", "")}
                        for s in page_skus if s.get("sku")
                    ]
                    print(f"[CV] AI PICKER v24 pág {page_num}: {len(skus_for_ai)} SKUs, {len(candidates_for_ai)} candidatas")
                    # Passa o raster já renderizado + rects. Sem extração prévia.
                    picks = pick_images_for_page(
                        raster, candidates_for_ai, page_num, skus_for_ai, scale
                    )

                    # info por xref pra extração sob demanda (só da escolhida)
                    img_info_by_xref = {p["xref"]: p for p in ai_page_imgs}
                    for sku_info in page_skus:
                        sku_code = sku_info.get("sku")
                        if not sku_code:
                            continue
                        chosen_xref = picks.get(sku_code)
                        if chosen_xref is None:
                            continue
                        chosen_info = img_info_by_xref.get(chosen_xref)
                        if not chosen_info:
                            continue
                        # Extrai APENAS a imagem escolhida (qualidade perfeita)
                        img_rgb = _extract_perfect_image(doc, chosen_info, raster, width, height, scale)
                        if img_rgb is None or img_rgb.size == 0:
                            continue
                        box_image_hires = _resize_keep_aspect(img_rgb, max_dim=1200)
                        existing = next((m for m in pm if m["sku"] == sku_code), None)
                        if existing:
                            _save_image_hires(box_image_hires, sku_code, output_folder)
                            existing["match_type"] = "ai_picker"
                            print(f"[CV] AI: override match {sku_code} → xref={chosen_xref}")
                        else:
                            filepath = _save_image_hires(box_image_hires, sku_code, output_folder)
                            pm.append(_make_match(sku_info, page_num, filepath, "ai_picker"))
                            pu = [u for u in pu if u.get("sku") != sku_code]
                            print(f"[CV] AI: novo match {sku_code} → xref={chosen_xref}")
                        del img_rgb, box_image_hires  # libera imediatamente
            except Exception as e:
                print(f"[CV] AI Picker falhou pág {page_num}: {str(e)[:200]} — usando heurística fallback")

        # ─── KIT BOX IMAGE (heurística): SKUs DAGIA DZ + DXPD ───
        # FALLBACK: roda só se AI Picker não rodou ou não decidiu pra esse SKU.
        # Cliente reportou (v17): colagem ficou com baixa resolução + faltavam
        # peças. Sugestão dele: usar a imagem da CAIXA (que já mostra o kit
        # montado com todas as peças). Estratégia v18: pegar a MAIOR imagem
        # da página (em pixels) que tipicamente é a foto da caixa do kit.
        import re as _re
        kit_skus_raw = [s for s in page_skus
                        if s.get("sku") and _re.match(r"^(DZ|DXPD)\d+", str(s["sku"]).upper())]
        # Se AI Picker já decidiu para este SKU, NÃO sobrescreve com heurística
        ai_decided_skus = {m["sku"] for m in pm if m.get("match_type") == "ai_picker"}
        kit_skus = [s for s in kit_skus_raw if s.get("sku") not in ai_decided_skus]
        if kit_skus and page_imgs:
            print(f"[CV] KIT detectado em pág {page_num}: {len(kit_skus)} SKU(s), buscando imagem maior (caixa)")

            # Heurística refinada (v20) para identificar a CAIXA do kit DAGIA:
            # Análise empírica de páginas reais 4-10 do catálogo:
            #   - Pratos: aspect h/w ≈ 0.97-1.01 (quadrados perfeitos)
            #   - Caixas (3D em perspectiva): aspect h/w ≈ 0.65-0.90 (mais larga)
            #   - Peças avulsas: aspect ≈ 0.95-1.05
            # Logo: BÔNUS FORTE para aspect 0.65-0.90, PENALIDADE para ~1.0.
            def _box_score(img: np.ndarray) -> float:
                h, w = img.shape[:2]
                if h == 0 or w == 0:
                    return -1.0
                ratio = h / w
                if 0.65 <= ratio <= 0.90:
                    aspect_score = 1.0  # zona ouro da caixa
                elif 0.55 <= ratio < 0.65 or 0.90 < ratio <= 1.05:
                    aspect_score = 0.6  # zona ambígua
                elif 0.40 <= ratio < 0.55 or 1.05 < ratio <= 1.30:
                    aspect_score = 0.3  # menos provável
                else:
                    aspect_score = 0.1  # quase certo não é caixa
                try:
                    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
                    std_dev = float(np.std(gray)) / 255.0
                except Exception:
                    std_dev = 0.3
                import math as _math
                size_score = min(_math.log10(max(h * w, 1)) / 6.0, 1.0)
                return aspect_score * 0.55 + std_dev * 0.30 + size_score * 0.15

            # ─── STREAMING anti-OOM (23/06/2026) ──────────────────────────
            # NÃO acumula todas as imagens da página como arrays. Em DZ01 (pág 36)
            # isso chegava a ~65MB de arrays VIVOS de uma vez → OOM no Render
            # 512MB. fitz.store_shrink/malloc_trim (v44/v45) NÃO liberam refs
            # vivas — por isso não resolveram. Aqui mantemos só o MELHOR array
            # por vez (pico ~2 imagens). Re-honra IV-16 (não materializar todas
            # as candidatas antes de decidir). Medido: 65MB → ~5MB de pico.
            best_img = None          # melhor candidata (área >= 20000)
            best_score = -1.0
            fallback_img = None      # maior área entre TODAS (se nenhuma >= 20000)
            fallback_area = -1
            for img_info in page_imgs:
                try:
                    arr = _extract_perfect_image(doc, img_info, raster, width, height, scale)
                except Exception as e:
                    print(f"[CV] kit: falha ao extrair imagem (xref={img_info.get('xref')}): {e}")
                    continue
                if arr is None or arr.size == 0:
                    continue
                h, w = arr.shape[:2]
                area = h * w
                keep = False
                if area >= 20000:  # ignora fragmentos (ícones/badges/logos)
                    sc = _box_score(arr)
                    if sc > best_score:
                        best_score = sc
                        best_img = arr  # rebinda: best antigo perde ref e é coletado
                        keep = True
                elif area > fallback_area:
                    fallback_area = area
                    fallback_img = arr
                    keep = True
                if not keep:
                    del arr  # libera imediatamente (não é melhor nem fallback)

            box_image = best_img if best_img is not None else fallback_img
            if box_image is not None:
                h0, w0 = box_image.shape[:2]
                print(f"[CV] kit: escolhida imagem aspect={h0/max(w0,1):.2f}, área={h0*w0}, score={best_score:.2f}")
                # max_dim 1200 pra kit (preserva qualidade da foto da caixa)
                box_image_hires = _resize_keep_aspect(box_image, max_dim=1200)
                del best_img, fallback_img, box_image  # libera os full-res
                for kit_sku in kit_skus:
                    sku_code = kit_sku["sku"]
                    existing = next((m for m in pm if m["sku"] == sku_code), None)
                    if existing:
                        _save_image_hires(box_image_hires, sku_code, output_folder)
                        existing["match_type"] = "kit_box"
                        print(f"[CV] kit box salvo (1200px): {sku_code}")
                    else:
                        filepath = _save_image_hires(box_image_hires, sku_code, output_folder)
                        pm.append(_make_match(kit_sku, page_num, filepath, "kit_box"))
                        pu = [u for u in pu if u.get("sku") != sku_code]
                        print(f"[CV] kit box (novo match): {sku_code}")
                del box_image_hires
                gc.collect()

        matches.extend(pm)
        unmatched.extend(pu)

        # Libera memória explicitamente (Render Starter 512MB é apertado)
        del raster, pix, page_imgs, h_lines, v_lines
        page = None
        # gc.collect() a cada 5 páginas (era 10) — mais agressivo após OOM
        # confirmado em catálogo DAGIA (apenas 24 páginas com imagens pesadas).
        if (page_idx + 1) % 5 == 0:
            gc.collect()
            fitz.TOOLS.store_shrink(100)
            print(f"[CV] gc+store_shrink em pág {page_idx+1}/{total_pages}")

    doc.close()
    fitz.TOOLS.store_shrink(100)
    gc.collect()
    print(f"[CV] Total: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Detecção de grade via OpenCV
# ─────────────────────────────────────────────────────────────

def _detect_lines(raster: np.ndarray, width: int, height: int) -> Tuple[list, list]:
    gray = cv2.cvtColor(raster, cv2.COLOR_RGB2GRAY)
    min_hl = int(width * 0.15)
    min_vl = int(height * 0.15)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 60,
                             minLineLength=max(50, min_hl // 3), maxLineGap=20)
    h_lines, v_lines = [], []
    if lines is None:
        return h_lines, v_lines
    for line in lines:
        # cv2.HoughLinesP retorna (N,1,4) na maioria das builds, mas ALGUMAS
        # versoes do opencv (ex: a instalada no Render via opencv-python-headless
        # >=4.10) retornam (N,4) — nesse caso `line` ja e' (4,) e `line[0]` seria
        # um escalar int32, quebrando o unpack (crash real 22/07/2026, catalogo
        # GIRA cortado). Achatar torna o codigo robusto as duas formas.
        coords = np.asarray(line).reshape(-1)
        if coords.size < 4:
            continue
        x1, y1, x2, y2 = int(coords[0]), int(coords[1]), int(coords[2]), int(coords[3])
        dx, dy = x2 - x1, y2 - y1
        angle = np.arctan2(dy, dx) * 180 / np.pi
        if angle < 0:
            angle += 180
        seg_len = np.sqrt(dx * dx + dy * dy)
        if (angle < 2 or angle > 178) and seg_len >= min_hl:
            h_lines.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
        elif 88 < angle < 92 and seg_len >= min_vl:
            v_lines.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))
    return h_lines, v_lines


def _finalize_coords(raw: list, tolerance: float, min_count: int,
                     boundary_lo: float, boundary_hi: float) -> List[float]:
    if not raw:
        return [boundary_lo, boundary_hi]
    clusters = _cluster_coords(raw, tolerance)
    counts = _count_segments_per_cluster([(v, 0, 0) for v in raw], clusters, tolerance)
    filtered = [c for c, cnt in zip(clusters, counts) if cnt >= min_count]
    return sorted(set([boundary_lo] + filtered + [boundary_hi]))


# ─────────────────────────────────────────────────────────────
# Selos / tags sobrepostos à foto do produto
# ─────────────────────────────────────────────────────────────

# Foto de produto ~34.000px², selo ~1.300px² (≈4%) — medido no catálogo GIRA.
# 15% derruba o selo com folga sem encostar em foto real.
BADGE_AREA_RATIO = 0.15
# Quanto do selo precisa estar DENTRO da foto para ser considerado sobreposto.
BADGE_CONTAINMENT = 0.80
# E ele tem que ser bem menor que a foto: duas fotos de produto nunca se
# sobrepõem assim, mas um selo "PROMOCIONAL" no canto da foto, sim.
BADGE_MAX_REL_AREA = 0.50


def _foto_principal_da_celula(sku, valid_skus, imgs, usadas, page_w, page_h, min_area=0.0):
    """Catálogo com foto ABAIXO do código: o bloco do produto vai do seu código
    até o próximo código abaixo (mesma faixa horizontal) e, na horizontal, até o
    código vizinho à direita na mesma linha. A foto principal é a MAIOR imagem
    cujo centro cai no bloco — a foto larga que fica longe do código em X (ou
    começa acima dele) não perde para o detalhe/zoom que está mais perto."""
    sc = sku["spatialContext"]
    sx, sy = sc["x"], sc["y"]
    meia = (sc.get("width") or 40.0) / 2.0
    x0 = max(0.0, sx - meia - 5.0)
    x1 = page_w
    for o in valid_skus:
        if o is sku:
            continue
        oc = o["spatialContext"]
        if abs(oc["y"] - sy) < 30.0 and oc["x"] > sx + 20.0:
            x1 = min(x1, oc["x"] - (oc.get("width") or 40.0) / 2.0 - 5.0)
    y0, y1 = sy - 10.0, page_h
    # Próximo código abaixo em QUALQUER coluna: a coluna da direita sem
    # código abaixo ia até o fim da página e a maior foto de lá (a estante do
    # RD2131) ganhava da foto do próprio RD1715 (PETRIN pág. 85, Josef
    # 25/09/2026). Medido no catálogo inteiro: o bloco curto primeiro acerta
    # também RD1006/1012 (bolas), RD1589, RD2050, RD1857 (porta-retrato que
    # pegava a moldura do RD1856). Se nada cabe no bloco curto, vale o bloco
    # só pela coluna.
    y1_qualquer = page_h
    for o in valid_skus:
        if o is sku:
            continue
        oc = o["spatialContext"]
        if oc["y"] > sy + 30.0:
            y1_qualquer = min(y1_qualquer, oc["y"] - 10.0)
            if x0 <= oc["x"] < x1:
                y1 = min(y1, oc["y"] - 10.0)

    def _maior_no_bloco(y_fim):
        melhor = None
        for img in imgs:
            if id(img) in usadas or img.get("rect") is None:
                continue
            if min_area > 0 and img.get("area", 0.0) < min_area:
                continue
            if x0 <= img["cx"] < x1 and y0 <= img["cy"] < y_fim:
                if melhor is None or img.get("area", 0.0) > melhor.get("area", 0.0):
                    melhor = img
        return melhor

    if y1_qualquer < y1:
        melhor = _maior_no_bloco(y1_qualquer)
        if melhor is not None:
            return melhor
    return _maior_no_bloco(y1)


def _descartar_selos(page_imgs: List[Dict], tag: str) -> List[Dict]:
    """
    Tira da disputa as imagens que são SELO/TAG, não foto de produto.

    Reunião com o Josef (20/08/2026, catálogo GIRA): tags "PROMOCIONAL",
    "OFERTA" e "NOVIDADE" estavam saindo como se fossem a imagem do produto.
    Causa: elas ficam SOBREPOSTAS à foto real, então o centro delas chega a
    ficar mais perto do texto do código do que o centro da foto grande — e o
    casamento por proximidade escolhia o selo.

    Dois sinais, ambos geométricos (não dependem do layout do fornecedor):

      1. Tamanho relativo — abaixo de 15% da maior imagem da página não é foto
         de produto. Já existia no caminho de grid desde 22/07; o caminho por
         proximidade (Lila, BM36, GIRA) não tinha nenhum filtro, e era por lá
         que o selo passava.

      2. Sobreposição — imagem contida em ≥80% dentro de outra MAIOR e com
         menos da metade da área dela é overlay, não produto. Pega o selo que
         escapa do item 1 por ser grande demais (ex.: faixa "OFERTA" atravessando
         a foto inteira).

    Nunca esvazia a página: se os dois filtros derrubarem tudo, devolve a lista
    original. Ficar sem imagem nenhuma é pior que arriscar um selo.
    """
    if len(page_imgs) < 2:
        return page_imgs

    max_area = max(img.get("area", 0) for img in page_imgs)
    if max_area <= 0:
        return page_imgs

    # sobrepostas: selo propriamente dito (≥80% contido numa foto maior) — some
    # a imagem some da disputa mesmo sendo grande o bastante pra passar no
    # filtro de tamanho (ex.: faixa "OFERTA" atravessando a foto inteira).
    #
    # toca_imagem_maior: sinal mais fraco — a imagem apenas ENCOSTA em alguma
    # foto maior, mesmo sem os 80% de contenção. É o que separa selo de
    # variante de cor: um selo/tag sempre fica SOBRE a foto real (é assim que
    # o Josef descreveu o bug da GIRA — "sobrepostas à foto"). Uma miniatura
    # de variante de cor (VAESO: 4 cores, 1 foto grande + 3 pequenas — 25/08)
    # fica no SEU PRÓPRIO espaço da página, sem tocar a foto grande. Por isso
    # o filtro de tamanho (item 1) só vale se a imagem pequena também tocar
    # alguma maior — sem essa condição as 3 fotos legítimas de cor eram
    # descartadas junto com os selos de verdade, e a VAESO saía com 102 de
    # 162 produtos sem imagem.
    sobrepostas = set()
    toca_imagem_maior = set()
    for i, selo in enumerate(page_imgs):
        r_selo, a_selo = selo.get("rect"), selo.get("area", 0)
        if r_selo is None or a_selo <= 0:
            continue
        for j, foto in enumerate(page_imgs):
            if i == j:
                continue
            r_foto, a_foto = foto.get("rect"), foto.get("area", 0)
            if r_foto is None or a_foto <= 0 or a_foto <= a_selo:
                continue
            inter = r_selo & r_foto
            if inter.is_empty:
                continue
            toca_imagem_maior.add(i)
            if a_selo > a_foto * BADGE_MAX_REL_AREA:
                continue
            if (inter.width * inter.height) >= a_selo * BADGE_CONTAINMENT:
                sobrepostas.add(i)
                break

    mantidas = [
        img for i, img in enumerate(page_imgs)
        if i not in sobrepostas
        and (img.get("area", 0) >= max_area * BADGE_AREA_RATIO or i not in toca_imagem_maior)
    ]

    if not mantidas:
        print(f"  [{tag}] filtro de selo derrubaria TODAS as imagens — mantendo a página como estava")
        return page_imgs

    n = len(page_imgs) - len(mantidas)
    if n > 0:
        print(f"  [{tag}] {n} selo(s)/tag(s) descartado(s) "
              f"(< {BADGE_AREA_RATIO:.0%} da maior ou sobreposto a uma foto maior)")
    return mantidas


# ─────────────────────────────────────────────────────────────
# Estratégia A: Column-First (catálogos com layout em grid)
# ─────────────────────────────────────────────────────────────

def _cluster_coords(coords: List[float], tolerance: float = 20.0) -> List[float]:
    """Agrupa coordenadas X próximas e retorna os centros de cada grupo."""
    if not coords:
        return []
    sorted_coords = sorted(coords)
    clusters = []
    current_cluster = [sorted_coords[0]]
    
    for x in sorted_coords[1:]:
        if x - current_cluster[-1] <= tolerance:
            current_cluster.append(x)
        else:
            clusters.append(sum(current_cluster) / len(current_cluster))
            current_cluster = [x]
    if current_cluster:
        clusters.append(sum(current_cluster) / len(current_cluster))
        
    return clusters


def _detectar_grade_de_cards(
    doc: fitz.Document,
    skus_list: list,
    logo_xrefs: set,
    logo_digests: set,
) -> bool:
    """O catálogo é uma grade de cards, em que cada produto é UMA imagem com
    foto + código + preço desenhados na arte (achado na Folia)?

    Dois sinais medidos no próprio arquivo, os dois necessários:
    1. os códigos não existem como texto no PDF (>=60% dos SKUs amostrados
       não aparecem na camada de texto da própria página) — num catálogo
       com texto isso é ~0%;
    2. nas páginas conferidas, há pelo menos um card grande por SKU em >=60%
       delas (mesmo critério de tamanho/formato de `_folia_card_candidates`).
    O sinal 1 olha o TEXTO DO PDF, não o `spatialContext` do SKU: a leitura
    por visão devolve posição aproximada pra cada produto, então "SKU sem
    posição" não prova ausência de texto (regressão em produção 23/09/2026,
    FOLIA recadastrada: 298/301 SKUs com posição da visão → grade não
    detectada → card inteiro exportado com preço).
    Medido em 23/09/2026: FOLIA Utilidades e Brinquedos passam; BM36, DAGIA,
    DUTE, FORTAL, GIRA, PETRIN e VAESO têm ~0% de código fora do texto.
    """
    if not skus_list:
        return False

    def _pagina(sku: dict) -> Optional[int]:
        pagina = sku.get("page") or (sku.get("spatialContext") or {}).get("page")
        return pagina if isinstance(pagina, int) and 1 <= pagina <= len(doc) else None

    com_pagina = [(s, _pagina(s)) for s in skus_list if s.get("sku")]
    com_pagina = [(s, pg) for s, pg in com_pagina if pg]
    if not com_pagina:
        return False
    passo_sku = max(1, len(com_pagina) // 200)
    amostra = com_pagina[::passo_sku]
    textos: Dict[int, str] = {}
    fora_do_texto = 0
    for sku, pagina in amostra:
        if pagina not in textos:
            textos[pagina] = re.sub(r"\s+", "", doc.load_page(pagina - 1).get_text()).upper()
        codigo = re.sub(r"\s+", "", str(sku["sku"])).upper()
        if codigo not in textos[pagina]:
            fora_do_texto += 1
    if fora_do_texto < 0.6 * len(amostra):
        return False
    por_pagina: Dict[int, int] = {}
    for _sku, pagina in com_pagina:
        por_pagina[pagina] = por_pagina.get(pagina, 0) + 1
    paginas = sorted(por_pagina)
    passo = max(1, len(paginas) // 20)
    conferidas = paginas[::passo]
    com_cards = 0
    for pagina in conferidas:
        page = doc.load_page(pagina - 1)
        imgs = _get_page_embedded_images(page, logo_xrefs, logo_digests)
        if len(_folia_card_candidates(page, imgs)) >= por_pagina[pagina]:
            com_cards += 1
    detectado = com_cards >= 0.6 * len(conferidas)
    print(f"[CV] Grade de cards: {fora_do_texto}/{len(amostra)} códigos fora do texto do PDF, "
          f"{com_cards}/{len(conferidas)} páginas com card por SKU → {'SIM' if detectado else 'não'}")
    return detectado


def _folia_card_candidates(page: fitz.Page, page_imgs: List[Dict]) -> List[Dict]:
    """Seleciona e ordena os cards quadrados do catálogo Folia.

    Medido no PDF real de 20/07/2026: cards têm ~184-192pt, ficam abaixo do
    cabeçalho (Y>14% da página) e formam uma grade de três colunas. Os vários
    pedaços do logotipo ficam no cabeçalho e são menores/retangulares.
    """
    page_w, page_h = page.rect.width, page.rect.height
    cards = []
    for image in page_imgs:
        rect = image["rect"]
        aspect = rect.width / max(rect.height, 1.0)
        if (
            rect.y0 > page_h * 0.14
            and rect.width >= page_w * 0.18
            and rect.height >= page_h * 0.10
            and 0.70 <= aspect <= 1.45
        ):
            cards.append(image)

    # Pequenas oscilações de 1-3pt no Y não podem trocar a ordem da linha.
    row_band = max(10.0, page_h * 0.015)
    return sorted(cards, key=lambda image: (
        round(image["rect"].y0 / row_band), image["rect"].x0,
    ))


def _assign_folia_card_positions(
    doc: fitz.Document,
    skus_list: list,
    logo_xrefs: set,
    logo_digests: set,
) -> int:
    """Preenche coordenadas ausentes da Folia pela grade visual dos cards."""
    missing_by_page: Dict[int, list] = {}
    for sku in skus_list:
        if sku.get("spatialContext"):
            continue
        page_number = sku.get("page")
        if isinstance(page_number, int) and 1 <= page_number <= len(doc):
            missing_by_page.setdefault(page_number, []).append(sku)

    assigned = 0
    for page_number, page_skus in missing_by_page.items():
        page = doc.load_page(page_number - 1)
        page_imgs = _get_page_embedded_images(page, logo_xrefs, logo_digests)
        cards = _folia_card_candidates(page, page_imgs)
        if len(cards) < len(page_skus):
            print(
                f"[FoliaCards] pág {page_number}: {len(page_skus)} SKUs, "
                f"mas só {len(cards)} cards confiáveis; mantendo sem coordenada"
            )
            continue
        for sku, card in zip(page_skus, cards):
            rect = card["rect"]
            sku["spatialContext"] = {
                "x": card["cx"],
                "y": card["cy"],
                "width": rect.width,
                "height": rect.height,
                "page": page_number,
            }
            assigned += 1
    if assigned:
        print(f"[FoliaCards] coordenadas inferidas em {assigned} SKU(s)")
    return assigned


def _crop_folia_price_band(img_rgb: np.ndarray) -> np.ndarray:
    """Recorta a faixa de baixo (especificações + etiqueta de preço) do card
    da Folia, devolvendo só a fotografia do produto.

    Josef (15/09/2026): "as imagens estão capturando valor também, não pode.
    Precisa ser somente a imagem pra não ter divergência nas alterações de
    preço" — a foto trazia o preço IMPRESSO junto, e se o preço mudar depois
    (desconto, reajuste), a imagem salva mostra um valor que já não é o real.

    Cada card da Folia é UMA ÚNICA imagem rasterizada (não há texto nem preço
    "por cima" via PDF — é tudo a mesma arte, ver `guide.md #14.9`), então não
    dá pra excluir a faixa por xref: tem que recortar o PIXEL certo dentro da
    própria imagem.

    Como acha o corte: a faixa de baixo (specs + preço) usa a MESMA cor navy
    da borda do card. Mede essa cor na própria imagem (não fixa um RGB —
    catálogos futuros podem trocar a paleta) e varre de CIMA PRA BAIXO, a
    partir do meio do card, procurando a transição NÍTIDA onde a linha vira
    quase 100% navy (a borda superior da faixa é uma aresta reta — dá esse
    salto abrupto de uma linha pra outra).

    Por que de cima pra baixo, e não o inverso: a primeira versão procurava o
    FIM da faixa varrendo de baixo pra cima, e falhava num card com nome de
    produto mais largo — o texto branco cria linhas com pouco navy MESMO
    DENTRO da faixa (uma palavra larga o suficiente derruba a fração abaixo do
    limiar por 3-4 linhas seguidas), o que a varredura de baixo confundia com
    "a foto recomeçou" e cortava tarde demais, sobrando o texto. A aresta de
    CIMA da faixa não tem esse problema: ela é sempre uma transição reta e
    limpa, então around 2 linhas consecutivas com fração de navy > 85% bastam
    pra identificá-la com segurança — provado nas 298 imagens do catálogo
    real (0 sobras de navy, 0 fallback pra "sem corte").

    Só olha a METADE ESQUERDA de cada linha: a etiqueta de preço (clara) fica
    na direita e, se entrar na conta, dilui a fração de navy da própria linha
    da faixa.

    Se a faixa não for encontrada numa proporção plausível (55%-97% da altura),
    devolve a imagem ORIGINAL sem recortar — plano de segurança: card com
    layout fora do padrão não pode ficar com a foto cortada ao meio.
    """
    h, w = img_rgb.shape[:2]
    if h < 20 or w < 20:
        return img_rgb
    linha_borda = img_rgb[min(2, h - 1)]
    navy = np.median(linha_borda[w // 3: 2 * w // 3], axis=0)
    x0, x1 = 0, int(w * 0.52)  # só a metade esquerda — foge da etiqueta de preço

    def fracao_navy(y: int) -> float:
        trecho = img_rgb[y, x0:x1].astype(int)
        dist = np.abs(trecho - navy).sum(axis=-1)
        return float((dist < 45).mean())

    topo_faixa = None
    for y in range(int(h * 0.5), h - 2):
        if fracao_navy(y) > 0.85 and fracao_navy(y + 1) > 0.85:
            topo_faixa = y
            break

    if topo_faixa is None or not (0.55 * h <= topo_faixa <= 0.97 * h):
        return img_rgb
    return img_rgb[:topo_faixa, :, :]


def _folia_cards_por_ordem(skus: list, cards: List[Dict]) -> Optional[List[Tuple[dict, Dict]]]:
    """Casa SKU↔card pela ORDEM de leitura (linha, depois coluna), não pela
    distância. A posição que a leitura por visão devolve vem com a escala da
    página errada — FOLIA pág. 16 (Josef 24/09/2026): linhas em y=173/304/434
    com os cards em y=246/442/639; pela distância a 2ª linha caía na 1ª e os
    9 produtos saíam com a foto de outro. A ORDEM relativa, porém, vem certa.

    Só vale quando há exatamente um card por SKU: as linhas dos cards (medidas
    no PDF) dizem quantos SKUs vão em cada linha; os SKUs ordenados por Y
    enchem as linhas nessa ordem, e dentro da linha casam por X. Devolve None
    (usa a distância) se as contas não baterem.
    """
    if not skus or len(skus) != len(cards):
        return None
    ordem_cards = sorted(cards, key=lambda c: c["cy"])
    linhas: List[List[Dict]] = []
    for card in ordem_cards:
        altura = card["rect"].height
        if linhas and abs(card["cy"] - linhas[-1][0]["cy"]) <= altura * 0.5:
            linhas[-1].append(card)
        else:
            linhas.append([card])
    por_y = sorted(skus, key=lambda s: (s["spatialContext"]["y"], s["spatialContext"]["x"]))
    pares: List[Tuple[dict, Dict]] = []
    inicio = 0
    for linha in linhas:
        grupo = por_y[inicio:inicio + len(linha)]
        inicio += len(linha)
        # a linha de SKUs precisa estar separada da próxima (senão a leitura
        # misturou linhas e a ordem não é confiável)
        if inicio < len(por_y) and por_y[inicio]["spatialContext"]["y"] <= grupo[-1]["spatialContext"]["y"]:
            return None
        grupo.sort(key=lambda s: s["spatialContext"]["x"])
        pares.extend(zip(grupo, sorted(linha, key=lambda c: c["cx"])))
    return pares


def _match_folia_cards(
    doc: fitz.Document,
    page: fitz.Page,
    raster: np.ndarray,
    page_skus: list,
    page_imgs: List[Dict],
    scale: float,
    output_folder: str,
    page_num: int,
) -> Tuple[List[Dict], List[Dict]]:
    """Casa cada SKU Folia diretamente com o card visual mais próximo.

    As linhas do Illustrator variam entre páginas e faziam o algoritmo de
    colunas rejeitar cards legítimos. No PDF real, porém, cada produto é uma
    imagem quadrada independente; distância entre centros é a regra exata.
    """
    cards = _folia_card_candidates(page, page_imgs)
    available = list(cards)
    matches: List[Dict] = []
    unmatched: List[Dict] = []
    height, width = raster.shape[:2]

    positioned = [sku for sku in page_skus if sku.get("spatialContext")]
    por_ordem = _folia_cards_por_ordem(positioned, cards)
    if por_ordem is not None:
        for sku, chosen in por_ordem:
            image = _extract_perfect_image(doc, chosen, raster, width, height, scale)
            if image is None or image.size == 0:
                unmatched.append({
                    "sku": sku.get("sku"), "page": page_num,
                    "reason": "folia_card_extract_failed",
                })
                continue
            image = _crop_folia_price_band(image)
            filepath = _save_image(image, sku["sku"], output_folder)
            matches.append(_make_match(sku, page_num, filepath, "folia_card"))
            del image
        positioned = []
    # Resolve primeiro quem está mais perto de algum card. Isso evita que uma
    # coordenada imprecisa pegue o card de outra coordenada quase perfeita.
    ranked = []
    for sku in positioned:
        context = sku["spatialContext"]
        if cards:
            nearest_card = min(
                cards,
                key=lambda card: (
                    (card["cx"] - context["x"]) ** 2
                    + (card["cy"] - context["y"]) ** 2
                ),
            )
            nearest_distance = (
                (nearest_card["cx"] - context["x"]) ** 2
                + (nearest_card["cy"] - context["y"]) ** 2
            )
        else:
            nearest_distance = float("inf")
        ranked.append((nearest_distance, sku))

    for _, sku in sorted(ranked, key=lambda item: item[0]):
        context = sku["spatialContext"]
        if not available:
            unmatched.append({
                "sku": sku.get("sku"), "page": page_num,
                "reason": "no_folia_card_available",
            })
            continue
        chosen = min(
            available,
            key=lambda card: (
                (card["cx"] - context["x"]) ** 2
                + (card["cy"] - context["y"]) ** 2
            ),
        )
        available.remove(chosen)
        image = _extract_perfect_image(doc, chosen, raster, width, height, scale)
        if image is None or image.size == 0:
            unmatched.append({
                "sku": sku.get("sku"), "page": page_num,
                "reason": "folia_card_extract_failed",
            })
            continue
        # Tira a faixa de specs+preço do card antes de salvar — ver
        # _crop_folia_price_band (Josef, 15/09/2026: preço não pode aparecer
        # dentro da imagem, ele diverge quando o preço muda depois).
        image = _crop_folia_price_band(image)
        filepath = _save_image(image, sku["sku"], output_folder)
        matches.append(_make_match(sku, page_num, filepath, "folia_card"))
        del image

    for sku in page_skus:
        if not sku.get("spatialContext"):
            unmatched.append({
                "sku": sku.get("sku"), "page": page_num,
                "reason": "no_coords",
            })
    print(
        f"  [FoliaCards] {len(cards)} cards | {len(page_skus)} SKUs | "
        f"{len(matches)} matches | {len(unmatched)} unmatched"
    )
    return matches, unmatched


def _snap_partition_before_anchor(
    previous_anchor: float,
    anchor: float,
    detected_lines: List[float],
    previous_boundary: float,
) -> float:
    """Acha a divisoria visual imediatamente antes de uma nova coluna/linha.

    O codigo do Dute fica perto do inicio de cada bloco. Por isso, a linha que
    separa dois produtos costuma ficar perto do SEGUNDO codigo, e nao no meio
    dos dois codigos. Se a grade nao trouxer uma linha confiavel, usamos o meio
    como fallback seguro.
    """
    gap = anchor - previous_anchor
    fallback = previous_anchor + gap / 2
    if gap <= 0:
        return max(previous_boundary, fallback)

    max_snap = max(35.0, min(120.0, gap * 0.40))
    # A divisoria precisa ficar ANTES do novo codigo. Toleramos somente 10pt
    # depois dele porque o detector pode oscilar alguns pixels (pag. 141), mas
    # nunca escolhemos uma linha muito abaixo: nas paginas 116/127/142/165 essa
    # linha atravessa a propria foto e deixava o produto sem nenhum elemento.
    candidates = [
        line for line in detected_lines
        if line > previous_boundary + 5.0
        and previous_anchor < line <= anchor + 10.0
    ]
    if not candidates:
        return fallback

    nearest = min(candidates, key=lambda line: abs(line - anchor))
    return nearest if abs(nearest - anchor) <= max_snap else fallback


def _dute_axis_partitions(
    anchors: List[float],
    detected_lines: List[float],
    axis_limit: float,
    cluster_tolerance: float,
) -> Tuple[List[float], List[Tuple[float, float]]]:
    """Cria faixas logicas do catalogo Dute a partir dos codigos e da grade."""
    centers = _cluster_coords(anchors, tolerance=cluster_tolerance)
    if not centers:
        return [], []

    interior = sorted(line for line in detected_lines if 1.0 < line < axis_limit - 1.0)
    boundaries = [0.0]
    for index in range(1, len(centers)):
        boundary = _snap_partition_before_anchor(
            centers[index - 1], centers[index], interior, boundaries[-1]
        )
        # Uma deteccao imperfeita nunca pode inverter ou zerar uma faixa.
        boundary = min(axis_limit - 1.0, max(boundaries[-1] + 1.0, boundary))
        boundaries.append(boundary)
    boundaries.append(axis_limit)

    return centers, list(zip(boundaries[:-1], boundaries[1:]))


def _crop_composition_masked(
    grouped: List[Dict],
    raster: np.ndarray,
    width: int,
    height: int,
    scale: float,
    page: Optional[fitz.Page] = None,
) -> Optional[np.ndarray]:
    """Recorta a uniao das imagens de uma composicao Dute apagando o que nao
    pertence a nenhuma delas.

    Com `page`, o recorte vem de uma renderizacao so com as imagens do grupo
    (ver `_render_so_imagens`): texto, linhas e imagens de fundo/rodape que
    ficam POR CIMA ou POR BAIXO do retangulo da foto nao entram.

    Josef, 16/09/2026 (Dute, mesmo defeito que a Folia em 15/09): o preco e o
    titulo do produto ficam ENTRE as fotos (embalagem + brinquedo), nunca
    dentro delas -- sao texto da pagina, nao imagem. Quando as duas fotos
    ficam na diagonal (uma em cima a direita, outra embaixo a esquerda, por
    exemplo), o retangulo que as envolve sobra espaco morto no canto oposto,
    e e exatamente ali que o preco/titulo estao desenhados. Recortar so a
    uniao (raster cru) trazia esse texto junto porque o crop e um recorte da
    PAGINA renderizada, nao das imagens em si. Aqui pintamos de branco tudo
    que fica fora do retangulo de CADA imagem, preservando a posicao
    relativa das fotos e descartando qualquer texto que sobrava no meio.
    """
    if not grouped:
        return None

    union = fitz.Rect(grouped[0]["rect"])
    for image in grouped[1:]:
        union |= image["rect"]

    x0 = max(0, int(union.x0 * scale))
    y0 = max(0, int(union.y0 * scale))
    x1 = min(width, int(union.x1 * scale))
    y1 = min(height, int(union.y1 * scale))
    if x1 <= x0 or y1 <= y0:
        return None

    crop = None
    if page is not None:
        crop = _render_so_imagens(page, grouped, fitz.Rect(x0 / scale, y0 / scale, x1 / scale, y1 / scale),
                                  (x1 - x0, y1 - y0), scale)
    if crop is None:
        crop = raster[y0:y1, x0:x1].copy()
    mask = np.zeros(crop.shape[:2], dtype=bool)
    # 1pt de folga pra nao deixar friso branco no contorno real da foto por
    # arredondamento de ponto-flutuante -> pixel.
    pad = max(1.0, 1.0 / max(scale, 0.0001))
    for image in grouped:
        rect = image["rect"]
        rx0 = max(0, int((rect.x0 - pad) * scale) - x0)
        ry0 = max(0, int((rect.y0 - pad) * scale) - y0)
        rx1 = min(crop.shape[1], int((rect.x1 + pad) * scale) - x0)
        ry1 = min(crop.shape[0], int((rect.y1 + pad) * scale) - y0)
        if rx1 > rx0 and ry1 > ry0:
            mask[ry0:ry1, rx0:rx1] = True

    crop[~mask] = 255
    return crop if crop.size > 0 else None


def _copia_so_com_imagens(page: fitz.Page, manter_xrefs: set, clip: fitz.Rect):
    """Cópia descartável da página sem texto, sem desenho vetorial e sem as
    imagens (com xref) que tocam `clip` e não estão em `manter_xrefs`.
    Devolve (doc, página, imagens embutidas sem xref que tocam o clip) ou
    None — quem chama fecha o doc."""
    caminho = page.parent.name
    if not caminho or not os.path.exists(caminho):
        return None
    try:
        tmp = fitz.open(caminho)
    except Exception:
        return None
    try:
        tp = tmp.load_page(page.number)
        tp.add_redact_annot(tp.rect, fill=False)
        tp.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                            graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                            text=fitz.PDF_REDACT_TEXT_REMOVE)
        inline = []
        for info in tp.get_image_info(xrefs=True):
            r = fitz.Rect(info["bbox"])
            if not r.intersects(clip):
                continue
            xref = info.get("xref") or 0
            if xref and xref not in manter_xrefs:
                tp.delete_image(xref)
            elif not xref and r.get_area() > 0:
                inline.append(r)
        return tmp, tp, inline
    except Exception as e:
        print(f"[CV] cópia só-imagens falhou: {e}")
        tmp.close()
        return None


def _render_so_imagens(
    page: fitz.Page, manter: List[Dict], clip: fitz.Rect, tamanho: Tuple[int, int], scale: float,
) -> Optional[np.ndarray]:
    """Renderiza `clip` da página só com as imagens de `manter`.

    Josef, 25/09/2026 (Dute, 9 códigos): o retângulo de uma foto recortada
    (PNG transparente) cobre também o que a página desenha em volta — linha
    tracejada entre quadrantes, texto da ficha ("BANCO", "Dimensões..."), a
    barra de ícones do rodapé e o fundo decorado de página inteira. Recortar
    a página renderizada trazia tudo isso junto. Aqui a página é reaberta
    numa cópia descartável, sem texto, sem desenho vetorial e sem as outras
    imagens, e só então renderizada. Qualquer falha devolve None (o chamador
    usa o recorte antigo).
    """
    # foto fatiada (ver _costurar_tiles): todas as fatias ficam
    manter_xrefs = {
        x for img in manter
        for x in [img.get("xref")] + [t.get("xref") for t in img.get("tiles") or []] if x
    }
    copia = _copia_so_com_imagens(page, manter_xrefs, clip)
    if copia is None:
        return None
    tmp, tp, inline = copia
    try:
        rects_manter = [fitz.Rect(img["rect"]) for img in manter]
        # imagem embutida no conteúdo (sem xref, ex. ícones do rodapé) não
        # sai pelo xref. Se fica quase toda FORA da foto é da página → apaga
        # depois de renderizar. Se fica dentro (selo "NOVO" em cima da foto)
        # é da foto → fica.
        apagar = [
            r & clip for r in inline
            if (max((r & m).get_area() for m in rects_manter) if rects_manter else 0.0) < 0.5 * r.get_area()
        ]
        pix = tp.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, colorspace=fitz.csRGB, alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        for r in apagar:
            ax0, ay0 = int((r.x0 - clip.x0) * scale), int((r.y0 - clip.y0) * scale)
            ax1, ay1 = int(math.ceil((r.x1 - clip.x0) * scale)), int(math.ceil((r.y1 - clip.y0) * scale))
            arr[max(0, ay0):max(0, ay1), max(0, ax0):max(0, ax1)] = 255
        w, h = tamanho
        if arr.shape[1] != w or arr.shape[0] != h:
            arr = cv2.resize(arr, (w, h))
        return arr
    except Exception as e:
        print(f"[CV] render só-imagens falhou (usa recorte da página): {e}")
        return None
    finally:
        tmp.close()


def _retangulo_visivel(page: fitz.Page, img: Dict) -> Optional[fitz.Rect]:
    """Parte do retângulo da imagem que aparece de fato na página.

    PETRIN pág. 140 (Josef 25/09/2026, RD1333 sem foto): a foto do RD1113 é
    um JPEG com 4 coletes que o PDF recorta (clip) pra mostrar só o laranja.
    O retângulo declarado é o da foto inteira e cobria a foto do RD1333, que
    por isso era descartada como "selo em cima de foto maior". Renderiza só
    esta imagem com fundo transparente e mede onde há pixel desenhado."""
    rect = fitz.Rect(img["rect"]) & page.rect
    if rect.is_empty:
        return None
    copia = _copia_so_com_imagens(page, {img["xref"]}, rect)
    if copia is None:
        return None
    tmp, tp, inline = copia
    try:
        escala = min(1.0, 200.0 / max(rect.width, rect.height))
        pix = tp.get_pixmap(matrix=fitz.Matrix(escala, escala), clip=rect, alpha=True)
        alfa = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, -1].copy()
        sx, sy = rect.width / pix.width, rect.height / pix.height
        # selo/etiqueta embutido sem xref (preço, logo) não é desta imagem
        for r in inline:  # +2px: borda suavizada (antialias) do selo
            alfa[max(0, int((r.y0 - rect.y0) / sy) - 2):max(0, int(math.ceil((r.y1 - rect.y0) / sy)) + 2),
                 max(0, int((r.x0 - rect.x0) / sx) - 2):max(0, int(math.ceil((r.x1 - rect.x0) / sx)) + 2)] = 0
        ys, xs = np.nonzero(alfa > 16)
        if len(xs) == 0:
            return None
        return fitz.Rect(rect.x0 + xs.min() * sx, rect.y0 + ys.min() * sy,
                         rect.x0 + (xs.max() + 1) * sx, rect.y0 + (ys.max() + 1) * sy)
    except Exception as e:
        print(f"[CV] retângulo visível falhou: {e}")
        return None
    finally:
        tmp.close()


def _filtrar_imagens_fora_da_pagina(
    page_imgs: List[Dict], page_width: float, page_height: float, min_frac: float = 0.8,
) -> List[Dict]:
    """Descarta imagens cujo retangulo declarado no PDF fica, em boa parte,
    fora da pagina.

    Catalogo Dute real, pagina 34 (livro sensorial): algumas imagens sao
    posicionadas com uma transformacao (rotacao/escala) que faz o retangulo
    reportado por get_image_info() ser MUITO maior que a pagina e ate comecar
    em coordenada negativa -- x0 chega a -472. O pixel de verdade so aparece
    no pedaco que a pagina recorta; o resto do retangulo e espaco morto. Ao
    entrar na composicao Dute (uniao + mascara por retangulo), esse retangulo
    gigante engolia o produto vizinho inteiro (preco, titulo, especificacoes).
    Uma foto de produto de verdade fica quase inteira dentro da pagina; aqui
    exigimos pelo menos 80% da area declarada dentro dos limites da pagina.
    Medido no catalogo real: as imagens problematicas ficam com 24%-70% em
    pagina, e a unica foto legitima que sangra a borda (pag. 152, DTY1109)
    fica com 89% -- 80% deixa folga dos dois lados.

    Sem rede de seguranca "devolve tudo se esvaziar": a pagina 34 (colecao de
    livros sensoriais) tem SOMENTE imagens fora da pagina depois do filtro de
    selo, entao qualquer rede de seguranca aqui devolveria exatamente as
    imagens gigantes que causam a mistura de produtos. Perder a foto (o SKU
    cai no relatorio de nao-casados, ja existente) e muito melhor do que
    devolver a foto de um produto com o preco do vizinho dentro.
    """
    page_rect = fitz.Rect(0.0, 0.0, page_width, page_height)
    mantidas = []
    for image in page_imgs:
        rect = image.get("rect")
        area = image.get("area", 0)
        if rect is None or area <= 0:
            continue
        inter = rect & page_rect
        on_page_frac = (inter.width * inter.height) / area if not inter.is_empty else 0.0
        if on_page_frac >= min_frac:
            mantidas.append(image)
    return mantidas


def _dute_dono_de_cada_imagem(valid_skus: list, page_imgs: List[Dict], page_width: float) -> Dict[int, dict]:
    """Dono de cada imagem num catálogo de foto composta: o código mais
    próximo que fica ACIMA-À-ESQUERDA dela (no Dute o código abre o bloco, no
    canto superior esquerdo, e as imagens ficam à direita/abaixo).

    Candidato: canto do código com x <= centro da imagem e a imagem
    descendo pelo menos 20pt abaixo do topo do código. Entre os candidatos vence o de menor vão horizontal + 2× vão
    vertical (ver `distancia`). Medido nas págs. 17 e 105
    (Josef 24/09/2026): a divisão pelo ponto médio entre códigos punha a
    caixa do DT10052 na foto do DT10421 e juntava pedaços do DT10151/DTY1408
    na do DT10231. Devolve {id(imagem): sku}.
    """
    donos: Dict[int, dict] = {}
    cantos = []
    for sku in valid_skus:
        sc = sku["spatialContext"]
        w, h = sc.get("width") or 0.0, sc.get("height") or 0.0
        cantos.append((sku, sc["x"] - w / 2, sc["y"] - h / 2))
    if not cantos:
        return donos
    for image in page_imgs:
        rect = image["rect"]
        # Faixa decorativa da largura da página (barra de navegação do rodapé
        # do Dute, 821pt de 854) não é foto de produto de ninguém.
        if rect.width >= 0.7 * page_width:
            continue
        candidatos = [
            (sku, ax, ay) for sku, ax, ay in cantos
            # a imagem precisa descer pelo menos 20pt abaixo do topo do código:
            # imagem que termina logo ACIMA dele é do bloco de cima (pág. 29,
            # varas da PESCARIA DT10284 terminando 12pt acima do DT10386)
            if ax - 20 <= image["cx"] and ay <= rect.y1 - 20
        ]
        if not candidatos:
            continue
        # Distância = vão horizontal (código → borda esquerda da imagem) +
        # 2× o vão vertical (zero quando a imagem cobre a linha do código).
        # Pág. 179: os patinhos do DT10097 começam 44pt acima do código dele —
        # cobrem a linha dele, vão vertical 0 — e não vão mais pro DT10096 lá
        # no alto; pág. 105: a mola do DT10151 fica na altura do DT10231, mas
        # 480pt à direita dele, e volta pro DT10151.
        def distancia(c):
            _sku, ax, ay = c
            vao_h = max(0.0, rect.x0 - ax)
            if rect.y0 - 30 <= ay <= rect.y1:
                vao_v = 0.0
            else:
                vao_v = (rect.y0 - 30 - ay) if ay < rect.y0 - 30 else (ay - rect.y1)
            return vao_h + 2 * vao_v
        donos[id(image)] = min(candidatos, key=distancia)[0]
    return donos


_VEZES_POR_DOC: Dict[int, Dict[int, int]] = {}


def _vezes_de_cada_imagem(doc: fitz.Document) -> Dict[int, int]:
    """Quantas vezes cada xref é desenhado no catálogo inteiro (calculado uma
    vez por documento; só o caminho de foto composta usa)."""
    if doc is None:
        return {}
    chave = id(doc)
    if chave not in _VEZES_POR_DOC:
        _VEZES_POR_DOC.clear()
        vezes: Dict[int, int] = {}
        for page in doc:
            for info in page.get_image_info(xrefs=True):
                xref = info.get("xref") or 0
                if xref:
                    vezes[xref] = vezes.get(xref, 0) + 1
        _VEZES_POR_DOC[chave] = vezes
    return _VEZES_POR_DOC[chave]


def _icones_de_caracteristica(doc: fitz.Document, page_imgs: List[Dict]) -> set:
    """ids das imagens que são ícone de característica (som/luz/pilha): a
    MESMA imagem pequena (<80pt) desenhada 3+ vezes no catálogo, mais o
    desenho que vai por cima dela (nota musical, lâmpada — outra imagem,
    dentro do retângulo do ícone). Foto de produto não se repete assim."""
    vezes_no_catalogo = _vezes_de_cada_imagem(doc)
    repetidas = {
        image["xref"] for image in page_imgs
        if not image.get("tiles") and vezes_no_catalogo.get(image["xref"], 0) >= 3
        and max(image["rect"].width, image["rect"].height) < 80
    }
    fundos_de_icone = [image["rect"] for image in page_imgs if image["xref"] in repetidas]
    return {
        id(image) for image in page_imgs
        if not image.get("tiles")
        and (image["xref"] in repetidas or any(r.contains(image["rect"]) for r in fundos_de_icone))
    }


def _match_dute_compositions(
    doc: fitz.Document,
    raster: np.ndarray,
    h_coords: List[float],
    v_coords: List[float],
    valid_skus: list,
    page_imgs: List[Dict],
    scale: float,
    output_folder: str,
    page_num: int,
    target_sku_codes: Optional[set] = None,
) -> Tuple[List[Dict], List[Dict]]:
    """Extrai a composicao completa de cada produto do catalogo Dute.

    No PDF real, embalagem, brinquedo e acessorios sao objetos de imagem
    separados. O casamento antigo escolhia apenas o objeto cujo centro ficava
    mais perto do codigo. Aqui cada objeto e atribuido ao bloco visual do SKU e
    o recorte final usa a uniao de todos os objetos desse bloco.
    """
    height, width = raster.shape[:2]
    page_width = width / max(scale, 0.0001)
    page_height = height / max(scale, 0.0001)
    v_points = [value / max(scale, 0.0001) for value in v_coords]
    h_points = [value / max(scale, 0.0001) for value in h_coords]
    page_imgs = _filtrar_imagens_fora_da_pagina(page_imgs, page_width, page_height)

    # O Dute alterna entre dois desenhos:
    #   - grade comum (2x2, 2x1 etc.): ha dois ou mais SKUs na mesma linha;
    #   - blocos laterais desencontrados (pag. 141): um SKU por linha visual,
    #     mas cada produto ocupa uma coluna inteira.
    # Nas grades comuns, dividir LINHAS primeiro resolve tambem as paginas em
    # triangulo (1 produto em cima + 2 embaixo, ou o inverso). Nas laterais
    # desencontradas, dividir COLUNAS primeiro evita cortar a composicao alta.
    global_row_centers = _cluster_coords(
        [sku["spatialContext"]["y"] for sku in valid_skus], tolerance=45.0
    )
    skus_by_global_row: Dict[int, list] = {
        index: [] for index in range(len(global_row_centers))
    }
    for sku in valid_skus:
        sku_y = sku["spatialContext"]["y"]
        row_index = min(
            range(len(global_row_centers)),
            key=lambda idx: abs(global_row_centers[idx] - sku_y),
        )
        skus_by_global_row[row_index].append(sku)

    cells: List[Tuple[Dict, float, float, float, float, int, int]] = []
    use_row_first = any(len(row_skus) >= 2 for row_skus in skus_by_global_row.values())

    if use_row_first:
        row_centers, row_ranges = _dute_axis_partitions(
            [sku["spatialContext"]["y"] for sku in valid_skus],
            h_points,
            page_height,
            cluster_tolerance=45.0,
        )
        row_cols = {
            row_index: _dute_axis_partitions(
                [sku["spatialContext"]["x"] for sku in row_skus],
                v_points,
                page_width,
                cluster_tolerance=80.0,
            )
            for row_index, row_skus in skus_by_global_row.items()
        }
        # Linha com 1 produto so (pag. 162: peixe em cima, tartaruga embaixo, e a
        # foto do caranguejo da coluna vizinha desce ate a linha de baixo) ganhava
        # a pagina inteira e engolia a foto do vizinho. Se as colunas da pagina
        # sao consistentes (mesmo numero da linha mais cheia), a linha curta usa
        # a faixa da propria coluna. Pagina em triangulo (1 centralizado + 2)
        # gera mais colunas globais que a linha mais cheia: nao entra aqui.
        global_col_centers, global_col_ranges = _dute_axis_partitions(
            [sku["spatialContext"]["x"] for sku in valid_skus],
            v_points,
            page_width,
            cluster_tolerance=80.0,
        )
        max_row_cols = max(len(c) for c, _ in row_cols.values())
        use_global_cols = len(global_col_centers) == max_row_cols
        for row_index, row_skus in skus_by_global_row.items():
            col_centers, col_ranges = row_cols[row_index]
            if use_global_cols and len(col_centers) < max_row_cols:
                col_centers, col_ranges = global_col_centers, global_col_ranges
            y_min, y_max = row_ranges[row_index]
            for sku in row_skus:
                sku_x = sku["spatialContext"]["x"]
                col_index = min(
                    range(len(col_centers)),
                    key=lambda idx: abs(col_centers[idx] - sku_x),
                )
                x_min, x_max = col_ranges[col_index]
                cells.append((sku, x_min, x_max, y_min, y_max, col_index, row_index))
    else:
        col_centers, col_ranges = _dute_axis_partitions(
            [sku["spatialContext"]["x"] for sku in valid_skus],
            v_points,
            page_width,
            cluster_tolerance=80.0,
        )
        skus_by_col: Dict[int, list] = {index: [] for index in range(len(col_centers))}
        for sku in valid_skus:
            sku_x = sku["spatialContext"]["x"]
            col_index = min(
                range(len(col_centers)), key=lambda idx: abs(col_centers[idx] - sku_x)
            )
            skus_by_col[col_index].append(sku)

        for col_index, col_skus in skus_by_col.items():
            row_centers, row_ranges = _dute_axis_partitions(
                [sku["spatialContext"]["y"] for sku in col_skus],
                h_points,
                page_height,
                cluster_tolerance=45.0,
            )
            x_min, x_max = col_ranges[col_index]
            for sku in col_skus:
                sku_y = sku["spatialContext"]["y"]
                row_index = min(
                    range(len(row_centers)),
                    key=lambda idx: abs(row_centers[idx] - sku_y),
                )
                y_min, y_max = row_ranges[row_index]
                cells.append((sku, x_min, x_max, y_min, y_max, col_index, row_index))

    donos = _dute_dono_de_cada_imagem(valid_skus, page_imgs, page_width)
    icones = _icones_de_caracteristica(doc, page_imgs)

    matches: List[Dict] = []
    unmatched: List[Dict] = []
    for sku, x_min, x_max, y_min, y_max, col_index, row_index in cells:
        sku_code = sku.get("sku", "UNKNOWN")
        if target_sku_codes is not None and sku_code not in target_sku_codes:
            continue
        grouped = [
            image for image in page_imgs
            if x_min <= image["cx"] < x_max
            and y_min <= image["cy"] < y_max
        ]
        # Quem decide o dono de cada imagem é o código (ver
        # `_dute_dono_de_cada_imagem`), não a faixa linha×coluna: a faixa
        # partia no ponto médio entre códigos e cortava composições (DT10231
        # pág. 105) ou vazava pedaço do vizinho (DT10421 pág. 17). A faixa
        # fica só no log (col/row).
        grouped = [image for image in page_imgs if donos.get(id(image)) is sku]
        # Ícone de característica (ver `_icones_de_caracteristica`): o filtro
        # de logo não pega (amostra só 15 páginas). Josef 25/09/2026.
        sem_icones = [image for image in grouped if id(image) not in icones]
        if sem_icones:
            grouped = sem_icones

        if not grouped:
            unmatched.append({"sku": sku_code, "page": page_num, "reason": "no_img_in_dute_cell"})
            continue

        if len(grouped) == 1:
            img_arr = _extract_perfect_image(
                doc, grouped[0], raster, width, height, scale
            )
            match_type = "dute_cell"
        else:
            img_arr = _crop_composition_masked(
                grouped, raster, width, height, scale,
                page=doc.load_page(page_num - 1) if doc is not None else None,
            )
            match_type = "dute_composition"

        if img_arr is None or img_arr.size == 0:
            unmatched.append({"sku": sku_code, "page": page_num, "reason": "extract_failed"})
            continue

        filepath = _save_image(img_arr, sku_code, output_folder)
        matches.append(_make_match(sku, page_num, filepath, match_type))
        print(
            f"    [DuteCell] {sku_code}: {len(grouped)} elemento(s) "
            f"no bloco col={col_index + 1}, row={row_index + 1}"
        )

    print(f"  [DuteCell] Resultado: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched

def _costurar_tiles(page_imgs: List[Dict]) -> List[Dict]:
    """Junta imagens que sao FATIAS contiguas da MESMA foto.

    Alguns exportadores de PDF (tipicamente CMYK) cortam uma foto em duas ou
    mais tiras lado a lado. Cada tira vira um objeto de imagem separado, e o
    casamento salva so uma delas -- foi o "LEVIVAN ta pegando so parte do
    produto" (LV1052, pag. 20: xref 885 = 1 tigela + 1 pires, xref 884 = o
    resto do conjunto).

    Assinatura de fatia, puramente geometrica: mesma faixa vertical (topo e
    base coincidem dentro de 2pt) e bordas horizontais encostadas (vao < 3pt).
    Duas fotos de PRODUTOS diferentes nunca se encostam assim -- num layout de
    duas colunas sempre ha um vao de dezenas de pontos entre elas.
    """
    if len(page_imgs) < 2:
        return page_imgs

    TOL_Y = 2.0
    TOL_GAP = 3.0
    restantes = sorted(page_imgs, key=lambda i: (i["rect"].y0, i["rect"].x0))
    usados: set = set()
    saida: List[Dict] = []

    for i, base in enumerate(restantes):
        if i in usados:
            continue
        grupo = [base]
        idx_grupo = {i}
        faixa = fitz.Rect(base["rect"])
        mudou = True
        while mudou:
            mudou = False
            for j, cand in enumerate(restantes):
                if j in usados or j in idx_grupo:
                    continue
                r = cand["rect"]
                mesma_faixa = (abs(r.y0 - faixa.y0) <= TOL_Y
                               and abs(r.y1 - faixa.y1) <= TOL_Y)
                if not mesma_faixa:
                    continue
                # Encosta de QUALQUER um dos lados da faixa ja montada — a
                # ordem em que o PDF lista as fatias nao é confiavel.
                encosta = (-TOL_GAP <= (r.x0 - faixa.x1) <= TOL_GAP
                           or -TOL_GAP <= (faixa.x0 - r.x1) <= TOL_GAP)
                if encosta:
                    grupo.append(cand)
                    idx_grupo.add(j)
                    faixa |= r
                    mudou = True
                    break
        usados |= idx_grupo
        if len(grupo) == 1:
            saida.append(base)
            continue

        # Grade de cards INDEPENDENTES coladas por poucos pontos de vão
        # (FOLIA, 22/09/2026: cards quadrados de 192×192 numa linha, vão de
        # ~2pt entre eles — dentro de TOL_GAP; acontece tanto em grupos de 3
        # quanto, ocasionalmente, de 2). Fatiamento real de UMA foto cortada
        # pelo exportador (LEVIVAN LV1052) produz pedaços de TAMANHOS
        # DIFERENTES (o conteúdo não se divide em partes iguais — medido:
        # 213pt vs 313pt de largura); pedaços do MESMO tamanho (±2pt) são a
        # assinatura de uma grade de fotos de produtos DIFERENTES que só por
        # coincidência de layout quase se tocam. Não costura nesse caso,
        # mesmo com só 2 pedaços.
        larguras = [g["rect"].width for g in grupo]
        alturas = [g["rect"].height for g in grupo]
        grade_uniforme = (
            max(larguras) - min(larguras) <= 2.0
            and max(alturas) - min(alturas) <= 2.0
        )
        if grade_uniforme:
            print(f"    [Tiles] {len(grupo)} cards do mesmo tamanho encostados — "
                  f"grade de produtos diferentes, não costura (xrefs={[g['xref'] for g in grupo]})")
            saida.extend(grupo)
            continue

        union = fitz.Rect(grupo[0]["rect"])
        for g in grupo[1:]:
            union |= g["rect"]
        print(f"    [Tiles] {len(grupo)} fatias costuradas numa foto so "
              f"(xrefs={[g['xref'] for g in grupo]})")
        saida.append({
            "xref": grupo[0]["xref"],
            "rect": union,
            "cx": (union.x0 + union.x1) / 2,
            "cy": (union.y0 + union.y1) / 2,
            "area": union.width * union.height,
            "tiles": grupo,
        })

    return saida


def _avaliar_direcao(
    skus: list, imgs: List[Dict], direcao: str, janela: float = 360.0,
) -> Tuple[int, float]:
    """Monta a atribuicao 1:1 SKU<->foto sob uma hipotese e devolve
    (quantos SKUs conseguiram foto, custo medio)."""
    pares = []
    for si, sku in enumerate(skus):
        sc = sku.get("spatialContext") or {}
        sx, sy = sc.get("x"), sc.get("y")
        if sx is None or sy is None:
            continue
        for ii, img in enumerate(imgs):
            r = img["rect"]
            gap = (r.y0 - sy) if direcao == "abaixo" else (sy - r.y1)
            if gap < -25.0 or gap > janela:
                continue
            dx = 0.0
            if r.x1 < sx:
                dx = sx - r.x1
            elif r.x0 > sx:
                dx = r.x0 - sx
            pares.append((max(gap, 0.0) + dx * 1.5, si, ii))

    pares.sort()
    us: set = set()
    ui: set = set()
    total, n = 0.0, 0
    for custo, si, ii in pares:
        if si in us or ii in ui:
            continue
        us.add(si)
        ui.add(ii)
        total += custo
        n += 1
    return n, (total / n if n else float("inf"))


def _detectar_orientacao_do_catalogo(
    doc: fitz.Document,
    skus_by_page: Dict[int, list],
    logo_xrefs: set,
    logo_digests: set,
    max_paginas: int = 40,
) -> str:
    """Descobre sozinho se a foto do produto fica ACIMA ou ABAIXO do codigo.

    O casamento por coluna sempre assumiu "foto em cima, codigo/legenda
    embaixo". A PETRIN (16/09/2026) inverte isso: codigo + nome + specs no topo
    do bloco e a foto embaixo. Com a regra fixa, 142 SKUs ficaram sem imagem
    (`no_img_in_col`, a foto legitima era descartada por estar "abaixo demais")
    e outros pegaram o enfeite que por acaso estava logo ACIMA do codigo -- foi
    o "alguns registros ta pegando a tag" do Josef (RD1193 ficou com o selo
    "PREÇO REDUZIDO", que fica a 1,9pt acima do codigo).

    Em vez de mais um `if fornecedor == X`, a orientacao e MEDIDA: para cada
    pagina, monta-se a atribuicao 1:1 completa sob as duas hipoteses e vence a
    que explica mais SKUs. So as K maiores imagens entram na votacao (K = qtd
    de codigos da pagina) -- a foto de verdade esta sempre entre as maiores, e
    selos/tags/enfeites saem sozinhos por serem pequenos.

    Na duvida devolve "acima", que e o comportamento historico: catalogo que ja
    funciona nao muda de caminho.
    """
    votos_acima = votos_abaixo = 0
    paginas = sorted(skus_by_page.keys())[:max_paginas]

    for page_num in paginas:
        skus = [s for s in skus_by_page[page_num]
                if (s.get("spatialContext") or {}).get("y") is not None]
        if len(skus) < 2:
            continue
        try:
            page = doc.load_page(page_num - 1)
            imgs = _get_page_embedded_images(page, logo_xrefs, logo_digests)
        except Exception:
            continue
        if len(imgs) < 2:
            continue
        imgs = sorted(imgs, key=lambda i: -i.get("area", 0))[:max(len(skus), 2)]

        n_a, c_a = _avaliar_direcao(skus, imgs, "acima")
        n_b, c_b = _avaliar_direcao(skus, imgs, "abaixo")
        if n_b > n_a or (n_b == n_a and c_b < c_a * 0.85):
            votos_abaixo += 1
        elif n_a > n_b or (n_a == n_b and c_a < c_b * 0.85):
            votos_acima += 1

    total = votos_acima + votos_abaixo
    # Exige evidencia forte pra sair do padrao: >=3 paginas decididas e 60% de
    # maioria. Abaixo disso, mantem o comportamento historico.
    if total >= 3 and votos_abaixo >= total * 0.6:
        print(f"[CV] Orientacao MEDIDA: foto ABAIXO do codigo "
              f"({votos_abaixo}/{total} paginas)")
        return "abaixo"
    print(f"[CV] Orientacao: foto ACIMA do codigo (padrao) "
          f"[{votos_acima} acima x {votos_abaixo} abaixo]")
    return "acima"


def _match_via_grid(
    doc: fitz.Document,
    page: fitz.Page,
    raster: np.ndarray,
    h_coords: List[float],
    v_coords: List[float],
    page_skus: list,
    page_imgs: List[Dict],
    scale: float,
    output_folder: str,
    page_num: int,
    orientacao: str = "acima",
    foto_composta: bool = False,
) -> Tuple[List[Dict], List[Dict]]:
    """
    Estratégia Column-First:
    1. Usa posições X dos SKUs (confiáveis) para descobrir colunas
    2. Atribui cada imagem à coluna mais próxima
    3. Dentro de cada coluna, emparelha SKU↔Imagem pela ordem Y
       (imagem mais próxima acima do SKU = match correto)

    Não depende da detecção de grid do OpenCV para emparelhamento.
    """
    height, width = raster.shape[:2]

    # ═══════════════════════════════════════════════════════
    # FASE 1: Filtrar SKUs válidos
    # ═══════════════════════════════════════════════════════
    valid_skus: list = []
    unmatched: List[Dict] = []
    for sku in page_skus:
        sc = sku.get("spatialContext", {})
        if sc.get("x") is not None and sc.get("y") is not None:
            valid_skus.append(sku)
        else:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_coords"})

    if not valid_skus:
        return [], unmatched

    # ═══════════════════════════════════════════════════════
    # FASE 1.5: Descartar imagens-selo (badges "KIT"/"JOGO"/"3 CORES")
    # Reunião 22/07/2026 (Josef, catálogo GIRA): esses selos ficam no CANTO
    # da foto real (não distantes dela), então o match por "menor distância
    # Y ao texto do SKU" às vezes pegava o selinho — seu centro Y fica mais
    # perto do preço/código (que vem logo abaixo da foto) que o centro da
    # foto grande. Validado com dados reais: fotos de produto ~34.000px²,
    # selo ~1.300px² (≈4%) — descartar tudo abaixo de 15% da maior imagem
    # da página elimina o selo com folga, sem risco de rejeitar foto real.
    # ═══════════════════════════════════════════════════════
    raw_page_imgs = page_imgs
    page_imgs = _descartar_selos(page_imgs, "ColMatch")

    # FOTO COMPOSTA (achado no Dute, 08/09/2026): uma unica foto comercial e
    # montada por varios objetos independentes no PDF (caixa + brinquedo +
    # acessorios). Agrupar so imagens com centro no mesmo Y salvava apenas um
    # pedaco. Liga pela opcao do cadastro do fornecedor, nao pelo nome: medido
    # em 23/09 em 9 catalogos reais, a PETRIN (varias fotos de variacao,
    # regra certa = 1 foto) fica perto demais do Dute pra decidir sozinho
    # sem risco (28% x 19% de imagens sobrepostas). Ver guide.md.
    if foto_composta:
        coordinate_unmatched = list(unmatched)
        matches, cell_unmatched = _match_dute_compositions(
            doc, raster, h_coords, v_coords, valid_skus, page_imgs,
            scale, output_folder, page_num,
        )
        # Pagina 142 do catalogo de 08/09: uma imagem gigante contem duas
        # variacoes e envolve geometricamente os objetos menores. O filtro de
        # selo, corretamente, protege os demais fornecedores, mas nesse caso
        # tambem esconde duas fotos legitimas. Reabre SOMENTE as celulas Dute
        # que ficaram vazias usando a lista original; as celulas ja corretas
        # nao sao recalculadas nem substituidas.
        missing_codes = {item.get("sku") for item in cell_unmatched if item.get("sku")}
        if missing_codes and raw_page_imgs is not page_imgs:
            recovered, still_unmatched = _match_dute_compositions(
                doc, raster, h_coords, v_coords, valid_skus, raw_page_imgs,
                scale, output_folder, page_num, target_sku_codes=missing_codes,
            )
            if recovered:
                recovered_codes = {item.get("sku") for item in recovered}
                matches.extend(recovered)
                cell_unmatched = [
                    item for item in cell_unmatched
                    if item.get("sku") not in recovered_codes
                ]
                # Mantem um motivo novo apenas se o fallback tentou e falhou.
                remaining_codes = {item.get("sku") for item in cell_unmatched}
                cell_unmatched = [
                    item for item in still_unmatched
                    if item.get("sku") in remaining_codes
                ]
                print(f"  [DuteCell] fallback recuperou {len(recovered)} celula(s)")
        return matches, coordinate_unmatched + cell_unmatched

    # ═══════════════════════════════════════════════════════
    # FASE 1.6: Legenda logo abaixo da foto grande (VAESO, 27/08/2026)
    #
    # Layout: 1 foto grande (variante "principal") + N miniaturas de cor
    # abaixo dela. A legenda da variante principal fica no VÃO entre o fim
    # da foto grande e o início das miniaturas. Duas coisas quebravam esse
    # caso na FASE 4 (por coluna): (1) a foto grande é larga — seu centro X
    # cai numa coluna DIFERENTE da coluna do SKU, então o casamento normal
    # por coluna nunca a considera; (2) o fallback last-resort (Y-proximity
    # pura, sem checar gap/alinhamento) processa colunas em ordem e deixa
    # QUALQUER SKU processado antes reivindicar a foto grande por ela ser
    # "a mais próxima disponível" — mesmo sendo de um SKU errado (efeito
    # cascata: o dono de verdade processa depois e não sobra nada).
    #
    # Roda ANTES da divisão em colunas, pra quem bate o critério preciso
    # (gap pequeno e positivo, SKU dentro da faixa horizontal da foto)
    # reservar sua foto ANTES de qualquer fallback genérico de outro SKU
    # poder roubá-la. Preenche `used_xrefs_global` adiantado — a FASE 4 já
    # respeita esse conjunto nativamente (todo `_try_match` já checa antes
    # de considerar uma imagem).
    # ═══════════════════════════════════════════════════════
    # Chave por IDENTIDADE do dict (id(img)), não por xref: a mesma imagem
    # embutida pode ser desenhada em 2+ posições da página (ex: BM36 pág. 119,
    # WC410003 e WC410004 usam o MESMO xref de foto de frasco em 2 células
    # diferentes) — dedup por xref achava que a 2ª posição "já tinha sido
    # usada" pela 1ª e descartava o produto ("no_img_in_col"), quando na
    # verdade são 2 recortes legítimos da mesma foto reaproveitada.
    used_img_ids: set = set()
    pre_matched: Dict[str, Dict] = {}
    # A FASE 1.6 so faz sentido no layout classico (foto em cima, legenda
    # embaixo). Num catalogo medido como "foto abaixo do codigo" ela casaria
    # justamente o enfeite que fica acima do codigo.
    for sku in (valid_skus if orientacao == "acima" else []):
        sku_code = sku.get("sku", "UNKNOWN")
        sku_x, sku_y = sku["spatialContext"]["x"], sku["spatialContext"]["y"]
        melhor, melhor_gap = None, float("inf")
        for img in page_imgs:
            if id(img) in used_img_ids:
                continue
            rect = img.get("rect")
            if rect is None:
                continue
            gap = sku_y - rect.y1
            if 0 <= gap <= 30.0 and rect.x0 <= sku_x <= rect.x1 and gap < melhor_gap:
                melhor_gap, melhor = gap, img
        if melhor is not None:
            pre_matched[sku_code] = melhor
            used_img_ids.add(id(melhor))
            print(f"    [ColMatch] {sku_code}: foto grande logo acima da legenda (gap={melhor_gap:.1f}pt)")

    # ═══════════════════════════════════════════════════════
    # FASE 2: Descobrir colunas via clustering de X (SKUs + Imagens)
    # ═══════════════════════════════════════════════════════
    all_xs = [s["spatialContext"]["x"] for s in valid_skus] + [img["cx"] for img in page_imgs]
    col_centers = _cluster_coords(all_xs, tolerance=60)
    n_cols = len(col_centers)

    if n_cols == 0:
        return [], [{"sku": s.get("sku"), "page": page_num, "reason": "no_columns"} for s in valid_skus]

    # ═══════════════════════════════════════════════════════
    # FASE 3: Atribuir SKUs e imagens às colunas
    # ═══════════════════════════════════════════════════════
    col_skus: Dict[int, list] = {i: [] for i in range(n_cols)}
    col_imgs: Dict[int, list] = {i: [] for i in range(n_cols)}

    for sku in valid_skus:
        x = sku["spatialContext"]["x"]
        col = min(range(n_cols), key=lambda i: abs(col_centers[i] - x))
        col_skus[col].append(sku)

    for img in page_imgs:
        col = min(range(n_cols), key=lambda i: abs(col_centers[i] - img["cx"]))
        col_imgs[col].append(img)

    total_imgs = sum(len(v) for v in col_imgs.values())
    print(f"  [ColMatch] {n_cols} colunas | {len(valid_skus)} SKUs | {total_imgs} imgs")

    # Piso de tamanho pra uma imagem ser PLAUSIVEL como foto de produto.
    # O cromo do template (selo "PREÇO REDUZIDO", botao "VÍDEO", enfeite de
    # cabecalho) é sempre pequeno perto da foto real da MESMA pagina, e o filtro
    # de selo nao o pega porque ele nao encosta em nenhuma foto maior. Estimativa
    # robusta do tamanho tipico de foto: mediana das N maiores imagens da pagina,
    # N = quantidade de SKUs. Quem nao alcanca 22% disso so entra na segunda
    # passada, se nada plausivel tiver casado — assim nenhum SKU perde imagem.
    area_min_foto = 0.0
    if orientacao == "abaixo" and valid_skus and page_imgs:
        maiores = sorted((i.get("area", 0.0) for i in page_imgs),
                         reverse=True)[:max(len(valid_skus), 2)]
        if maiores:
            area_min_foto = maiores[len(maiores) // 2] * 0.22

    # ═══════════════════════════════════════════════════════
    # FASE 4: Emparelhar SKU↔Imagem dentro de cada coluna
    # Regra: para cada SKU, a imagem correta é a mais
    # próxima ACIMA dele na mesma coluna.
    # Processa SKUs de cima para baixo para evitar conflitos.
    # ═══════════════════════════════════════════════════════
    matches: List[Dict] = []

    # Helper: detecta SKUs que são VARIAÇÕES do mesmo produto base
    # (ex: NX445-A, NX445-P, NX445-V compartilham a imagem do NX445)
    import re as _re
    def _base_sku(code: str) -> str:
        # Remove sufixos comuns: -A, -P, -V, -01, /A, etc.
        return _re.sub(r"[-_/][A-Z0-9]{1,3}$", "", str(code))

    # used_img_ids já existe (populado na FASE 1.6, com o que foi
    # reservado pra legenda-abaixo-da-foto-grande).
    # Mapa: sku_code → imagem matched (para variantes pegarem a mesma)
    variant_cache: Dict[str, Dict] = {}
    # (coluna, x, y, imagem) de cada código já casado nesta página
    casados_pagina: List[Tuple[int, float, float, Dict]] = []
    coluna_da_imagem = {id(img): c for c, imgs in col_imgs.items() for img in imgs}

    for col_idx in range(n_cols):
        skus_sorted = sorted(col_skus[col_idx],
                             key=lambda s: s["spatialContext"]["y"])
        imgs_sorted = sorted(col_imgs[col_idx],
                             key=lambda p: p["cy"])

        for sku in skus_sorted:
            sku_y = sku["spatialContext"]["y"]
            sku_code = sku.get("sku", "UNKNOWN")
            base = _base_sku(sku_code)

            # Já resolvido na FASE 1.6 (legenda logo abaixo da foto grande) —
            # não repete a busca por coluna, só extrai e segue.
            if sku_code in pre_matched:
                best_img = pre_matched[sku_code]
                variant_cache[base] = best_img
                img_arr = _extract_perfect_image(doc, best_img, raster, width, height, scale)
                if img_arr is not None and img_arr.size > 0:
                    filepath = _save_image(img_arr, sku_code, output_folder)
                    matches.append(_make_match(sku, page_num, filepath, "col_match"))
                else:
                    unmatched.append({"sku": sku_code, "page": page_num, "reason": "extract_failed"})
                continue

            # FAST-PATH para variantes: se o base já recebeu uma imagem na página,
            # reaproveita a mesma imagem para a variante (ex: NX445-A,-P,-V)
            if base != sku_code and base in variant_cache:
                cached = variant_cache[base]
                img_arr_var = _extract_perfect_image(doc, cached, raster, width, height, scale)
                if img_arr_var is not None and img_arr_var.size > 0:
                    fp = _save_image(img_arr_var, sku_code, output_folder)
                    matches.append(_make_match(sku, page_num, fp, "variant_share"))
                    continue

            # Encontrar imagem mais próxima acima (ou na mesma altura)
            # Tolerância aumentada de -30 para -100 (catálogo NIX tem balões
            # de SKU sobrepondo a imagem com Y praticamente igual)
            best_img = None
            best_dist = float("inf")

            def _try_match(candidates, min_area: float = 0.0, peso_x: float = 0.0):
                nonlocal best_img, best_dist
                for img in candidates:
                    if id(img) in used_img_ids:
                        continue
                    if min_area > 0 and img.get("area", 0.0) < min_area:
                        continue

                    if orientacao == "abaixo":
                        # Catalogo medido como "foto depois do codigo" (PETRIN).
                        # Exige que a imagem COMECE depois do codigo e mede pela
                        # BORDA de cima, nao pelo centro. Medir por centro deixava
                        # o selo "PREÇO REDUZIDO" (18pt ACIMA do codigo) ganhar da
                        # foto certa (226pt abaixo) só por estar mais perto em
                        # valor absoluto — era o "ta pegando a tag" do Josef.
                        gap = img["rect"].y0 - sku_y
                        if gap < -20:  # comeca antes do codigo → nao é a foto dele
                            continue
                        dist = abs(gap)
                    else:
                        dy = sku_y - img["cy"]
                        if dy < -100:  # imagem MUITO abaixo do SKU → pular
                            continue
                        dist = abs(dy)
                        # Foto que COMEÇA depois do código é do cartão de baixo:
                        # só vale se nenhuma foto acima/sobreposta ao código casar.
                        rect_i = img.get("rect")
                        if rect_i is not None and rect_i.y0 > sku_y + 2.0:
                            dist += 10000.0

                    if peso_x and img.get("rect") is not None:
                        sku_x = sku["spatialContext"]["x"]
                        r = img["rect"]
                        dist += peso_x * max(0.0, r.x0 - sku_x, sku_x - r.x1)

                    if dist < best_dist:
                        best_dist = dist
                        best_img = img

            # 1ª passada: só candidatas plausíveis como foto de produto.
            # 2ª passada (se nada casou): reabre tudo, pra nunca perder imagem.
            for min_area in ([area_min_foto, 0.0] if area_min_foto > 0 else [0.0]):
                if orientacao == "abaixo":
                    celula = _foto_principal_da_celula(
                        sku, valid_skus, page_imgs, used_img_ids,
                        width / scale, height / scale, min_area,
                    )
                    if celula is not None:
                        best_img = celula
                        break
                _try_match(imgs_sorted, min_area)

                # FALLBACK CROSS-COLUMN: se nenhuma imagem na coluna do SKU,
                # busca em colunas adjacentes (±1) pela imagem mais próxima.
                # A distância horizontal entra no desempate: foto à esquerda do
                # texto (Neo Festas pág. 6, Josef 25/09/2026) tem a foto do card
                # vizinho na MESMA altura, do outro lado, e ganhava por 1pt.
                if not best_img:
                    for nearby_col in (col_idx - 1, col_idx + 1):
                        if 0 <= nearby_col < n_cols:
                            _try_match(col_imgs[nearby_col], min_area, peso_x=1.0)
                    if best_img:
                        print(f"    [ColMatch] {sku_code}: match cross-col (col_idx={col_idx})")

                # LAST-RESORT: catálogos de lista exportados de planilha (ex: UNIVERSAL)
                # onde imagens ficam numa coluna separada dos SKUs por mais de 1 coluna
                # de distância (UNIVERSAL: imagem x≈109, SKU x≈339, col_2 não alcança
                # col_0 pelo ±1 acima). Tenta qualquer imagem não usada na página pela
                # proximidade Y — só ativa quando todos os outros métodos falharam.
                if not best_img:
                    all_page_imgs = [img for imgs in col_imgs.values() for img in imgs]
                    _try_match(all_page_imgs, min_area)
                    if best_img:
                        print(f"    [ColMatch] {sku_code}: match last-resort Y-proximity (col_idx={col_idx})")

                if best_img:
                    break

            # Vários códigos no MESMO card (variações de cor com bolinha, Neo
            # Festas págs. 9 e 13, Josef 25/09/2026): a foto do card já foi
            # para o 1º código, e os outros pegavam a foto do card de BAIXO
            # (cascata: o último card ficava sem foto) ou a do card VIZINHO
            # na mesma altura (o código da ponta da fileira de bolinhas fica
            # mais perto da foto do vizinho). Código a até 40pt (vertical) e
            # 150pt (horizontal) de outro já casado divide a foto dele quando
            # o que sobrou pra ele é foto de OUTRA coluna que não a da foto do
            # irmão, foto que começa abaixo dele, ou nada.
            sku_x = sku["spatialContext"]["x"]
            irmao = None
            if orientacao != "abaixo":
                irmao = next(
                    (img for _c, x, y, img in reversed(casados_pagina)
                     if abs(y - sku_y) <= 40 and abs(x - sku_x) <= 150),
                    None,
                )
            if irmao is not None and (
                best_img is None or best_dist >= 10000.0
                or coluna_da_imagem.get(id(best_img)) != coluna_da_imagem.get(id(irmao))
            ):
                img_arr_irmao = _extract_perfect_image(doc, irmao, raster, width, height, scale)
                if img_arr_irmao is not None and img_arr_irmao.size > 0:
                    fp = _save_image(img_arr_irmao, sku_code, output_folder)
                    matches.append(_make_match(sku, page_num, fp, "variant_share"))
                    casados_pagina.append((col_idx, sku_x, sku_y, irmao))
                    continue

            if not best_img:
                unmatched.append({"sku": sku_code, "page": page_num, "reason": "no_img_in_col"})
                continue

            used_img_ids.add(id(best_img))
            variant_cache[base] = best_img
            casados_pagina.append((col_idx, sku_x, sku_y, best_img))

            # Verificar variações (múltiplas imagens agrupadas no mesmo Y)
            grouped = [best_img]
            for other in imgs_sorted:
                if id(other) in used_img_ids:
                    continue
                if abs(other["cy"] - best_img["cy"]) < 15:
                    grouped.append(other)
                    used_img_ids.add(id(other))

            if len(grouped) >= 2:
                # Composição: recorta a união das imagens APAGANDO o espaço
                # morto. Fotos posicionadas na diagonal deixam canto vazio no
                # retângulo que as envolve, e é lá que preço/specs da página
                # estão desenhados — recortar o raster cru trazia esse texto
                # junto (mesmo defeito do Dute em 16/09, ver #14.13).
                img_arr = _crop_composition_masked(grouped, raster, width, height, scale, page=page)
                match_type = "col_composition"
            else:
                img_arr = _extract_perfect_image(doc, best_img, raster, width, height, scale)
                match_type = "col_match"

            if img_arr is not None and img_arr.size > 0:
                filepath = _save_image(img_arr, sku_code, output_folder)
                matches.append(_make_match(sku, page_num, filepath, match_type))
            else:
                unmatched.append({"sku": sku_code, "page": page_num, "reason": "extract_failed"})

    print(f"  [ColMatch] Resultado: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Estratégia B: Embedded (catálogos sem grid visual)
# ─────────────────────────────────────────────────────────────

def _match_via_embedded(
    doc: fitz.Document,
    raster: np.ndarray,
    page_skus: list,
    page_imgs: List[Dict],
    scale: float,
    output_folder: str,
    page_num: int,
    orientacao: str = "acima",
) -> Tuple[List[Dict], List[Dict]]:
    """
    Casamento SKU↔imagem por proximidade espacial (para páginas sem grade
    detectável, ex: Lila Home, BM36).

    v55 (reunião 22/07/2026): reescrito após dois relatos reais —
    Lila pegando o LOGO do fornecedor em vez da foto do produto, BM36
    pegando a imagem "de baixo"/"do lado" errada. Causa raiz: o algoritmo
    antigo era guloso SKU-a-SKU em ordem de Y, sempre pegando a imagem mais
    PRÓXIMA AINDA DISPONÍVEL, sem limite de distância e sem olhar o conjunto
    todo — isso causa efeito cascata (um SKU rouba a imagem certa de outro,
    que sobra com o que estiver disponível, às vezes um logo distante).

    Fix: (1) casamento guloso GLOBAL — todos os pares SKU×imagem ordenados
    por distância, evita a cascata; (2) limite de distância máxima — rejeita
    (unmatched) em vez de forçar um match implausível.
    """
    height, width = raster.shape[:2]

    if not page_imgs:
        return [], [{"sku": s.get("sku"), "page": page_num, "reason": "no_embedded_imgs"} for s in page_skus]

    # Selo/tag sobreposto à foto vencia o casamento por proximidade — era o
    # "PROMOCIONAL saiu como imagem do produto" do catálogo GIRA. Este caminho
    # (usado por Lila, BM36 e GIRA) não tinha nenhum filtro; o de grid já tinha.
    page_imgs = _descartar_selos(page_imgs, "Embedded")

    matches, unmatched = [], []

    valid_skus = []
    for s in page_skus:
        sc = s.get("spatialContext", {})
        if sc.get("x") is not None and sc.get("y") is not None:
            valid_skus.append(s)
        else:
            unmatched.append({"sku": s.get("sku"), "page": page_num, "reason": "no_coords"})

    if not valid_skus:
        return matches, unmatched

    # raster está em pixels (escala `scale`); página em pontos PDF = height/scale.
    # Teto generoso o bastante pra não regredir catálogos que já funcionam,
    # mas rejeita o caso clássico (logo de cabeçalho longe do bloco do SKU).
    page_h_pt = height / max(scale, 0.01)
    max_score = max(300.0, page_h_pt * 0.6)

    # Score: distância Y (peso 2) + distância X (peso 1) — mesma métrica de antes.
    pairs = []  # (score, sku_idx, img_idx)
    for si, sku in enumerate(valid_skus):
        sc = sku["spatialContext"]
        sku_x, sku_y = sc["x"], sc["y"]
        for pi, img in enumerate(page_imgs):
            s = abs(img["cy"] - sku_y) * 2 + abs(img["cx"] - sku_x)
            # Foto ACIMA do código: a do cartão de baixo começa depois do código
            # e empatava em distância com a do próprio cartão (VAESO pág. 25:
            # o 7º item ficava sem foto). Só reordena o desempate: o teto de
            # aceitação usa o score cru (não pode reprovar quem já casava).
            rect_i = img.get("rect")
            ordem = s
            if orientacao == "acima" and rect_i is not None and rect_i.y0 > sku_y + 2.0:
                ordem += 100.0
            # Foto ABAIXO do código (medido no catálogo): foto inteira ACIMA do
            # código é do cartão de cima. Na Petrin pág. 62 (Josef 24/09/2026)
            # os códigos da 2ª linha ficavam mais perto das fotos da 1ª linha
            # e as roubavam — a 1ª linha ficava sem foto (RD1891, RD1889) e a
            # 2ª com a foto errada. Só reordena; o teto usa o score cru.
            if orientacao == "abaixo" and rect_i is not None and rect_i.y1 < sku_y - 2.0:
                ordem += 1000.0
            pairs.append((ordem, si, pi, s))
    pairs.sort(key=lambda t: t[0])

    chosen_by_sku: Dict[int, Dict] = {}
    used_sku_idx: set = set()
    used_img_idx: set = set()
    for _ordem, si, pi, s in pairs:
        if si in used_sku_idx or pi in used_img_idx:
            continue
        used_sku_idx.add(si)
        used_img_idx.add(pi)
        chosen_by_sku[si] = {"img": page_imgs[pi], "score": s}

    # ── MATRIZ COR × TAMANHO (VAESO, 19/08/2026) ──
    # O casamento acima é 1:1 (used_img_idx), o que é o certo quando cada
    # foto pertence a um produto. Mas há páginas que cruzam COR × TAMANHO
    # numa tabela: a miniatura da cor fica à ESQUERDA e vários códigos à
    # DIREITA, na MESMA linha —
    #     [foto Rosé]  ...  KM0002 (500 ml)   KG0002 (750 ml)
    # Aqui UMA miniatura pertence legitimamente a 2+ códigos. Com 6 fotos
    # para 12 códigos, o 1:1 deixava metade sem imagem e ainda embaralhava:
    # o código que sobrava puxava a miniatura da linha VIZINHA (foi o
    # "trocou os de cima pelos de baixo" relatado pelo cliente).
    #
    # Esta passada roda SÓ para quem ficou sem imagem e exige que a faixa
    # vertical da foto CONTENHA o Y do código (mesma linha visual) — critério
    # geométrico, não uma folga arbitrária. Como o compartilhamento é
    # intencional, ela ignora o used_img_idx e o teto de score (que existe
    # pra barrar logo distante, situação diferente desta).
    MARGEM_LINHA_PT = 8.0  # código raramente centraliza exato na faixa da foto
    for si, sku in enumerate(valid_skus):
        # Só pula quem já tem match ACEITÁVEL. Quem recebeu um par acima do
        # teto de score está de fato sem imagem (vai virar unmatched adiante),
        # e é justamente o caso do código que sobrou na matriz — precisa
        # entrar aqui, senão fica sem foto mesmo tendo a miniatura na linha.
        ja = chosen_by_sku.get(si)
        if ja is not None and ja["score"] <= max_score:
            continue
        sku_y = sku["spatialContext"]["y"]
        melhor, melhor_dist = None, float("inf")
        for img in page_imgs:
            rect = img.get("rect")
            if rect is None:
                continue
            if rect.y0 - MARGEM_LINHA_PT <= sku_y <= rect.y1 + MARGEM_LINHA_PT:
                d = abs(img["cy"] - sku_y)
                if d < melhor_dist:
                    melhor_dist, melhor = d, img
        if melhor is not None:
            chosen_by_sku[si] = {"img": melhor, "score": 0.0, "row_shared": True}
            print(f"    [Embedded] {sku.get('sku')}: foto compartilhada da mesma linha (matriz cor×tamanho)")

    # ── LEGENDA LOGO ABAIXO DA FOTO GRANDE (VAESO, 27/08/2026) ──
    # Layout: 1 foto grande (a variante "principal") + N miniaturas de cor
    # abaixo. A legenda da variante principal fica no VÃO entre o fim da
    # foto grande e o início das miniaturas — fora da faixa ±8pt do passo
    # acima (pensado pra legenda DENTRO da faixa da foto, não abaixo dela).
    # E a foto grande, sendo larga, tem o centro longe da própria legenda —
    # o score ponderado (passo 1) rejeita como implausível, mesmo com a
    # foto certa disponível e sem uso. Cliente reportou isso exatamente:
    # a variante "principal" de cada grupo (a que teria a foto grande)
    # ficando sem imagem enquanto as de cor saíam certas.
    #
    # Só roda pra quem ainda não tem nenhum match aceitável (nada a perder)
    # e só considera imagens que NINGUÉM mais vai usar — nunca tira a foto
    # de um SKU que já casou certo.
    imgs_em_uso = {
        id(v["img"]) for v in chosen_by_sku.values()
        if v.get("row_shared") or v["score"] <= max_score
    }
    MARGEM_ABAIXO_PT = 30.0  # vão típico legenda/preço entre a foto e o texto
    for si, sku in enumerate(valid_skus):
        ja = chosen_by_sku.get(si)
        if ja is not None and (ja.get("row_shared") or ja["score"] <= max_score):
            continue
        sku_x, sku_y = sku["spatialContext"]["x"], sku["spatialContext"]["y"]
        melhor, melhor_gap = None, float("inf")
        for img in page_imgs:
            if id(img) in imgs_em_uso:
                continue
            rect = img.get("rect")
            if rect is None:
                continue
            gap = sku_y - rect.y1  # legenda deve estar LOGO ABAIXO (gap pequeno e positivo)
            if 0 <= gap <= MARGEM_ABAIXO_PT and rect.x0 <= sku_x <= rect.x1 and gap < melhor_gap:
                melhor_gap, melhor = gap, img
        if melhor is not None:
            chosen_by_sku[si] = {"img": melhor, "score": 0.0, "row_shared": True}
            imgs_em_uso.add(id(melhor))
            print(f"    [Embedded] {sku.get('sku')}: foto grande logo acima da legenda (gap={melhor_gap:.1f}pt)")

    # ── FOTO LOGO ABAIXO DO CÓDIGO (Petrin, 24/09/2026) ──
    # Catálogo medido como "foto abaixo do código": a foto do produto começa
    # logo abaixo dele, mas pode ser larga (guarda-chuva aberto da pág. 184,
    # 296pt) e ter o CENTRO longe do código — o score ponderado a rejeitava
    # (RD1147, RD1151, RD1142 sem foto). Mesmo cuidado da passada anterior:
    # só pra quem não tem match aceitável, só com imagem sem dono, e só se
    # nenhum outro código estiver entre o código e a foto.
    if orientacao == "abaixo":
        MARGEM_FOTO_ABAIXO_PT = 160.0
        for si, sku in enumerate(valid_skus):
            ja = chosen_by_sku.get(si)
            if ja is not None and (ja.get("row_shared") or ja["score"] <= max_score):
                continue
            sku_x, sku_y = sku["spatialContext"]["x"], sku["spatialContext"]["y"]
            melhor, melhor_gap = None, float("inf")
            for img in page_imgs:
                if id(img) in imgs_em_uso:
                    continue
                rect = img.get("rect")
                if rect is None:
                    continue
                gap = rect.y0 - sku_y
                if not (0 <= gap <= MARGEM_FOTO_ABAIXO_PT and rect.x0 - 10 <= sku_x <= rect.x1):
                    continue
                entre = any(
                    o is not sku and sku_y < o["spatialContext"]["y"] < rect.y0
                    and rect.x0 - 10 <= o["spatialContext"]["x"] <= rect.x1
                    for o in valid_skus
                )
                if not entre and gap < melhor_gap:
                    melhor_gap, melhor = gap, img
            if melhor is not None:
                chosen_by_sku[si] = {"img": melhor, "score": 0.0, "row_shared": True}
                imgs_em_uso.add(id(melhor))
                print(f"    [Embedded] {sku.get('sku')}: foto logo abaixo do código (gap={melhor_gap:.1f}pt)")

    for si, sku in enumerate(valid_skus):
        chosen = chosen_by_sku.get(si)
        # row_shared já passou pelo critério geométrico de "mesma linha";
        # o teto de score existe pra outro caso (logo/foto distante).
        if not chosen or (not chosen.get("row_shared") and chosen["score"] > max_score):
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_plausible_match"})
            continue

        img_arr = _extract_perfect_image(doc, chosen["img"], raster, width, height, scale)
        if img_arr is None or img_arr.size == 0:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "extract_failed"})
            continue

        filepath = _save_image(img_arr, sku.get("sku", "UNKNOWN"), output_folder)
        matches.append(_make_match(sku, page_num, filepath, "embedded"))

    return matches, unmatched


def _crop_raster_at_pdf_rect(rect: fitz.Rect, raster: np.ndarray,
                              width: int, height: int, scale: float) -> Optional[np.ndarray]:
    """Helper: crop do raster usando rect em PDF-points."""
    x0 = max(0, int(rect.x0 * scale))
    x1 = min(width, int(rect.x1 * scale))
    y0 = max(0, int(rect.y0 * scale))
    y1 = min(height, int(rect.y1 * scale))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = raster[y0:y1, x0:x1]
    return crop if crop.size > 0 else None


def _decode_with_white_bg(decoded: np.ndarray, doc: fitz.Document, smask_xref: int) -> np.ndarray:
    """
    Decodifica imagem em RGB compondo qualquer transparência sobre fundo BRANCO.

    PDF storage cases handled:
    - Grayscale (1 channel) → RGB direto
    - BGR (3 channels) sem alpha → RGB direto
    - BGR (3 channels) com SMask externo → composita SMask como alpha sobre branco
    - BGRA (4 channels) → composita alpha sobre branco
    """
    # Caso 1: grayscale puro
    if len(decoded.shape) == 2:
        return cv2.cvtColor(decoded, cv2.COLOR_GRAY2RGB)

    if decoded.shape[2] == 4:
        # BGRA — composita alpha sobre branco
        bgr = decoded[:, :, :3].astype(np.float32)
        alpha = decoded[:, :, 3:4].astype(np.float32) / 255.0
        white = np.full_like(bgr, 255.0)
        composited = bgr * alpha + white * (1.0 - alpha)
        rgb = cv2.cvtColor(composited.astype(np.uint8), cv2.COLOR_BGR2RGB)
        return rgb

    # decoded tem 3 canais (BGR). Verifica se há SMask externo (alpha channel separado)
    bgr = decoded
    if smask_xref and smask_xref > 0:
        try:
            smask_data = doc.extract_image(smask_xref)
            if smask_data and smask_data.get("image"):
                mask_arr = np.frombuffer(smask_data["image"], dtype=np.uint8)
                mask = cv2.imdecode(mask_arr, cv2.IMREAD_UNCHANGED)
                if mask is not None:
                    # Reduz mask a 1 canal se necessário
                    if len(mask.shape) == 3:
                        mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
                    # Resize se dimensões não baterem
                    if mask.shape[:2] != bgr.shape[:2]:
                        mask = cv2.resize(mask, (bgr.shape[1], bgr.shape[0]),
                                          interpolation=cv2.INTER_LINEAR)
                    alpha = mask.astype(np.float32) / 255.0
                    alpha = alpha[:, :, np.newaxis]
                    bgr_f = bgr.astype(np.float32)
                    white = np.full_like(bgr_f, 255.0)
                    composited = bgr_f * alpha + white * (1.0 - alpha)
                    bgr = composited.astype(np.uint8)
        except Exception:
            pass

    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


# ─────────────────────────────────────────────────────────────
# Extração padrão-ouro: doc.extract_image com fallback raster
# ─────────────────────────────────────────────────────────────

def _extract_perfect_image(
    doc: fitz.Document,
    img_info: Dict,
    raster: np.ndarray,
    width: int,
    height: int,
    scale: float
) -> Optional[np.ndarray]:
    """
    Extrai a imagem com qualidade perfeita.

    Prioridade:
    1. doc.extract_image() — bytes raw do PDF, decode para RGB
       Verifica se a imagem extraída tem proporção compatível com o display rect
       (rejeita partial/mask/sub-images com aspect ratio muito diferente)
    2. Fallback: crop do raster renderizado no rect de display

    Retorna numpy array RGB ou None se ambos falharem.
    """
    rect = img_info["rect"]

    # Foto fatiada pelo exportador do PDF (ver _costurar_tiles): nenhum xref
    # sozinho contem a foto inteira, entao recorta o raster na uniao das
    # fatias. Como as fatias sao contiguas, a uniao e exatamente a foto.
    if img_info.get("tiles"):
        return _crop_raster_at_pdf_rect(rect, raster, width, height, scale)

    # Foto recortada pelo PDF: o arquivo tem mais do que aparece (4 coletes,
    # aparece 1) — vai direto pro recorte da parte visível.
    if img_info.get("recortada"):
        doc_extract = False
    else:
        doc_extract = True

    xref = img_info["xref"]
    display_w = max(1.0, rect.width)
    display_h = max(1.0, rect.height)
    display_aspect = display_w / display_h

    # Tentativa 1: doc.extract_image (qualidade perfeita)
    try:
        if not doc_extract:
            raise ValueError("recortada")
        img_data = doc.extract_image(xref)
        if img_data and img_data.get("image"):
            raw = img_data["image"]
            arr = np.frombuffer(raw, dtype=np.uint8)
            decoded = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
            if decoded is not None and decoded.size > 0:
                # Tentar máscara/SMask explícita do PDF (alpha channel separado)
                smask_xref = img_data.get("smask", 0)
                rgb = _decode_with_white_bg(decoded, doc, smask_xref)

                # Sanidade: aspect ratio do extraído deve bater com o display
                ext_h, ext_w = rgb.shape[:2]
                if ext_w > 0 and ext_h > 0:
                    ext_aspect = ext_w / ext_h
                    aspect_ratio = max(ext_aspect, display_aspect) / min(ext_aspect, display_aspect)
                    if aspect_ratio < 1.4:  # aspecto compatível
                        return rgb
                    # senão: cai no fallback raster
    except Exception as e:
        pass  # cai no fallback

    # Fallback: crop do raster no rect de display
    inset = 2 / scale
    x0 = max(0, int((rect.x0 + inset) * scale))
    x1 = min(width, int((rect.x1 - inset) * scale))
    y0 = max(0, int((rect.y0 + inset) * scale))
    y1 = min(height, int((rect.y1 - inset) * scale))
    if x1 <= x0 or y1 <= y0:
        return None
    # Só a imagem, sem o texto/linhas/fundo que a página desenha por cima ou
    # por baixo do retângulo (Dute DT10176 pág. 185, Josef 25/09/2026: foto
    # girada no arquivo cai aqui e trazia a linha tracejada e o rodapé).
    if img_info.get("pagina") is not None:
        limpo = _render_so_imagens(
            doc.load_page(img_info["pagina"]), [img_info],
            fitz.Rect(x0 / scale, y0 / scale, x1 / scale, y1 / scale), (x1 - x0, y1 - y0), scale,
        )
        if limpo is not None:
            return limpo
    crop = raster[y0:y1, x0:x1]
    return crop if crop.size > 0 else None


# ─────────────────────────────────────────────────────────────
# Utilitários
# ─────────────────────────────────────────────────────────────

def _is_barcode_like(img_bgr: np.ndarray) -> bool:
    """Detecta CÓDIGO DE BARRAS (EAN) p/ NÃO escolher a barra no lugar da foto
    do produto (Lila: barra colada/sobreposta à imagem). Assinatura: baixa
    saturação (preto/branco) + alta densidade de transições verticais (barras)
    + largo. Limiares validados nas imagens reais da Lila (30 barras pegas,
    0 fotos de produto). Fail-open: erro → não é barra."""
    try:
        h, w = img_bgr.shape[:2]
        if h < 8 or w < 8:
            return False
        sat = float(np.mean(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)[:, :, 1])) / 255.0
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        _, binr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        trans = [int(np.count_nonzero(np.diff(binr[int(h * f), :].astype(np.int16)) != 0))
                 for f in (0.3, 0.5, 0.7)]
        dens = (sum(trans) / len(trans)) / max(w, 1)
        aspect = w / max(h, 1)
        return dens >= 0.15 and sat <= 0.08 and aspect >= 1.5
    except Exception:
        return False


def _get_page_embedded_images(page: fitz.Page, logo_xrefs: set,
                              logo_digests: set = frozenset(),
                              allow_fullpage: bool = False) -> List[Dict]:
    """Retorna imagens válidas da página com posição (PDF-points) e xref.

    allow_fullpage (v24): por padrão descarta imagens que cobrem >85% da
    página (são fundos/decorações no matching por coluna). MAS para o AI
    Picker, a foto PRINCIPAL do produto às vezes É uma imagem quase
    full-page (ex: DAGIA pg 14 — foto dos 6 copos cobre a página inteira,
    com título e tag SOBREPOSTOS como imagens separadas). Nesses casos
    o filtro >85% descartava a melhor candidata e o Gemini só via tag/título.
    Com allow_fullpage=True mantemos a imagem grande; logos (que repetem em
    várias páginas) seguem filtrados por logo_xrefs, então fundos decorativos
    recorrentes continuam fora.

    PERFORMANCE + CORRETUDE (achado real: catálogo Fortal, 24/07/2026): usa
    page.get_image_info(xrefs=True) em vez de page.get_images(full=True) +
    page.get_image_rects(xref) por imagem. O catálogo real do Fortal tem
    900+ objetos de imagem "fantasma" referenciados nos recursos de CADA
    página (nunca desenhados -- artefato do export), mas só ~10-12
    realmente aparecem. O loop antigo: (1) chamava get_image_rects() uma
    vez por FANTASMA (900+ x ~30ms = travava a página inteira), e (2) como
    quase todo fantasma se repete em várias páginas, _detect_logo_xrefs
    classificava TODOS como "logo" e a página inteira ficava com 0 imagens
    válidas -- exatamente o "as imagens não vieram" relatado. get_image_info
    retorna só as imagens de fato desenhadas, com bbox já calculado, em 1
    chamada -- resolve as duas coisas de uma vez. Bônus: também corrige um
    dedup incorreto por xref (a mesma imagem reaproveitada em 2+ posições
    na mesma página só contava a 1ª posição).

    logo_digests filtra por CONTEÚDO (não posição -- ver nota em
    _detect_logo_xrefs sobre catálogos com grid template perfeito).
    """
    page_w, page_h = page.rect.width, page.rect.height
    result = []
    for info in page.get_image_info(xrefs=True):
        xref = info.get("xref") or 0
        if not xref or xref in logo_xrefs:
            continue
        digest = info.get("digest")
        if digest and digest in logo_digests:
            continue
        bbox = info.get("bbox")
        if not bbox:
            continue
        rect = fitz.Rect(bbox)
        iw, ih = rect.width, rect.height
        if iw < 20 or ih < 20:
            continue
        if not allow_fullpage and iw > page_w * 0.85 and ih > page_h * 0.85:
            continue
        # CÓDIGO DE BARRAS: gate pelo aspect dos PIXELS (não do rect, que pode
        # estar escalado). extract_image traz width/height sem decodificar; só
        # imdecode as LARGAS (barras são largas/baixas; fotos são quadradas/
        # retrato). Evita escolher a barra colada na foto (Lila). Memory-safe:
        # decodifica 1 por vez e descarta (não acumula arrays — IV-16).
        try:
            ext = page.parent.extract_image(xref)
            pw, ph = ext.get("width", 0), ext.get("height", 1)
            is_bar = False
            if pw / max(ph, 1) >= 1.5:
                arr = cv2.imdecode(np.frombuffer(ext["image"], np.uint8), cv2.IMREAD_COLOR)
                is_bar = arr is not None and _is_barcode_like(arr)
                del arr
            del ext  # libera bytes raw imediatamente (fotos DAGIA ~1-5MB cada)
            if is_bar:
                continue
        except Exception:
            pass
        result.append({
            "xref": xref,
            "pagina": getattr(page, "number", None),
            "rect": rect,
            "cx": (rect.x0 + rect.x1) / 2,
            "cy": (rect.y0 + rect.y1) / 2,
            "area": iw * ih,
        })

    # Imagem que COBRE outra (≥80% da menor dentro dela) pode ser uma foto
    # recortada pelo PDF (clip) — o retângulo declarado é maior que o que
    # aparece. Mede a parte visível só nesses casos (render custa) e, se for
    # bem menor, passa a usar ela. Ver _retangulo_visivel.
    for img in result:
        r = img["rect"]
        cobre = any(
            o is not img and o["area"] < img["area"]
            and (o["rect"] & r).get_area() >= 0.8 * o["area"]
            for o in result
        )
        if not cobre:
            continue
        vis = _retangulo_visivel(page, img) if isinstance(page, fitz.Page) else None
        if vis is None or vis.get_area() >= 0.6 * r.get_area():
            continue
        img.update({
            "rect": vis, "cx": (vis.x0 + vis.x1) / 2, "cy": (vis.y0 + vis.y1) / 2,
            "area": vis.get_area(), "recortada": True,
        })
    return result


def _find_image_above_sku(page_imgs: List[Dict],
                           sku_x: float, sku_y: float,
                           x_min: float, x_max: float,
                           used_xrefs: set) -> Optional[Dict]:
    """Imagem cujo centro está acima do SKU, na mesma coluna, ainda não usada."""
    x_margin = (x_max - x_min) * 0.2
    candidates = [
        p for p in page_imgs
        if p["xref"] not in used_xrefs
        and p["cy"] < sku_y
        and (x_min - x_margin) <= p["cx"] <= (x_max + x_margin)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda p: sku_y - p["cy"])


def _detect_logo_xrefs(doc: fitz.Document) -> tuple:
    """
    Detecta imagens de logo/cabeçalho repetidas em ≥3 páginas amostradas,
    por DOIS sinais:
      1. Mesmo xref reaproveitado entre páginas (PDF eficiente, 1 cópia só).
      2. Mesmo CONTEÚDO (digest -- hash da imagem decodificada, já calculado
         pelo próprio MuPDF em get_image_info) repetindo entre páginas, MESMO
         com xref diferente a cada página -- achado real: catálogo Lila Home
         reinsere uma cópia nova do logo (xref distinto) no topo de cada
         página; o sinal 1 sozinho não detectava, e o logo entrava como
         candidato válido de imagem de produto (LH635 puxava o logo).

      IMPORTANTE: NÃO usar posição (bbox) como sinal de repetição -- tentado
      e revertido (achado real: catálogo Fortal). Catálogos com grid
      template perfeito (mesmas N células, mesmo tamanho, em TODA página de
      produto) fazem toda posição de foto real "repetir" entre páginas
      tanto quanto um logo de verdade repetiria -- um logo genuíno repete
      MESMO CONTEÚDO em posição fixa; fotos de produtos diferentes na mesma
      célula têm conteúdo diferente. Digest resolve isso corretamente.

    Amostra até 15 páginas distribuídas -- reduzido de 40 (achado real: Fortal
    tem 900+ imagens "fantasma" por página e get_image_info leva ~12-20s
    nelas; 40 páginas amostradas custava minutos só nesta etapa). 15 páginas
    já são de sobra pro limiar de detecção (≥3 ocorrências).
    Retorna (logo_xrefs, logo_digests).
    """
    n = len(doc)
    if n <= 15:
        sample = list(range(n))
    else:
        step = max(1, n // 12)
        sample = sorted(set(
            list(range(0, min(n, 5))) +
            list(range(0, n, step))[:8] +
            list(range(max(0, n - 2), n))
        ))
    xref_pages: Dict[int, set] = {}
    digest_pages: Dict[bytes, set] = {}
    for i in sample:
        page = doc.load_page(i)
        # get_image_info (não get_images + get_image_rects por imagem): ver
        # nota de performance em _get_page_embedded_images. Essencial aqui
        # também -- catálogos como o Fortal têm 900+ imagens "fantasma" por
        # página, e o loop antigo fazia 1 get_image_rects() POR imagem em
        # até 40 páginas amostradas (minutos de trava só nesta etapa).
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref") or 0
            if not xref:
                continue
            xref_pages.setdefault(xref, set()).add(i)
            digest = info.get("digest")
            if digest:
                digest_pages.setdefault(digest, set()).add(i)
    logo_xrefs = {x for x, pgs in xref_pages.items() if len(pgs) >= 3}
    logo_digests = {d for d, pgs in digest_pages.items() if len(pgs) >= 3}
    return logo_xrefs, logo_digests


def _create_kit_collage(images_rgb: List[np.ndarray], max_dim: int = 800) -> Optional[np.ndarray]:
    """
    Cria colagem em grid das imagens de um kit (ex: Jogo de Jantar DAGIA DZ\\d+).

    Cliente Nunes precisa enxergar o kit completo no cadastro Mercos, não
    apenas 1 das peças (xícara avulsa). Esta colagem agrupa todas as imagens
    da página em um grid balanceado (~sqrt N), com padding branco.

    Args:
      images_rgb: lista de numpy RGB arrays (1 ou mais)
      max_dim: dimensão máxima do arquivo final

    Returns:
      np.ndarray RGB com a colagem, ou None se lista vazia.
    """
    import math
    n = len(images_rgb)
    if n == 0:
        return None
    if n == 1:
        return images_rgb[0]

    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cell_h = max_dim // max(rows, 2)

    # Redimensiona cada imagem mantendo proporção (altura igual)
    resized: List[np.ndarray] = []
    for img in images_rgb:
        h, w = img.shape[:2]
        if h <= 0:
            continue
        scale_f = cell_h / h
        new_w = max(1, int(w * scale_f))
        resized.append(cv2.resize(img, (new_w, cell_h), interpolation=cv2.INTER_AREA))

    if not resized:
        return None

    # Monta linhas: agrupa cols imagens, padding branco pra alinhar
    row_images: List[np.ndarray] = []
    for r in range(rows):
        row_items = resized[r * cols:(r + 1) * cols]
        if not row_items:
            continue
        # Pad em largura: completa células faltantes com branco
        while len(row_items) < cols:
            row_items.append(np.full((cell_h, max(1, cell_h), 3), 255, dtype=np.uint8))
        max_w = max(img.shape[1] for img in row_items)
        padded = []
        for img in row_items:
            h, w = img.shape[:2]
            if w < max_w:
                pad = np.full((h, max_w - w, 3), 255, dtype=np.uint8)
                img = np.hstack([img, pad])
            padded.append(img)
        row_images.append(np.hstack(padded))

    # Combina linhas verticalmente — todas têm mesma largura (cols * max_w)
    max_row_w = max(img.shape[1] for img in row_images)
    final_rows: List[np.ndarray] = []
    for img in row_images:
        h, w = img.shape[:2]
        if w < max_row_w:
            pad = np.full((h, max_row_w - w, 3), 255, dtype=np.uint8)
            img = np.hstack([img, pad])
        final_rows.append(img)
    return np.vstack(final_rows)


def _resize_keep_aspect(img_rgb: np.ndarray, max_dim: int) -> np.ndarray:
    """Redimensiona mantendo aspect ratio se algum lado > max_dim."""
    h, w = img_rgb.shape[:2]
    if h <= max_dim and w <= max_dim:
        return img_rgb
    s = max_dim / max(h, w)
    return cv2.resize(img_rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


def _save_image_hires(img_rgb: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Variante de _save_image para kits — preserva resolução alta (1200px).

    Sanitização do nome igual a _save_image. Quality JPEG 92 (melhor que 85
    do default) porque a imagem é da caixa do produto e o cliente cadastra
    no Mercos.
    """
    pre = sku_code.replace("/", "_").replace("\\", "_")
    clean = "".join(c for c in pre if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.jpg")
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    if h > 1200 or w > 1200:
        scale_f = 1200 / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale_f), int(h * scale_f)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(filepath, bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return filepath


def _save_image(img_rgb: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Salva {sku}.jpg. img_rgb é numpy array RGB.

    Sanitização do nome:
      - barra "/" vira "_" (ex: CF001/L12 -> CF001_L12.jpg) para preservar
        legibilidade do código quando aberto fora do app
      - outros caracteres não-alfanuméricos viram nada

    Qualidade (v19): max_dim 600→1000, JPEG 85→90 (cliente Nunes cadastra no
    Mercos e precisa de imagem clara). Tamanho ainda OK pra Supabase Storage.
    """
    pre = sku_code.replace("/", "_").replace("\\", "_")
    clean = "".join(c for c in pre if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.jpg")
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    max_dim = 1000  # era 600
    h, w = bgr.shape[:2]
    if h > max_dim or w > max_dim:
        scale = max_dim / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    cv2.imwrite(filepath, bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])  # era 85
    return filepath


def _make_match(sku: dict, page_num: int, filepath: str, match_type: str) -> Dict:
    return {
        "sku": sku.get("sku", "UNKNOWN"),
        "product_name": sku.get("name", ""),
        "page": page_num,
        "local_path": filepath,
        "final_image_name": os.path.basename(filepath),
        "match_type": match_type,
        "match_confidence": 1.0,
        "status": "matched",
    }


def _cluster_coords(coords: List[float], tolerance: float = 10) -> List[float]:
    if not coords:
        return []
    coords_sorted = sorted(set(coords))
    clusters, current = [], [coords_sorted[0]]
    for coord in coords_sorted[1:]:
        if coord - current[-1] <= tolerance:
            current.append(coord)
        else:
            clusters.append(sum(current) / len(current))
            current = [coord]
    clusters.append(sum(current) / len(current))
    return clusters


def _count_segments_per_cluster(lines: List[tuple], clusters: List[float],
                                  tolerance: float = 20) -> List[int]:
    counts = [0] * len(clusters)
    for line in lines:
        coord = line[0]
        for i, cluster in enumerate(clusters):
            if abs(coord - cluster) <= tolerance:
                counts[i] += 1
                break
    return counts
