# SpecFactory Ecosystem Architecture

> Principal Solutions Architect Document
> Generated: 2026-02-16
> Stack: React 18 + Node.js + AWS S3 + SQLite (Frontier + SpecDb)
> Revision: Post-Ecosystem-Sync (all 19 cross-surface invalidation gaps resolved)

---

## Table of Contents

1. [High-Level System Overview](#1-high-level-system-overview)
2. [Directory Structure](#2-directory-structure)
3. [Data Ecosystem & Flow](#3-data-ecosystem--flow)
4. [API Architecture](#4-api-architecture)
5. [Frontend Architecture](#5-frontend-architecture)
6. [State Management & Cache Synchronization](#6-state-management--cache-synchronization)
7. [Infrastructure & Deployment](#7-infrastructure--deployment)
8. [Appendix: Diagrams](#8-appendix-diagrams)

---

## 1. High-Level System Overview

SpecFactory is an automated product specification harvesting platform that discovers, extracts, validates, and curates structured specification data for gaming peripherals (mice, keyboards, monitors). The system operates as a closed-loop: a headless browser fleet crawls manufacturer and review sites, an LLM extraction pipeline parses specifications from unstructured HTML, a consensus engine merges candidates from multiple sources, and a human-in-the-loop review GUI enables curation before publishing to downstream consumers.

### Three-Tier Interaction Model

```

  React SPA (Port 5173 dev / static prod)
  HashRouter + React Query + Zustand
       |              ^
       | REST API     | WebSocket (data-change,
       | (fetch)      |  events, process, control)
       v              |
  Node.js GUI Server (Port 8788)
  guiServer.js  -  HTTP + WS
       |              |
       | Filesystem   | Child Process (spec.js CLI)
       | I/O          | (pipeline, compile, review)
       v              v
  Local Filesystem         AWS S3
  (helper_files/,          (DualMirroredStorage)
   out/, fixtures/s3/)     Bucket: my-spec-harvester-data
```

**Client (React SPA):** Single-page application built with Vite, served as static files from the Node.js server. Communicates exclusively via REST API and WebSocket. All server-state is managed by React Query with 5-second stale time; all UI-state (selections, editing mode, drawer state) is managed by 8 Zustand stores.

**Server (Node.js):** A vanilla `http.createServer` (no Express) that handles 60+ REST endpoints via manual URL parsing, serves the SPA static build, and runs a WebSocket server for real-time updates. Spawns the `spec.js` CLI as child processes for long-running pipeline operations (extraction, compilation, review finalization).

**Cloud/Storage (AWS S3 + Local FS):** A tri-modal storage abstraction (`LocalStorage`, `S3Storage`, `DualMirroredStorage`) allows the system to run fully local during development, fully on S3 in production, or in a dual-mirror mode that writes locally first and mirrors to S3. The local filesystem under `helper_files/` stores all authoring data (workbook maps, field rules, component databases, overrides), while `out/` stores all runtime artifacts (queue state, run outputs, final published specs).

### Mermaid: System Context

```mermaid
graph TB
    subgraph Client["React SPA (Browser)"]
        RQ[React Query Cache]
        ZS[8 Zustand Stores]
        UI[Review Grid + Studio + Catalog]
    end

    subgraph Server["Node.js GUI Server :8788"]
        API[REST API - 60+ endpoints]
        WS[WebSocket Server]
        CLI[spec.js Child Process]
    end

    subgraph Storage["Data Layer"]
        FS[Local Filesystem]
        S3[AWS S3 Bucket]
        FrontierSQLite[SQLite - Frontier DB]
        SpecSQLite[SQLite - SpecDb (spec.sqlite)]
    end

    subgraph External["External Services"]
        LLM[LLM Providers - GPT/Gemini/DeepSeek]
        Search[Search Engines - Bing/Google/SearXNG]
        Sites[Product Websites]
    end

    UI --> RQ
    RQ -->|fetch /api/v1/*| API
    WS -->|data-change, events, process| RQ
    API --> FS
    API --> S3
    CLI --> FS
    CLI --> S3
    CLI --> FrontierSQLite
    CLI --> SpecSQLite
    CLI --> LLM
    CLI --> Search
    CLI --> Sites
```

---

## 2. Directory Structure

### Root Project Tree

```
spec-harvester/
|
|-- src/                          # Backend: Node.js application source
|   |-- api/                      # HTTP servers
|   |   |-- guiServer.js          # Main GUI API server (port 8788) - 60+ REST endpoints + WebSocket
|   |   `-- intelGraphApi.js      # GraphQL intelligence API (port 8787)
|   |
|   |-- cli/                      # CLI entry points
|   |   |-- spec.js               # Main CLI router (40+ commands)
|   |   |-- args.js               # Argument parser
|   |   `-- s3-integration.js     # S3 connectivity smoke test
|   |
|   |-- pipeline/                 # Core extraction pipeline
|   |   `-- runProduct.js         # Single-product extraction orchestrator (100+ imports)
|   |
|   |-- runner/                   # Run strategies
|   |   `-- runUntilComplete.js   # Multi-round retry runner
|   |
|   |-- daemon/                   # Continuous processing
|   |   `-- daemon.js             # File watcher daemon with queue management
|   |
|   |-- s3/                       # Storage abstraction
|   |   `-- storage.js            # LocalStorage / S3Storage / DualMirroredStorage
|   |
|   |-- config.js                 # Config loader: .env + env vars + run profiles
|   |-- constants.js              # Shared constants
|   |-- logger.js                 # EventLogger -> events.jsonl
|   |
|   |-- fetcher/                  # Web fetching
|   |   |-- playwrightFetcher.js  # Headless browser with network recording
|   |   |-- replayFetcher.js      # Offline replay from recordings
|   |   |-- graphqlReplay.js      # GraphQL response replay
|   |   |-- networkRecorder.js    # Network traffic interception
|   |   `-- robotsPolicy.js       # robots.txt compliance
|   |
|   |-- extract/                  # Extraction engines
|   |   |-- deterministicParser.js    # Regex/structural spec table parsing
|   |   |-- componentResolver.js      # Hardware component fuzzy matching
|   |   |-- aggressiveOrchestrator.js # Multi-pass aggressive extraction
|   |   `-- pdfTableExtractor.js      # PDF table parsing
|   |
|   |-- extractors/               # DOM-level extractors
|   |   |-- fieldExtractor.js         # DOM field extraction
|   |   |-- embeddedStateExtractor.js # __NEXT_DATA__, __NUXT__, __APOLLO_STATE__
|   |   `-- ldjsonExtractor.js        # JSON-LD extraction
|   |
|   |-- llm/                      # LLM integration
|   |   |-- openaiClient.js       # OpenAI-compatible HTTP client with cost tracking
|   |   |-- extractCandidatesLLM.js   # LLM-based field extraction
|   |   |-- validateCandidatesLLM.js  # LLM validation pass
|   |   |-- evidencePack.js       # Evidence assembly for LLM prompts
|   |   |-- llmCache.js           # File-based response cache (7-day TTL)
|   |   |-- providerHealth.js     # Circuit breaker for LLM providers
|   |   `-- providers/            # DeepSeek, Gemini, OpenAI-compatible adapters
|   |
|   |-- scoring/                  # Candidate scoring & consensus
|   |   |-- consensusEngine.js    # Multi-source candidate merging
|   |   |-- constraintSolver.js   # Cross-field logical constraints
|   |   `-- qualityScoring.js     # Confidence/coverage metrics
|   |
|   |-- validator/                # Quality gates
|   |   |-- identityGate.js       # Product identity verification
|   |   |-- qualityGate.js        # Validation threshold gate
|   |   `-- trafficLight.js       # Per-field green/yellow/red scoring
|   |
|   |-- normalizer/               # Output normalization
|   |   `-- mouseNormalizer.js     # Builds normalized spec object
|   |
|   |-- exporter/                 # Artifact writers
|   |   |-- exporter.js           # Run-stamped artifact writer
|   |   |-- finalExporter.js      # Final output writer (-> out/final/)
|   |   `-- summaryWriter.js      # Markdown summary generation
|   |
|   |-- catalog/                  # Product & brand management
|   |   |-- productCatalog.js     # product_catalog.json CRUD
|   |   |-- brandRegistry.js      # Brand registry with rename cascade
|   |   `-- reconciler.js         # Orphan product reconciliation
|   |
|   |-- db/                       # Data management SQLite
|   |   |-- specDb.js             # Schema + DAO (candidates, item/component/list links)
|   |   `-- seed.js               # seed-db command: JSON artifacts -> spec.sqlite
|   |
|   |-- queue/                    # Processing queue
|   |   `-- queueState.js         # Queue state persistence, scoring, retry backoff
|   |
|   |-- review/                   # Review system
|   |   |-- reviewGridData.js     # Review grid layout + product payloads
|   |   |-- overrideWorkflow.js   # Field override CRUD + finalization
|   |   |-- componentReviewData.js    # Component/enum review data builders
|   |   |-- componentImpact.js    # Cascade analysis (component->product propagation)
|   |   `-- confidenceColor.js    # Confidence -> color thresholds
|   |
|   |-- field-rules/              # Field rule system
|   |   |-- compiler.js           # Workbook -> field_rules.json compilation
|   |   |-- loader.js             # Runtime loader with file-stat cache
|   |   `-- migrations.js         # Schema format migrations
|   |
|   |-- engine/                   # Field rules runtime engine
|   |   |-- fieldRulesEngine.js   # Normalization, unit conversion, enum validation
|   |   |-- constraintEvaluator.js    # Cross-field constraint evaluation
|   |   `-- curationSuggestions.js    # Auto-generated curation suggestions
|   |
|   |-- ingest/                   # Data ingestion
|   |   |-- categoryCompile.js    # Excel workbook -> generated artifacts
|   |   |-- csvIngestor.js        # CSV product list import
|   |   `-- excelSeed.js          # Excel-based product seeding
|   |
|   |-- learning/                 # ML & scheduling
|   |   |-- banditScheduler.js    # Thompson Sampling + UCB batch ordering
|   |   |-- categoryBrain.js      # Per-category learning state
|   |   `-- hypothesisQueue.js    # Unknown field hypothesis tracking
|   |
|   |-- intel/                    # Source intelligence
|   |   |-- sourceIntel.js        # Per-domain planner scores
|   |   |-- endpointMiner.js      # API endpoint discovery from network traffic
|   |   `-- domainFieldMatrix.js  # Domain x field yield matrix
|   |
|   |-- research/                 # URL frontier & search
|   |   |-- frontierSqlite.js     # SQLite-backed URL frontier (better-sqlite3)
|   |   |-- frontierDb.js         # JSON-based URL frontier (legacy)
|   |   `-- queryPlanner.js       # Search query planning
|   |
|   |-- search/                   # Search providers
|   |   |-- searchProviders.js    # SearXNG, Bing, Google CSE, DuckDuckGo
|   |   `-- searchLoop.js         # Multi-provider search orchestration
|   |
|   |-- publish/                  # Publishing pipeline
|   |   |-- publishingPipeline.js # CSV/XLSX/SQLite bulk export
|   |   `-- driftScheduler.js     # Change detection & re-queue
|   |
|   |-- billing/                  # Cost tracking
|   |   |-- costLedger.js         # Per-product JSONL cost log
|   |   `-- budgetGuard.js        # Per-product & monthly budget enforcement
|   |
|   |-- adapters/                 # Site-specific parsers
|   |   |-- rtingsAdapter.js
|   |   |-- techPowerUpAdapter.js
|   |   `-- manufacturerAdapter.js
|   |
|   |-- components/               # Component library
|   |   `-- library.js            # Component DB loader/updater
|   |
|   |-- runtime/                  # Runtime instrumentation
|   |   |-- runtimeTraceWriter.js # Trace artifact writer
|   |   `-- metricsWriter.js      # Metrics collection
|   |
|   `-- benchmark/                # Quality benchmarking
|       |-- goldenBenchmark.js    # Golden fixture accuracy testing
|       `-- regressionGates.js    # Automated regression detection
|
|-- tools/
|   |-- gui-react/                # Frontend: React SPA source
|   |   |-- src/                  # (see Frontend section below)
|   |   |-- dist/                 # Production build output
|   |   |-- vite.config.ts
|   |   |-- tsconfig.json
|   |   `-- package.json
|   |
|   |-- searxng/                  # Self-hosted SearXNG search engine config
|   `-- build-exe.mjs             # Electron-less EXE bundler via @yao-pkg/pkg
|
|-- helper_files/                 # Per-category authoring data
|   `-- mouse/
|       |-- mouseData.xlsm        # Source workbook (Excel with macros)
|       |-- _control_plane/       # Authoring state
|       |   |-- workbook_map.json     # Sheet-to-field column mappings
|       |   |-- product_catalog.json  # Product registry
|       |   `-- *_draft.json          # Draft field rules
|       |-- _generated/           # Compiled artifacts (from workbook)
|       |   |-- field_rules.json      # Master field definitions (276 KB)
|       |   |-- known_values.json     # Per-field enum allowlists
|       |   |-- component_db/         # Compiled component databases
|       |   |   |-- sensors.json
|       |   |   |-- switches.json
|       |   |   |-- encoders.json
|       |   |   `-- materials.json
|       |   |-- ui_field_catalog.json  # UI field metadata (79 KB)
|       |   |-- field_groups.json
|       |   |-- parse_templates.json
|       |   `-- cross_validation_rules.json
|       |-- _overrides/           # Manual overrides
|       |   |-- {productId}.overrides.json
|       |   `-- components/{type}_{slug}.json
|       `-- _suggestions/         # Pipeline-generated suggestions
|
|-- fixtures/s3/                  # Local S3 mirror (development)
|   `-- specs/inputs/mouse/products/   # 396 product input JSONs
|
|-- out/                          # Runtime output root
|   |-- _queue/mouse/state.json       # Processing queue state
|   |-- _runtime/                     # Events, traces, control
|   |   |-- events.jsonl              # Structured event stream
|   |   |-- traces/                   # Per-run trace artifacts
|   |   `-- control/runtime_overrides.json
|   |-- _billing/                     # Cost ledger
|   |-- _review/                      # Review queue artifacts
|   |-- final/mouse/{brand}/{model}/  # Published per-product specs
|   |   |-- spec.json
|   |   |-- summary.json
|   |   |-- provenance.json
|   |   |-- traffic_light.json
|   |   `-- evidence/
|   |-- output/mouse/exports/         # Bulk exports
|   |   |-- all_products.sqlite
|   |   |-- all_products.csv
|   |   |-- all_products.xlsx
|   |   `-- feed.json
|   `-- runs/                         # Raw per-run artifacts
|
|-- .specfactory_tmp/             # Local SQLite workspace
|   `-- {category}/spec.sqlite        # SpecDb snapshot (seed-db)
|
|-- .env                          # Configuration (AWS, LLM, crawl budgets, search)
|-- Dockerfile                    # Container: Playwright + Python + Node
|-- package.json                  # Backend dependencies
`-- gui-dist/                     # Pre-built GUI static files
```

### Frontend Tree (`tools/gui-react/src/`)

```
src/
|-- main.tsx                      # Entry: StrictMode + createRoot
|-- App.tsx                       # HashRouter + QueryClientProvider + Routes
|-- index.css                     # Tailwind imports + custom variables
|
|-- api/                          # Server communication
|   |-- client.ts                 # REST wrapper: api.get/post/put/del
|   |-- graphql.ts                # GraphQL fetch helper
|   `-- ws.ts                     # WebSocket manager with exponential reconnect
|
|-- stores/                       # Zustand state (8 stores, no middleware)
|   |-- uiStore.ts                # category, darkMode, devMode
|   |-- productStore.ts           # selectedProductId, selectedBrand, selectedModel
|   |-- runtimeStore.ts           # overrides, processStatus, processOutput
|   |-- eventsStore.ts            # RuntimeEvent ring buffer (5000 max)
|   |-- queueStore.ts             # QueueProduct[] snapshot
|   |-- reviewStore.ts            # Review grid FSM: cell selection, editing, flagged nav
|   |-- componentReviewStore.ts   # Component review: entity selection, enum drawer
|   `-- studioStore.ts            # Studio active sub-tab
|
|-- types/                        # TypeScript interfaces (6 modules)
|   |-- product.ts                # CatalogRow, ProductSummary, NormalizedProduct, QueueProduct
|   |-- review.ts                 # FieldState, ReviewCandidate, ProductReviewPayload, RunMetrics
|   |-- runtime.ts                # RuntimeOverrides, FrontierEntry, LlmTraceEntry
|   |-- events.ts                 # RuntimeEvent, ProcessStatus
|   |-- studio.ts                 # FieldRule, StudioPayload, WorkbookMap, ComponentSource
|   `-- componentReview.ts        # ComponentReviewItem, EnumValueReviewItem, VariancePolicy
|
|-- utils/                        # Pure utility functions
|   |-- constants.ts              # EVENT_MEANINGS, PIPELINE_STAGE_DEFS, UNKNOWN_VALUES
|   |-- colors.ts                 # trafficColor, statusBg, sourceBadgeClass maps
|   |-- formatting.ts             # pct, usd, compactNumber, relativeTime, truncate
|   `-- fieldNormalize.ts         # normalizeField, hasKnownValue, humanizeField
|
|-- hooks/
|   `-- useDebounce.ts            # useDebounce, useDebouncedCallback with flush/cancel
|
|-- components/
|   |-- layout/                   # App chrome
|   |   |-- AppShell.tsx          # Header + TabNav + Sidebar + Outlet + WS bootstrap
|   |   |-- TabNav.tsx            # CATALOG_TABS (5) + OPS_TABS (4) navigation
|   |   `-- Sidebar.tsx           # Category > Brand > Model cascade + run controls
|   |
|   `-- common/                   # 18 reusable components
|       |-- DataTable.tsx         # TanStack Table v8 with sort + globalFilter
|       |-- DrawerShell.tsx       # Slide-in drawer: Shell, Section, Card, ActionStack,
|       |                         #   ValueRow, Badges, SourceRow, ManualOverride
|       |-- ReviewValueCell.tsx   # Traffic light cell renderer
|       |-- InlineCellEditor.tsx  # In-cell text editing
|       |-- ErrorBoundary.tsx     # Class component with Retry button
|       |-- MetricCard.tsx        # Stat tile
|       |-- MetricRow.tsx         # Row of MetricCards
|       |-- TrafficLight.tsx      # Green/yellow/red/gray dot
|       |-- StatusBadge.tsx       # Status chip
|       |-- ProgressBar.tsx       # Horizontal fill bar
|       |-- Spinner.tsx           # Loading indicator
|       |-- JsonViewer.tsx        # Pretty-printed JSON
|       |-- CodeBlock.tsx         # Monospace code display
|       |-- ComboSelect.tsx       # Searchable select
|       |-- TagPicker.tsx         # Multi-tag input
|       |-- TierPicker.tsx        # Tier number selector
|       |-- ColumnPicker.tsx      # Column visibility toggle
|       `-- EnumConfigurator.tsx  # Enum list editor
|
`-- pages/                        # Route-level page components
    |-- overview/
    |   `-- OverviewPage.tsx      # Catalog summary dashboard + metrics table
    |
    |-- catalog/
    |   |-- CatalogPage.tsx       # Brands sub-tab + Models sub-tab
    |   |-- CategoryManager.tsx   # Create/select categories
    |   `-- ProductManager.tsx    # Product CRUD + seed from workbook
    |
    |-- product/
    |   |-- ProductPage.tsx       # Selected product detail + field status
    |   |-- FieldStatusTable.tsx  # Per-field traffic light table
    |   `-- PipelineProgress.tsx  # Pipeline stage progress
    |
    |-- runtime/
    |   |-- RuntimePage.tsx       # Overview sub-tab + Cockpit sub-tab
    |   |-- EventLog.tsx          # Structured event stream viewer
    |   |-- ProcessOutput.tsx     # Raw stdout/stderr viewer
    |   |-- QueueSnapshot.tsx     # Queue status table
    |   `-- cockpit/              # Runtime cockpit (6 panels)
    |       |-- CockpitLayout.tsx
    |       |-- RunHeader.tsx
    |       |-- SearchPanel.tsx
    |       |-- FrontierPanel.tsx
    |       |-- InspectorPanel.tsx
    |       |-- LlmTracePanel.tsx
    |       |-- FieldProgressPanel.tsx
    |       `-- AdvancedControls.tsx
    |
    |-- billing/
    |   `-- BillingPage.tsx       # LLM cost charts + learning artifacts
    |
    |-- studio/
    |   |-- StudioPage.tsx        # 9 sub-tabs: mapping, field-rules, workbook, enums,
    |   |                         #   data-lists, component-sources, component-db, artifacts, guardrails
    |   |-- BrandManager.tsx      # Brand CRUD with impact analysis
    |   |-- WorkbookContextTab.tsx
    |   `-- workbench/            # Field rules workbench (spreadsheet editor)
    |       |-- FieldRulesWorkbench.tsx
    |       |-- WorkbenchTable.tsx
    |       |-- WorkbenchDrawer.tsx
    |       `-- WorkbenchBulkBar.tsx
    |
    |-- review/
    |   |-- ReviewPage.tsx        # Review grid (virtualized 2D matrix)
    |   |-- ReviewMatrix.tsx      # @tanstack/react-virtual: rows + columns
    |   |-- ReviewDrawer.tsx      # Field detail drawer with candidates
    |   |-- BrandFilterBar.tsx    # Brand multi-select filter
    |   `-- CellTooltip.tsx       # Hover details: confidence, source, evidence
    |
    `-- component-review/
        |-- ComponentReviewPage.tsx   # Dynamic sub-tabs from layout API
        |-- ComponentSubTab.tsx       # Per-component-type grid
        |-- ComponentReviewDrawer.tsx # Per-component detail drawer
        |-- EnumSubTab.tsx            # Enum value grid
        `-- EnumReviewDrawer.tsx      # Per-enum-value drawer
```

---

## 3. Data Ecosystem & Flow

### 3.1 Data Origins

Data enters SpecFactory from four sources:

| Source | Format | Entry Point | Storage |
|--------|--------|-------------|---------|
| **Excel Workbook** | `.xlsm` | `helper_files/{cat}/mouseData.xlsm` | Compiled to `_generated/*.json` via `categoryCompile.js` |
| **Product Catalog** | JSON | GUI API `POST /catalog/{cat}/products` | `_control_plane/product_catalog.json` |
| **Web Crawl** | HTML/JSON | Playwright headless browser | `out/runs/{runId}/raw/pages/` |
| **Manual Override** | JSON | GUI API `POST /review/{cat}/override` | `_overrides/{productId}.overrides.json` |
| **SpecDb Snapshot (derived)** | SQLite | CLI `seed-db --category <cat>` | `.specfactory_tmp/{cat}/spec.sqlite` |

### 3.2 Complete Data Lifecycle

```mermaid
graph TD
    subgraph Origins["Data Origins"]
        WB[Excel Workbook<br/>mouseData.xlsm]
        CAT[Product Catalog<br/>product_catalog.json]
        WEB[Web Sources<br/>Manufacturer + Review Sites]
        MAN[Manual Overrides<br/>GUI Review + Studio]
    end

    subgraph Compile["Compilation Phase"]
        CC[categoryCompile.js]
        WB --> CC
        CC --> FR[field_rules.json<br/>276 KB - Field definitions]
        CC --> KV[known_values.json<br/>Enum allowlists]
        CC --> CDB[component_db/<br/>sensors, switches, encoders]
        CC --> UFC[ui_field_catalog.json<br/>79 KB - UI metadata]
        CC --> PT[parse_templates.json<br/>Deterministic regex rules]
        CC --> XVR[cross_validation_rules.json<br/>Inter-field constraints]
    end

    subgraph Queue["Queue Management"]
        CAT --> QS[queueState.js]
        QS --> QST[queue_state.json<br/>Product status + priority + scoring]
    end

    subgraph Pipeline["Extraction Pipeline - runProduct.js"]
        QST -->|selectNextQueueProduct| RP[runProduct.js]
        FR --> RP
        KV --> RP
        CDB --> RP
        WEB -->|PlaywrightFetcher| RP

        RP --> DP[Deterministic Parser]
        RP --> EX[DOM Extractors<br/>LD+JSON, Embedded State]
        RP --> LLM[LLM Extraction<br/>GPT/Gemini/DeepSeek]
        RP --> CR[Component Resolver]

        DP --> CE[Consensus Engine]
        EX --> CE
        LLM --> CE
        CR --> CE

        CE --> CS[Constraint Solver]
        CS --> QG[Quality Gate]
        QG --> TL[Traffic Light Scoring]
    end

    subgraph Output["Output Artifacts"]
        TL --> RUN[Run Artifacts<br/>candidates, normalized,<br/>provenance, summary]
        TL --> FIN[Final Outputs<br/>spec.json, traffic_light.json,<br/>evidence/]
        MAN --> OVR[Override Files<br/>_overrides/]
        OVR --> FIN
    end

    subgraph DataMgmt["Data Management DB (SpecDb)"]
        SDB[.specfactory_tmp/{cat}/spec.sqlite]
        T1[candidates + candidate_reviews]
        T2[item_field_state + item_component_links + item_list_links]
        T3[component_identity + component_values + list_values]
        SDB --> T1
        SDB --> T2
        SDB --> T3
    end

    subgraph Publish["Publishing"]
        FIN --> PUB[publishingPipeline.js]
        PUB --> CSV[all_products.csv]
        PUB --> XLSX[all_products.xlsx]
        PUB --> SQL[all_products.sqlite]
        PUB --> FEED[feed.json]
    end

    subgraph GUI["React GUI Surfaces"]
        RUN --> RV[Review Grid]
        RUN --> CRV[Component Review]
        FR --> STU[Studio]
        CAT --> OV[Overview + Catalog]
        QST --> RT[Runtime Cockpit]
    end

    RUN -->|"seed-db (per product)"| SDB
    CDB -->|"seed-db components"| SDB
    KV -->|"seed-db lists"| SDB
    OVR -->|"seed-db override provenance"| SDB
```

### 3.3 Per-Product Extraction Pipeline

The heart of the system is `runProduct.js` which orchestrates a 25-step pipeline for each product:

```
Step  1: Load job identity (brand, model, variant, seedUrls)
Step  2: Load category config (field_rules, field_order, component_db)
Step  3: Load helper data (supportive fill, per-brand targets)
Step  4: Load component library (sensors, switches, encoders)
Step  5: Load source intelligence (domain scores, field yield matrix)
Step  6: Load learning profile (per-category ML state)
Step  7: Source planning (rank URLs by domain intel, tier, freshness)
Step  8: URL discovery via search (Bing, Google CSE, SearXNG, DuckDuckGo)
Step  9: Playwright fetch (headless Chrome, capture DOM + network + GraphQL)
Step 10: Deterministic parsing (regex templates from parse_templates.json)
Step 11: DOM extraction (spec tables, structured data)
Step 12: Embedded state extraction (__NEXT_DATA__, __NUXT__, __APOLLO_STATE__)
Step 13: JSON-LD extraction (structured data blocks)
Step 14: Site-specific adapters (Rtings, TechPowerUp, manufacturer pages)
Step 15: Component resolution (fuzzy match extracted names -> component DB)
Step 16: LLM extraction (evidence packs -> GPT/Gemini -> structured candidates)
Step 17: Identity gate (verify extracted data matches the target product)
Step 18: Consensus engine (cluster candidates, pass-target voting, confidence)
Step 19: Constraint solver (cross-field rules: weight in 1-500g, polling 10-10000Hz)
Step 20: LLM validation (verify top candidates against evidence)
Step 21: Quality gate (minimum confidence + coverage thresholds)
Step 22: Hypothesis queue (generate hypotheses for unknown fields)
Step 23: Supportive fill (helper file data fills remaining gaps)
Step 24: Component library priors (component specs fill related fields)
Step 25: Export artifacts (run/ + final/ + update queue + cost ledger + learning)
```

### 3.4 Compiled Artifact Chain

The workbook compilation (`categoryCompile.js`) transforms the Excel workbook into machine-readable artifacts that drive the entire system:

```
mouseData.xlsm (Excel with macros)
    |
    |-- workbook_map.json (describes sheet-to-field column mappings)
    |       |
    |       v
    |-- compileCategoryWorkbook()
            |
            |-- field_rules.json      Used by: extraction pipeline, field rules engine,
            |                                  review grid layout, studio UI
            |
            |-- known_values.json     Used by: enum validation, LLM prompts,
            |                                  enum review tab, studio UI
            |
            |-- component_db/*.json   Used by: component resolver, component review tab,
            |                                  cascade propagation
            |
            |-- ui_field_catalog.json Used by: review grid column headers, tooltips,
            |                                  studio field workbench
            |
            |-- parse_templates.json  Used by: deterministic parser
            |
            |-- field_groups.json     Used by: review grid grouping,
            |                                  field rules workbench grouping
            |
            `-- cross_validation_rules.json  Used by: constraint solver
```

### 3.5 Data Management SQLite (SpecDb)

SpecFactory now includes a category-scoped SQLite snapshot database for cross-surface data management:

- Path: `.specfactory_tmp/{category}/spec.sqlite`
- Entry command: `node src/cli/spec.js seed-db --category <category> --local`
- Runtime config: `SPEC_DB_DIR` (`src/config.js`)
- Seed implementation: `src/db/seed.js`
- DAO + schema: `src/db/specDb.js`

#### 3.5.1 Source Capture Per Item

`candidates` is the canonical evidence-bearing table for per-item source provenance. Each candidate row captures:

- identity: `product_id`, `field_key`, `candidate_id`
- ranking: `score`, `rank`
- source metadata: `source_url`, `source_host`, `source_root_domain`, `source_tier`, `source_method`, `approved_domain`
- evidence payload: `snippet_id`, `snippet_hash`, `snippet_text`, `quote`, `quote_span_start/end`, `evidence_url`, `evidence_retrieved_at`
- field typing flags: `is_component_field`, `component_type`, `is_list_field`

Seed path:

- From `out/specs/outputs/{cat}/{productId}/latest/candidates.json`
- Override provenance fallback from `_overrides/{productId}.overrides.json` when accepted override candidate rows must be synthesized

#### 3.5.2 Sharing Sources With Components and Lists

Source-aware sharing happens through key references:

- `item_field_state.accepted_candidate_id` links the chosen item field value back to its candidate/source.
- `component_values.accepted_candidate_id` allows component properties to reference the same candidate/evidence lineage.
- `list_values.accepted_candidate_id` allows enum/list values to reference the same candidate/evidence lineage.
- `item_component_links` maps `(product_id, field_key)` to canonical component identity (`component_type`, `component_name`, `component_maker`).
- `item_list_links` maps `(product_id, field_key)` to canonical `list_values.id`.
- `candidate_reviews` supports multi-context review on the same candidate via `context_type IN ('item','component','list')`.

Current seed behavior:

- Fully seeds item candidates + item field state + item-component links + item-list links.
- Seeds component/list baselines from compiled artifacts (`component_db`, `known_values`, `workbook_map.manual_enum_values`).
- Writes `candidate_reviews` in `item` context from override files.
- Schema supports `component` and `list` review contexts, but those context rows are not auto-seeded yet.

#### 3.5.3 Source Registry and Evidence Lineage

The normalized source capture layer provides a clean lineage chain on top of the denormalized `candidates` table:

```
candidates (raw extraction store, denormalized source metadata)
  -> source_registry (one row per product+host+run combination)
       -> source_assertions (normalized claims; assertion_id = candidate_id)
            -> source_evidence_refs (specific quotes + snippet IDs)
```

**`source_registry`** — One row per crawled source. Source ID format: `{category}::{product_id}::{host}::{run_id}`. Tracks `source_url`, `source_host`, `source_tier`, `source_method`, `crawl_status`, `http_status`.

**`source_assertions`** — One per candidate, linking field+value+source. Uses `assertion_id = candidate_id` as deliberate identity. Context kinds: `scalar` (plain field), `component` (component-typed field), `list` (enum field).

**`source_evidence_refs`** — Specific quotes/snippets per assertion. Only candidates with a `quote` or `evidence_url` generate evidence refs.

Read methods:
- `specDb.getSourcesForItem(itemIdentifier)` — all sources for a product, ordered by tier
- `specDb.getAssertionsForSource(sourceId)` — all assertions from that source

#### 3.5.4 Key Review State (Two-Lane AI Review)

`key_review_state` tracks AI review status per field per item with two independent review lanes:

**Target kinds:**
- `grid_key` = `(item_identifier, field_key)` — per-product field
- `enum_key` = `(field_key, enum_value_norm)` — shared enum value
- `component_key` = `(component_identifier, property_key)` — shared component property

**Two-lane model:**

| Lane | Color | Scope | Columns |
|------|-------|-------|---------|
| **Primary** (Item) | Teal | Per-product field value correctness | `ai_confirm_primary_status`, `user_accept_primary_status`, `user_override_ai_primary` |
| **Shared** (Component/Enum) | Purple | Component DB or enum list consistency | `ai_confirm_shared_status`, `user_accept_shared_status`, `user_override_ai_shared` |

**Frontend wiring:**

The `products-index` API enriches each product's fields with `keyReview` data from `key_review_state`. The review grid uses this + the field contract to determine badges:

- `field_rule.component_type` or `field_rule.enum_source` set → field has shared lane
- Missing `keyReview` row → treated as `pending` (AI review never ran)
- `primaryStatus === 'pending' && userAcceptPrimary !== 'accepted' && !overridePrimary` → teal badge
- `sharedStatus === 'pending' && userAcceptShared !== 'accepted' && !overrideShared` → purple badge

**API endpoints:**

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/review/{cat}/key-review-confirm` | `{ id, lane: 'primary'\|'shared' }` | Confirm AI review for a lane |
| `POST` | `/review/{cat}/key-review-accept` | `{ id, lane: 'primary'\|'shared' }` | User accepts a lane |

Both insert audit entries and broadcast WebSocket updates.

**Supporting tables:**
- `key_review_runs` — LLM call attempts per key review state
- `key_review_run_sources` — links runs to `assertion_id` (evidence packets sent to LLM)
- `key_review_audit` — immutable audit trail for all review state changes

#### 3.5.5 Component Value Change Propagation

When a component property value changes (via component-override endpoint), `cascadeComponentChange()` in `componentImpact.js` propagates based on the property's variance policy:

| Policy | Enforcement | Action on Change |
|--------|-------------|------------------|
| `authoritative` | Exact match required | Value pushed directly to all linked products; priority 1 stale |
| `upper_bound` | Product must be <= component | Violations flagged `needs_ai_review=1`; priority 2 stale |
| `lower_bound` | Product must be >= component | Violations flagged `needs_ai_review=1`; priority 2 stale |
| `range` | Within +/-10% tolerance | Violations flagged `needs_ai_review=1`; priority 2 stale |
| `override_allowed` | Any value permitted | Stale-marking only |

Constraints (e.g., `sensor_date <= release_date`) are evaluated independently and bump priority by +1 on violation.

#### 3.5.6 List Value Change Propagation

When a list value changes (via enum-override/enum-rename endpoints), `cascadeEnumChange()` propagates:

**Remove:** Clears `item_field_state.value = NULL`, `needs_ai_review = 1`, removes list links, rewrites `normalized.json`, marks stale with priority 1 and `dirty_flags: [{ reason: 'enum_removed' }]`.

**Rename:** Atomic SQLite transaction updates `item_field_state.value`, re-points `item_list_links` foreign keys, rewrites `normalized.json`, marks stale with `reason: 'enum_renamed'`.

**Add:** No impact on existing products. New value available for future extraction/override.

### 3.6 Override & Cascade Flow

When a user makes a change in any GUI surface, it must propagate to all affected data:

```
User Action in GUI
    |
    |-- Component Override (Studio/Component Review)
    |       |
    |       v
    |   1. Write to _overrides/components/{type}_{slug}.json
    |   2. Dual-write to compiled component_db
    |   3. cascadeComponentChange() -> mark affected products stale in queue
    |   4. broadcastWs('data-change', { category })
    |   5. Frontend: invalidate 7 query key families
    |
    |-- Enum Override (Component Review / Studio)
    |       |
    |       v
    |   1. Write to workbook_map.json manual_enum_values (survives recompile)
    |   2. Write to known_values.json (immediate visibility)
    |   3. If remove: cascadeEnumChange() -> mark affected products stale
    |   4. broadcastWs('data-change', { category })
    |   5. Frontend: invalidate 7 query key families
    |
    |-- Field Override (Review Grid)
    |       |
    |       v
    |   1. Write to _overrides/{productId}.overrides.json
    |   2. Shell out to spec.js review override
    |   3. Frontend: optimistic update via setQueryData + invalidate
    |
    |-- Brand Rename (Studio / Catalog)
    |       |
    |       v
    |   1. Rename in brand_registry.json
    |   2. Cascade to product_catalog.json (update all matching products)
    |   3. Cascade to input JSON files (rename product IDs)
    |   4. Cascade to output artifacts, queue state, overrides
    |   5. Frontend: invalidate ALL query families (no category scope)
    |
    `-- Product Rename (Catalog)
            |
            v
        1. Rename in product_catalog.json
        2. Migrate input/output files to new product ID
        3. Frontend: update productStore.selectedProductId if affected
        4. Frontend: invalidate catalog + review + product queries
```

---

## 4. API Architecture

### 4.1 Design Pattern

The backend uses a **pure Node.js HTTP server** (no Express, no Koa) with manual URL routing via string parsing. All routes are under the `/api/v1/` prefix.

```javascript
// Routing pattern (guiServer.js)
const server = http.createServer(async (req, res) => {
  corsHeaders(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.url.startsWith('/api/v1/') || req.url === '/health') {
    const handled = await handleApi(req, res);
    if (handled === null) jsonRes(res, 404, { error: 'not_found' });
    return;
  }
  serveStatic(req, res); // SPA fallback
});
```

### 4.2 Complete Endpoint Inventory

#### Health & Meta
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check: `{ ok: true }` |
| `GET` | `/categories` | List all category directories |
| `POST` | `/categories` | Create new category with scaffold dirs |

#### Product Catalog (CRUD)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/catalog/{cat}` | Full catalog overview (products + queue state + storage) |
| `GET` | `/catalog/all` | Cross-category merged catalog |
| `GET` | `/catalog/{cat}/products` | Product list from catalog JSON |
| `POST` | `/catalog/{cat}/products` | Add product (brand, model, variant, seedUrls) |
| `PUT` | `/catalog/{cat}/products/{pid}` | Update product identity or status |
| `DELETE` | `/catalog/{cat}/products/{pid}` | Remove product |
| `POST` | `/catalog/{cat}/products/seed` | Bulk seed from workbook (identity or full) |

#### Product Detail
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/product/{cat}/{pid}` | Full product payload: summary + normalized + provenance + trafficLight |

#### Review Grid
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/review/{cat}/layout` | Column definitions + field groups for review grid |
| `GET` | `/review/{cat}/products-index` | All products (lightweight, no candidates) for grid population |
| `GET` | `/review/{cat}/products?ids&brands` | Batch product payloads with optional candidate loading |
| `GET` | `/review/{cat}/product/{pid}` | Single product review payload |
| `GET` | `/review/{cat}/candidates/{pid}/{field}` | Lazy-load candidates for drawer |
| `POST` | `/review/{cat}/override` | Override field from candidate selection |
| `POST` | `/review/{cat}/manual-override` | Override field with manual value |
| `POST` | `/review/{cat}/finalize` | Finalize single product (apply overrides -> final/) |
| `POST` | `/review/{cat}/finalize-all` | Finalize all run products sequentially |
| `POST` | `/review/{cat}/key-review-confirm` | Confirm AI review lane (primary/shared) |
| `POST` | `/review/{cat}/key-review-accept` | Accept AI review lane (primary/shared) |

#### Review Components
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/review-components/{cat}/layout` | Component types with property column definitions |
| `GET` | `/review-components/{cat}/components?type` | Component items for a type |
| `GET` | `/review-components/{cat}/enums` | Enum review data (known values per field) |
| `POST` | `/review-components/{cat}/component-override` | Save component property override + cascade |
| `POST` | `/review-components/{cat}/enum-override` | Add/remove/accept enum value + cascade |
| `POST` | `/review-components/{cat}/enum-rename` | Atomic rename with cascade |
| `GET` | `/review-components/{cat}/component-impact?type&name` | Products referencing component |

#### Studio & Field Rules
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/studio/{cat}/payload` | fieldRules + fieldOrder + uiFieldCatalog + guardrails |
| `GET` | `/studio/{cat}/guardrails` | Guardrails configuration |
| `GET` | `/studio/{cat}/known-values` | Enum allowlists by field |
| `GET` | `/studio/{cat}/component-db` | Full component database by type |
| `GET` | `/studio/{cat}/introspect` | Excel workbook sheet preview |
| `GET` | `/studio/{cat}/workbook-map` | Workbook column mapping config |
| `PUT` | `/studio/{cat}/workbook-map` | Save workbook map |
| `POST` | `/studio/{cat}/validate-map` | Validate workbook map structure |
| `GET` | `/studio/{cat}/tooltip-bank` | Tooltip content for fields |
| `POST` | `/studio/{cat}/save-drafts` | Save draft field rules + UI catalog |
| `GET` | `/studio/{cat}/drafts` | Load draft rules |
| `GET` | `/studio/{cat}/artifacts` | List generated artifacts |
| `POST` | `/studio/{cat}/compile` | Trigger workbook compilation (child process) |

#### Brands
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/brands?category` | List brands (optional category filter) |
| `POST` | `/brands/seed` | Seed brands from workbook |
| `POST` | `/brands` | Add brand |
| `PUT` | `/brands/{slug}` | Update brand (rename cascades) |
| `DELETE` | `/brands/{slug}` | Remove brand |
| `GET` | `/brands/{slug}/impact` | Rename/delete impact analysis |

#### Process Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/process/start` | Start pipeline: run-one, run-batch, run-until-complete, daemon |
| `POST` | `/process/stop` | SIGTERM -> SIGKILL child process |
| `GET` | `/process/status` | Running state: pid, command, exitCode |

#### Runtime & Events
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/events/{cat}?productId&limit` | Read events.jsonl (filtered) |
| `GET` | `/runtime/runs` | Last 50 runs metadata |
| `GET` | `/runtime/runs/{id}/events` | Events for specific run |
| `GET` | `/runtime/runs/{id}/traces/index` | Trace file listing |
| `GET` | `/runtime/runs/{id}/traces/{type}/{id}` | Specific trace JSON |
| `GET` | `/runtime/runs/{id}/control` | Runtime overrides for run |
| `PUT` | `/runtime/runs/{id}/control` | Update runtime overrides |
| `GET` | `/runtime/traces?runId&productId&section` | Filtered trace query |
| `GET` | `/runtime/overrides` | Global runtime overrides |
| `PUT` | `/runtime/overrides` | Update global runtime overrides |

#### Queue
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/queue/{cat}` | Full queue state |
| `GET` | `/queue/{cat}/review?status&limit` | Filtered review queue |

#### Billing & Learning
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/billing/{cat}/monthly` | Monthly cost data |
| `GET` | `/learning/{cat}/artifacts` | Learning artifacts list |

#### GraphQL Proxy
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/graphql` | Proxied to Intel Graph API (:8787) |

### 4.3 Frontend Data Fetching Pattern

The frontend uses React Query (`@tanstack/react-query` v5) for all server communication:

```typescript
// Fetch pattern (all pages)
const { data, isLoading, error } = useQuery({
  queryKey: ['reviewProductsIndex', category],  // cache address
  queryFn: () => api.get<ProductsIndexResponse>(`/review/${category}/products-index`),
  enabled: category !== 'all',                   // conditional fetching
  staleTime: 5_000,                              // 5s stale window (global default)
});

// Mutation pattern (all write operations)
const overrideMut = useMutation({
  mutationFn: (body) => api.post(`/review-components/${category}/component-override`, body),
  onMutate: async () => { /* optimistic update via setQueryData */ },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['componentReviewData', category, type] });
    queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    queryClient.invalidateQueries({ queryKey: ['product', category] });
    queryClient.invalidateQueries({ queryKey: ['componentImpact'] });
  },
  onError: () => { /* rollback: re-invalidate to refetch truth */ },
});
```

### 4.4 WebSocket Protocol

**Endpoint:** `ws://localhost:8788/ws`

**Client subscribes on connect:**
```json
{ "subscribe": ["events", "traces", "queue", "process", "control"], "category": "mouse" }
```

**Server broadcasts (5 channels):**

| Channel | Trigger | Payload | Frontend Handler |
|---------|---------|---------|-----------------|
| `events` | New lines in events.jsonl | `RuntimeEvent[]` | `appendEvents()` in eventsStore |
| `process` | New stdout/stderr from child process | `string[]` | `appendProcessOutput()` in runtimeStore |
| `control` | Runtime overrides written | `RuntimeOverrides` | (planned) |
| `traces` | New trace file in traces/ | `{ type, file }` | (planned) |
| `data-change` | Mutation in component/enum/compile | `{ type, category }` | Bulk `invalidateQueries` for 7 key families |

**`data-change` handler in AppShell.tsx:**
```typescript
if (channel === 'data-change') {
  const cat = msg.category;
  queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', cat] });
  queryClient.invalidateQueries({ queryKey: ['componentReviewData', cat] });
  queryClient.invalidateQueries({ queryKey: ['componentReviewLayout', cat] });
  queryClient.invalidateQueries({ queryKey: ['enumReviewData', cat] });
  queryClient.invalidateQueries({ queryKey: ['product', cat] });
  queryClient.invalidateQueries({ queryKey: ['catalog', cat] });
  queryClient.invalidateQueries({ queryKey: ['studio-known-values', cat] });
}
```

---

## 5. Frontend Architecture

### 5.1 Routing

```
HashRouter (#/path)
    |
    AppShell (layout route — always rendered)
    |-- /                    -> OverviewPage
    |-- /categories          -> CategoryManager
    |-- /catalog             -> CatalogPage
    |-- /product             -> ProductPage
    |-- /runtime             -> RuntimePage
    |-- /billing             -> BillingPage
    |-- /studio              -> StudioPage          (disabled when category = 'all')
    |-- /review              -> ReviewPage           (disabled when category = 'all')
    `-- /review-components   -> ComponentReviewPage  (disabled when category = 'all')
```

**Tab groups in TabNav:**
- **CATALOG_TABS:** Overview, Categories, Catalog, Selected Product, Field Rules Studio
- **OPS_TABS:** Live Runtime, Billing & Learning, Review Grid, Review Components

### 5.2 Component Hierarchy

```
<AppShell>
  |-- <header>
  |     |-- App title
  |     |-- DEV toggle (shows raw LLM prompts)
  |     `-- Dark mode toggle
  |
  |-- <TabNav>
  |     |-- CATALOG_TABS (NavLink x5)
  |     `-- OPS_TABS (NavLink x4)
  |
  |-- <Sidebar>
  |     |-- Category select
  |     |-- Brand > Model > Variant cascade selects
  |     |-- Run controls (Start/Stop)
  |     |-- Process status indicator
  |     `-- Queue summary
  |
  `-- <main>
        `-- <Outlet /> (routed page content)
              |
              |-- <ReviewPage>
              |     |-- <BrandFilterBar>
              |     |-- <ReviewMatrix>         (virtualized 2D grid)
              |     |     |-- Row virtualizer   (@tanstack/react-virtual)
              |     |     |-- Col virtualizer   (@tanstack/react-virtual)
              |     |     `-- <ReviewValueCell>  (per-cell with <CellTooltip>)
              |     `-- <ReviewDrawer>          (slide-in with candidates)
              |
              |-- <ComponentReviewPage>
              |     |-- Dynamic sub-tabs (sensor, switch, encoder, enums, ...)
              |     |-- <ComponentSubTab>      (per-type editable grid)
              |     |     `-- <ComponentReviewDrawer>
              |     `-- <EnumSubTab>           (per-field value list)
              |           `-- <EnumReviewDrawer>
              |
              `-- <StudioPage>
                    |-- 9 sub-tabs
                    |-- <FieldRulesWorkbench>
                    |     |-- <WorkbenchTable>  (virtualized spreadsheet)
                    |     |-- <WorkbenchDrawer> (7 editing sub-tabs)
                    |     `-- <WorkbenchBulkBar>
                    `-- <BrandManager>
```

### 5.3 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` + `react-dom` | 18.3.1 | UI framework |
| `react-router-dom` | 6.28.0 | HashRouter client routing |
| `@tanstack/react-query` | 5.62.0 | Server state management + caching |
| `@tanstack/react-table` | 8.20.0 | Headless table engine (DataTable) |
| `@tanstack/react-virtual` | 3.11.0 | Row + column virtualization (ReviewMatrix) |
| `zustand` | 5.0.2 | Client state (8 stores, no middleware) |
| `recharts` | 2.15.0 | Bar/area charts (BillingPage) |
| `react-hotkeys-hook` | 5.2.4 | Keyboard shortcuts (Review grid navigation) |
| `@radix-ui/react-tooltip` | 1.1.6 | Accessible tooltips (CellTooltip) |
| `@radix-ui/react-dialog` | 1.1.4 | Modal dialogs |
| `@radix-ui/react-select` | 2.1.4 | Accessible selects |
| `tailwindcss` | 3.4.16 | Utility CSS with dark mode via class strategy |
| `vite` | 6.0.3 | Build tool + dev server |
| `typescript` | 5.7.2 | Type checking (strict mode) |

---

## 6. State Management & Cache Synchronization

### 6.1 Dual-State Architecture

SpecFactory separates state into two distinct domains:

**Server State (React Query):** All data from the backend — product lists, review payloads, field rules, component databases. Managed via `useQuery` hooks with automatic background refetching, stale-time windows, and cache invalidation.

**UI State (Zustand):** All ephemeral interaction state — which cell is selected, whether the drawer is open, editing mode, sort preferences, dark mode. Never persisted to the server.

```
React Query Cache                    Zustand Stores
|                                    |
|-- reviewProductsIndex              |-- reviewStore
|-- componentReviewData              |     |-- selectedField
|-- enumReviewData                   |     |-- activeCell
|-- product                          |     |-- cellMode (FSM)
|-- catalog                          |     |-- editingValue
|-- studio                           |     |-- flaggedCells[]
|-- billing                          |     |-- brandFilter
|                                    |
|   (server truth)                   |-- componentReviewStore
|   (fetched via REST)               |     |-- selectedEntity
|   (invalidated via WS)             |     |-- drawerOpen
|                                    |     |-- enumDrawerOpen
|                                    |
|                                    |-- uiStore
|                                    |     |-- category
|                                    |     |-- darkMode
|                                    |
|                                    |-- productStore
|                                    |     |-- selectedProductId
|                                    |     |-- selectedBrand
|                                    |
|                                    |   (ephemeral interaction state)
|                                    |   (never persisted)
```

### 6.2 Cross-Surface Cache Invalidation

After the ecosystem sync fixes, every mutation now correctly invalidates all affected query families across all three review surfaces (Review Grid, Component Review, Studio):

```
Mutation                          Query Keys Invalidated
|                                 |
|-- Component Override ---------> componentReviewData, reviewProductsIndex,
|                                 product, componentImpact
|
|-- Enum Override/Rename -------> enumReviewData, reviewProductsIndex,
|                                 studio-known-values
|
|-- Product CRUD ---------------> catalog-products, catalog,
|                                 reviewProductsIndex, product
|
|-- Brand Rename ---------------> brands, brand-impact, catalog-products,
|                                 catalog, reviewProductsIndex, product
|                                 (no category scope - affects all)
|
|-- Studio Compile -------------> catalog, reviewProductsIndex, reviewLayout,
|                                 componentReviewData, componentReviewLayout,
|                                 enumReviewData, product
|
|-- WebSocket data-change ------> reviewProductsIndex, componentReviewData,
    (from other tabs/clients)     componentReviewLayout, enumReviewData,
                                  product, catalog, studio-known-values
```

### 6.3 Complete Query Key Inventory

| Query Key Pattern | Page(s) | Endpoint | Notes |
|---|---|---|---|
| `['categories']` | AppShell | `GET /categories` | Bootstrapped at app start |
| `['processStatus']` | AppShell | `GET /process/status` | `refetchInterval: 5000` |
| `['catalog', cat]` | Sidebar, Overview | `GET /catalog/{cat}` | `refetchInterval: 10000` (Sidebar) |
| `['catalog-review', cat]` | ReviewPage | `GET /catalog/{cat}/products` | Separate key to avoid collision |
| `['catalog-products', cat]` | ProductManager | `GET /catalog/{cat}/products` | Catalog CRUD |
| `['product', cat, pid]` | ProductPage | `GET /product/{cat}/{pid}` | Per-product detail |
| `['reviewLayout', cat]` | ReviewPage | `GET /review/{cat}/layout` | Column definitions |
| `['reviewProductsIndex', cat]` | ReviewPage | `GET /review/{cat}/products-index` | Core grid data |
| `['candidates', cat, pid, field]` | ReviewDrawer | `GET /review/{cat}/candidates/{pid}/{field}` | Lazy-loaded |
| `['componentReviewLayout', cat]` | ComponentReviewPage | `GET /review-components/{cat}/layout` | Type tabs |
| `['componentReviewData', cat, type]` | ComponentReviewPage | `GET /review-components/{cat}/components?type` | Per-type |
| `['enumReviewData', cat]` | ComponentReviewPage | `GET /review-components/{cat}/enums` | All enum fields |
| `['componentImpact', cat, type, name]` | ComponentReviewDrawer | `GET /.../component-impact` | On-demand |
| `['brands', cat?]` | ProductManager, BrandManager | `GET /brands?category` | |
| `['brand-impact', slug]` | BrandManager | `GET /brands/{slug}/impact` | |
| `['studio', cat]` | StudioPage | `GET /studio/{cat}/payload` | Field rules bundle |
| `['studio-workbook-map', cat]` | StudioPage | Workbook map | |
| `['studio-introspect', cat]` | StudioPage | Sheet introspection | |
| `['studio-known-values', cat]` | StudioPage | Enum allowlists | |
| `['studio-component-db', cat]` | StudioPage | Component DB | |
| `['studio-tooltip-bank', cat]` | StudioPage | Tooltip content | |
| `['studio-drafts', cat]` | StudioPage | Draft rules | |
| `['studio-artifacts', cat]` | StudioPage | Build artifacts | |
| `['workbook-context', cat]` | StudioPage | Workbook context | |
| `['billing', cat]` | Overview, Billing | `GET /billing/{cat}/monthly` | |
| `['learning', cat]` | BillingPage | `GET /learning/{cat}/artifacts` | |
| `['events', cat, pid]` | RuntimePage | `GET /events/{cat}` | `refetchInterval: 5000` |
| `['queue', cat]` | RuntimePage | `GET /queue/{cat}` | `refetchInterval: 10000` |

### 6.4 Review Grid Cell FSM

The Review Grid implements a formal finite state machine for cell interaction:

```
                    click cell
  [viewing] ─────────────────────> [selected]
      ^                                |
      |   Escape / click outside       |   double-click / F2 / E
      |                                v
      `─────────────────────────── [editing]
                                       |
                                       |   Enter / commitEditing()
                                       v
                                  [saving...]
                                       |
                               success | error
                                  |         |
                                  v         v
                              [saved]   [error]
                                  |         |
                                  `----+----'
                                       |
                                       v
                                  [viewing]
```

**Keyboard shortcuts (react-hotkeys-hook):**
- `Tab` / `Shift+Tab` — Navigate flagged cells
- `Escape` — Cancel editing / close drawer
- `Space` — Open drawer for selected cell
- `F2` / `E` — Enter edit mode
- `Enter` — Commit edit
- `1-9` — Quick-select candidate by index
- `Ctrl+A` — Approve green fields
- `Ctrl+S` — Save/finalize

---

## 7. Infrastructure & Deployment

### 7.1 AWS Services

| Service | Usage | Configuration |
|---------|-------|---------------|
| **Amazon S3** | Primary data store for product inputs, outputs, and published specs | Bucket: `my-spec-harvester-data`, Region: `us-east-2`, Prefixes: `specs/inputs/`, `specs/outputs/` |
| **S3 (secondary)** | Published data distribution | Bucket: `eggamer-data` |

**Authentication:** Standard AWS credential chain — `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` environment variables or IAM role. The `DualMirroredStorage` mode fails gracefully if S3 credentials are unavailable (writes log warning, continues local-only).

**S3 Operations Used:**
- `GetObjectCommand` — Reading product inputs and output artifacts
- `PutObjectCommand` — Writing normalized outputs, summaries, provenance
- `ListObjectsV2Command` — Listing product input keys (paginated)
- `HeadObjectCommand` — Checking file existence
- `DeleteObjectCommand` — Removing product files on rename/delete

### 7.2 Storage Modes

```
                       ┌──────────────────────────────┐
                       │   createStorage(config)       │
                       │                               │
                       │   OUTPUT_MODE env var          │
                       └───────┬───────┬───────┬───────┘
                               │       │       │
                     'local'   │  'dual'│  's3' │
                               │       │       │
                     ┌─────────┴┐  ┌───┴───┐  ┌┴─────────┐
                     │  Local   │  │ Dual  │  │    S3     │
                     │ Storage  │  │Mirror │  │  Storage  │
                     └──────────┘  └───────┘  └───────────┘
                     Read: FS      Read: FS    Read: S3
                     Write: FS     Write: FS   Write: S3
                                   +mirror S3
```

- **`local` (development):** All I/O against `fixtures/s3/` (inputs) and `out/` (outputs). Zero cloud dependency.
- **`dual` (staging):** Reads always from local. Writes go to local first, then best-effort mirror to S3. Mirror failures are logged but non-fatal.
- **`s3` (production):** All I/O against S3 bucket. Requires valid AWS credentials.

### 7.3 LLM Provider Architecture

```
                    ┌─────────────────────────────────────┐
                    │         LLM Role Router              │
                    │   (per-role provider selection)       │
                    └──┬──────┬──────┬──────┬──────────────┘
                       │      │      │      │
                  plan │ extract│ validate│ write│
                       │      │      │      │
                  ┌────┴──┐ ┌─┴───┐ ┌┴────┐ ┌┴────────────┐
                  │Cortex │ │Cortex│ │Cortex│ │Google Gemini│
                  │Proxy  │ │Proxy │ │Proxy │ │Direct API   │
                  │:5001  │ │:5001 │ │:5001 │ │             │
                  └───┬───┘ └──┬───┘ └──┬───┘ └─────────────┘
                      │        │        │
                  ┌───┴────────┴────────┴───┐
                  │   Cortex Sidecar         │
                  │   (escalation engine)    │
                  │   Tiers: fast → audit    │
                  │     → deep → xhigh       │
                  └──────────┬───────────────┘
                             │
                  ┌──────────┴───────────────┐
                  │  Primary: GPT-5.1        │
                  │  Fallback: DeepSeek      │
                  └──────────────────────────┘
```

**Four LLM roles** with independent provider routing:
- **plan:** Source planning, URL prioritization (gpt-5.1-low via Cortex)
- **extract:** Field extraction from evidence packs (gpt-5.1-high via Cortex)
- **validate:** Candidate verification (gpt-5.1-high via Cortex)
- **write:** Summary generation (gemini-2.5-flash-lite direct to Google)

**Budget enforcement:** Per-product ($X/product) and monthly ($X/month) limits via `budgetGuard.js`. Circuit breaker (`providerHealth.js`) automatically fails-over to DeepSeek on provider errors.

### 7.4 Containerization

```dockerfile
# Dockerfile
FROM mcr.microsoft.com/playwright:v1.54.2-jammy
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/cli/run-batch.js", "--category", "mouse"]
```

Base image: Microsoft Playwright (Ubuntu Jammy + Chromium/Firefox/WebKit). Includes Python for SQLite export via inline scripts. Default entrypoint runs batch extraction for the `mouse` category.

### 7.5 Desktop Distribution

The application is also distributed as standalone Windows executables:
- **`Launcher.exe`** (43 MB) — Quick launcher
- **`SpecFactory.exe`** (55 MB) — Full application

Built via `@yao-pkg/pkg` which bundles Node.js + application code into a single binary. The GUI server serves the pre-built React SPA from `gui-dist/`.

### 7.6 Development Architecture

```
Browser (:5173)
    |
    |-- Vite Dev Server (HMR + proxy)
    |       |
    |       |-- /api/* ──proxy──> Node.js GUI Server (:8788)
    |       |-- /ws    ──proxy──> WebSocket Server (:8788)
    |       `-- /*     ──────────> React SPA (Vite HMR)
    |
    |-- SearXNG (:8080) ──────> Local search engine
    |-- Cortex (:5001) ──────> LLM proxy/router
    `-- Intel Graph (:8787) ──> GraphQL API
```

### 7.7 Search Provider Stack

| Provider | Type | Usage |
|----------|------|-------|
| **SearXNG** | Self-hosted | Primary search (localhost:8080) |
| **Bing** | Commercial API | Secondary search |
| **Google CSE** | Commercial API | Secondary search |
| **DuckDuckGo** | Free | Tertiary fallback |

Search mode is `dual` — queries are sent to multiple providers simultaneously, results are merged and deduplicated by `serpDedupe.js`, then re-ranked by `resultReranker.js` using domain intel scores.

---

## 8. Appendix: Diagrams

Five Mermaid diagrams are rendered as 4K PNG images in the same directory as this document:

| File | Description |
|------|-------------|
| `diagram1_system_context.png` | Master system context: client, server, storage, external services |
| `diagram2_data_lifecycle.png` | Complete data lifecycle from ingestion through publishing |
| `diagram3_frontend_state.png` | React Query + Zustand dual-state architecture |
| `diagram4_api_flow.png` | API request/response flow with WebSocket synchronization |
| `diagram5_cascade_propagation.png` | Override cascade propagation across all surfaces |

---

*This document is the authoritative architecture reference for the SpecFactory ecosystem. All 19 cross-surface synchronization gaps identified in the ecosystem audit have been resolved as of 2026-02-16.*
