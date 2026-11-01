# Changelog Update Skill

## Trigger
When the user says "Write to the changelog", "Update changelog", or similar.

## Workflow
1. Analyze all changes made in the current session
2. Determine the new version number (bump patch/minor/major based on changes)
3. Update `package.json` version
4. Add entry to `CHANGELOG.md` with:
   - Version header (## [x.y.z] - YYYY-MM-DD)
   - Categories: Added, Changed, Removed, Fixed, Security
   - Session summary with key changes
5. Run `npm run build:win` to build new EXE
6. Clean old EXE versions (keep only latest)
7. Start the new EXE for testing

## Version Bumping Rules
- **Patch** (x.y.Z): Bug fixes, small corrections, cleanup
- **Minor** (x.Y.z): New features, UI changes, new tabs/features
- **Major** (X.y.z): Breaking changes, architecture changes

## Changelog Format
```markdown
## [x.y.z] - YYYY-MM-DD

### Added
- Feature description

### Changed
- Change description

### Fixed
- Bug fix description

### Removed
- Removed feature

### Security
- Security-related changes
```

## Auto-Cleanup
After build, delete all `Orbit-Portable-*.exe` except the newest in `dist/`.

## Session Documentation
Always add a "Session Notes" section at the end of CHANGELOG.md with:
- Work request
- Steps taken
- Open topics / Known issues
