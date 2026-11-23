/**
 * Unified PIN security and validation utilities.
 *
 * Provides a single source of truth for weak-PIN detection across all
 * wallet creation, restoration, reset, and change flows.
 */

// Known common and predictable 6-digit PIN patterns from security studies and leaks
const COMMON_WEAK_PINS: ReadonlySet<string> = new Set([
  // Sequential runs (both directions)
  '123456',
  '654321',
  '012345',
  '543210',
  '987654',
  '234567',
  '765432',
  '345678',
  '876543',
  '456789',
  '567890',
  '098765',

  // All identical digits
  '000000',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',

  // Repeated 2-digit patterns
  '121212',
  '131313',
  '141414',
  '151515',
  '161616',
  '171717',
  '181818',
  '191919',
  '212121',
  '232323',
  '242424',
  '252525',
  '696969',
  '010101',
  '101010',

  // Repeated 3-digit patterns
  '123123',
  '321321',
  '456456',
  '654654',
  '789789',
  '987987',

  // Paired and mirrored runs
  '112233',
  '332211',
  '111222',
  '222111',
  '333222',
  '222333',
  '123321',
  '654456',

  // Arithmetic steps & keypad patterns
  '246802',
  '135791',
  '135790',
  '024680',
  '147258', // keypad col 1 & 2
  '258369', // keypad col 2 & 3
  '369258',
  '147369', // keypad col 1 & 3
  '258147',
  '741852',
  '852963',
  '963852',
  '159357', // keypad diagonals
  '357159',
  '159753',
  '753951',
  '159951',
  '258025',
  '258012',
  '085208',

  // Popular / novelty numbers
  '000007',
  '007007',
  '420420',
  '666999',
]);

/**
 * Checks if all digits in a 6-digit PIN are identical (e.g. 111111).
 */
function hasAllRepeatedDigits(pin: string): boolean {
  return /^(\d)\1{5}$/.test(pin);
}

/**
 * Checks if the PIN contains 4 or more identical consecutive digits (e.g. 111123, 900000).
 */
function hasConsecutiveRepeatedDigits(pin: string): boolean {
  return /(\d)\1{3,}/.test(pin);
}

/**
 * Checks if the PIN consists of repeating 2-digit or 3-digit sub-patterns (e.g. 121212, 123123)
 * or paired digits (e.g. 112233).
 */
function hasRepeatedPatterns(pin: string): boolean {
  // 2-digit repeated: 121212
  if (/^(\d{2})\1\1$/.test(pin)) return true;
  // 3-digit repeated: 123123
  if (/^(\d{3})\1$/.test(pin)) return true;
  // 3 pairs: 112233
  if (/^(\d)\1(\d)\2(\d)\3$/.test(pin)) return true;
  return false;
}

/**
 * Checks if the PIN contains a run of 4 or more ascending or descending digits.
 * Handles both strict sequences (1234, 4321) and modular wrapping (9012, 2109).
 */
function hasAscendingOrDescendingRun(pin: string): boolean {
  const digits = pin.split('').map(Number);

  for (let start = 0; start <= digits.length - 4; start++) {
    let isAsc = true;
    let isDesc = true;
    for (let i = start + 1; i < start + 4; i++) {
      if ((digits[i - 1] + 1) % 10 !== digits[i]) {
        isAsc = false;
      }
      if ((digits[i - 1] - 1 + 10) % 10 !== digits[i]) {
        isDesc = false;
      }
    }
    if (isAsc || isDesc) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether a string is a valid calendar date.
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Checks if the PIN resembles common birthday patterns:
 * 1. YYYYMM / MMYYYY (4-digit birth year 1920-2029 with 2-digit valid month)
 * 2. YYYYDD / DDYYYY (4-digit birth year 1920-2029 with 2-digit valid day)
 * 3. DDMMYY / MMDDYY / YYMMDD (6-digit date with 2-digit birth year 30-99 or 00-25)
 */
function hasBirthdayPattern(pin: string): boolean {
  // 1. Year (1920..2029) + Month (01..12)
  const first4 = parseInt(pin.slice(0, 4), 10);
  const last2 = parseInt(pin.slice(4), 10);
  if (first4 >= 1920 && first4 <= 2029 && last2 >= 1 && last2 <= 12) {
    return true;
  }

  // 2. Month (01..12) + Year (1920..2029)
  const first2 = parseInt(pin.slice(0, 2), 10);
  const last4 = parseInt(pin.slice(2), 10);
  if (last4 >= 1920 && last4 <= 2029 && first2 >= 1 && first2 <= 12) {
    return true;
  }

  // 3. Year (1920..2029) + Day (01..31)
  if (first4 >= 1920 && first4 <= 2029 && last2 >= 1 && last2 <= 31) {
    return true;
  }

  // 4. Day (01..31) + Year (1920..2029)
  if (last4 >= 1920 && last4 <= 2029 && first2 >= 1 && first2 <= 31) {
    return true;
  }

  // 5. Full dates with 2-digit birth years:
  // Plausible birth year 2-digit representation (e.g. 1930 - 2025 -> 30..99 or 00..25)
  const p1 = parseInt(pin.slice(0, 2), 10);
  const p2 = parseInt(pin.slice(2, 4), 10);
  const p3 = parseInt(pin.slice(4, 6), 10);

  const isBirthYear2Digit = (yy: number) => (yy >= 30 && yy <= 99) || (yy >= 0 && yy <= 25);

  // MMDDYY
  if (isBirthYear2Digit(p3) && isValidDate(2000 + p3, p1, p2)) {
    return true;
  }

  // DDMMYY
  if (isBirthYear2Digit(p3) && isValidDate(2000 + p3, p2, p1)) {
    return true;
  }

  // YYMMDD
  if (isBirthYear2Digit(p1) && isValidDate(2000 + p1, p2, p3)) {
    return true;
  }

  return false;
}

/**
 * Determines whether a 6-digit PIN is considered weak.
 *
 * A PIN is weak if it:
 * - is not exactly 6 digits
 * - consists of repeated digits (all same, 4+ in a row, repeating pairs/triplets)
 * - contains ascending or descending runs of 4+ numbers (e.g. 123456, 654321, 123490)
 * - is in a known dictionary of high-frequency / easily guessed PINs
 * - matches common birthday patterns (e.g. 199512, 121995, 251295, 122595)
 */
export function isWeakPin(pin: string): boolean {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    return true;
  }

  if (COMMON_WEAK_PINS.has(pin)) {
    return true;
  }

  if (hasAllRepeatedDigits(pin)) {
    return true;
  }

  if (hasConsecutiveRepeatedDigits(pin)) {
    return true;
  }

  if (hasRepeatedPatterns(pin)) {
    return true;
  }

  if (hasAscendingOrDescendingRun(pin)) {
    return true;
  }

  if (hasBirthdayPattern(pin)) {
    return true;
  }

  return false;
}
