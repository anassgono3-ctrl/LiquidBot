# Contributing to LiquidBot

Thank you for your interest in contributing to LiquidBot! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Security](#security)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors. We pledge to:

- Be respectful and considerate of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, discrimination, or offensive comments
- Trolling, insulting comments, or personal attacks
- Publishing others' private information without permission
- Any conduct that could reasonably be considered inappropriate

## Getting Started

### Prerequisites

- Node.js 18+ LTS
- PostgreSQL 14+
- Redis 7+
- Docker & Docker Compose (for local development)
- Git

### Setting Up Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/LiquidBot.git
   cd LiquidBot
   ```

2. **Install Dependencies** (when available)
   ```bash
   npm install
   ```

3. **Set Up Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

4. **Start Local Services**
   ```bash
   docker-compose up -d postgres redis
   ```

5. **Run Database Migrations** (when available)
   ```bash
   npm run migrate
   ```

6. **Run Tests**
   ```bash
   npm test
   ```

## Development Workflow

### Branch Naming Convention

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test additions or updates

Example: `feature/add-collateral-optimizer`

### Commit Message Format

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test additions or updates
- `chore`: Maintenance tasks

**Examples**:
```
feat(monitor): add health factor calculation module

Implement real-time health factor calculation using Aave V3
subgraph data and Chainlink price feeds.

Closes #123
```

```
fix(api): resolve authentication token expiry issue

JWT tokens were expiring prematurely due to incorrect timezone
handling. Updated token generation to use UTC timestamps.

Fixes #456
```

### Code Style

- Use TypeScript for all backend code
- Use ESLint and Prettier (configuration provided)
- Follow Airbnb JavaScript Style Guide (with TypeScript extensions)
- Maximum line length: 100 characters
- Use meaningful variable and function names

### Running Linters

```bash
# Check code style
npm run lint

# Auto-fix style issues
npm run lint:fix

# Format code with Prettier
npm run format
```

## Pull Request Process

### Before Submitting

1. **Update Documentation**: Ensure all changes are documented
2. **Write Tests**: Add tests for new features or bug fixes
3. **Run Tests**: Ensure all tests pass (`npm test`)
4. **Run Linters**: Ensure code passes linting (`npm run lint`)
5. **Update CHANGELOG**: Add entry for your changes (when applicable)

### Submitting a Pull Request

1. **Push Your Branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create Pull Request**
   - Go to the GitHub repository
   - Click "New Pull Request"
   - Select your branch
   - Fill out the PR template completely

3. **PR Title Format**
   ```
   [Type] Brief description
   ```
   Example: `[Feature] Add collateral optimization strategy`

4. **PR Description Template**
   ```markdown
   ## Description
   Brief description of changes

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   How has this been tested?

   ## Checklist
   - [ ] Code follows project style guidelines
   - [ ] Self-review completed
   - [ ] Comments added for complex code
   - [ ] Documentation updated
   - [ ] Tests added/updated
   - [ ] All tests passing
   - [ ] No new warnings
   ```

### Review Process

1. **Automated Checks**: CI/CD pipeline runs tests and linters
2. **Code Review**: At least one maintainer reviews your code
3. **Address Feedback**: Make requested changes and push updates
4. **Approval**: Once approved, maintainer will merge your PR

### After Merge

- Delete your feature branch (locally and remotely)
- Pull the latest changes from main
- Celebrate! 🎉

## Coding Standards

### TypeScript

```typescript
// ✅ Good
interface UserPosition {
  id: string;
  userId: string;
  healthFactor: number;
  totalCollateralETH: BigNumber;
}

async function calculateHealthFactor(
  positionId: string
): Promise<number> {
  // Implementation
}

// ❌ Bad
interface position {
  id: any;
  user: any;
  hf: any;
}

function calc(id) {
  // Implementation
}
```

### Error Handling

```typescript
// ✅ Good
async function fetchUserPosition(userId: string): Promise<Position> {
  try {
    const position = await db.getPosition(userId);
    if (!position) {
      throw new PositionNotFoundError(`Position not found: ${userId}`);
    }
    return position;
  } catch (error) {
    logger.error('Failed to fetch position', { userId, error });
    throw error;
  }
}

// ❌ Bad
async function fetchUserPosition(userId: string) {
  try {
    return await db.getPosition(userId);
  } catch (e) {
    console.log(e);
  }
}
```

### Logging

```typescript
// ✅ Good
logger.info('Position monitored', {
  positionId,
  healthFactor,
  timestamp: Date.now()
});

// ❌ Bad
console.log('Position monitored: ' + positionId);
```

### Testing

```typescript
// ✅ Good
describe('HealthFactorCalculator', () => {
  it('should calculate health factor correctly', async () => {
    const position = createMockPosition();
    const hf = await calculator.calculate(position);
    expect(hf).toBeCloseTo(1.5, 2);
  });

  it('should throw error for invalid position', async () => {
    await expect(calculator.calculate(null))
      .rejects.toThrow(InvalidPositionError);
  });
});
```

## Testing Guidelines

### Test Categories

1. **Unit Tests**: Test individual functions/components
2. **Integration Tests**: Test component interactions
3. **E2E Tests**: Test complete user workflows
4. **Smart Contract Tests**: Test contracts with Hardhat/Foundry

### Test Coverage Requirements

- Minimum 80% overall coverage
- 95%+ for critical paths (health factor calculation, intervention logic)
- 100% for smart contracts

### Writing Tests

```typescript
// Example unit test
import { calculateHealthFactor } from './calculator';

describe('calculateHealthFactor', () => {
  it('returns correct health factor for healthy position', () => {
    const position = {
      collateral: ethers.utils.parseEther('10'),
      debt: ethers.utils.parseEther('5'),
      liquidationThreshold: 0.8
    };
    
    const hf = calculateHealthFactor(position);
    expect(hf).toBe(1.6);
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- calculator.test.ts

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Documentation

### Code Documentation

Use JSDoc/TSDoc comments for functions and classes:

```typescript
/**
 * Calculates the health factor for an Aave position.
 * 
 * @param positionId - The unique identifier of the position
 * @returns The calculated health factor
 * @throws {PositionNotFoundError} If position doesn't exist
 * 
 * @example
 * ```typescript
 * const hf = await calculateHealthFactor('0x123...');
 * console.log(hf); // 1.5
 * ```
 */
async function calculateHealthFactor(
  positionId: string
): Promise<number> {
  // Implementation
}
```

### Smart Contract Documentation

Use NatSpec comments for contracts:

```solidity
/// @title Position Manager
/// @author LiquidBot Team
/// @notice Manages user position enrollment and preferences
/// @dev Implements access control and emergency pause
contract PositionManager {
    /// @notice Enrolls a new position for monitoring
    /// @param user The address of the position owner
    /// @param threshold The health factor threshold for alerts
    /// @return positionId The unique identifier of the enrolled position
    function enrollPosition(
        address user,
        uint256 threshold
    ) external returns (uint256 positionId) {
        // Implementation
    }
}
```

### README Updates

When adding new features, update the main README.md with:
- Feature description
- Usage examples
- Configuration options

## Security

### Reporting Security Issues

**DO NOT** create public GitHub issues for security vulnerabilities.

Instead, email security concerns to: [security@liquidbot.example] (placeholder)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Security Best Practices

1. **Never Commit Secrets**: Use environment variables
2. **Input Validation**: Validate all user inputs
3. **Access Control**: Implement proper authentication/authorization
4. **Rate Limiting**: Protect against abuse
5. **Audit Dependencies**: Run `npm audit` regularly

### Smart Contract Security

1. **Follow OpenZeppelin Standards**: Use audited libraries
2. **Reentrancy Guards**: Protect against reentrancy attacks
3. **Integer Overflow**: Use SafeMath or Solidity 0.8+
4. **Access Control**: Implement role-based permissions
5. **Testing**: Achieve 100% test coverage

## Community

### Communication Channels

- **GitHub Discussions**: General questions and discussions
- **GitHub Issues**: Bug reports and feature requests
- **Discord** (future): Real-time community chat
- **Twitter** (future): Project updates

### Getting Help

If you need help:
1. Check existing documentation
2. Search GitHub issues
3. Ask in GitHub Discussions
4. Reach out to maintainers

## Recognition

Contributors will be recognized in:
- CONTRIBUTORS.md file
- Release notes
- Project website (future)

Thank you for contributing to LiquidBot! 🚀
