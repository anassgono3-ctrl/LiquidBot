/**
 * Minimal event fragments for Aave V3 Pool events
 * Used for decoding on-chain events in real-time HF monitoring
 */

import { Interface } from 'ethers';

// Event signatures for Aave V3 Pool
export const AAVE_V3_EVENTS = [
  // Core user action events
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)',
  
  // Liquidation event (for logging)
  'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)',
  
  // Optional reserve/protocol events
  'event ReserveDataUpdated(address indexed reserve, uint256 liquidityRate, uint256 stableBorrowRate, uint256 variableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex)',
  'event FlashLoan(address indexed target, address indexed initiator, address indexed asset, uint256 amount, uint8 interestRateMode, uint256 premium, uint16 referralCode)'
];

// Chainlink AnswerUpdated event
export const CHAINLINK_EVENTS = [
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
];

// Create interfaces for event parsing
export const aaveV3Interface = new Interface(AAVE_V3_EVENTS);
export const chainlinkInterface = new Interface(CHAINLINK_EVENTS);

/**
 * Decoded event data structure
 */
export interface DecodedEvent {
  name: string;
  args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  signature: string;
}

/**
 * Event decoder function type
 */
export type EventDecoderFn = (topics: string[], data: string) => DecodedEvent | null;

/**
 * Event registry entry
 */
export interface EventRegistryEntry {
  name: string;
  signature: string;
  decodeFn: EventDecoderFn;
}

/**
 * EventRegistry - maps topic0 (event signature hash) to decoder info
 */
export class EventRegistry {
  private registry: Map<string, EventRegistryEntry> = new Map();

  constructor() {
    this.initializeAaveV3Events();
    this.initializeChainlinkEvents();
  }

  /**
   * Initialize Aave V3 Pool event decoders
   */
  private initializeAaveV3Events(): void {
    const events = ['Borrow', 'Repay', 'Supply', 'Withdraw', 'LiquidationCall', 'ReserveDataUpdated', 'FlashLoan'];
    
    for (const eventName of events) {
      const fragment = aaveV3Interface.getEvent(eventName);
      if (fragment) {
        const topic0 = fragment.topicHash;
        const signature = fragment.format('sighash');
        
        this.registry.set(topic0, {
          name: eventName,
          signature,
          decodeFn: (topics: string[], data: string): DecodedEvent | null => {
            try {
              const parsed = aaveV3Interface.parseLog({ topics, data });
              if (!parsed) return null;
              
              // Convert Result to plain object, including both indexed and non-indexed params
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const args: { [key: string]: any } = {};
              parsed.args.forEach((value, index) => {
                const fragment = parsed.fragment;
                const paramName = fragment.inputs[index].name;
                if (paramName) {
                  args[paramName] = value;
                }
              });
              
              return {
                name: parsed.name,
                args,
                signature
              };
            } catch (err) {
              return null;
            }
          }
        });
      }
    }
  }

  /**
   * Initialize Chainlink AnswerUpdated event decoder
   */
  private initializeChainlinkEvents(): void {
    const fragment = chainlinkInterface.getEvent('AnswerUpdated');
    if (fragment) {
      const topic0 = fragment.topicHash;
      const signature = fragment.format('sighash');
      
      this.registry.set(topic0, {
        name: 'AnswerUpdated',
        signature,
        decodeFn: (topics: string[], data: string): DecodedEvent | null => {
          try {
            const parsed = chainlinkInterface.parseLog({ topics, data });
            if (!parsed) return null;
            
            // Convert Result to plain object, including both indexed and non-indexed params
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const args: { [key: string]: any } = {};
            parsed.args.forEach((value, index) => {
              const fragment = parsed.fragment;
              const paramName = fragment.inputs[index].name;
              if (paramName) {
                args[paramName] = value;
              }
            });
            
            return {
              name: parsed.name,
              args,
              signature
            };
          } catch (err) {
            return null;
          }
        }
      });
    }
  }

  /**
   * Get event registry entry by topic0
   */
  get(topic0: string): EventRegistryEntry | undefined {
    return this.registry.get(topic0);
  }

  /**
   * Decode an event log
   */
  decode(topics: string[], data: string): DecodedEvent | null {
    if (topics.length === 0) return null;
    
    const topic0 = topics[0];
    const entry = this.registry.get(topic0);
    
    if (!entry) return null;
    
    return entry.decodeFn(topics, data);
  }

  /**
   * Check if topic0 is registered
   */
  has(topic0: string): boolean {
    return this.registry.has(topic0);
  }

  /**
   * Get all registered topic0 values
   */
  getAllTopics(): string[] {
    return Array.from(this.registry.keys());
  }
}

/**
 * Singleton event registry instance
 */
export const eventRegistry = new EventRegistry();

/**
 * Helper function to extract user address from decoded Aave event
 */
export function extractUserFromAaveEvent(decoded: DecodedEvent): string[] {
  const users: string[] = [];
  
  switch (decoded.name) {
    case 'Borrow':
      // Primary user and onBehalfOf
      if (decoded.args.user) users.push(decoded.args.user.toLowerCase());
      if (decoded.args.onBehalfOf && decoded.args.onBehalfOf !== decoded.args.user) {
        users.push(decoded.args.onBehalfOf.toLowerCase());
      }
      break;
      
    case 'Repay':
      // User being repaid and repayer (if different)
      if (decoded.args.user) users.push(decoded.args.user.toLowerCase());
      if (decoded.args.repayer && decoded.args.repayer !== decoded.args.user) {
        users.push(decoded.args.repayer.toLowerCase());
      }
      break;
      
    case 'Supply':
      // Primary user and onBehalfOf
      if (decoded.args.user) users.push(decoded.args.user.toLowerCase());
      if (decoded.args.onBehalfOf && decoded.args.onBehalfOf !== decoded.args.user) {
        users.push(decoded.args.onBehalfOf.toLowerCase());
      }
      break;
      
    case 'Withdraw':
      // User withdrawing
      if (decoded.args.user) users.push(decoded.args.user.toLowerCase());
      break;
      
    case 'LiquidationCall':
      // User being liquidated
      if (decoded.args.user) users.push(decoded.args.user.toLowerCase());
      break;
      
    default:
      break;
  }
  
  return users;
}

/**
 * Helper function to extract reserve (asset) address from decoded Aave event
 */
export function extractReserveFromAaveEvent(decoded: DecodedEvent): string | null {
  switch (decoded.name) {
    case 'Borrow':
    case 'Repay':
    case 'Supply':
    case 'Withdraw':
    case 'ReserveDataUpdated':
      return decoded.args.reserve?.toLowerCase() || null;
      
    case 'FlashLoan':
      return decoded.args.asset?.toLowerCase() || null;
      
    default:
      return null;
  }
}

/**
 * Helper function to extract amount from decoded Aave event
 */
export function extractAmountFromAaveEvent(decoded: DecodedEvent): bigint | null {
  return decoded.args.amount || null;
}

/**
 * Format decoded event for logging
 */
export function formatDecodedEvent(decoded: DecodedEvent, blockNumber?: number): string {
  const parts = [`[${decoded.name}]`];
  
  if (blockNumber) {
    parts.push(`block=${blockNumber}`);
  }
  
  switch (decoded.name) {
    case 'Borrow':
      parts.push(`user=${decoded.args.user}`);
      parts.push(`onBehalfOf=${decoded.args.onBehalfOf}`);
      parts.push(`reserve=${decoded.args.reserve}`);
      parts.push(`amount=${decoded.args.amount?.toString()}`);
      break;
      
    case 'Repay':
      parts.push(`user=${decoded.args.user}`);
      parts.push(`repayer=${decoded.args.repayer}`);
      parts.push(`reserve=${decoded.args.reserve}`);
      parts.push(`amount=${decoded.args.amount?.toString()}`);
      break;
      
    case 'Supply':
      parts.push(`user=${decoded.args.user}`);
      parts.push(`onBehalfOf=${decoded.args.onBehalfOf}`);
      parts.push(`reserve=${decoded.args.reserve}`);
      parts.push(`amount=${decoded.args.amount?.toString()}`);
      break;
      
    case 'Withdraw':
      parts.push(`user=${decoded.args.user}`);
      parts.push(`to=${decoded.args.to}`);
      parts.push(`reserve=${decoded.args.reserve}`);
      parts.push(`amount=${decoded.args.amount?.toString()}`);
      break;
      
    case 'LiquidationCall':
      parts.push(`user=${decoded.args.user}`);
      parts.push(`liquidator=${decoded.args.liquidator}`);
      parts.push(`collateral=${decoded.args.collateralAsset}`);
      parts.push(`debt=${decoded.args.debtAsset}`);
      parts.push(`debtCovered=${decoded.args.debtToCover?.toString()}`);
      parts.push(`collateralLiquidated=${decoded.args.liquidatedCollateralAmount?.toString()}`);
      break;
      
    case 'AnswerUpdated':
      parts.push(`current=${decoded.args.current?.toString()}`);
      parts.push(`roundId=${decoded.args.roundId?.toString()}`);
      break;
      
    default:
      // Generic formatting for other events
      Object.entries(decoded.args).forEach(([key, value]) => {
        parts.push(`${key}=${String(value)}`);
      });
  }
  
  return parts.join(' ');
}
