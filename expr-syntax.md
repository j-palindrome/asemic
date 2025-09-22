# `expr` Syntax Description

The `expr` function parses and evaluates mathematical and logical expressions from strings. It supports a variety of operators, constants, and function calls. Below is an overview of its syntax and capabilities.

## Basic Syntax

- **Numbers:** `1`, `3.14`, `-2`
- **Arithmetic Operators:** `+`, `-`, `*`, `/`, `%`, `^`
- **Parentheses:** For grouping: `(1 + 2) * 3`
- **Comparison Operators:** `==`, `!=`, `<`, `>`, `<=`, `>=`
- **Logical Operators:** `&&`, `||`, `!`
- **Conditional (ternary):** `condition ? valueIfTrue : valueIfFalse`

## Constants

You can use built-in constants, such as:

- `N`, `I`, `i`, `T`, `!`, `H`, `Hpx`, `Wpx`, `S`, `C`, `L`, `P`, `px`
- Mathematical functions: `sin(x)`, `hash(x)`, `or(cond, trueVal, falseVal)`, etc.

## Function Calls

Functions can be called using their names and parentheses:

- `sin(x)`
- `table(name, point, channel)`
- `acc(x)`
- `~(speed, freq1, freq2, ...)`
- `tangent(progress, curve)`
- `hash(x)`

## Examples

```expr
1 + 2 * 3
sin(P)
N(1) / I(2)
or(P > 0.5, 1, 0)
!(C)
hash(L)
>(progress, 0, 1, 2)
```

## Notes

- All variables and functions are evaluated in the context of the current parser state.
- Custom constants and functions can be added via the parser API.
- Expressions can be nested and combined freely.
