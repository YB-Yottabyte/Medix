"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  FileText,
  Layers,
  List,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Children, isValidElement, useEffect, useRef, useState } from "react";
import "./docs.css";

const sections = [
  ["overview", "Overview"],
  ["architecture", "System Architecture"],
  ["workflow", "How Medix Works"],
  ["multimodal", "Multimodal Processing"],
  ["retrieval", "RAG & Evidence Retrieval"],
  ["models", "Model Architecture"],
  ["evaluation", "Evaluation & Results"],
  ["safety", "Limitations & Safety"],
  ["development", "Development & Integration"],
];

function Status({
  children,
  planned = false,
}: {
  children: ReactNode;
  planned?: boolean;
}) {
  return (
    <span className={`docs-status ${planned ? "docs-status-planned" : ""}`}>
      {children}
    </span>
  );
}
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const intro =
    isValidElement(items[0]) && items[0].type === "p" ? items.shift() : null;
  return (
    <section aria-labelledby={`${id}-title`} className="docs-section" id={id}>
      <header className="docs-section-intro">
        <div className="docs-eyebrow">Medix documentation</div>
        <h1 id={`${id}-title`}>
          {sections.find(([key]) => key === id)?.[1] ?? title}
        </h1>
        {intro}
      </header>
      <div className="docs-section-detail">{items}</div>
    </section>
  );
}

function Table({
  headers,
  rows,
  caption,
}: {
  headers: string[];
  rows: string[][];
  caption: string;
}) {
  return (
    <section aria-label={caption} className="docs-table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={headers[i]} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={headers[i]}>{cell}</td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function Code({ label, children }: { label: string; children: string }) {
  return (
    <figure className="docs-code">
      <figcaption>
        <span className="docs-code-dots">● ● ●</span>
        {label}
      </figcaption>
      <pre>
        <code>{children}</code>
      </pre>
    </figure>
  );
}
function Diagram() {
  return (
    <figure className="docs-diagram">
      <figcaption>
        THE CANONICAL EVIDENCE PATH <span>Question → source → response</span>
      </figcaption>
      <div className="docs-flow">
        {[
          [Search, "Retrieve", "MiniLM + lexical"],
          [Layers, "Localize", "Transcript + CLIP"],
          [FileText, "Extract", "EvidenceBundle"],
          [ShieldCheck, "Validate", "Claims + citations"],
        ].map(([Icon, title, detail], i) => {
          const NodeIcon = Icon as typeof Search;
          return (
            <div className="docs-flow-step" key={String(title)}>
              <div className="docs-flow-node">
                <NodeIcon size={21} />
                <strong>{String(title)}</strong>
                <small>{String(detail)}</small>
              </div>
              {i < 3 && <ArrowRight className="docs-flow-arrow" size={18} />}
            </div>
          );
        })}
      </div>
      <div className="docs-flow-branches">
        <span>Local catalog + timestamped transcripts + video files</span>
        <span>Failure or insufficient support → abstention</span>
      </div>
    </figure>
  );
}

export function DocsExplorer() {
  const [active, setActive] = useState("overview");
  const [search, setSearch] = useState("");
  const [outline, setOutline] = useState<{ id: string; label: string }[]>([]);
  const [currentHeading, setCurrentHeading] = useState("");
  const [copyStatus, setCopyStatus] = useState("Copy page");
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = (id: string) => {
    setActive(id);
    setSearch("");
    window.history.pushState(null, "", `#${id}`);
    window.scrollTo({ behavior: "instant", top: 0 });
  };
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.slice(1).split("--")[0] || "overview";
      if (sections.some(([key]) => key === id)) {
        setActive(id);
      }
    };
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    const section = document.getElementById(active);
    const headings = [
      ...(section?.querySelectorAll<HTMLElement>(
        "h3, caption, .docs-code figcaption"
      ) ?? []),
    ];
    const items = headings.map((heading, index) => {
      heading.id = `${active}--${index}`;
      return {
        id: heading.id,
        label: heading.textContent?.replace(/●/g, "").trim() ?? "",
      };
    });
    setOutline(items);
    setCopyStatus("Copy page");
    const update = () => {
      setCurrentHeading(
        headings.filter((h) => h.getBoundingClientRect().top < 190).at(-1)
          ?.id ??
          items[0]?.id ??
          ""
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [active]);
  const copyPage = async () => {
    try {
      await navigator.clipboard.writeText(
        document.getElementById(active)?.innerText ?? ""
      );
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Unable to copy");
    }
  };
  const chapterIndex = sections.findIndex(([id]) => id === active);
  return (
    <div className="docs-explorer">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-title">
          <BookOpen size={18} /> Medix <span>Docs</span>
        </div>
        <label className="docs-search">
          <Search size={15} />
          <input
            aria-label="Search documentation sections"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a section…"
            ref={searchRef}
            value={search}
          />
          <kbd>⌘ K</kbd>
        </label>
        <a className="docs-home-link" href="/">
          ← Back to Medix
        </a>
        <div className="docs-nav-label">Documentation</div>
        <nav aria-label="Documentation sections">
          {sections
            .filter(([, title]) =>
              title.toLowerCase().includes(search.toLowerCase())
            )
            .map(([id, title]) => (
              <a
                aria-current={active === id ? "location" : undefined}
                href={`#${id}`}
                key={id}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(id);
                }}
              >
                {title}
              </a>
            ))}
        </nav>
        {search &&
          !sections.some(([, title]) =>
            title.toLowerCase().includes(search.toLowerCase())
          ) && <output>No sections found.</output>}
        <div className="docs-sidebar-note">
          <span className="docs-live-dot" /> Research prototype
          <br />
          <small>Implementation & evaluation notes</small>
        </div>
      </aside>
      <div className="docs-mobile-nav">
        <label htmlFor="docs-section">Explore documentation</label>
        <select
          id="docs-section"
          onChange={(e) => navigate(e.target.value)}
          value={active}
        >
          {sections.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </div>
      <article className="docs-article" data-page={active}>
        <div className="docs-toolbar">
          <span>
            Docs <span aria-hidden="true">/</span> {sections[chapterIndex][1]}
          </span>
          <button onClick={copyPage} type="button">
            <Copy size={13} />
            <span aria-live="polite">{copyStatus}</span>
          </button>
        </div>
        <Section id="overview" title="Evidence first. Every step explained.">
          <p className="docs-lead">
            A technical guide to how Medix retrieves medical instructional
            videos, identifies relevant moments, and builds responses from
            traceable evidence.
          </p>
          <div className="docs-badges">
            <Status>Implemented · text-to-evidence pipeline</Status>
            <Status>Implemented · image + text via Voyager</Status>
          </div>
          <Diagram />
          <div className="docs-three">
            <div>
              <Search />
              <h3>Find the source</h3>
              <p>
                Retrieve candidate videos from a fixed catalog, without using
                benchmark answer labels.
              </p>
            </div>
            <div>
              <Layers />
              <h3>Locate the moment</h3>
              <p>
                Rank transcript intervals and sampled frames to select a
                supporting clip.
              </p>
            </div>
            <div>
              <ShieldCheck />
              <h3>Show the evidence</h3>
              <p>
                Attach transcript citations and reject output that fails
                grounding checks.
              </p>
            </div>
          </div>
          <div className="docs-callout">
            Scope matters: current results evaluate evidence retrieval and
            temporal localization. They do not establish clinical accuracy or
            caregiver effectiveness.
          </div>
        </Section>
        <Section id="architecture" title="One pipeline. Explicit boundaries.">
          <p>
            The canonical FastAPI endpoint resolves a shared pipeline through
            the service container. <code>ResearchPipelineFactory</code> composes
            retrieval, localization, extraction, and grounded generation. The
            evaluator uses the same evidence pipeline, while stopping before
            answer generation.
          </p>
          <Table
            caption="Component connections"
            headers={["Component", "Receives", "Produces"]}
            rows={[
              [
                "POST /api/query",
                "Text query",
                "Grounded answer, citations, evidence URLs",
              ],
              [
                "GroundedMedicalQAPipeline",
                "Question + scope assessment",
                "Evidence result + validated answer",
              ],
              [
                "EndToEndMedicalPipeline",
                "Question",
                "Selected video/interval or abstention",
              ],
              [
                "SemanticVideoRetriever",
                "Question embedding + catalog",
                "Ranked video candidates",
              ],
              [
                "MultimodalWindowLocalizer",
                "Question, video ID, duration",
                "TemporalSegment + similarity score",
              ],
              [
                "EvidenceExtractor",
                "Selected interval + local resources",
                "EvidenceBundle with provenance",
              ],
              [
                "EvidenceGroundedAnswerGenerator",
                "Question + cited transcript cues",
                "Validated claims or abstention",
              ],
            ]}
          />
          <p>
            Media remains on Sol in the frozen resource setup; the merged
            transcript cache can also run locally. Retrieval and grounding do
            not require a hosted LLM. Generation depends on the selected local,
            hosted, or extractive adapter.
          </p>
        </Section>
        <Section id="workflow" title="Follow a question through the system.">
          <ol className="docs-timeline">
            {[
              [
                "Validate and assess scope",
                "The API trims the question, rejects empty input, and bounds its length. The grounded QA service can decline out-of-scope requests before retrieval.",
              ],
              [
                "Retrieve five candidates",
                "MiniLM title/author similarity is combined with token overlap. The frozen benchmark replays saved candidates and scores for reproducibility.",
              ],
              [
                "Score temporal windows",
                "The baseline uses 90-second transcript windows with 45-second stride, sampling three frames per window. Text and visual similarities receive equal weight.",
              ],
              [
                "Select and extract",
                "The baseline selects using localization confidence (retrieval weight 0). Failed evidence extraction falls through to another candidate; complete failure produces abstention.",
              ],
              [
                "Generate from transcript evidence",
                "Bundle-local cue IDs (T001, T002, …) constrain citations. Empty claims, unknown cue IDs, or insufficient lexical support lead to abstention.",
              ],
            ].map(([title, body], i) => (
              <li key={title}>
                <span>{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Code label="Canonical request · JSON">{`POST /api/query\nContent-Type: application/json\n\n{\n  "query": "How is an arm sling applied?"\n}\n\n# /api/v2/query is a compatibility alias.\n# The canonical request currently accepts text only.`}</Code>
        </Section>
        <Section
          id="multimodal"
          title="Different modalities. Clear responsibilities."
        >
          <Table
            caption="Input support and integration status"
            headers={["Input", "Current behavior", "Status"]}
            rows={[
              [
                "Text question",
                "Canonical retrieval → evidence → generation",
                "Implemented",
              ],
              [
                "Voice",
                "Application voice input is converted to text",
                "Application capability; not separately benchmarked",
              ],
              [
                "Retrieved video frames",
                "CLIP compares sampled frames with the question",
                "Implemented",
              ],
              [
                "Uploaded image + question",
                "Voyager qwen35-27b describes visible context for retrieval",
                "Implemented; image-QA evaluation pending",
              ],
            ]}
          />
          <div className="docs-split">
            <div>
              <h3>Video grounding is already multimodal</h3>
              <p>
                The localizer combines transcript text and retrieved video
                frames. The current answer generator receives transcript cues;
                this does not mean the LLM directly reasons over the entire
                video.
              </p>
            </div>
            <div>
              <h3>User-image understanding is a separate stage</h3>
              <p>
                The optional adapter preserves the original question and returns
                visible objects, actions, uncertainty, and model identity.
                Without a configured provider it reports{" "}
                <code>provider_not_configured</code>.
              </p>
            </div>
          </div>
          <Code label="Prepared adapter boundary · Python">{`adapter = OptionalVisionAdapter(model=None)\nprepared = adapter.prepare(question, image_bytes)\n\nprepared.question       # original question preserved\nprepared.observation    # None without a provider\nprepared.vision_status  # "provider_not_configured"`}</Code>
        </Section>
        <Section
          id="retrieval"
          title="Retrieval is the first accuracy ceiling."
        >
          <p>
            The baseline searches public title/author metadata across 852
            catalog videos. It does not index gold answer annotations. Missing
            target videos cannot be recovered by a stronger localizer
            downstream.
          </p>
          <div className="docs-formula">
            <span>Baseline retrieval score</span>
            <code>
              0.85 × cosine(question, title + author)
              <br />+ 0.15 × query-token overlap
            </code>
          </div>
          <p>
            Transcript hybrid RRF combines ranking signals. Lexical title fusion
            is another validation-only experiment. Neither has been promoted to
            a proven end-to-end accuracy improvement.
          </p>
          <Table
            caption="Reproduced retrieval ablations · 145 validation questions"
            headers={["Method", "Recall@1", "Recall@5", "MRR@5"]}
            rows={[
              ["Title + author", "29.7%", "64.1%", "0.429"],
              ["Transcript hybrid RRF", "32.4%", "62.1%", "0.445"],
              ["Title-weighted RRF", "31.0%", "64.1%", "0.438"],
              ["Lexical title fusion", "35.2%", "64.1%", "0.467"],
            ]}
          />
          <p className="docs-source">
            Source:
            development/evaluation/results/validation-improvements-v2/summary.json.
            Reproduced exactly from v1; this is not independent validation.
          </p>
          <div className="docs-callout">
            Evidence traceability: bundles retain source-video identity,
            predicted boundaries, transcript cues, artifacts, scores, and
            provenance. A citation identifies a source passage; it does not
            certify a medical claim.
          </div>
        </Section>
        <Section id="models" title="Small components with measurable roles.">
          <Table
            caption="Model and algorithm inventory"
            headers={["Component", "Implementation", "Role"]}
            rows={[
              [
                "Text encoder",
                "all-MiniLM-L6-v2, pinned revision",
                "Catalog and transcript similarity",
              ],
              [
                "Visual encoder",
                "CLIP ViT-B/32, pinned revision",
                "Question-to-frame similarity; three frames/window",
              ],
              [
                "Baseline fusion",
                "50% transcript + 50% visual",
                "Ranks window candidates",
              ],
              [
                "Generation",
                "Voyager qwen35-27b; structured claims and citation checks",
                "Claims grounded in transcript cues",
              ],
              [
                "Adaptive windows",
                "30 / 60 / 90 seconds; optional cue snapping",
                "Experimental; no convincing accuracy gain",
              ],
              [
                "CCAL / joint reranker",
                "Earlier research approaches",
                "Underperformed; development/evaluation/objective issues documented",
              ],
            ]}
          />
          <p>
            CLIP scores independent frames; it does not explicitly model action
            order or motion. Similarities mapped into [0,1] are not calibrated
            probabilities. CLIP input is truncated to its text-token budget;
            long questions can lose visual-query context.
          </p>
          <div className="docs-split">
            <div>
              <h3>Cache reusable features</h3>
              <p>
                Opt-in caches key text and image contents with model/software
                identity. CLIP cache misses run in batches of 32. Atomic writes
                and malformed-entry recovery protect reuse across runs.
              </p>
            </div>
            <div>
              <h3>Bound expensive work</h3>
              <p>
                Experimental top-N window scoring limits visual inference.
                Explicit CPU/CUDA/MPS selection and stage timing enable
                comparisons. The default baseline still scores all candidates.
              </p>
            </div>
          </div>
        </Section>
        <Section
          id="evaluation"
          title="Results, with their boundaries attached."
        >
          <p>
            Full evidence-pipeline results below come from the completed Sol
            validation run. “Answered” means an evidence bundle was returned; it
            is not a measurement of generated-answer correctness.
          </p>
          <Table
            caption="Frozen end-to-end baseline · Sol job 65027646"
            headers={["Metric", "Validation result", "Meaning"]}
            rows={[
              ["Target in top five", "93/145 · 64.1%", "Retrieval coverage"],
              [
                "Correct video selected",
                "49/145 · 33.8%",
                "Video selection accuracy",
              ],
              [
                "Mean temporal IoU",
                "0.1224",
                "Interval overlap across all questions",
              ],
              [
                "IoU ≥ 0.3 / 0.5 / 0.7",
                "21.4% / 10.3% / 3.4%",
                "Temporal success thresholds",
              ],
              [
                "Evidence returned",
                "145/145",
                "Availability, not answer correctness",
              ],
              [
                "Mean / maximum latency",
                "27.1 s / 137.9 s",
                "CPU evidence pipeline; excludes answer generation",
              ],
              [
                "Candidate transcript failures",
                "16 attempts",
                "Not necessarily distinct questions",
              ],
              [
                "Calibration (ECE / Brier)",
                "Not measured",
                "Similarity is not probability",
              ],
              [
                "Generated medical answer accuracy",
                "Not established by this run",
                "Requires separate answer assessment",
              ],
            ]}
          />
          <figure
            aria-label="Validation error decomposition"
            className="docs-funnel"
          >
            <div>
              <strong>145</strong>
              <span>questions</span>
            </div>
            <ArrowRight />
            <div>
              <strong>93</strong>
              <span>target retrieved</span>
            </div>
            <ArrowRight />
            <div>
              <strong>49</strong>
              <span>video selected</span>
            </div>
            <ArrowRight />
            <div>
              <strong>15</strong>
              <span>IoU ≥ 0.5</span>
            </div>
          </figure>
          <Table
            caption="Matched local text-only ablations · not the full multimodal protocol"
            headers={["Configuration", "Mean IoU", "IoU ≥ 0.5"]}
            rows={[
              ["Title + fixed 90 s", "0.0906", "5.5%"],
              ["Title + fixed 60 s", "0.0939", "9.7%"],
              ["Equal RRF + fixed 60 s", "0.1058", "11.0%"],
              ["Equal RRF + cue refinement", "0.1089", "8.3%"],
              ["Grouped validation configuration selection", "0.0901", "7.6%"],
            ]}
          />
          <p>
            These text-only experiments omit media extraction. Their apparent
            improvements over the matched text baseline do not establish an
            improvement over the full pipeline. Grouped selection was unstable;
            no new default was promoted.
          </p>
          <Table
            caption="Cache microbenchmark · local CPU, five alternating repeats"
            headers={["Measurement", "Result", "Scope"]}
            rows={[
              [
                "Uncached / warm cached median",
                "0.1388 s / 0.00986 s",
                "All 145 validation query embeddings",
              ],
              [
                "Median speedup",
                "14.1×",
                "Encoding only; not full-pipeline latency",
              ],
              [
                "Maximum vector difference",
                "0.0",
                "Identical vectors in this experiment",
              ],
              [
                "Initial cold cache",
                "0.2048 s",
                "First pass adds cache-writing overhead",
              ],
            ]}
          />
          <p className="docs-source">
            Sources: development/docs/research/thesis-optimization-results.md;
            development/evaluation/results/thesis-cache-benchmark-v1/summary.json;
            development/evaluation/results/validation-improvements-v2/summary.json;
            user-supplied Sol job 65027646. Test results are reserved from
            further tuning.
          </p>
        </Section>
        <Section
          id="safety"
          title="Traceable does not mean clinically validated."
        >
          <div className="docs-three">
            <div>
              <ShieldCheck />
              <h3>Implemented checks</h3>
              <p>
                Input bounds, scope triage, valid cue references, bounded
                claims, lexical support, and explicit abstention paths.
              </p>
            </div>
            <div>
              <Search />
              <h3>Known limits</h3>
              <p>
                Retrieval misses, imperfect timestamps, ASR errors, static-frame
                scoring, and unsupported claims that lexical overlap may not
                detect.
              </p>
            </div>
            <div>
              <FileText />
              <h3>Evaluation still needed</h3>
              <p>
                Image-question assessment, generated-answer review, calibration,
                and evidence of benefit in representative caregiver tasks.
              </p>
            </div>
          </div>
          <p>
            The frozen snapshot contains 840 timestamped transcripts: 167
            source/downloaded captions and 673 Whisper ASR transcripts. Two
            unavailable validation target videos affect four questions. They
            remain in the evaluation denominator.
          </p>
          <div className="docs-callout">
            Medix is a research prototype. It is not a medical device and does
            not replace professional judgment or emergency care. Resource
            availability and fluent answers are not evidence of clinical
            reliability.
          </div>
        </Section>
        <Section
          id="development"
          title="Reproduce first. Integrate deliberately."
        >
          <Code label="Offline validation experiments · repository root">
            {
              "# Existing dependencies and pinned model weights required\nHF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \\\n  uv run --no-sync python -m development.evaluation.run_validation_improvements \\\n  --device cpu --output-dir development/evaluation/results/new-validation-run\n\n# Output directory must be new. No official test evaluation.\n# Full video experiments require the Sol media paths."
            }
          </Code>
          <Table
            caption="Development status"
            headers={["Workstream", "Status", "Next verification"]}
            rows={[
              [
                "Baseline reproduction",
                "Completed",
                "Preserve frozen manifests and predictions",
              ],
              [
                "Caching + bounded visual scoring",
                "Implemented, opt-in",
                "Media-backed equivalence and warm latency on Sol",
              ],
              [
                "Video-selection replay",
                "Implemented",
                "Compare existing candidate scores before model reruns",
              ],
              [
                "Image model adapter",
                "Implemented with Voyager",
                "Live image-question and citation verification",
              ],

              [
                "Image-question evaluation",
                "Pending",
                "Held-out cases and explicit evidence-support review",
              ],
            ]}
          />
          <p>
            Integration should retain the original question, keep image
            observations distinct from source evidence, and use the existing
            grounded-answer contract. No API credentials are needed for current
            retrieval/localization experiments. Local operation depends on
            installed media, model weights, and the selected generation
            provider.
          </p>
          <div className="docs-ending">
            <Check size={18} />
            <span>
              Documentation describes implementation and recorded results.
              Experimental options are not production accuracy claims.
            </span>
            <button onClick={() => navigate("overview")} type="button">
              Back to overview <ArrowDown className="rotate-180" size={14} />
            </button>
          </div>
        </Section>
        <nav aria-label="Chapter navigation" className="docs-pagination">
          {chapterIndex > 0 ? (
            <button
              onClick={() => navigate(sections[chapterIndex - 1][0])}
              type="button"
            >
              <small>Previous</small>← {sections[chapterIndex - 1][1]}
            </button>
          ) : (
            <span />
          )}
          {chapterIndex < sections.length - 1 && (
            <button
              onClick={() => navigate(sections[chapterIndex + 1][0])}
              type="button"
            >
              <small>Next</small>
              {sections[chapterIndex + 1][1]} →
            </button>
          )}
        </nav>
      </article>
      <aside aria-label="On this page" className="docs-outline">
        <div>
          <List size={15} /> On this page
        </div>
        <nav>
          {outline.map((item) => (
            <a
              aria-current={currentHeading === item.id ? "location" : undefined}
              href={`#${item.id}`}
              key={item.id}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(item.id)?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                  ).matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <a className="docs-outline-link" href="/">
          Explore Medix <ArrowUpRight size={13} />
        </a>
      </aside>
    </div>
  );
}
