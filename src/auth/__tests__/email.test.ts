import { looksLikeEmail, looksLikeEmailCode } from '../email';

describe('looksLikeEmail', () => {
  it.each(['bob@example.com', ' alexi@mail.co.uk ', 'a+b@c.io'])('accepts %s', (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });
  it.each(['', 'bob', 'bob@', 'bob@example', 'bo b@example.com'])('rejects %j', (value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });
});

describe('looksLikeEmailCode', () => {
  it.each(['123456', ' 12345678 ', '1234567890'])('accepts %j', (value) => {
    expect(looksLikeEmailCode(value)).toBe(true);
  });
  it.each(['', '12345', '12345a', '12345678901'])('rejects %j', (value) => {
    expect(looksLikeEmailCode(value)).toBe(false);
  });
});
