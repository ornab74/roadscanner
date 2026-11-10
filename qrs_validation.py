"""Strict, shared scan request validation."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Mapping


VALID_MODELS = frozenset({"openai", "grok", "llama_local"})
VALID_LANGUAGES = frozenset(
    {"en", "zh", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur", "id", "de", "ja", "sw"}
)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ScanValidationError(ValueError):
    pass


def parse_scan_json(body: bytes, *, maximum_bytes: int = 32 * 1024) -> Mapping[str, Any]:
    if not isinstance(body, bytes) or not body or len(body) > maximum_bytes:
        raise ScanValidationError("request body is empty or too large")

    def object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ScanValidationError("request body contains duplicate fields")
            result[key] = value
        return result

    def reject_constant(_value: str) -> None:
        raise ScanValidationError("request body contains a non-finite number")

    try:
        parsed = json.loads(
            body.decode("utf-8", errors="strict"),
            object_pairs_hook=object_without_duplicates,
            parse_constant=reject_constant,
        )
    except ScanValidationError:
        raise
    except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ScanValidationError("request body must be valid UTF-8 JSON") from exc
    if not isinstance(parsed, Mapping):
        raise ScanValidationError("request body must be a JSON object")
    return parsed


@dataclass(frozen=True)
class ValidatedScan:
    latitude: float
    longitude: float
    vehicle_type: str
    destination: str
    model: str
    language: str
    road_type: str
    weather: str
    traffic: str
    obstacles: str
    sensor_notes: str

    @property
    def scene_context(self) -> dict[str, str]:
        return {
            "road_type": self.road_type,
            "weather": self.weather,
            "traffic": self.traffic,
            "obstacles": self.obstacles,
            "sensor_notes": self.sensor_notes,
        }


def _text(
    data: Mapping[str, Any],
    key: str,
    *,
    maximum: int,
    required: bool = False,
    default: str = "unknown",
) -> str:
    value = data.get(key, default)
    if value is None and not required:
        value = default
    if not isinstance(value, str):
        raise ScanValidationError(f"{key} must be a string")
    value = value.strip()
    if required and not value:
        raise ScanValidationError(f"{key} is required")
    if len(value) > maximum:
        raise ScanValidationError(f"{key} exceeds {maximum} characters")
    if _CONTROL.search(value):
        raise ScanValidationError(f"{key} contains control characters")
    return value or default


def _coordinate(data: Mapping[str, Any], key: str, low: float, high: float) -> float:
    try:
        value = float(data[key])
    except (KeyError, TypeError, ValueError):
        raise ScanValidationError(f"{key} must be a number") from None
    if not math.isfinite(value) or not low <= value <= high:
        raise ScanValidationError(f"{key} must be between {low:g} and {high:g}")
    return value


def validate_scan_payload(
    raw: Any,
    *,
    default_model: str = "llama_local",
    default_language: str = "en",
) -> ValidatedScan:
    if not isinstance(raw, Mapping):
        raise ScanValidationError("request body must be a JSON object")
    allowed = {
        "latitude", "longitude", "vehicle_type", "destination", "model",
        "model_selection", "language", "language_selection", "road_type",
        "weather", "traffic", "obstacles", "sensor_notes",
    }
    unknown = set(raw) - allowed
    if unknown:
        raise ScanValidationError("request body contains unsupported fields")
    if "model" in raw and "model_selection" in raw:
        raise ScanValidationError("use model or model_selection, not both")
    if "language" in raw and "language_selection" in raw:
        raise ScanValidationError("use language or language_selection, not both")
    model_value = raw.get("model", raw.get("model_selection", default_model))
    language_value = raw.get("language", raw.get("language_selection", default_language))
    model = _text({"model": model_value}, "model", maximum=32, required=True)
    language = _text(
        {"language": language_value}, "language", maximum=8, required=True
    ).lower()
    if model not in VALID_MODELS:
        raise ScanValidationError("model is not supported")
    if language not in VALID_LANGUAGES:
        raise ScanValidationError("language is not supported")
    return ValidatedScan(
        latitude=_coordinate(raw, "latitude", -90.0, 90.0),
        longitude=_coordinate(raw, "longitude", -180.0, 180.0),
        vehicle_type=_text(raw, "vehicle_type", maximum=64, required=True),
        destination=_text(raw, "destination", maximum=256, required=True),
        model=model,
        language=language,
        road_type=_text(raw, "road_type", maximum=96),
        weather=_text(raw, "weather", maximum=96),
        traffic=_text(raw, "traffic", maximum=96),
        obstacles=_text(raw, "obstacles", maximum=512),
        sensor_notes=_text(raw, "sensor_notes", maximum=1000),
    )
