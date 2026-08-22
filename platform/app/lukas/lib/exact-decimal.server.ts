export type ExactDecimal = {
  coefficient: bigint;
  scale: number;
};

const decimalPattern = /^-?[0-9]+(?:\.[0-9]+)?$/;

export function parseExactDecimal(value: string, field = "decimal") {
  if (!decimalPattern.test(value))
    throw new Error(`${field}가 lossless decimal 형식이 아닙니다.`);

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const significant = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  if (significant.length > 29 || fraction.length > 28)
    throw new Error(`${field}가 decimal 정밀도 범위를 벗어났습니다.`);

  return normalize({
    coefficient: BigInt(`${negative ? "-" : ""}${whole}${fraction}`),
    scale: fraction.length,
  });
}

export function addExact(left: ExactDecimal, right: ExactDecimal) {
  const scale = Math.max(left.scale, right.scale);
  return checked({
    coefficient:
      scaledCoefficient(left, scale) + scaledCoefficient(right, scale),
    scale,
  });
}

export function subtractExact(left: ExactDecimal, right: ExactDecimal) {
  const scale = Math.max(left.scale, right.scale);
  return checked({
    coefficient:
      scaledCoefficient(left, scale) - scaledCoefficient(right, scale),
    scale,
  });
}

export function multiplyExact(left: ExactDecimal, right: ExactDecimal) {
  return checked({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  });
}

export function roundExact(
  value: ExactDecimal,
  scale: number,
  mode: "half_away_from_zero" | "truncate",
) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 28)
    throw new Error("반올림 자리수는 0부터 28 사이의 정수여야 합니다.");
  if (value.scale <= scale) return checked(value);

  const divisor = 10n ** BigInt(value.scale - scale);
  let coefficient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;
  if (
    mode === "half_away_from_zero" &&
    (remainder < 0n ? -remainder : remainder) * 2n >= divisor
  )
    coefficient += value.coefficient < 0n ? -1n : 1n;
  return checked({ coefficient, scale });
}

export function equalExact(left: ExactDecimal, right: ExactDecimal) {
  const scale = Math.max(left.scale, right.scale);
  return scaledCoefficient(left, scale) === scaledCoefficient(right, scale);
}

export function compareExact(left: ExactDecimal, right: ExactDecimal) {
  const scale = Math.max(left.scale, right.scale);
  const a = scaledCoefficient(left, scale);
  const b = scaledCoefficient(right, scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function exactToString(value: ExactDecimal) {
  const normalized = normalize(value);
  const negative = normalized.coefficient < 0n;
  const digits = (
    negative ? -normalized.coefficient : normalized.coefficient
  ).toString();
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(normalized.scale + 1, "0");
  const split = padded.length - normalized.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

export const exactZero: ExactDecimal = { coefficient: 0n, scale: 0 };

function scaledCoefficient(value: ExactDecimal, scale: number) {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

function normalize(value: ExactDecimal): ExactDecimal {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function checked(value: ExactDecimal): ExactDecimal {
  const normalized = normalize(value);
  const digits = (
    normalized.coefficient < 0n
      ? -normalized.coefficient
      : normalized.coefficient
  ).toString().length;
  if (digits > 29 || normalized.scale > 28)
    throw new Error("계산 결과가 decimal 정밀도 범위를 벗어났습니다.");
  return normalized;
}
