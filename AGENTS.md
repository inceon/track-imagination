# Engineering Guidelines

## Architecture

- Keep UI state local to the smallest component that owns it. Extract a hook only when state or behavior is genuinely shared.
- Separate route-domain calculations, UI rendering, and external routing integrations. Network providers must be behind a typed adapter rather than called from components.
- Prefer explicit TypeScript types for domain data and component boundaries; do not use `any`.
- Keep components focused on one responsibility. Split a component when a distinct area has its own state, interactions, or test surface.

## React conventions

- Use functional components and hooks. Keep effects for synchronization with external systems, never for ordinary derived state.
- Derive values with plain expressions first; use `useMemo` only for non-trivial computation or stable reference requirements.
- Use accessible native controls, visible labels, meaningful button text, and `aria-label` for icon-only actions.
- Model async flows with explicit loading, success, empty, and error states.

## Quality checks

Before submitting changes, run:

```bash
npm run build
npm run lint
npx -y react-doctor@latest . --verbose --scope changed
```

Verify modified interactions in a browser and keep all user-facing copy in English.
