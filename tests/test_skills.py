"""Tests for the real-world skills. Nothing here touches the network, opens
apps or changes the volume: those calls are swapped for fakes."""

from __future__ import annotations

import pytest

from jarvis import Brain, BrainConfig
from jarvis.skills import ALL_SKILLS, SkillsConfig, apps, register_skills, system, weather
from jarvis.tools import ToolRegistry
from jarvis.voice.session import VoiceSession

from test_brain import FakeClient, response, text


def registry_with(*skills, confirm=None, **cfg):
    reg = ToolRegistry(confirm=confirm)
    register_skills(reg, SkillsConfig(enabled=skills, **cfg))
    return reg


def test_all_skills_register_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("JARVIS_SKILLS", raising=False)
    reg = registry_with(*SkillsConfig.from_env().enabled, files_root=tmp_path)
    assert set(reg.names()) >= {
        "web_search", "web_fetch", "get_weather", "open_website", "open_app",
        "get_system_info", "set_volume", "mute", "list_files", "find_files",
        "read_file", "write_file", "move_file", "delete_file",
    }


def test_skills_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("JARVIS_SKILLS", "weather")
    assert SkillsConfig.from_env().enabled == ("weather",)
    monkeypatch.setenv("JARVIS_SKILLS", "none")
    assert SkillsConfig.from_env().enabled == ()
    monkeypatch.setenv("JARVIS_SKILLS", "weather,teleport")
    with pytest.raises(ValueError, match="teleport"):
        SkillsConfig.from_env()


def test_brain_sends_server_tools_after_custom_tools(tmp_path):
    client = FakeClient(response(text("hi")))
    brain = Brain(
        config=BrainConfig(data_dir=tmp_path), client=client,
        skills=SkillsConfig(enabled=("web", "weather")),
    )
    brain.think("hello")
    tools = client.requests[0]["tools"]
    assert tools[-2:] == [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": 5},
        {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 5,
         "max_content_tokens": 20000},
    ]
    assert "get_weather" in [t["name"] for t in tools]


def test_server_tool_use_is_reported(tmp_path):
    from test_brain import Block

    seen = []
    client = FakeClient(
        response(
            Block(type="server_tool_use", id="s1", name="web_search", input={"query": "news"}),
            Block(type="web_search_tool_result", tool_use_id="s1", content=[]),
            text("Here's the news."),
        )
    )
    brain = Brain(config=BrainConfig(data_dir=tmp_path), client=client,
                  skills=SkillsConfig(enabled=("web",)), on_tool_call=seen.append)
    reply = brain.think("what's new?")
    assert reply.text == "Here's the news."
    assert [c.name for c in seen] == ["web_search"]


def test_risky_action_is_declined_without_a_way_to_ask(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    reg = registry_with("files", files_root=tmp_path)
    result, is_error = reg.run("delete_file", {"path": "a.txt"})
    assert is_error and "confirmation" in result
    assert (tmp_path / "a.txt").exists()


def test_user_can_decline(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    asked = []
    reg = registry_with("files", files_root=tmp_path, confirm=lambda q: asked.append(q) or False)
    result, is_error = reg.run("delete_file", {"path": "a.txt"})
    assert is_error and "declined" in result
    assert asked and "a.txt" in asked[0]
    assert (tmp_path / "a.txt").exists()


@pytest.fixture
def files(tmp_path, monkeypatch):
    monkeypatch.setattr("jarvis.skills.files.send2trash", None)
    (tmp_path / "Documents").mkdir()
    (tmp_path / "Documents" / "invoice-may.pdf").write_bytes(b"%PDF\x00binary")
    (tmp_path / "notes.txt").write_text("buy milk\n")
    answers = []
    reg = registry_with("files", files_root=tmp_path, confirm=lambda q: answers.pop(0))
    return reg, tmp_path, answers


def test_list_find_read(files):
    reg, root, _ = files
    listing, err = reg.run("list_files", {"folder": ""})
    assert not err and '"Documents/"' in listing and "notes.txt" in listing
    found, _ = reg.run("find_files", {"pattern": "invoice", "folder": ""})
    assert "invoice-may.pdf" in found
    assert reg.run("read_file", {"path": "notes.txt"}) == ("buy milk\n", False)
    result, err = reg.run("read_file", {"path": "Documents/invoice-may.pdf"})
    assert err and "binary" in result


def test_paths_cannot_escape_the_root(files):
    reg, root, _ = files
    for path in ("../outside.txt", "/etc/passwd", "~/../../etc/passwd"):
        result, err = reg.run("read_file", {"path": path})
        assert err and "PermissionError" in result


def test_write_new_file_without_asking_but_overwrite_asks(files):
    reg, root, answers = files
    assert reg.run("write_file", {"path": "todo/list.txt", "content": "a", "append": False})[1] is False
    assert (root / "todo" / "list.txt").read_text() == "a"
    reg.run("write_file", {"path": "todo/list.txt", "content": "b", "append": True})
    assert (root / "todo" / "list.txt").read_text() == "ab"

    answers.append(False)
    _, err = reg.run("write_file", {"path": "notes.txt", "content": "gone", "append": False})
    assert err and (root / "notes.txt").read_text() == "buy milk\n"
    answers.append(True)
    reg.run("write_file", {"path": "notes.txt", "content": "new", "append": False})
    assert (root / "notes.txt").read_text() == "new"


def test_move_and_delete_ask_first(files):
    reg, root, answers = files
    answers.append(True)
    assert reg.run("move_file", {"source": "notes.txt", "destination": "Documents"})[1] is False
    assert (root / "Documents" / "notes.txt").exists()
    answers.append(True)
    assert reg.run("delete_file", {"path": "Documents/notes.txt"})[1] is False
    assert not (root / "Documents" / "notes.txt").exists()
    result, err = reg.run("delete_file", {"path": "Documents"})  # not empty
    assert err and "isn't empty" in result


def fake_open_meteo(url, params):
    if "geocoding" in url:
        if params["name"] == "Atlantis":
            return {}
        return {"results": [{"name": "Lahore", "admin1": "Punjab", "country": "Pakistan",
                             "latitude": 31.5, "longitude": 74.3}]}
    assert params["forecast_days"] == 2
    return {
        "current": {"time": "2026-11-06T20:00", "temperature_2m": 22.1,
                    "apparent_temperature": 21.0, "relative_humidity_2m": 40,
                    "wind_speed_10m": 6.5, "weather_code": 2},
        "daily": {"time": ["2026-11-06", "2026-11-07"], "weather_code": [2, 61],
                  "temperature_2m_max": [27, 25], "temperature_2m_min": [15, 14],
                  "precipitation_probability_max": [0, 70],
                  "sunrise": ["2026-11-06T06:27", "2026-11-07T06:28"],
                  "sunset": ["2026-11-06T17:12", "2026-11-07T17:11"]},
    }


def test_weather():
    w = weather.get_weather("Lahore", 2, fetch=fake_open_meteo)
    assert w["place"] == "Lahore, Punjab, Pakistan"
    assert w["now"]["conditions"] == "partly cloudy"
    assert w["now"]["temperature"] == "22.1°C"
    assert w["forecast"][1]["conditions"] == "light rain"
    assert w["forecast"][1]["chance_of_rain"] == "70%"
    with pytest.raises(LookupError):
        weather.get_weather("Atlantis", 1, fetch=fake_open_meteo)
    with pytest.raises(ValueError, match="home location"):
        weather.get_weather("", 1, fetch=fake_open_meteo)


def test_open_website(monkeypatch):
    opened = []
    monkeypatch.setattr(apps, "open_url", opened.append)
    reg = registry_with("apps")
    assert reg.run("open_website", {"url": "youtube.com"}) == ("Opened https://youtube.com", False)
    for bad in ("file:///etc/passwd", "javascript:alert(1)"):
        _, err = reg.run("open_website", {"url": bad})
        assert err
    assert opened == ["https://youtube.com"]


def test_open_app_trusted_vs_untrusted(monkeypatch):
    ran = []
    monkeypatch.setattr(apps, "launch_command", lambda name: ["launch", name])
    monkeypatch.setattr(apps, "run_detached", ran.append)
    asked = []
    reg = registry_with("apps", confirm=lambda q: asked.append(q) or False)

    assert reg.run("open_app", {"name": "Spotify"})[1] is False
    assert not asked
    _, err = reg.run("open_app", {"name": "shutdown"})
    assert err and asked == ["Open the program 'shutdown'?"]
    _, err = reg.run("open_app", {"name": "calc & del /q *"})
    assert err
    assert ran == [["launch", "Spotify"]]


@pytest.mark.parametrize(
    "platform,name,expected",
    [
        ("win32", "calculator", ["cmd", "/c", "start", "", "calc"]),
        ("win32", "spotify", ["cmd", "/c", "start", "", "spotify:"]),
        ("darwin", "chrome", ["open", "-a", "Google Chrome"]),
        ("darwin", "Spotify", ["open", "-a", "Spotify"]),
    ],
)
def test_launch_command(platform, name, expected):
    assert apps.launch_command(name, platform) == expected


def test_system_info_has_basics():
    info = system.system_info()
    assert info["os"] and info["cpu_cores"] and "free of" in info["disk"]


def test_volume_commands(monkeypatch):
    cmds = []
    monkeypatch.setattr(system, "_run", cmds.append)
    monkeypatch.setattr(system.shutil, "which", lambda name: name == "pactl")
    assert system.set_volume(140, "linux") == "Volume set to 100%."
    system.mute(True, "linux")
    system.set_volume(30, "darwin")
    assert cmds == [
        ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "100%"],
        ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"],
        ["osascript", "-e", "set volume output volume 30"],
    ]


class Ears:
    def __init__(self, *heard):
        self.heard = list(heard)

    def listen(self, timeout=None):
        return self.heard.pop(0) if self.heard else None

    def flush(self):
        pass


class Mouth:
    def __init__(self):
        self.said = []

    def say(self, t):
        self.said.append(t)


@pytest.mark.parametrize(
    "heard,expected",
    [("Yes.", True), ("yeah go ahead", True), ("Jarvis, yes", True), ("No.", False),
     ("yes, no wait", False), ("okay don't", False), (None, False), ("maybe", False)],
)
def test_voice_confirm(heard, expected):
    mouth = Mouth()
    session = VoiceSession(None, Ears(heard), mouth, show=lambda _: None)
    assert session.confirm("Delete notes.txt?") is expected
    assert mouth.said == ["Delete notes.txt? Say yes or no."]
