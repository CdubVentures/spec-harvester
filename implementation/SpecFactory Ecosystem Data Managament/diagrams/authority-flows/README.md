# Component + Enum Authority Mermaid Diagrams

This folder contains Mermaid source and rendered outputs for item keys, component tables, component keys, enum keys, and enum values.

## What is covered
- Component authoritative propagation to linked items
- Component variance and constraints re-flag flow
- Enum master propagation and item enum link sync
- Lane decoupling (grid key vs component key vs enum key)
- Data hierarchy between item state, links, masters, and review state

## Files
- `component-authoritative-flow.mmd`
- `enum-master-flow.mmd`
- `lane-decoupling-flow.mmd`
- `entity-hierarchy.mmd`
- `*.4k.png` (3840x2160)
- `*.svg`

## Render command
From repo root:

```bash
npm run docs:render:authority-diagrams
```

## 4K Outputs
### Component Authoritative Flow
![Component Authoritative Flow](./component-authoritative-flow.4k.png)

### Enum Master Flow
![Enum Master Flow](./enum-master-flow.4k.png)

### Lane Decoupling
![Lane Decoupling Flow](./lane-decoupling-flow.4k.png)

### Entity Hierarchy
![Entity Hierarchy](./entity-hierarchy.4k.png)

## Logic assertions shown in the diagrams
- Item/grid shared acceptance does not write back into component/enum masters.
- Component and enum master updates propagate downward to linked item keys.
- Authoritative component updates write linked item values directly.
- Variance/constraint component updates re-run flags across linked items.
- Item-level candidate sources can differ while still mapping to shared master values.
