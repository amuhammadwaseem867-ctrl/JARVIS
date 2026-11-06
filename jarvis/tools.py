"""Tools (commands) JARVIS can run.

Register a new skill anywhere in the app with the ``@registry.tool`` decorator::

    @brain.tools.tool(
        description="Turn a smart light on or off.",
        parameters={
            "room": {"type": "string", "description": "Which room"},
            "on": {"type": "boolean"},
        },
    )
    def set_light(room: str, on: bool) -> str:
        ...
        return f"Light in {room} is now {'on' if on else 'off'}."

The function's return value (any JSON-able value or string) is sent back to
Claude as the tool result. Raise an exception to report a failure; Claude sees
the error message and can explain it or try something else.
"""

from __future__ import annotations

import ast
import json
import math
import operator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .memory import FactStore


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    required: list[str]
    func: Callable[..., Any]

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "strict": True,
            "input_schema": {
                "type": "object",
                "properties": self.parameters,
                "required": self.required,
                "additionalProperties": False,
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def tool(
        self,
        description: str,
        parameters: dict[str, Any] | None = None,
        required: list[str] | None = None,
        name: str | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator that registers a function as a tool.

        ``required`` defaults to every parameter (strict tool schemas need
        an explicit list).
        """

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            params = parameters or {}
            self._tools[name or func.__name__] = Tool(
                name=name or func.__name__,
                description=description,
                parameters=params,
                required=list(params) if required is None else required,
                func=func,
            )
            return func

        return decorator

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> list[str]:
        return list(self._tools)

    def schemas(self) -> list[dict[str, Any]]:
        # Sorted so the tool list is byte-identical every request (cache-friendly).
        return [self._tools[n].schema() for n in sorted(self._tools)]

    def run(self, name: str, args: dict[str, Any]) -> tuple[str, bool]:
        """Run a tool. Returns ``(result_text, is_error)``."""
        tool = self._tools.get(name)
        if tool is None:
            return f"Unknown tool: {name}", True
        if not isinstance(args, dict):
            return "Tool input must be a JSON object.", True
        missing = [r for r in tool.required if r not in args]
        if missing:
            return f"Missing required argument(s): {', '.join(missing)}", True
        try:
            result = tool.func(**args)
        except Exception as exc:  # report any tool failure back to Claude
            return f"{type(exc).__name__}: {exc}", True
        if isinstance(result, str):
            return result, False
        return json.dumps(result, ensure_ascii=False, default=str), False


# ---------------------------------------------------------------------------
# Built-in tools
# ---------------------------------------------------------------------------

_OPS: dict[type, Callable[..., Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}
_FUNCS: dict[str, Any] = {
    name: getattr(math, name)
    for name in ("sqrt", "sin", "cos", "tan", "log", "log10", "exp", "floor", "ceil", "factorial")
} | {"abs": abs, "round": round, "pi": math.pi, "e": math.e}


def safe_eval(expression: str) -> float | int:
    """Evaluate arithmetic without ``eval`` (no names, imports or attributes)."""

    def walk(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            left, right = walk(node.left), walk(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 1000:
                raise ValueError("exponent too large")
            return _OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](walk(node.operand))
        if isinstance(node, ast.Name) and node.id in _FUNCS and not callable(_FUNCS[node.id]):
            return _FUNCS[node.id]
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and callable(_FUNCS.get(node.func.id))
            and not node.keywords
        ):
            return _FUNCS[node.func.id](*[walk(a) for a in node.args])
        raise ValueError(f"unsupported expression: {ast.unparse(node)}")

    return walk(ast.parse(expression, mode="eval"))


def register_builtin_tools(registry: ToolRegistry, facts: FactStore) -> None:
    @registry.tool(
        description=(
            "Get the current date and time. Pass an IANA timezone such as "
            "'Asia/Karachi' or 'Europe/London', or an empty string for the "
            "computer's local time."
        ),
        parameters={"timezone": {"type": "string", "description": "IANA timezone or ''"}},
    )
    def get_current_time(timezone: str) -> str:
        try:
            now = datetime.now(ZoneInfo(timezone)) if timezone else datetime.now().astimezone()
        except ZoneInfoNotFoundError:
            raise ValueError(f"unknown timezone '{timezone}'") from None
        return now.strftime("%A %d %B %Y, %H:%M:%S %Z (UTC%z)")

    @registry.tool(
        description=(
            "Evaluate an arithmetic expression exactly. Supports + - * / // % **, "
            "parentheses, pi, e, and sqrt, sin, cos, tan, log, log10, exp, floor, "
            "ceil, factorial, abs, round."
        ),
        parameters={"expression": {"type": "string", "description": "e.g. '(3+4)*sqrt(2)'"}},
    )
    def calculate(expression: str) -> str:
        return str(safe_eval(expression))

    @registry.tool(
        description=(
            "Save a fact to long-term memory so it is available in future "
            "conversations. Use a short descriptive key."
        ),
        parameters={
            "key": {"type": "string", "description": "e.g. 'sister birthday'"},
            "value": {"type": "string", "description": "e.g. '3 May'"},
        },
    )
    def remember(key: str, value: str) -> str:
        facts.remember(key, value)
        return f"Saved '{key}'."

    @registry.tool(
        description=(
            "Search long-term memory. Returns facts whose key or value contains "
            "all the words in the query. Use an empty query to list everything."
        ),
        parameters={"query": {"type": "string"}},
    )
    def recall(query: str) -> Any:
        found = facts.search(query)
        return found or "Nothing found in memory for that."

    @registry.tool(
        description="Delete a fact from long-term memory by its exact key.",
        parameters={"key": {"type": "string"}},
    )
    def forget(key: str) -> str:
        if facts.forget(key):
            return f"Forgot '{key}'."
        raise KeyError(f"no memory with key '{key}'")
