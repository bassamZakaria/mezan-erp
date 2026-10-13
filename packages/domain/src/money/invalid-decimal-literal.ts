export enum DecimalErrorCode {
  InvalidLiteral = "INVALID_DECIMAL",
}

export class InvalidDecimalLiteralError extends RangeError {
  readonly code = DecimalErrorCode.InvalidLiteral;
  readonly messageAr = "قيمة رقمية غير صالحة: المبالغ والكميات والأسعار تُكتب رقماً عشرياً بأرقام لاتينية، بست خانات عشرية على الأكثر، بلا أُس ولا مسافات ولا فواصل.";
  readonly messageEn = "Not a valid number: an amount, quantity or price is an exact decimal with at most six decimal places, no exponent, no spaces, no separators.";
  constructor(message: string, readonly literal: string) {
    super(message);
    this.name = "InvalidDecimalLiteralError";
  }
}
