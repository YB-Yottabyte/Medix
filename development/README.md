# Development support

The application has two main parts: `frontend/` is the website and chat interface, and `backend/`
is the API and evidence-grounded question-answering pipeline. This directory groups supporting
files so they do not distract from that project structure.

| Folder | Supporting role |
| --- | --- |
| `scripts/` | Resource preparation and maintenance utilities |
| `evaluation/` | Research experiments, frozen results, and artifacts |
| `docs/` | Architecture and research notes |
| `papers/`, `thesis/` | Reference materials and supporting documents |


Essential project files stay at the repository root: `pyproject.toml`, `uv.lock`,
`.python-version`, `app.py`, `README.md`, and `LICENSE`. uv is the Python environment manager;
it is not part of the development directory. The existing root `.venv` stays in place.
Runtime resources are in the root `data/` directory; the source dataset is in root `MedVidQA/`.

Run from the Medix root:

```bash
uv run --env-file backend/.env --no-sync python app.py
uv run --no-sync python -m development.scripts.build_runtime_collection --help
sbatch backend/medix_live_backend.sbatch
```

Start the frontend with `pnpm dev` from `frontend/`. Backend credentials and runtime resources
remain in `backend/.env`, `backend/config.yaml`, and `data/`. Frozen research records
are retained. Files on Sol and running remote jobs are not changed by a local reorganization.

Backend regression tests are in `development/tests/` and run in CI. Earlier
retired UI/assets remain in the local support archive; they are not runtime
dependencies. The live Sol launcher is `backend/medix_live_backend.sbatch`.
Generated evaluation results stay local and can be regenerated from the
documented runners. Deployment instructions are in `docs/DEPLOYMENT.md`.
