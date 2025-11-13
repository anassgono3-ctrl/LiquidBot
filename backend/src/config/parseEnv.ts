/**
 * Environment variable parsing utilities with robust boolean/int/string handling
 * Addresses truthy coercion pitfalls where "false" string evaluates to true
 */

/**
 * Parse boolean environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default value if undefined/empty
 * @returns Parsed boolean
 */
export function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  const normalized = value.toLowerCase().trim();
  
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  
  // Invalid value - return default
  return defaultValue;
}

/**
 * Parse integer environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default value if undefined/empty/invalid
 * @param min - Optional minimum value
 * @param max - Optional maximum value
 * @returns Parsed integer
 */
export function parseIntEnv(
  value: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  
  if (isNaN(parsed)) {
    return defaultValue;
  }
  
  let result = parsed;
  
  if (min !== undefined && result < min) {
    result = min;
  }
  
  if (max !== undefined && result > max) {
    result = max;
  }
  
  return result;
}

/**
 * Get string environment variable with optional default
 * @param value - Environment variable value
 * @param defaultValue - Default value if undefined/empty
 * @returns String value or default
 */
export function getEnvString(
  value: string | undefined,
  defaultValue?: string
): string | undefined {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  
  return value.trim();
}

/**
 * Parse enum environment variable
 * @param value - Environment variable value
 * @param allowedValues - Array of allowed values
 * @param defaultValue - Default value if undefined/empty/invalid
 * @returns Parsed enum value
 */
export function parseEnumEnv<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  defaultValue: T
): T {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  const normalized = value.toLowerCase().trim() as T;
  
  if (allowedValues.includes(normalized)) {
    return normalized;
  }
  
  return defaultValue;
}
