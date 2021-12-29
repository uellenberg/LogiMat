//This file provides fills for some functions that don't exist in piecewise (select, etc).

export default `
inline function select(a) {
    state = a != 0;
}

inline function notSelect(a) {
    state = a == 0;
}

inline function not(a) {
    state = a == 0;
}

inline function nand(a, b) {
    state = not(and(a, b));
}

inline function nor(a, b) {
    state = not(or(a, b));
}

inline function xor(a, b) {
    state = a != b;
}

inline function xnor(a, b) {
    state = a == b;
}

inline function isPositive(a) {
    state = a > 0;
}

inline function isPositiveOrZero(a) {
    state = a >= 0;
}

inline function isNegative(a) {
    state = a < 0;
}

inline function isNegativeOrZero(a) {
    state = a <= 0;
}

inline function isNaN(a) {
    //NaN is not equal to itself, so this will return 0 for normal numbers and 1 for NaN.
    state = a != a;
}
`;