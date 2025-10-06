// Rate limiting middleware
import rateLimit from 'express-rate-limit';

import { config } from '../config/index.js';

/**
 * Rate limiter: 120 requests per minute
 */
export const rateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
