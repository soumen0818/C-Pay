import { isWeakPin } from '../../utils/pin';

describe('isWeakPin', () => {
  describe('acceptance criteria', () => {
    test('rejects 123456', () => {
      expect(isWeakPin('123456')).toBe(true);
    });
  });

  describe('format and length validation', () => {
    test('rejects PINs that are not 6 digits', () => {
      expect(isWeakPin('')).toBe(true);
      expect(isWeakPin('1')).toBe(true);
      expect(isWeakPin('12')).toBe(true);
      expect(isWeakPin('123')).toBe(true);
      expect(isWeakPin('1234')).toBe(true);
      expect(isWeakPin('12345')).toBe(true);
      expect(isWeakPin('1234567')).toBe(true);
    });

    test('rejects non-digit characters', () => {
      expect(isWeakPin('abcdef')).toBe(true);
      expect(isWeakPin('12345a')).toBe(true);
      expect(isWeakPin('12 456')).toBe(true);
      expect(isWeakPin('12-456')).toBe(true);
      expect(isWeakPin('12.456')).toBe(true);
    });

    test('handles non-string inputs safely', () => {
      expect(isWeakPin(null as any)).toBe(true);
      expect(isWeakPin(undefined as any)).toBe(true);
      expect(isWeakPin(123456 as any)).toBe(true);
      expect(isWeakPin({} as any)).toBe(true);
    });
  });

  describe('repeated digits', () => {
    test('rejects all identical 6-digit PINs', () => {
      const identicalPins = [
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
      ];
      identicalPins.forEach((pin) => {
        expect(isWeakPin(pin)).toBe(true);
      });
    });

    test('rejects 4 or more consecutive identical digits', () => {
      expect(isWeakPin('111123')).toBe(true);
      expect(isWeakPin('900000')).toBe(true);
      expect(isWeakPin('555512')).toBe(true);
      expect(isWeakPin('288882')).toBe(true);
    });

    test('rejects repeating 2-digit patterns', () => {
      expect(isWeakPin('121212')).toBe(true);
      expect(isWeakPin('696969')).toBe(true);
      expect(isWeakPin('010101')).toBe(true);
      expect(isWeakPin('232323')).toBe(true);
    });

    test('rejects repeating 3-digit patterns', () => {
      expect(isWeakPin('123123')).toBe(true);
      expect(isWeakPin('321321')).toBe(true);
      expect(isWeakPin('456456')).toBe(true);
      expect(isWeakPin('789789')).toBe(true);
    });

    test('rejects paired repeated digits', () => {
      expect(isWeakPin('112233')).toBe(true);
      expect(isWeakPin('332211')).toBe(true);
      expect(isWeakPin('111222')).toBe(true);
      expect(isWeakPin('222111')).toBe(true);
    });
  });

  describe('sequential runs', () => {
    test('rejects straight ascending runs', () => {
      expect(isWeakPin('012345')).toBe(true);
      expect(isWeakPin('123456')).toBe(true);
      expect(isWeakPin('234567')).toBe(true);
      expect(isWeakPin('345678')).toBe(true);
      expect(isWeakPin('456789')).toBe(true);
      expect(isWeakPin('567890')).toBe(true);
    });

    test('rejects straight descending runs', () => {
      expect(isWeakPin('654321')).toBe(true);
      expect(isWeakPin('543210')).toBe(true);
      expect(isWeakPin('987654')).toBe(true);
      expect(isWeakPin('876543')).toBe(true);
      expect(isWeakPin('765432')).toBe(true);
    });

    test('rejects runs containing 4+ sequential digits', () => {
      expect(isWeakPin('123498')).toBe(true);
      expect(isWeakPin('812349')).toBe(true);
      expect(isWeakPin('984321')).toBe(true);
      expect(isWeakPin('765492')).toBe(true);
    });
  });

  describe('common PINs and keypad patterns', () => {
    test('rejects keypad columns and diagonals', () => {
      expect(isWeakPin('147258')).toBe(true);
      expect(isWeakPin('258369')).toBe(true);
      expect(isWeakPin('369258')).toBe(true);
      expect(isWeakPin('159357')).toBe(true);
      expect(isWeakPin('159753')).toBe(true);
      expect(isWeakPin('753951')).toBe(true);
      expect(isWeakPin('258025')).toBe(true);
    });

    test('rejects arithmetic progressions', () => {
      expect(isWeakPin('246802')).toBe(true);
      expect(isWeakPin('135791')).toBe(true);
      expect(isWeakPin('135790')).toBe(true);
      expect(isWeakPin('024680')).toBe(true);
    });

    test('rejects popular novelty PINs', () => {
      expect(isWeakPin('000007')).toBe(true);
      expect(isWeakPin('007007')).toBe(true);
      expect(isWeakPin('420420')).toBe(true);
      expect(isWeakPin('123321')).toBe(true);
      expect(isWeakPin('654456')).toBe(true);
    });
  });

  describe('birthday-like patterns', () => {
    test('rejects YYYYMM (birth year + month)', () => {
      expect(isWeakPin('199512')).toBe(true);
      expect(isWeakPin('198805')).toBe(true);
      expect(isWeakPin('200108')).toBe(true);
    });

    test('rejects MMYYYY (month + birth year)', () => {
      expect(isWeakPin('121995')).toBe(true);
      expect(isWeakPin('051988')).toBe(true);
      expect(isWeakPin('082001')).toBe(true);
    });

    test('rejects full calendar dates (DDMMYY / MMDDYY / YYMMDD)', () => {
      expect(isWeakPin('150895')).toBe(true); // 15 Aug 1995
      expect(isWeakPin('081595')).toBe(true); // Aug 15 1995
      expect(isWeakPin('950815')).toBe(true); // 1995 Aug 15
      expect(isWeakPin('251295')).toBe(true); // 25 Dec 1995
      expect(isWeakPin('122595')).toBe(true); // Dec 25 1995
    });
  });

  describe('strong PINs', () => {
    test('accepts sufficiently random and non-patterned PINs', () => {
      const strongPins = [
        '839201',
        '749281',
        '395821',
        '582914',
        '948172',
        '482719',
        '629381',
        '381947',
        '719384',
      ];
      strongPins.forEach((pin) => {
        expect(isWeakPin(pin)).toBe(false);
      });
    });
  });
});
