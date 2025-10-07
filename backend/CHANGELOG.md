# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Live polling falsely degrading due to Zod parse failures on numeric `timestamp`
- Liquidation schema now accepts numeric or string timestamp and normalizes to number
- Parse (Zod) errors no longer increment degradation counter
- Duplicate `SubgraphService` instantiation prevention (already enforced by buildRoutes)

### Changed
- Updated `LiquidationCallRawSchema` to accept `timestamp` as `number | string` with regex validation
- Updated `LiquidationReserveSchema` to properly handle `decimals` as `number | string` with regex validation
- Improved error serialization in debug mode for better visibility

### Added
- Subgraph polling loop with configurable interval (`SUBGRAPH_POLL_INTERVAL_MS`)
- Poller module (`polling/subgraphPoller.ts`) with DI and graceful shutdown
- Unit tests for poller behavior and error resilience

### Changed (Previous)
- Application startup (`index.ts`) now starts poller only in live mode
- Environment schema updated to include poll interval
