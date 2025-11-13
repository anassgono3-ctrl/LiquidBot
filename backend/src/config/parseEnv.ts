/**
 * parseEnv.ts - Environment variable parsing utilities
 * 
 * Provides convenient functions for parsing boolean environment variables
 * with sensible defaults and clear parsing rules.
 */

/**
 * Parse a boolean value from a string
 * 
 * Accepts:
 * - true/1/yes/on (case-insensitive) -> true
 * - false/0/no/off (case-insensitive) -> false
 * - undefined/empty string -> defaultValue
 * 
 * @param value - The string value to parse
 * @param defaultValue - The default value to return if value is undefined or empty (default: false)
 * @returns The parsed boolean value
 */
export function parseBoolEnv(value?: string, defaultValue: boolean = false): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const trimmed = value.trim().toLowerCase();
  
  if (trimmed === '') {
    return defaultValue;
  }

  // True values
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes' || trimmed === 'on') {
    return true;
  }

  // False values
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no' || trimmed === 'off') {
    return false;
  }

  // Unknown value, use default
  return defaultValue;
}

/**
 * Parse a boolean environment variable by key
 * 
 * Convenience function that reads process.env[key] and parses it as a boolean.
 * 
 * @param key - The environment variable key to read
 * @param defaultValue - The default value to return if the variable is not set (default: false)
 * @returns The parsed boolean value
 */
export function parseBoolEnvVar(key: string, defaultValue: boolean = false): boolean {
  return parseBoolEnv(process.env[key], defaultValue);
}
