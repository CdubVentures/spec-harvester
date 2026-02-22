# Rename Propagation Diagrams

This folder contains frontend and backend rename propagation diagrams for brand/model rename saves.

## Files
- `frontend-rename-propagation.mmd`
- `frontend-rename-propagation.4k.png`
- `frontend-rename-propagation.svg`
- `backend-rename-propagation.mmd`
- `backend-rename-propagation.4k.png`
- `backend-rename-propagation.svg`

## Render (from repo root)

```bash
npx mmdc -i "implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.mmd" -o "implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.4k.png" -w 3840 -H 2160 -b white
npx mmdc -i "implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.mmd" -o "implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.svg"
npx mmdc -i "implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.mmd" -o "implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.4k.png" -w 3840 -H 2160 -b white
npx mmdc -i "implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.mmd" -o "implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.svg"
```
