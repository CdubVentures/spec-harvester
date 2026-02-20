# Phase 8 — GUI Framework Decision: React vs Streamlit

> Date: 2026-02-13
> Status: DECIDED — Streamlit (current) with optional React migration path

---

## Context

The Spec Factory has two GUI surfaces:

1. **Review Grid** (`tools/gui/app.py`) — Human review of extracted product specs with override/approve/reject workflow
2. **Runtime Ops Cockpit** (Phase 14) — Live monitoring dashboard with 6 tab panels (search, frontier, inspector, LLM, field progress, controls)

Both are currently implemented in **Streamlit** (Python). The question: should we migrate to **React** for either or both?

---

## Options Evaluated

### Option A: Stay on Streamlit (Recommended)

**Pros:**
- Already working and tested (95% complete for Review Grid, 70% for Cockpit)
- Zero migration cost — no throwaway work
- Single-language backend (Python) matches the GUI data layer
- WebSocket support via `streamlit-ws` for live updates
- Rapid iteration: change a few lines, see results immediately
- The team knows Python; no frontend dev hiring needed
- Streamlit 1.x supports custom components, session state, multipage apps

**Cons:**
- Limited layout flexibility (column/sidebar model)
- Not embeddable in other web apps
- Slower for highly interactive UIs (drag-and-drop, complex tables)
- Scaling: Streamlit spawns a process per user session

### Option B: Migrate to React

**Pros:**
- Full layout control (CSS Grid, Flexbox, any UI library)
- Better for complex interactive tables (AG Grid, TanStack Table)
- Standard web tech — embeddable, deployable anywhere
- Better performance for large datasets with virtual scrolling
- Richer component ecosystem

**Cons:**
- Significant migration cost (rewrite 2 GUIs from scratch)
- Requires REST/WebSocket API layer between Node.js backend and React frontend
- Two runtime environments to maintain (Node.js + React dev server)
- Frontend build tooling (Vite/Webpack, TypeScript, testing)
- The team's strength is backend — this adds frontend complexity

### Option C: Hybrid (Streamlit + React Micro-Frontend)

**Pros:**
- Keep Streamlit for what works (dashboard, monitoring)
- Use React only for the Review Grid (where interactivity matters most)
- Gradual migration path

**Cons:**
- Two GUI frameworks to maintain
- Integration complexity between Streamlit and React
- Confusing developer experience

---

## Decision Matrix

| Criteria | Weight | Streamlit | React | Hybrid |
|----------|--------|-----------|-------|--------|
| Migration cost | 30% | 10 (none) | 2 (full rewrite) | 5 (partial) |
| Interactivity | 20% | 6 | 10 | 8 |
| Maintainability | 20% | 9 | 6 | 4 |
| Team skill fit | 15% | 9 | 4 | 6 |
| Scalability | 10% | 5 | 9 | 7 |
| Time to value | 5% | 10 | 3 | 6 |
| **Weighted Score** | | **8.15** | **5.35** | **5.55** |

---

## Decision

**Stay on Streamlit** for both GUI surfaces.

### Rationale

1. **Sunk cost is real**: The Review Grid is 95% complete, the Cockpit is 70% complete. A React migration would discard months of working code for marginal UI improvements.

2. **The bottleneck isn't the GUI**: Product quality depends on extraction accuracy, evidence verification, and source intelligence — not on whether the review grid uses React or Streamlit.

3. **Streamlit is sufficient**: The current implementation handles the review workflow (approve/reject/override), WebSocket live updates, and 6 monitoring panels adequately.

4. **Migration path exists**: If interactivity becomes a real bottleneck (not a theoretical one), the data layer is cleanly separated. A React frontend could consume the same JSON APIs that Streamlit reads.

### Future Triggers for Reconsidering

- More than 3 concurrent reviewers hitting Streamlit session limits
- Review Grid needs drag-and-drop reordering or inline editing
- External teams need to embed the review UI in their own tools
- Streamlit performance degrades with 1000+ products loaded

---

## Action Items

1. No migration needed now
2. Continue enhancing Streamlit GUI (fleet monitor, improved tables)
3. Keep data layer clean (JSON APIs) so React migration remains possible
4. Revisit if any "future triggers" above are hit
