"""Tests for specialist agents, the registry and the supervisor (no API key needed)."""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace as NS

import pytest

from jarvis import Brain, BrainConfig
from jarvis.agents import BUILTIN_DIR, AgentFileError, AgentRegistry, parse_agent
from jarvis.chat import agent_command, ask
from jarvis.supervisor import Supervisor
from jarvis.tools import ToolRegistry


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
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.messages = NS(create=self._create)
        self.beta = NS(messages=NS(create=self._create))

    def _create(self, **params):
        params = {**params, "messages": [dict(m) for m in params["messages"]]}
        self.requests.append(params)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def write_agent(folder, name, body="You help.", **fields):
    folder.mkdir(parents=True, exist_ok=True)
    header = {"name": name, "description": f"The {name} agent.", **fields}
    lines = ["---", *(f"{k}: {v}" for k, v in header.items()), "---", body]
    path = folder / f"{name}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def make_brain(tmp_path, *responses):
    client = FakeClient(*responses)
    brain = Brain(config=BrainConfig(data_dir=tmp_path), client=client)
    return brain, client


# ------------------------------------------------------------------ registry


def test_builtin_agents_all_parse_and_use_real_tools(tmp_path):
    reg = AgentRegistry([BUILTIN_DIR])
    assert reg.errors == []
    assert len(reg) >= 8
    brain, _ = make_brain(tmp_path)
    tools = set(brain.tools.names()) | {"web_search", "web_fetch"}
    for spec in reg.all():
        full = reg.get(spec.name)
        assert full.prompt
        assert set(full.tools) <= tools, spec.name


def test_header_parsing_ignores_unknown_keys(tmp_path):
    path = write_agent(
        tmp_path, "helper", tools="[calculate, recall]", keywords="Maths, SUM",
        tier="small", color="blue", emoji="x", max_rounds="99",
    )
    spec = parse_agent(path, with_prompt=True)
    assert spec.tools == ("calculate", "recall")
    assert spec.keywords == ("maths", "sum")
    assert spec.tier == "small"
    assert spec.max_rounds == 10  # clamped
    assert spec.prompt == "You help."


@pytest.mark.parametrize(
    "content, problem",
    [
        ("no header here", "must start"),
        ("---\nname: x\n", "closing"),
        ("---\nname: Bad Name\ndescription: d\n---\nhi", "name"),
        ("---\nname: ok\n---\nhi", "description"),
        ("---\nname: ok\ndescription: d\ntier: huge\n---\nhi", "tier"),
    ],
)
def test_bad_files_are_rejected(tmp_path, content, problem):
    path = tmp_path / "a.md"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(AgentFileError, match=problem):
        parse_agent(path)


def test_registry_skips_broken_files_and_user_files_override(tmp_path):
    builtin, user = tmp_path / "builtin", tmp_path / "user"
    write_agent(builtin, "weather", body="builtin prompt")
    write_agent(user, "weather", body="my prompt")
    (user / "broken.md").write_text("nonsense", encoding="utf-8")
    reg = AgentRegistry([builtin, user, tmp_path / "missing"])
    assert reg.names() == ["weather"]
    assert reg.get("weather").prompt == "my prompt"
    assert [p.name for p, _ in reg.errors] == ["broken.md"]


def test_prompts_load_lazily_and_cache_is_bounded(tmp_path):
    for i in range(5):
        write_agent(tmp_path, f"a{i}")
    reg = AgentRegistry([tmp_path], cache_size=2)
    assert reg.loaded() == []
    assert all(s.prompt == "" for s in reg.all())
    reg.get("a0"), reg.get("a1"), reg.get("a0"), reg.get("a2")
    assert reg.loaded() == ["a0", "a2"]
    with pytest.raises(KeyError):
        reg.get("nope")


# --------------------------------------------------------------------- tools


def test_schemas_and_run_can_be_limited():
    reg = ToolRegistry()

    @reg.tool(description="add", parameters={"a": {"type": "integer"}})
    def add(a):
        return a + 1

    @reg.tool(description="sub", parameters={"a": {"type": "integer"}})
    def sub(a):
        return a - 1

    assert [s["name"] for s in reg.schemas(only=["sub", "nope"])] == ["sub"]
    assert reg.run("add", {"a": 1}, allowed=["sub"]) == ("Tool 'add' isn't available here.", True)
    assert reg.run("sub", {"a": 1}, allowed=["sub"]) == ("0", False)


# ----------------------------------------------------------------- run_agent


def test_agent_uses_only_its_tools_and_keeps_history_clean(tmp_path):
    brain, client = make_brain(
        tmp_path,
        response(tool_use("t1", "calculate", {"expression": "2+2"}), stop_reason="tool_use"),
        response(text("It's 4.")),
    )
    write_agent(tmp_path / "agents", "maths", body="You do maths.", tools="calculate, not_a_tool")
    brain.agents.reload()

    result = brain.run_agent("maths", "what is 2+2")
    assert result.ok and result.text == "It's 4."
    assert [c.result for c in result.tool_calls] == ["4"]
    req = client.requests[0]
    assert [t["name"] for t in req["tools"]] == ["calculate"]
    system = req["system"] if isinstance(req["system"], str) else req["system"][0]["text"]
    assert system.startswith("You do maths.")
    assert len(brain.memory) == 0  # JARVIS's own conversation untouched


def test_agent_cannot_call_tools_outside_its_list(tmp_path):
    brain, _ = make_brain(
        tmp_path,
        response(tool_use("t1", "forget", {"key": "x"}), stop_reason="tool_use"),
        response(text("ok")),
    )
    write_agent(tmp_path / "agents", "maths", tools="calculate")
    brain.agents.reload()
    result = brain.run_agent("maths", "forget x")
    assert result.tool_calls[0].is_error
    assert "isn't available" in result.tool_calls[0].result


def test_unknown_agent_and_crash_come_back_as_results(tmp_path):
    brain, _ = make_brain(tmp_path, RuntimeError("provider exploded"))
    write_agent(tmp_path / "agents", "maths")
    brain.agents.reload()

    missing = brain.run_agent("nobody", "hi")
    assert not missing.ok and "no agent called" in missing.error

    crashed = brain.run_agent("maths", "hi")
    assert not crashed.ok and "provider exploded" in crashed.error
    assert brain.status()["jobs"]["agent:maths"]["failed"] == 1


def test_agent_that_never_finishes_its_tools_fails_cleanly(tmp_path):
    loop = response(tool_use("t", "calculate", {"expression": "1"}), stop_reason="tool_use")
    brain, _ = make_brain(tmp_path, loop, loop)
    write_agent(tmp_path / "agents", "maths", tools="calculate", max_rounds="2")
    brain.agents.reload()
    result = brain.run_agent("maths", "loop")
    assert not result.ok and "2 rounds" in result.error


# ---------------------------------------------------------------- supervisor


def test_supervisor_circuit_breaker():
    now = [0.0]
    sup = Supervisor(max_failures=3, window=60, rest=100, clock=lambda: now[0])

    def boom():
        raise ValueError("bad")

    for _ in range(3):
        assert not sup.run("job", boom).ok
    calls = []
    out = sup.run("job", lambda: calls.append(1))
    assert not out.ok and "switched off" in out.error and calls == []
    now[0] = 101
    assert sup.run("job", lambda: "fine").value == "fine"
    assert sup.status()["job"]["state"] == "ok"


def test_supervisor_failures_outside_window_dont_count():
    now = [0.0]
    sup = Supervisor(max_failures=2, window=10, rest=100, clock=lambda: now[0])
    sup.run("job", lambda: 1 / 0)
    now[0] = 20
    sup.run("job", lambda: 1 / 0)
    assert sup.resting("job") == 0


def test_supervisor_timeout_and_pause():
    sup = Supervisor()
    release = threading.Event()
    out = sup.run("slow", lambda: release.wait(5), timeout=0.3)
    release.set()
    assert not out.ok and "longer than" in out.error

    # While paused (waiting on the user) the clock stops.
    paused = threading.Event()
    paused.set()

    def job():
        time.sleep(0.5)
        return "done"

    out = sup.run("confirm", job, timeout=0.2, paused=paused.is_set)
    assert out.ok and out.value == "done"


def test_agent_clock_stops_while_waiting_for_confirmation(tmp_path):
    brain, _ = make_brain(
        tmp_path,
        response(tool_use("t1", "slow_risky", {}), stop_reason="tool_use"),
        response(text("done")),
    )

    def confirm(question):
        time.sleep(6)  # longer than the agent's 5 s timeout
        return True

    brain.tools.confirm = confirm

    @brain.tools.tool(description="risky", parameters={})
    def slow_risky():
        brain.tools.ask_user("ok?")
        return "did it"

    write_agent(tmp_path / "agents", "risky", tools="slow_risky", timeout="5")
    brain.agents.reload()
    assert brain.run_agent("risky", "go").ok


# ---------------------------------------------------------------- front ends


def test_ask_never_raises_on_unexpected_errors(tmp_path):
    brain, _ = make_brain(tmp_path, KeyError("weird"))
    reply = ask(brain, "hello")
    assert "still running" in reply
    assert len(brain.memory) == 0


def test_agent_commands(tmp_path):
    brain, _ = make_brain(tmp_path, response(text("Assalam o alaikum")))
    listing = agent_command(brain, "/agents")
    assert "translator" in listing and "weather" in listing
    assert agent_command(brain, "/agent translator say hello") == "[translator] Assalam o alaikum"
    assert "Usage" in agent_command(brain, "/agent translator")
    status = agent_command(brain, "/status")
    assert "agent:translator" in status and "1 runs" in status
    assert agent_command(brain, "/reset") is None
