/**
 * PriceWindow: Ring buffer for price series with EMA and volatility calculation
 */

export interface PricePoint {
  price: number;
  timestamp: number;
  block: number;
}

export class PriceWindow {
  private readonly symbol: string;
  private readonly maxSize: number;
  private prices: PricePoint[] = [];

  constructor(symbol: string, maxSize = 60) {
    this.symbol = symbol;
    this.maxSize = maxSize;
  }

  public add(price: number, timestamp: number, block: number): void {
    this.prices.push({ price, timestamp, block });
    
    // Trim to max size (ring buffer behavior)
    if (this.prices.length > this.maxSize) {
      this.prices.shift();
    }
  }

  public getLatest(): PricePoint | null {
    return this.prices.length > 0 ? this.prices[this.prices.length - 1] : null;
  }

  public getEMA(periods: number): number | null {
    if (this.prices.length < periods) {
      return null;
    }

    const relevantPrices = this.prices.slice(-periods);
    const multiplier = 2 / (periods + 1);
    
    let ema = relevantPrices[0].price;
    for (let i = 1; i < relevantPrices.length; i++) {
      ema = (relevantPrices[i].price - ema) * multiplier + ema;
    }

    return ema;
  }

  public getVolatility(periods: number): number | null {
    if (this.prices.length < periods + 1) {
      return null;
    }

    const relevantPrices = this.prices.slice(-periods);
    const returns: number[] = [];
    
    for (let i = 1; i < relevantPrices.length; i++) {
      const ret = (relevantPrices[i].price - relevantPrices[i - 1].price) / relevantPrices[i - 1].price;
      returns.push(ret);
    }

    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  public getSymbol(): string {
    return this.symbol;
  }

  public size(): number {
    return this.prices.length;
  }
}
