# Contributing to LoveCapsule

This document outlines the development workflow for LoveCapsule.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- Expo CLI (`npm install -g expo-cli`)
- EAS CLI (`npm install -g eas-cli`)
- iOS Simulator (via Xcode) or physical device

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/lovecapsule.git
cd lovecapsule
npm install
```

### Environment Setup

Create a `.env` file based on `.env.example` and add your Supabase credentials.

## Development Workflow

### Starting a New Feature

```bash
# Ensure you're on main and up to date
git checkout main
git pull origin main

# Create a feature branch
git checkout -b feature/my-new-feature
```

### Branch Naming Convention

- `feature/` - New features (e.g., `feature/add-mood-selector`)
- `fix/` - Bug fixes (e.g., `fix/location-crash`)
- `chore/` - Maintenance tasks (e.g., `chore/update-deps`)
- `docs/` - Documentation updates (e.g., `docs/api-reference`)

### During Development

```bash
# Start the development server
npm start

# Run tests in watch mode (TDD)
npm run test:watch

# Check for lint errors
npm run lint

# Fix lint errors automatically
npm run lint:fix

# Run all validations before committing
npm run validate
```

### Running on Simulator

```bash
# Build for iOS simulator (first time or after native changes)
eas build --profile ios-simulator --platform ios

# Run the built app
eas build:run --platform ios
```

### Committing Changes

Pre-commit hooks automatically run:

- ESLint (with auto-fix)
- Prettier formatting
- TypeScript type checking (on push)

```bash
git add .
git commit -m "feat: add mood selector to entry form"
```

### Creating a Pull Request

```bash
# Push your branch
git push -u origin feature/my-new-feature
```

Then open a PR on GitHub. CI will automatically:

- Run ESLint
- Run TypeScript type checking
- Run all tests with coverage

### Merging

Once CI passes and you're satisfied with the changes:

1. Squash and merge via GitHub
2. Delete the feature branch

## Releasing to TestFlight

### Option 1: Manual Release

```bash
# Bump version in app.json (e.g., "1.0.1")
# Then commit and tag:
git add app.json
git commit -m "chore: bump version to 1.0.1"
git tag v1.0.1
git push origin main --tags
```

GitHub Actions will automatically:

1. Run all validations
2. Build for production
3. Submit to TestFlight

### Option 2: Direct Build (Debugging)

```bash
# Build manually
eas build --platform ios --profile production

# Submit manually
eas submit --platform ios --latest
```

## Available Scripts

| Script               | Description                      |
| -------------------- | -------------------------------- |
| `npm start`          | Start Expo development server    |
| `npm run lint`       | Run ESLint                       |
| `npm run lint:fix`   | Run ESLint with auto-fix         |
| `npm run format`     | Format code with Prettier        |
| `npm run typecheck`  | Run TypeScript type checking     |
| `npm run test`       | Run Jest tests                   |
| `npm run test:watch` | Run Jest in watch mode           |
| `npm run test:ci`    | Run Jest with coverage (CI mode) |
| `npm run validate`   | Run lint + typecheck + test      |

## Project Structure

```
lovecapsule/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Auth screens (sign-in, sign-up)
│   ├── (tabs)/            # Tab-based screens
│   │   ├── entries/       # Diary entries
│   │   ├── reveal/        # Anniversary reveal
│   │   └── settings/      # App settings
│   └── _layout.tsx        # Root layout
├── src/
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions
│   ├── providers/         # React context providers
│   └── types/             # TypeScript types
├── supabase/
│   └── migrations/        # Database migrations
└── assets/                # Static assets (images, fonts)
```

## Testing Strategy

### What to Test

1. **Utility functions** (`src/lib/`) - High priority, easy to test
2. **Custom hooks** (`src/hooks/`) - Business logic
3. **Critical user flows** - Reveal, pairing, entry creation

### What NOT to Test

- Third-party libraries
- Simple presentational components
- Styles and layout

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode (recommended during development)
npm run test:watch

# Run with coverage
npm run test:ci
```

## Troubleshooting

### ESLint errors on commit

The pre-commit hook runs ESLint with auto-fix. If there are errors that can't be auto-fixed:

```bash
npm run lint:fix
# Review and fix remaining issues manually
```

### TypeScript errors on push

The pre-push hook runs type checking. Fix any type errors before pushing:

```bash
npm run typecheck
```

### Build failures

1. Check the EAS build logs on expo.dev
2. Ensure all environment variables are set in EAS secrets
3. Try clearing the cache: `eas build --clear-cache`
