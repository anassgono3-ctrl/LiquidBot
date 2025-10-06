// Vitest global environment setup: ensure required secrets exist for test runs.
process.env.NODE_ENV = 'test';

if (!process.env.API_KEY) process.env.API_KEY = 'test-api-key';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret';

// Default to mock subgraph to avoid network calls in CI/local tests.
// Override in a specific test with: process.env.USE_MOCK_SUBGRAPH = 'false'
if (!process.env.USE_MOCK_SUBGRAPH) process.env.USE_MOCK_SUBGRAPH = 'true';
