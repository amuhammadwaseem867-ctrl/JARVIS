"""Tests for the brain, using a fake Claude client (no API key needed)."""

from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from jarvis import Brain, BrainConfig
from jarvis.tools import safe_eval


class Block(NS):
    def to_dict(self):
        return dict(vars(self))


def text(t):
    return Block(type="text", text=t)


def tool_use(id_, name, input_):
    return Block(type="tool_use", id=id_, name=name, input=input_)


def response(*content, stop_reason="end_turn"):
    return NS(content=list(content), stop_reason=stop_reason, model="claude-opus-5-5")


class FakeClient:
    """Returns scripted responses and records every request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.messages = NS(create=self._create)
        self.beta = NS(messages=NS(create=self._create))

    def _create(self, **params):
        # Snapshot messages: the brain keeps appending to the same list.
        params = {**params, "messages": [dict(m) for m in params["messages"]]}
        self.requests.append(params)
        return self.responses.pop(0)


def make_brain(tmp_path, *responses, **cfg):
    config = BrainConfig(data_dir=tmp_path, **cfg)
    client = FakeClient(*responses)
    return Brain(config=config, client=client), client


def test_plain_answer(tmp_path):
    brain, client = make_brain(tmp_path, response(text("Good afternoon.")))
    reply = brain.think("Hello JARVIS")

    assert reply.text == "Good afternoon."
    req = client.requests[0]
    assert req["model"] == "claude-opus-5-5"
    assert req["fallbacks"] == "default"
    assert req["betas"] == ["server-side-fallback-2026-07-01"]
    assert req["output_config"] == {"effort": "medium"}
    assert req["messages"] == [{"role": "user", "content": "Hello JARVIS"}]
    assert {t["name"] for t in req["tools"]} >= {"calculate", "get_current_time", "remember"}


def test_tool_loop_runs_tool_and_returns_final_answer(tmp_path):
    seen = []
    brain, client = make_brain(
        tmp_path,
        response(tool_use("t1", "calculate", {"expression": "6*7"}), stop_reason="tool_use"),
        response(text("It's 42.")),
    )
    brain.on_tool_call = seen.append

    reply = brain.think("What is 6 times 7?")

    assert reply.text == "It's 42."
    assert [c.result for c in reply.tool_calls] == ["42"]
    assert seen and seen[0].name == "calculate"
    second = client.requests[1]["messages"]
    assert second[-1] == {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "42", "is_error": False}
        ],
    }


def test_parallel_tool_calls_return_in_one_message(tmp_path):
    brain, client = make_brain(
        tmp_path,
        response(
            tool_use("a", "calculate", {"expression": "1+1"}),
            tool_use("b", "calculate", {"expression": "2+2"}),
            stop_reason="tool_use",
        ),
        response(text("2 and 4.")),
    )
    brain.think("two sums")
    results = client.requests[1]["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in results] == ["a", "b"]


def test_tool_errors_are_reported_not_raised(tmp_path):
    brain, client = make_brain(
        tmp_path,
        response(tool_use("t1", "no_such_tool", {}), stop_reason="tool_use"),
        response(text("Sorry.")),
    )
    reply = brain.think("do magic")
    assert reply.tool_calls[0].is_error
    assert client.requests[1]["messages"][-1]["content"][0]["is_error"] is True


def test_long_term_memory_survives_restart(tmp_path):
    brain, _ = make_brain(
        tmp_path,
        response(
            tool_use("t1", "remember", {"key": "Sister birthday", "value": "3 May"}),
            stop_reason="tool_use",
        ),
        response(text("Noted.")),
    )
    brain.think("Remember my sister's birthday is 3 May")

    brain2, _ = make_brain(tmp_path)
    assert brain2.facts.search("birthday") == {"sister birthday": "3 May"}
    # Conversation history is persisted too.
    assert len(brain2.memory) == 4


def test_refusal_rolls_back_the_turn(tmp_path):
    brain, _ = make_brain(tmp_path, response(stop_reason="refusal"))
    reply = brain.think("something declined")
    assert reply.refused
    assert len(brain.memory) == 0


def test_api_error_rolls_back_the_turn(tmp_path):
    brain, client = make_brain(tmp_path)

    def boom(**_):
        raise RuntimeError("network down")

    client.beta.messages.create = boom
    with pytest.raises(RuntimeError):
        brain.think("hello")
    assert len(brain.memory) == 0


def test_tool_round_limit(tmp_path):
    loop = [
        response(tool_use(f"t{i}", "calculate", {"expression": "1"}), stop_reason="tool_use")
        for i in range(3)
    ]
    brain, _ = make_brain(tmp_path, *loop, max_tool_rounds=3)
    reply = brain.think("loop forever")
    assert reply.stop_reason == "max_tool_rounds"


def test_fallbacks_can_be_disabled(tmp_path):
    brain, client = make_brain(tmp_path, response(text("ok")), use_fallbacks=False)
    brain.think("hi")
    assert "fallbacks" not in client.requests[0]


def test_custom_tool_registration(tmp_path):
    brain, _ = make_brain(tmp_path)

    @brain.tools.tool(
        description="Turn a light on or off.",
        parameters={"room": {"type": "string"}, "on": {"type": "boolean"}},
    )
    def set_light(room: str, on: bool) -> str:
        return f"{room} light {'on' if on else 'off'}"

    schema = next(s for s in brain.tools.schemas() if s["name"] == "set_light")
    assert schema["strict"] is True
    assert schema["input_schema"]["required"] == ["room", "on"]
    assert brain.tools.run("set_light", {"room": "kitchen", "on": True}) == ("kitchen light on", False)


@pytest.mark.parametrize(
    "expr,expected",
    [("2+3*4", 14), ("(1+2)**2", 9), ("sqrt(16)", 4.0), ("round(pi, 2)", 3.14), ("-5 % 3", 1)],
)
def test_safe_eval(expr, expected):
    assert safe_eval(expr) == expected


@pytest.mark.parametrize("expr", ["__import__('os')", "open('x')", "(1).real", "9**99999"])
def test_safe_eval_rejects_unsafe(expr):
    with pytest.raises(ValueError):
        safe_eval(expr)
