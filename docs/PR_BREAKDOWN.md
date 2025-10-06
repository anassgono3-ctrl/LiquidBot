# Initial PR Breakdown (Recommended Sequencing)

This document outlines the recommended sequence of Pull Requests (PRs) for implementing the Phase 2 MVP features. Each PR is scoped to deliver specific, testable functionality while minimizing dependencies and cognitive overhead.

## PR Sequence

| PR | Focus | Deliverables |
|----|-------|--------------|
| 1 | Contract Scaffolds | FlashLoanOrchestrator, PositionManager, FeeCollector, EmergencyPause (interfaces + basic logic) |
| 2 | Subgraph & HF Engine | Poller service, HF calculator, risk threshold triggers |
| 3 | Protection Prototype | Mock flash refinance flow, slippage guard, gas profiler |
| 4 | Subscription + Fees | Tier model, fee computation, event logging |
| 5 | API Layer (Phase 1) | Auth (JWT or API key), REST endpoints, WebSocket skeleton |
| 6 | Testing Baseline | Unit + integration harness, coverage reports |
| 7 | Documentation & Hardening | OpenAPI 3.0 draft, developer guide, security prep outline |

## PR Details

### PR 1: Contract Scaffolds
**Goal**: Establish the foundational smart contract structure

**Deliverables**:
- `FlashLoanOrchestrator.sol` - Interface and basic logic for coordinating flash loan operations
- `PositionManager.sol` - User subscription and position tracking contract
- `FeeCollector.sol` - Revenue distribution and fee management
- `EmergencyPause.sol` - Circuit breaker functionality for system safety

**Dependencies**: None

**Estimated Effort**: 3-5 days

---

### PR 2: Subgraph & HF Engine
**Goal**: Enable real-time position monitoring and risk detection

**Deliverables**:
- Subgraph polling service for Aave V3 Base positions
- Health Factor (HF) calculation engine
- Risk threshold detection logic (HF < 1.10 alert, HF < 1.05 emergency)
- Multi-asset position tracking

**Dependencies**: None (can run in parallel with PR 1)

**Estimated Effort**: 4-6 days

---

### PR 3: Protection Prototype
**Goal**: Implement core protection mechanisms

**Deliverables**:
- Mock flash loan refinancing flow
- Slippage protection guard (max 2%)
- Gas cost profiler and optimizer
- Position refinancing simulation

**Dependencies**: PR 1 (contracts), PR 2 (HF engine)

**Estimated Effort**: 5-7 days

---

### PR 4: Subscription + Fees
**Goal**: Build revenue and subscription management

**Deliverables**:
- Subscription tier model (Basic/Premium/Enterprise)
- Fee computation engine (0.15% refinancing, 0.5% emergency)
- Event logging for billing and analytics
- User tier management endpoints

**Dependencies**: PR 1 (FeeCollector contract)

**Estimated Effort**: 3-5 days

---

### PR 5: API Layer (Phase 1)
**Goal**: Create the API foundation for user interactions

**Deliverables**:
- Authentication system (JWT or API key based)
- REST endpoints for position management
- WebSocket skeleton for real-time notifications
- Rate limiting and security middleware

**Dependencies**: PR 2 (HF engine), PR 4 (subscription system)

**Estimated Effort**: 4-6 days

---

### PR 6: Testing Baseline
**Goal**: Establish comprehensive test coverage

**Deliverables**:
- Unit test harness for all core modules
- Integration test suite
- Coverage reports (target >90%)
- CI/CD test automation

**Dependencies**: All previous PRs

**Estimated Effort**: 4-6 days

---

### PR 7: Documentation & Hardening
**Goal**: Prepare for production deployment

**Deliverables**:
- OpenAPI 3.0 specification
- Developer guide and integration examples
- Security audit preparation materials
- Deployment and operations documentation

**Dependencies**: All previous PRs

**Estimated Effort**: 3-4 days

## Implementation Notes

### Parallel Work Opportunities
- PRs 1 and 2 can be developed simultaneously (contracts vs. backend service)
- PR 4 can begin once PR 1 is merged, parallel to PR 3 development
- Documentation work (PR 7) can start during PR 5-6 development

### Critical Path
1. PR 1 (contracts foundation) → PR 3 (protection logic)
2. PR 2 (monitoring) → PR 3 (protection logic) → PR 5 (API)
3. PR 6 (testing) requires all feature PRs to be complete

### Best Practices
- Each PR should be self-contained and independently testable
- PRs should include relevant documentation updates
- Smart contract PRs must include comprehensive tests (>95% coverage)
- Backend PRs should include both unit and integration tests
- All PRs must pass linting and CI checks before merge

## Success Criteria

Each PR is considered complete when:
- [ ] All deliverables are implemented and functional
- [ ] Tests are written and passing (>80% coverage minimum)
- [ ] Code review is completed
- [ ] Documentation is updated
- [ ] CI/CD pipeline passes
- [ ] No breaking changes to existing functionality

## Timeline Estimate

**Total estimated time**: 26-39 days (5-8 weeks)
- Sequential execution: ~8 weeks
- With parallel execution: ~5-6 weeks

This breakdown supports the Phase 2 goal of delivering a functional MVP within 8 weeks as outlined in the [Phase 2 Core Implementation](./phase2-core-implementation.md) document.

## Related Documentation

- [Phase 2: Complete Core Implementation (MVP)](./phase2-core-implementation.md)
- [Project Specification](./SPEC.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
