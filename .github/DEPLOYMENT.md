# Deployment Setup

This document explains how to set up automated deployment to NPM using GitHub Actions.

## Required Secrets

To enable automatic NPM publishing, you need to configure the following secrets in your GitHub repository:

### 1. NPM_TOKEN

1. Go to [npmjs.com](https://www.npmjs.com) and log in to your account
2. Navigate to "Access Tokens" in your account settings
3. Click "Generate New Token" → "Classic Token"
4. Select "Automation" (for publishing from CI/CD)
5. Copy the generated token
6. In your GitHub repository, go to Settings → Secrets and variables → Actions
7. Click "New repository secret"
8. Name: `NPM_TOKEN`
9. Value: paste your NPM token

### 2. GITHUB_TOKEN

This is automatically provided by GitHub Actions, no setup required.

## How the Deployment Works

### CI Workflow (`.github/workflows/ci.yml`)
- Runs on every pull request and push to main
- Tests the code with Bun
- Checks Node.js compatibility (versions 18, 20, 22)
- Validates package.json and required files
- Runs coverage tests

### Deploy Workflow (`.github/workflows/deploy.yml`)
- Runs only on pushes to the `main` branch
- Only deploys if relevant files have changed:
  - `$.mjs` (main library file)
  - `$.test.mjs` (test file)
  - `package.json` (package configuration)
  - `README.md` (documentation)
  - `.github/workflows/deploy.yml` (deployment config)

### Deployment Process
1. **Change Detection**: Checks if relevant files changed
2. **Testing**: Runs full test suite with coverage
3. **Version Check**: Verifies if the current version already exists on NPM
4. **Publishing**: If version doesn't exist, publishes to NPM
5. **Release Creation**: Creates a GitHub release with changelog

## Version Management

To release a new version:

1. Update the version in `package.json`:
   ```bash
   # For patch releases (bug fixes)
   npm version patch
   
   # For minor releases (new features)
   npm version minor
   
   # For major releases (breaking changes)
   npm version major
   ```

2. Push to main branch:
   ```bash
   git push origin main --tags
   ```

3. The GitHub Action will automatically:
   - Run tests
   - Check if the version exists on NPM
   - Publish if it's a new version
   - Create a GitHub release

## Manual Publishing

If you need to publish manually:

```bash
# Make sure you're logged in to NPM
npm login

# Publish the package
npm publish --access public
```

## Troubleshooting

### Common Issues

1. **NPM_TOKEN expired**: Generate a new token and update the secret
2. **Permission denied**: Ensure your NPM account has publish permissions for the package
3. **Version already exists**: Update the version in package.json
4. **Tests failing**: Fix the tests before the deployment will proceed

### Checking Deployment Status

- View workflow runs in the "Actions" tab of your GitHub repository
- Check NPM package status at: https://www.npmjs.com/package/command-stream
- Monitor GitHub releases in the "Releases" section of your repository