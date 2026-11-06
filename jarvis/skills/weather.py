"""Weather from Open-Meteo (https://open-meteo.com): free, no API key."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from ..tools import ToolRegistry
from ._http import get_json

if TYPE_CHECKING:
    from . import SkillsConfig

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather codes -> words.
CODES = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "freezing drizzle", 57: "heavy freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "heavy freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light showers", 81: "showers", 82: "violent showers",
    85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
}


def describe(code: Any) -> str:
    return CODES.get(code, f"weather code {code}")


def get_weather(
    location: str,
    days: int = 1,
    units: str = "metric",
    fetch: Callable[..., Any] = get_json,
) -> dict[str, Any]:
    """Current conditions plus a ``days``-day forecast for a place name."""
    if not location.strip():
        raise ValueError(
            "No location given and no home location set (JARVIS_HOME_LOCATION). "
            "Ask the user where they are."
        )
    days = max(1, min(int(days), 7))
    geo = fetch(GEOCODE_URL, {"name": location.strip(), "count": 1, "format": "json"})
    places = geo.get("results") or []
    if not places:
        raise LookupError(f"couldn't find a place called '{location}'")
    place = places[0]

    imperial = units == "imperial"
    params = {
        "latitude": place["latitude"],
        "longitude": place["longitude"],
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
        "wind_speed_10m,weather_code,precipitation",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
        "precipitation_probability_max,sunrise,sunset",
        "timezone": "auto",
        "forecast_days": days,
    }
    if imperial:
        params |= {"temperature_unit": "fahrenheit", "wind_speed_unit": "mph",
                   "precipitation_unit": "inch"}
    data = fetch(FORECAST_URL, params)

    t_unit = "°F" if imperial else "°C"
    w_unit = "mph" if imperial else "km/h"
    cur = data.get("current", {})
    daily = data.get("daily", {})
    forecast = []
    for i, date in enumerate(daily.get("time", [])):
        forecast.append(
            {
                "date": date,
                "conditions": describe(daily["weather_code"][i]),
                "high": f"{daily['temperature_2m_max'][i]}{t_unit}",
                "low": f"{daily['temperature_2m_min'][i]}{t_unit}",
                "chance_of_rain": f"{daily['precipitation_probability_max'][i]}%",
                "sunrise": daily["sunrise"][i][-5:],
                "sunset": daily["sunset"][i][-5:],
            }
        )
    name = ", ".join(p for p in (place.get("name"), place.get("admin1"), place.get("country")) if p)
    return {
        "place": name,
        "local_time": cur.get("time"),
        "now": {
            "conditions": describe(cur.get("weather_code")),
            "temperature": f"{cur.get('temperature_2m')}{t_unit}",
            "feels_like": f"{cur.get('apparent_temperature')}{t_unit}",
            "humidity": f"{cur.get('relative_humidity_2m')}%",
            "wind": f"{cur.get('wind_speed_10m')} {w_unit}",
        },
        "forecast": forecast,
    }


def register(registry: ToolRegistry, config: "SkillsConfig") -> None:
    home = config.home_location

    @registry.tool(
        name="get_weather",
        description=(
            "Get current weather and a forecast for a city or place. Pass an empty "
            "location for the user's home"
            + (f" ({home})" if home else " (if none is set, ask the user or check memory)")
            + ". days is 1 (today) to 7."
        ),
        parameters={
            "location": {"type": "string", "description": "e.g. 'Lahore' or 'Paris, France', or ''"},
            "days": {"type": "integer", "description": "Forecast days, 1 to 7"},
        },
    )
    def get_weather_tool(location: str, days: int) -> dict[str, Any]:
        return get_weather(location or home, days, config.units)
