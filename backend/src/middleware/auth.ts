// Authentication middleware
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '../config/index.js';

export interface AuthRequest extends Request {
  user?: {
    address: string;
  };
}

/**
 * Authenticate via API key or JWT Bearer token
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  // Check for API key in header
  const apiKey = req.header('x-api-key');
  if (apiKey === config.apiKey) {
    return next();
  }

  // Check for JWT Bearer token
  const authHeader = req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { address: string };
      req.user = { address: decoded.address };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}
