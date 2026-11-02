# Dawn of Worlds Mobile

A mobile app for playing Dawn of Worlds, the collaborative world-building game, with friends. You can play turn by turn over several days or in person around a shared tablet. It runs on iPhone, iPad and Android phones and tablets.

Planning lives in Jira (project **DOW**). Stories are grouped into the **MVP**, **v2** and **v3** releases. Labels say who should pick them up: `claude-ready`, `human`, or `either`.

## Stack

- [Expo](https://expo.dev) SDK 58 / React Native, [Expo Router](https://docs.expo.dev/router/introduction/) for navigation
- TypeScript (strict)
- Jest + `jest-expo` + React Native Testing Library
- ESLint (`eslint-config-expo`) + Prettier
- Backend (planned, DOW-13): Supabase

## Getting started

```bash
npm install
npm start          # then press i (iOS simulator), a (Android emulator) or w (web)
```

Scan the QR code with Expo Go to run it on your own phone or tablet.

## Scripts

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm start`         | Start the Expo dev server                              |
| `npm test`          | Run unit tests                                         |
| `npm run typecheck` | TypeScript type check                                  |
| `npm run lint`      | ESLint                                                 |
| `npm run format`    | Format all files with Prettier                         |
| `npm run check`     | Typecheck + lint + format check + tests (what CI runs) |

Add dependencies with `npx expo install <package>` so you get versions compatible with the SDK.

## Project layout

```
src/
  app/          Routes (Expo Router). Every file is a screen; _layout.tsx defines the tabs.
  components/   Shared UI components
  hooks/        React hooks
  layout/       Phone/tablet breakpoints
  navigation/   Tab definitions shared by native and web tab bars
  rules/        Pure TypeScript rules engine (no React), unit tested against the PDF rules
  constants/    Theme colors, spacing, fonts
```

### Phones vs tablets

`useLayoutMode()` returns `'phone'` or `'tablet'` (width ≥ 768). Phones show one screen per tab. On tablets, `<SplitView main={...} side={...} />` shows the main content (e.g. the map) with a side panel beside it.

## Contributing

1. Pick a story in Jira. Branch from `main` as `feature/DOW-<n>-short-name`.
2. Put the Jira key in the PR title, e.g. `DOW-12: App skeleton`, so Jira links it.
3. Run `npm run check` before opening the PR.

## Credits

Dawn of Worlds was created by N. Bob Pesall and "The Brosties" (first edition, 2005). This app implements the game's mechanics for personal play. It does not include or redistribute the rules document.
