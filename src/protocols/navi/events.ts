/**
 * Typed NAVI on-chain event shapes.
 *
 * Schemas reproduced from naviprotocol/navi-smart-contracts (lending_core
 * package, `event.move`). `suix_queryEvents` returns each event's BCS-decoded
 * payload in `parsedJson` as a loose `Record<string, unknown>` — wrapping
 * that with a typed parser catches schema drift (renamed fields, dropped
 * fields) at the boundary rather than storing zeros in the DB.
 *
 * All integer-valued fields arrive as decimal strings or numbers. Callers
 * should feed them into `BigNumber(String(v))` before scaling, not `Number()`,
 * because u64/u256 values routinely exceed 2^53.
 */

export interface LiquidationEventParsed {
  sender: string;            // liquidator
  user: string;              // borrower
  collateral_asset: number;  // pool id (u8)
  collateral_price: string;  // u256, scaled 1e18
  collateral_amount: string; // u64, raw token units
  treasury: string;          // u64, raw token units (in collateral asset)
  debt_asset: number;        // pool id (u8)
  debt_price: string;        // u256, scaled 1e18
  debt_amount: string;       // u64, raw token units
  market_id: number;
}

export interface LiquidationCallEventParsed {
  reserve: number;           // pool id (u8)
  sender: string;            // liquidator
  liquidate_user: string;    // borrower
  liquidate_amount: string;  // u64, raw token units
  market_id: number;
}

export interface DepositEventParsed {
  reserve: number;
  sender: string;
  amount: string;
}

export interface WithdrawEventParsed {
  reserve: number;
  sender: string;
  to: string;
  amount: string;
}

export interface BorrowEventParsed {
  reserve: number;
  sender: string;
  amount: string;
}

export interface RepayEventParsed {
  reserve: number;
  sender: string;
  amount: string;
}

type UnknownEvent = Record<string, unknown>;

function requireField<K extends string>(
  obj: UnknownEvent,
  key: K,
  eventName: string
): unknown {
  if (!(key in obj)) {
    throw new Error(
      `NAVI ${eventName}: missing required field "${key}" (got keys: ${Object.keys(obj).join(', ')})`
    );
  }
  return obj[key];
}

/**
 * Typed parsers. Each throws with a clear message when a required field is
 * missing — callers (cron/backfill loops) should try/catch per-event and skip
 * bad rows rather than halting the whole batch.
 */
export function parseLiquidationEvent(raw: UnknownEvent): LiquidationEventParsed {
  return {
    sender:            String(requireField(raw, 'sender', 'LiquidationEvent')),
    user:              String(requireField(raw, 'user', 'LiquidationEvent')),
    collateral_asset:  Number(requireField(raw, 'collateral_asset', 'LiquidationEvent')),
    collateral_price:  String(requireField(raw, 'collateral_price', 'LiquidationEvent')),
    collateral_amount: String(requireField(raw, 'collateral_amount', 'LiquidationEvent')),
    treasury:          String(requireField(raw, 'treasury', 'LiquidationEvent')),
    debt_asset:        Number(requireField(raw, 'debt_asset', 'LiquidationEvent')),
    debt_price:        String(requireField(raw, 'debt_price', 'LiquidationEvent')),
    debt_amount:       String(requireField(raw, 'debt_amount', 'LiquidationEvent')),
    market_id:         Number(raw.market_id ?? 0),
  };
}

export function parseDepositEvent(raw: UnknownEvent): DepositEventParsed {
  return {
    reserve: Number(requireField(raw, 'reserve', 'DepositEvent')),
    sender:  String(requireField(raw, 'sender', 'DepositEvent')),
    amount:  String(requireField(raw, 'amount', 'DepositEvent')),
  };
}

export function parseBorrowEvent(raw: UnknownEvent): BorrowEventParsed {
  return {
    reserve: Number(requireField(raw, 'reserve', 'BorrowEvent')),
    sender:  String(requireField(raw, 'sender', 'BorrowEvent')),
    amount:  String(requireField(raw, 'amount', 'BorrowEvent')),
  };
}
