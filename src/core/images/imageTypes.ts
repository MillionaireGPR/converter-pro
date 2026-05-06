// ===================================================================
// TIPOS DA CAMADA DE EXTRAÇÃO E PROCESSAMENTO DE IMAGENS
// ===================================================================

export interface SpatialContext {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface ImagemExtraida {
  originalName: string;
  temporaryId: string;
  sourceType: 'pdf' | 'excel' | 'url';
  sourcePage?: number;           // Para PDF (página 1-based)
  sourceIndex?: number;          // Se houver várias na página / workbook
  sourceSheet?: string;          // ✅ NOVO: Nome da aba/sheet no Excel (ex: "Conferencias", "DADOS")
  imageBlob?: Blob;              // Dados brutos
  imageDataUrl?: string;         // DataURL base64 para preview
  width?: number;
  height?: number;
  confidence: number;            // Qualidade presumida da extração
  spatialContext?: SpatialContext; // NOVO: Posição exata na página
}

export interface ImagemAssociadaProduto {
  sku: string;
  productName: string;
  supplier: string;
  imageFileNameFinal: string;    // Ex: "CK4527.jpg", "CK4527_2.jpg"
  sourcePage?: number;
  confidence: number;            // Quão certeira foi a heurística para este SKU
  warnings?: string[];
  imageBlob?: Blob;
  imageDataUrl?: string;
}

export interface ResultadoExtracaoImagens {
  totalImagesFound: number;
  totalImagesMatched: number;
  totalImagesUnmatched: number;
  images: ImagemAssociadaProduto[];
  unmatchedImages: ImagemExtraida[];
  zipUrl?: string;  // URL do ZIP gerado pelo backend
  warnings: string[];
  errors: string[];
}
