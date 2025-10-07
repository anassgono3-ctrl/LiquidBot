# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Subgraph polling loop with configurable interval (`SUBGRAPH_POLL_INTERVAL_MS`)
- Poller module (`polling/subgraphPoller.ts`) with DI and graceful shutdown
- Unit tests for poller behavior and error resilience

### Changed
- Application startup (`index.ts`) now starts poller only in live mode
- Environment schema updated to include poll interval
