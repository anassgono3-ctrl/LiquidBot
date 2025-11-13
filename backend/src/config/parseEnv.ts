/**
 * Utility functions for parsing environment variables with proper type handling
 * to avoid common pitfalls like treating "false" as truthy
 */

/**
 * Parse boolean environment variable with proper handling of string values.
 * 
 * Treats the following as FALSE (case-insensitive):
 * - "false", "0", "" (empty string), undefined
 * 
 * Treats the following as TRUE (case-insensitive):
 * - "true", "1", "yes"
 * 
 * @param value - The environment variable value
 * @param defaultValue - Default value if undefined or empty (default: false)
 * @returns Parsed boolean value
 */
export function parseBoolEnv(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();
  
  // Explicitly false values
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  
  // Explicitly true values
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  
  // For any other non-empty string, use default
  return defaultValue;
}

/**
 * Parse integer environment variable with default fallback
 * 
 * @param value - The environment variable value
 * @param defaultValue - Default value if undefined or invalid
 * @returns Parsed integer value
 */
export function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get environment variable with optional default
 * 
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Environment variable value or default
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}
