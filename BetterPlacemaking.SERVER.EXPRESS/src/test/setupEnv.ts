// Test-only env so config/env.ts's required() checks pass without a real .env file.
process.env.JWT_KEY ??= "test-jwt-signing-key-not-for-production";
process.env.JWT_ISSUER ??= "BetterPlacemaking";
process.env.JWT_AUDIENCE ??= "BetterPlacemaking.Client";
process.env.ALLOWED_ORIGINS ??= "http://localhost:5173";
