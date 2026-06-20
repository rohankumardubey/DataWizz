import json

from app.services.superset_runtime_service import SupersetRuntimeService


def test_native_command_uses_runtime_state_venv(tmp_path) -> None:
    native_venv = tmp_path / "cached-superset"
    superset_bin = native_venv / "bin" / "superset"
    superset_bin.parent.mkdir(parents=True)
    superset_bin.touch()

    runtime_state = tmp_path / "superset-runtime.json"
    runtime_state.write_text(
        json.dumps({"mode": "native", "native_venv": str(native_venv)}),
        encoding="utf-8",
    )

    service = SupersetRuntimeService()
    service.runtime_state_path = runtime_state

    assert service._native_superset_command() == [str(superset_bin)]
