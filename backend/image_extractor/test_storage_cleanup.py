"""Limpeza automática do bucket Supabase (22/09/2026): o bucket grátis tem
1GB e cada job de imagens deixa um ZIP permanente em `{jobId}/imagens_extraidas.zip`
-- sem apagar, o armazenamento enche sozinho (estourou em 22/09, 1.71GB/1GB,
"Organization exceeded its quota"). `cleanup_old_storage_files` decide o que
apagar só pela data do próprio arquivo no Storage (sem depender de nenhuma
tabela), então este teste simula a API do supabase-py com um dublê simples."""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import storage as st


class _FakeStorageBucket:
    def __init__(self, tree):
        # tree: {"jobA": [{"name": "imagens_extraidas.zip", "metadata": {"size": N},
        #                  "updated_at": "..."}], ...}
        self._tree = tree
        self.removed = []

    def list(self, path=""):
        if not path:
            return [
                {"name": job_id, "id": None, "metadata": None}
                for job_id in self._tree
            ]
        return self._tree.get(path, [])

    def remove(self, paths):
        self.removed.extend(paths)


class _FakeStorage:
    def __init__(self, bucket):
        self._bucket = bucket

    def from_(self, name):
        return self._bucket


def _iso(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def test_apaga_so_arquivos_mais_velhos_que_a_retencao(monkeypatch):
    tree = {
        "jobVelho": [{"name": "imagens_extraidas.zip", "metadata": {"size": 1_000_000}, "updated_at": _iso(15)}],
        "jobNovo": [{"name": "imagens_extraidas.zip", "metadata": {"size": 2_000_000}, "updated_at": _iso(1)}],
    }
    bucket = _FakeStorageBucket(tree)
    monkeypatch.setattr(st, "supabase", type("S", (), {"storage": _FakeStorage(bucket)})())

    result = st.cleanup_old_storage_files(retention_days=10)

    assert result["totalFiles"] == 2
    assert result["deletedFiles"] == 1
    assert bucket.removed == ["jobVelho/imagens_extraidas.zip"]
    assert result["freedBytes"] == 1_000_000


def test_nada_pra_apagar_nao_chama_remove(monkeypatch):
    tree = {"jobNovo": [{"name": "imagens_extraidas.zip", "metadata": {"size": 500}, "updated_at": _iso(1)}]}
    bucket = _FakeStorageBucket(tree)
    monkeypatch.setattr(st, "supabase", type("S", (), {"storage": _FakeStorage(bucket)})())

    result = st.cleanup_old_storage_files(retention_days=10)

    assert result["deletedFiles"] == 0
    assert bucket.removed == []


def test_arquivo_sem_data_e_ignorado_com_seguranca(monkeypatch):
    tree = {"jobSemData": [{"name": "imagens_extraidas.zip", "metadata": {"size": 500}, "updated_at": None}]}
    bucket = _FakeStorageBucket(tree)
    monkeypatch.setattr(st, "supabase", type("S", (), {"storage": _FakeStorage(bucket)})())

    result = st.cleanup_old_storage_files(retention_days=10)

    assert result["deletedFiles"] == 0
    assert result["skippedNoDate"] == 1
