# Medix Research Package

This directory separates the thesis method from the product implementation.

- `literature_matrix.md` records what each core paper establishes and how it affects Medix.
- `research_gap.md` defines claims that are testable without presenting the prototype as a
  clinically validated device.
- `evaluation_protocol.md` defines the technical experiment that must be completed before the
  user study.
- `kan_experiment.md` defines the controlled, parameter-matched KAN-versus-MLP confidence
  experiment and the rule for deciding whether KAN should enter the pipeline.
- `preliminary_kan_results.md` records the first reproducible comparison and its limitations.
- `evidence_agreement_method.md` specifies the proposed Medix-EAK contribution, feature contract,
  ablations, and review boundary for the conflict benchmark.
- `generation_comparison.md` defines the paired extractive, structured, and free-form response
  experiment and its blinded human-review protocol.
- `medgemma_comparison.md` records the MedGemma 1.5 4B IT versus Qwen 3.5 9B generation-model
  comparison and the decision not to promote MedGemma.
- `sol_qwen36_comparison.md` records the Sol-hosted Qwen 3.6 27B versus local Qwen 3.5 9B
  comparison and the decision not to switch production models.
- `references.bib` contains starter BibTeX entries that must be checked against the citation
  format required by the university.

The documents are working research notes, not clinical guidance. Any participant study must be
reviewed through the university's applicable ethics or IRB process before recruitment or data
collection.
