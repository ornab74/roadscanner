#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import logging
import sqlite3
from datetime import timedelta, datetime
from flask import (
    Flask,
    request,
    session,
    redirect,
    url_for,
    render_template_string,
    jsonify,
    flash,
)
from flask_wtf import FlaskForm, CSRFProtect
from flask_wtf.csrf import generate_csrf
from wtforms import StringField, PasswordField, SubmitField, TextAreaField, SelectField
from wtforms.validators import DataRequired, Length

import httpx
from markdown2 import markdown
import bleach
import geonamescache
import random
import re
import base64
import math
import binascii
import threading
import time
import hmac
import hashlib
import secrets
from typing import Tuple, Dict, List, Union
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor
import textwrap
import io
import sys
import pennylane as qml
import numpy as np
from pathlib import Path
import os
from statistics import mean
import json
import string
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

import psutil

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from argon2.low_level import Type

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.fernet import Fernet, InvalidToken

try:
    from waitress import serve
except Exception:
    serve = None


# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
console_handler.setFormatter(formatter)

logger.addHandler(console_handler)


# -----------------------------------------------------------------------------
# Flask App
# -----------------------------------------------------------------------------
app = Flask(__name__)

BASE_DIR = Path(__file__).parent.resolve()
DB_FILE = BASE_DIR / "secure_data.db"

SECRET_KEY = os.getenv("INVITE_CODE_SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is not defined!")

if isinstance(SECRET_KEY, str):
    SECRET_KEY = SECRET_KEY.encode("utf-8")

session_cookie_secure = os.getenv("SESSION_COOKIE_SECURE", "true").lower() == "true"

app.config.update(
    SESSION_COOKIE_SECURE=session_cookie_secure,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    WTF_CSRF_TIME_LIMIT=3600,
    SECRET_KEY=SECRET_KEY,
)

csrf = CSRFProtect(app)


def generate_very_strong_secret_key() -> bytes:
    base_key = secrets.token_bytes(24)
    derived_key = hashlib.scrypt(
        password=base_key,
        salt=secrets.token_bytes(16),
        n=2**16,
        r=8,
        p=1,
        dklen=32,
    )
    return derived_key


def get_very_complex_random_interval() -> int:
    base_interval = secrets.choice(range(15, 25))  # minutes
    additional_randomness = secrets.randbelow(600)  # seconds
    return (base_interval * 60) + additional_randomness


def rotate_secret_key():
    lock = threading.Lock()
    while True:
        with lock:
            app.secret_key = generate_very_strong_secret_key()
            logger.info("Secret key rotated securely.")
        time.sleep(get_very_complex_random_interval())


key_rotation_thread = threading.Thread(target=rotate_secret_key, daemon=True)
key_rotation_thread.start()


RATE_LIMIT_COUNT = 13
RATE_LIMIT_WINDOW = timedelta(minutes=15)
EXPIRATION_HOURS = 65

config_lock = threading.Lock()


@app.after_request
def apply_csp(response):
    csp_policy = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "img-src 'self' data:; "
        "object-src 'none'; "
        "base-uri 'self'; "
    )
    response.headers["Content-Security-Policy"] = csp_policy
    return response


def run_async(coro):
    """
    Run a coroutine safely whether we're already inside an event loop or not.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        return asyncio.run_coroutine_threadsafe(coro, loop).result()
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# Crypto / Key Management
# -----------------------------------------------------------------------------
class KeyManager:
    def __init__(
        self,
        passphrase_env_var: str = "ENCRYPTION_PASSPHRASE",
        salt_file_path: str = "/home/appuser/.keys/encryption_salt_key.key",
    ):
        self.encryption_key: bytes | None = None
        self.passphrase_env_var = passphrase_env_var
        self.salt_file_path = Path(salt_file_path)
        self.backend = default_backend()
        self._load_encryption_key()

    def _ensure_salt(self) -> bytes:
        self.salt_file_path.parent.mkdir(parents=True, exist_ok=True)
        if self.salt_file_path.exists():
            return self.salt_file_path.read_bytes()
        salt = secrets.token_bytes(16)
        self.salt_file_path.write_bytes(salt)
        try:
            os.chmod(self.salt_file_path, 0o600)
        except Exception:
            pass
        return salt

    def _derive_key(self, passphrase: bytes, salt: bytes) -> bytes:
        kdf = Scrypt(
            salt=salt,
            length=32,
            n=2**15,
            r=8,
            p=1,
            backend=self.backend,
        )
        return kdf.derive(passphrase)

    def _load_encryption_key(self):
        if self.encryption_key is not None:
            return

        passphrase = os.getenv(self.passphrase_env_var)
        if not passphrase:
            raise ValueError(
                f"{self.passphrase_env_var} environment variable is not defined!"
            )

        if isinstance(passphrase, str):
            passphrase_b = passphrase.encode("utf-8")
        else:
            passphrase_b = passphrase

        salt = self._ensure_salt()
        raw_key = self._derive_key(passphrase_b, salt)
        # Fernet needs a urlsafe base64-encoded 32-byte key
        self.encryption_key = base64.urlsafe_b64encode(raw_key)


key_manager = KeyManager()
fernet = Fernet(key_manager.encryption_key)


def encrypt_data(plaintext: str) -> str:
    if plaintext is None:
        plaintext = ""
    if not isinstance(plaintext, str):
        plaintext = str(plaintext)
    token = fernet.encrypt(plaintext.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_data(token: str) -> str:
    if token is None:
        return ""
    if not isinstance(token, str):
        token = str(token)
    try:
        pt = fernet.decrypt(token.encode("utf-8"))
        return pt.decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return ""


# -----------------------------------------------------------------------------
# Password hashing
# -----------------------------------------------------------------------------
argon2_parameters = {
    "time_cost": 2,
    "memory_cost": 102400,
    "parallelism": 2,
    "hash_len": 32,
    "salt_len": 16,
    "type": Type.ID,
}
ph = PasswordHasher(**argon2_parameters)


# -----------------------------------------------------------------------------
# Quantum (PennyLane)
# -----------------------------------------------------------------------------
dev = qml.device("default.qubit", wires=5)


@qml.qnode(dev)
def quantum_hazard_scan(cpu_usage, ram_usage):
    cpu_param = cpu_usage / 100
    ram_param = ram_usage / 100
    qml.RY(np.pi * cpu_param, wires=0)
    qml.RY(np.pi * ram_param, wires=1)
    qml.RY(np.pi * (0.5 + cpu_param), wires=2)
    qml.RY(np.pi * (0.5 + ram_param), wires=3)
    qml.RY(np.pi * (0.5 + cpu_param), wires=4)
    qml.CNOT(wires=[0, 1])
    qml.CNOT(wires=[1, 2])
    qml.CNOT(wires=[2, 3])
    qml.CNOT(wires=[3, 4])
    return qml.probs(wires=[0, 1, 2, 3, 4])


def get_cpu_ram_usage():
    return psutil.cpu_percent(), psutil.virtual_memory().percent


# -----------------------------------------------------------------------------
# DB setup / housekeeping
# -----------------------------------------------------------------------------
registration_enabled = True  # default; can be toggled in DB config table


def create_tables():
    if not DB_FILE.exists():
        DB_FILE.touch(mode=0o600)

    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT 0,
                preferred_model TEXT DEFAULT 'grok'
            )
        """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS hazard_reports (
                id INTEGER PRIMARY KEY,
                latitude TEXT,
                longitude TEXT,
                street_name TEXT,
                vehicle_type TEXT,
                destination TEXT,
                result TEXT,
                cpu_usage TEXT,
                ram_usage TEXT,
                quantum_results TEXT,
                user_id INTEGER,
                timestamp TEXT,
                risk_level TEXT,
                model_used TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS invite_codes (
                id INTEGER PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                is_used BOOLEAN DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS rate_limits (
                user_id INTEGER,
                window_start TEXT,
                count INTEGER,
                PRIMARY KEY (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """
        )

        db.commit()


create_tables()


def is_registration_enabled() -> bool:
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute("SELECT value FROM config WHERE key = 'registration_enabled'")
        row = cursor.fetchone()
        if not row:
            # default to True and persist
            cursor.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
                ("registration_enabled", "true"),
            )
            db.commit()
            return True
        return str(row[0]).lower() == "true"


def set_registration_enabled(enabled: bool):
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
            ("registration_enabled", "true" if enabled else "false"),
        )
        db.commit()


def delete_expired_data():
    """
    Periodically delete old hazard reports and used invite codes older than EXPIRATION_HOURS.
    """
    while True:
        try:
            cutoff = datetime.utcnow() - timedelta(hours=EXPIRATION_HOURS)
            cutoff_iso = cutoff.isoformat()

            with sqlite3.connect(DB_FILE) as db:
                cursor = db.cursor()
                # hazard_reports timestamp stored as ISO string
                cursor.execute(
                    "DELETE FROM hazard_reports WHERE timestamp < ?",
                    (cutoff_iso,),
                )
                # optional cleanup: invite codes used long ago
                cursor.execute(
                    "DELETE FROM invite_codes WHERE is_used = 1 AND created_at < datetime('now', ?)",
                    (f"-{EXPIRATION_HOURS} hours",),
                )
                db.commit()
        except Exception as e:
            logger.error("delete_expired_data failed: %s", e, exc_info=True)

        # run every ~25 minutes with jitter
        time.sleep(1500 + secrets.randbelow(600))


data_deletion_thread = threading.Thread(target=delete_expired_data, daemon=True)
data_deletion_thread.start()


# -----------------------------------------------------------------------------
# Input Sanitization & Validation
# -----------------------------------------------------------------------------
def sanitize_input(user_input):
    if not isinstance(user_input, str):
        user_input = str(user_input)
    return bleach.clean(user_input, strip=True).strip()


COORD_DECIMAL_PLACES = 8
COORD_MAX_LENGTH = 20
COORD_PATTERN = re.compile(r"^-?\d{1,3}(?:\.\d{1,8})?$")
ALLOWED_VEHICLE_TYPES = {"car", "truck", "motorbike"}
ALLOWED_MODELS = {"grok"}


def _format_decimal(value: Decimal) -> str:
    quantizer = Decimal(f"1.{'0' * COORD_DECIMAL_PLACES}")
    quantized = value.quantize(quantizer, rounding=ROUND_HALF_UP)
    text = format(quantized.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def parse_coordinate(raw_value: str, label: str) -> tuple[float, str]:
    if raw_value is None:
        raise ValueError(f"{label} is required.")
    raw_text = str(raw_value).strip()
    if len(raw_text) > COORD_MAX_LENGTH:
        raise ValueError(f"{label} is too long.")
    if not COORD_PATTERN.fullmatch(raw_text):
        raise ValueError(
            f"{label} must be a decimal number with up to {COORD_DECIMAL_PLACES} places."
        )
    try:
        decimal_value = Decimal(raw_text)
    except InvalidOperation as exc:
        raise ValueError(f"{label} is invalid.") from exc
    if not decimal_value.is_finite():
        raise ValueError(f"{label} must be finite.")

    if label.lower() == "latitude":
        if not (Decimal("-90") <= decimal_value <= Decimal("90")):
            raise ValueError("Latitude is out of range.")
    elif label.lower() == "longitude":
        if not (Decimal("-180") <= decimal_value <= Decimal("180")):
            raise ValueError("Longitude is out of range.")

    normalized = _format_decimal(decimal_value)
    return float(decimal_value), normalized


def validate_vehicle_type(vehicle_type: str) -> bool:
    return vehicle_type in ALLOWED_VEHICLE_TYPES


def validate_destination(destination: str, max_length: int = 140) -> bool:
    if not destination:
        return False
    if len(destination) > max_length:
        return False
    return True


# -----------------------------------------------------------------------------
# Geo helpers
# -----------------------------------------------------------------------------
gc = geonamescache.GeonamesCache()
cities = gc.get_cities()


def quantum_haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = (np.sin(dphi / 2) ** 2) + (
        np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2) ** 2
    )
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    return R * c * (1 + 0.000045 * np.sin(dphi) * np.cos(dlambda))


def approximate_nearest_city(lat, lon, cities_dict):
    nearest_city = None
    min_distance = float("inf")
    for city in cities_dict.values():
        try:
            city_lat = float(city["latitude"])
            city_lon = float(city["longitude"])
            distance = quantum_haversine_distance(lat, lon, city_lat, city_lon)
            if distance < min_distance:
                min_distance = distance
                nearest_city = city
        except Exception:
            continue
    return nearest_city, min_distance


def approximate_country(lat, lon, cities_dict):
    city, _ = approximate_nearest_city(lat, lon, cities_dict)
    if city:
        return city.get("countrycode", "UNKNOWN")
    return "UNKNOWN"


def reverse_geocode(lat, lon, cities_dict):
    if not cities_dict or not isinstance(cities_dict, dict):
        return "Unknown Location"
    nearest_city = None
    min_distance = float("inf")
    for city in cities_dict.values():
        try:
            city_lat = float(city["latitude"])
            city_lon = float(city["longitude"])
            distance = quantum_haversine_distance(lat, lon, city_lat, city_lon)
            if distance < min_distance:
                min_distance = distance
                nearest_city = city
        except Exception:
            continue
    if nearest_city:
        return f"{nearest_city['name']}, {nearest_city['countrycode']}"
    return "Unknown Location"


def reverse_geocode_osm(lat: float, lon: float) -> str | None:
    try:
        timeout = httpx.Timeout(10.0, connect=5.0, read=8.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"format": "jsonv2", "lat": lat, "lon": lon},
                headers={"User-Agent": "qrs-reverse-geocoder"},
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.warning("OSM reverse geocode failed: %s", exc)
        return None

    address = data.get("address", {})
    city = address.get("city") or address.get("town") or address.get("village")
    county = address.get("county")
    state = address.get("state")
    if city and county and state:
        return f"{city}, {county}, {state}"
    return None


# -----------------------------------------------------------------------------
# LLM calls (Grok + Gemini fallback)
# -----------------------------------------------------------------------------
async def run_google_gemini_completion(
    prompt: str, *, model_name: str = "gemini-2.0-flash-exp"
) -> str | None:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY is missing from environment variables.")
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 256,
        },
    }
    timeout = httpx.Timeout(30.0, connect=10.0, read=20.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, params={"key": api_key}, json=payload)
            response.raise_for_status()
            result = response.json()
            return result["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.error("Google Gemini HTTP call failed: %s", exc, exc_info=True)
        return None


async def run_grok_completion(
    prompt: str,
    *,
    system_prompt: str | None = None,
    tools: list[dict] | None = None,
    tool_choice: str | dict | None = None,
    max_tokens: int = 800,
    temperature: float = 0.4,
    timeout: httpx.Timeout | None = None,
) -> str | None:
    api_key = os.getenv("GROK_API_KEY")
    if not api_key:
        logger.error("GROK_API_KEY is missing from environment variables.")
        return None

    messages: list[dict] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload: dict[str, object] = {
        "model": "grok-4-latest",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        payload["tools"] = tools
    if tool_choice:
        payload["tool_choice"] = tool_choice

    timeout = timeout or httpx.Timeout(90.0, connect=15.0, read=60.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code == 422 and (tools or tool_choice):
                logger.warning("Grok tool call failed with 422, retrying without tools.")
                retry_payload = dict(payload)
                retry_payload.pop("tools", None)
                retry_payload.pop("tool_choice", None)
                response = await client.post(
                    "https://api.x.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=retry_payload,
                )
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"].strip()
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.error("Grok completion failed: %s", exc, exc_info=True)
        return None


async def phf_filter_input(input_text: str) -> tuple[bool, str]:
    logger.debug(
        "Entering phf_filter_input with input_text of length %d",
        len(input_text) if isinstance(input_text, str) else 0,
    )

    if not input_text or not isinstance(input_text, str):
        logger.warning("phf_filter_input received invalid or empty input_text.")
        return False, "Invalid input."

    grok_prompt = (
        "Run Probabilistic Harm Filtering (PHF) on the text below.\n"
        "Label each category as Safe or Flagged, then provide a final verdict.\n"
        "Categories: Violence, Hate Speech, Self-Harm, Harassment/Bullying, Illegal Activities, Self-Disclosure.\n"
        "Return format:\n"
        "- Violence: Safe/Flagged\n"
        "- Hate Speech: Safe/Flagged\n"
        "- Self-Harm: Safe/Flagged\n"
        "- Harassment/Bullying: Safe/Flagged\n"
        "- Illegal Activities: Safe/Flagged\n"
        "- Self-Disclosure: Safe/Flagged\n"
        "Final Recommendation: Safe/Flagged\n\n"
        f'Text: "{input_text}"'
    )

    try:
        grok_response = await run_grok_completion(
            grok_prompt,
            system_prompt="You are a strict safety classifier.",
            max_tokens=300,
            temperature=0.0,
        )
        if grok_response and ("Flagged" in grok_response or "Safe" in grok_response):
            logger.info("Grok PHF check succeeded.")
            return "Safe" in grok_response, f"Grok: {grok_response.strip()}"
    except Exception as exc:
        logger.error("Grok PHF failed: %s", exc, exc_info=True)

    gemini_prompt = (
        "Classify the following text as Safe or Unsafe. Reply with ONE WORD only.\n\n"
        f"Text: {input_text}\n"
        "Answer:"
    )
    gemini_response = await run_google_gemini_completion(gemini_prompt)
    if gemini_response:
        verdict = gemini_response.strip().lower()
        if "safe" in verdict and "unsafe" not in verdict:
            return True, f"Gemini: {gemini_response.strip()}"
        if "unsafe" in verdict or "flagged" in verdict:
            return False, f"Gemini: {gemini_response.strip()}"

    logger.warning("PHF processing failed. Returning default Unsafe response.")
    return False, "PHF processing failed."


async def fetch_street_name_llm(lat: float, lon: float) -> str:
    grok_api_key = os.getenv("GROK_API_KEY")
    likely_country_code = approximate_country(lat, lon, cities)
    nearest_city, distance_to_city = approximate_nearest_city(lat, lon, cities)

    if not grok_api_key:
        logger.error("Grok API Key is missing.")
        return reverse_geocode(lat, lon, cities)

    try:
        city_hint = "Unknown"
        distance_hint = ""
        if nearest_city:
            city_hint = nearest_city.get("name", "Unknown")
            distance_hint = f"{distance_to_city:.2f} km from {city_hint}"

        system_prompt = (
            "You are Grok 4, a fast reverse-geocoder. "
            "Use the web_search tool to verify the county and state. "
            "Return ONLY in the format: City, County, State. "
            "If uncertain, return 'Unknown Location'."
        )

        llm_prompt = (
            "Reverse-geocode the coordinates below with high accuracy. "
            "Confirm county boundaries and the nearest city.\n\n"
            f"Coordinates: {lat}, {lon}\n"
            f"Nearest known city (heuristic): {city_hint}\n"
            f"Distance to city: {distance_hint}\n"
            f"Likely country code: {likely_country_code}\n\n"
            "Return ONLY one line: City, County, State."
        )

        grok_result = await run_grok_completion(
            llm_prompt,
            system_prompt=system_prompt,
            tools=[{"type": "web_search"}],
            tool_choice="auto",
            max_tokens=80,
            temperature=0.1,
            timeout=httpx.Timeout(30.0, connect=10.0, read=20.0),
        )

        if grok_result:
            clean_location = bleach.clean(grok_result.strip(), tags=[], strip=True)
            if "unknown" in clean_location.lower():
                return reverse_geocode(lat, lon, cities)
            return clean_location

        fallback_prompt = (
            f"Coordinates: {lat}, {lon}. " "Return ONLY one line: City, County, State."
        )
        retry_result = await run_grok_completion(
            fallback_prompt,
            system_prompt="Return City, County, State only.",
            max_tokens=60,
            temperature=0.0,
            timeout=httpx.Timeout(20.0, connect=8.0, read=12.0),
        )
        if retry_result:
            clean_location = bleach.clean(retry_result.strip(), tags=[], strip=True)
            if "unknown" in clean_location.lower():
                return reverse_geocode(lat, lon, cities)
            return clean_location

        osm_location = reverse_geocode_osm(lat, lon)
        if osm_location:
            return osm_location

        return reverse_geocode(lat, lon, cities)

    except Exception as e:
        logger.error("LLM geocoding failed: %s", e, exc_info=True)
        return reverse_geocode(lat, lon, cities)


# -----------------------------------------------------------------------------
# Business logic: invite codes, users, rate limit, reports
# -----------------------------------------------------------------------------
def generate_invite_code(length=24, use_checksum=True):
    if length < 16:
        raise ValueError("Invite code length must be at least 16 characters.")

    charset = string.ascii_letters + string.digits
    invite_code = "".join(secrets.choice(charset) for _ in range(length))

    if use_checksum:
        checksum = hashlib.sha256(invite_code.encode("utf-8")).hexdigest()[:4]
        invite_code += checksum

    return invite_code


def generate_secure_invite_code() -> str:
    # Longer + checksum
    return generate_invite_code(length=24, use_checksum=True)


def validate_invite_code_format(code: str) -> bool:
    if not code or not isinstance(code, str):
        return False
    code = code.strip()
    if len(code) < 20:
        return False
    # last 4 chars must match checksum of prefix
    if len(code) < 5:
        return False
    prefix = code[:-4]
    checksum = code[-4:]
    expected = hashlib.sha256(prefix.encode("utf-8")).hexdigest()[:4]
    return hmac.compare_digest(checksum, expected)


def validate_password_strength(password: str) -> bool:
    if len(password) < 8:
        return False
    if not re.search(r"[A-Z]", password):
        return False
    if not re.search(r"[a-z]", password):
        return False
    if not re.search(r"[0-9]", password):
        return False
    if not re.search(r"[@$!%*?&]", password):
        return False
    return True


def register_user(username, password, invite_code=None):
    username = sanitize_input(username)
    password = sanitize_input(password)

    if not validate_password_strength(password):
        logger.warning("User '%s' provided a weak password.", username)
        return False, "Bad password, please use a stronger one."

    reg_enabled = is_registration_enabled()

    if not reg_enabled:
        if not invite_code:
            logger.warning("User '%s' attempted registration without an invite code.", username)
            return False, "Invite code is required for registration."
        if not validate_invite_code_format(invite_code):
            logger.warning(
                "User '%s' provided an invalid invite code format: %s.", username, invite_code
            )
            return False, "Invalid invite code format."

    hashed_password = ph.hash(password)
    preferred_model_encrypted = encrypt_data("grok")

    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        try:
            db.execute("BEGIN")

            cursor.execute("SELECT 1 FROM users WHERE username = ?", (username,))
            if cursor.fetchone():
                logger.warning("Registration failed: Username '%s' is already taken.", username)
                db.rollback()
                return False, "Error Try Again"

            if not reg_enabled:
                cursor.execute("SELECT id, is_used FROM invite_codes WHERE code = ?", (invite_code,))
                row = cursor.fetchone()
                if not row:
                    logger.warning("User '%s' provided an invalid invite code: %s.", username, invite_code)
                    db.rollback()
                    return False, "Invalid invite code."
                if row[1]:
                    logger.warning("User '%s' attempted to reuse invite code ID %s.", username, row[0])
                    db.rollback()
                    return False, "Invite code has already been used."
                cursor.execute("UPDATE invite_codes SET is_used = 1 WHERE id = ?", (row[0],))

            cursor.execute(
                "INSERT INTO users (username, password, preferred_model) VALUES (?, ?, ?)",
                (username, hashed_password, preferred_model_encrypted),
            )

            db.commit()
            return True, "Registration successful! Please log in."
        except Exception as e:
            db.rollback()
            logger.error("register_user failed: %s", e, exc_info=True)
            return False, "Error Try Again"


def authenticate_user(username: str, password: str) -> bool:
    username = sanitize_input(username)
    password = sanitize_input(password)

    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute("SELECT id, password, is_admin FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()
        if not row:
            return False

        user_id, stored_hash, is_admin = row
        try:
            ph.verify(stored_hash, password)
            session["is_admin"] = bool(is_admin)
            return True
        except VerifyMismatchError:
            return False
        except Exception as e:
            logger.error("authenticate_user error: %s", e, exc_info=True)
            return False


def get_user_id(username: str) -> int | None:
    username = sanitize_input(username)
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()
        return int(row[0]) if row else None


def check_rate_limit(user_id: int) -> bool:
    """
    Return True if allowed; False if exceeded.
    """
    now = datetime.utcnow()
    window_start = now - RATE_LIMIT_WINDOW

    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute("SELECT window_start, count FROM rate_limits WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()

        if not row:
            cursor.execute(
                "INSERT OR REPLACE INTO rate_limits (user_id, window_start, count) VALUES (?, ?, ?)",
                (user_id, now.isoformat(), 1),
            )
            db.commit()
            return True

        stored_start_str, count = row
        try:
            stored_start = datetime.fromisoformat(stored_start_str)
        except Exception:
            stored_start = now

        if stored_start < window_start:
            cursor.execute(
                "UPDATE rate_limits SET window_start = ?, count = ? WHERE user_id = ?",
                (now.isoformat(), 1, user_id),
            )
            db.commit()
            return True

        if int(count) >= RATE_LIMIT_COUNT:
            return False

        cursor.execute(
            "UPDATE rate_limits SET count = ? WHERE user_id = ?",
            (int(count) + 1, user_id),
        )
        db.commit()
        return True


def save_hazard_report(
    lat,
    lon,
    street_name,
    vehicle_type,
    destination,
    result,
    cpu_usage,
    ram_usage,
    quantum_results,
    user_id,
    risk_level,
    model_used,
):
    timestamp = datetime.utcnow().isoformat()

    lat_encrypted = encrypt_data(str(lat))
    lon_encrypted = encrypt_data(str(lon))
    street_name_encrypted = encrypt_data(street_name)
    vehicle_type_encrypted = encrypt_data(vehicle_type)
    destination_encrypted = encrypt_data(destination)
    result_encrypted = encrypt_data(result)
    cpu_usage_encrypted = encrypt_data(str(cpu_usage))
    ram_usage_encrypted = encrypt_data(str(ram_usage))
    quantum_results_encrypted = encrypt_data(str(quantum_results))
    risk_level_encrypted = encrypt_data(risk_level)
    model_used_encrypted = encrypt_data(model_used)

    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute(
            """
            INSERT INTO hazard_reports (
                latitude, longitude, street_name, vehicle_type, destination, result,
                cpu_usage, ram_usage, quantum_results, user_id, timestamp, risk_level, model_used
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                lat_encrypted,
                lon_encrypted,
                street_name_encrypted,
                vehicle_type_encrypted,
                destination_encrypted,
                result_encrypted,
                cpu_usage_encrypted,
                ram_usage_encrypted,
                quantum_results_encrypted,
                user_id,
                timestamp,
                risk_level_encrypted,
                model_used_encrypted,
            ),
        )
        report_id = cursor.lastrowid
        db.commit()

    return report_id


def get_user_preferred_model(user_id):
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute("SELECT preferred_model FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if row and row[0]:
            decrypted_model = decrypt_data(row[0])
            if decrypted_model and decrypted_model in ALLOWED_MODELS:
                return decrypted_model
            return "grok"
        else:
            return "grok"


def get_hazard_reports(user_id):
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute(
            "SELECT * FROM hazard_reports WHERE user_id = ? ORDER BY timestamp DESC",
            (user_id,),
        )
        reports = cursor.fetchall()

    decrypted_reports = []
    for report in reports:
        decrypted_report = {
            "id": report[0],
            "latitude": decrypt_data(report[1]),
            "longitude": decrypt_data(report[2]),
            "street_name": decrypt_data(report[3]),
            "vehicle_type": decrypt_data(report[4]),
            "destination": decrypt_data(report[5]),
            "result": decrypt_data(report[6]),
            "cpu_usage": decrypt_data(report[7]),
            "ram_usage": decrypt_data(report[8]),
            "quantum_results": decrypt_data(report[9]),
            "user_id": report[10],
            "timestamp": report[11],
            "risk_level": decrypt_data(report[12]),
            "model_used": decrypt_data(report[13]),
        }
        decrypted_reports.append(decrypted_report)

    return decrypted_reports


def get_hazard_report_by_id(report_id, user_id):
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute(
            "SELECT * FROM hazard_reports WHERE id = ? AND user_id = ?",
            (report_id, user_id),
        )
        report = cursor.fetchone()

    if not report:
        return None

    return {
        "id": report[0],
        "latitude": decrypt_data(report[1]),
        "longitude": decrypt_data(report[2]),
        "street_name": decrypt_data(report[3]),
        "vehicle_type": decrypt_data(report[4]),
        "destination": decrypt_data(report[5]),
        "result": decrypt_data(report[6]),
        "cpu_usage": decrypt_data(report[7]),
        "ram_usage": decrypt_data(report[8]),
        "quantum_results": decrypt_data(report[9]),
        "user_id": report[10],
        "timestamp": report[11],
        "risk_level": decrypt_data(report[12]),
        "model_used": decrypt_data(report[13]),
    }


# -----------------------------------------------------------------------------
# Scanning logic
# -----------------------------------------------------------------------------
def calculate_harm_level(result: str) -> str:
    if re.search(r"\b(high|severe|critical|urgent|dangerous)\b", result, re.IGNORECASE):
        return "High"
    elif re.search(r"\b(medium|moderate|caution|warning)\b", result, re.IGNORECASE):
        return "Medium"
    elif re.search(r"\b(low|minimal|safe|minor|normal)\b", result, re.IGNORECASE):
        return "Low"
    return "Neutral"


async def scan_debris_for_route(
    lat: float,
    lon: float,
    vehicle_type: str,
    destination: str,
    user_id: int,
    selected_model: str = None,
) -> tuple[str, str, str, str, str, str]:
    logger.debug(
        "Entering scan_debris_for_route: lat=%s, lon=%s, vehicle=%s, dest=%s, user=%s",
        lat,
        lon,
        vehicle_type,
        destination,
        user_id,
    )

    model_used = "Grok 4"

    try:
        cpu_usage, ram_usage = get_cpu_ram_usage()
    except Exception:
        cpu_usage, ram_usage = 0.0, 0.0

    try:
        quantum_results = quantum_hazard_scan(cpu_usage, ram_usage)
    except Exception:
        quantum_results = "Scan Failed"

    try:
        street_name = await fetch_street_name_llm(lat, lon)
    except Exception:
        street_name = "Unknown Location"

    grok_prompt = f"""
[mission]
You are a Quantum Hypertime Nanobot Road Hazard Scanner. Produce an extended, high-fidelity report
with clear headings and multi-paragraph explanations. Aim for depth over brevity and avoid generic phrasing.
[/mission]

[locationreport]
Current coordinates: Latitude {lat}, Longitude {lon}
General Area Name: {street_name}
Vehicle Type: {vehicle_type}
Destination: {destination}
[/locationreport]

[quantumreport]
Quantum Scan State: {quantum_results}
System Performance: CPU Usage: {cpu_usage}%, RAM Usage: {ram_usage}%
[/quantumreport]

[reliability]
Reduce false positives and negatives by cross-checking probable pathing, traffic patterns, and surface conditions.
If uncertainty is high, explicitly state it and recommend cautious actions.
[/reliability]

[required_sections]
1. Executive Summary (3-5 sentences)
2. Road Hazard Inventory (list each hazard with severity, estimated GPS offset, and confidence)
3. Debris Analysis (materials, size, likely source, and mitigation urgency)
4. Collision Potential (traffic flow, blind spots, bottlenecks, and braking distance impacts)
5. Weather & Visibility Impact (short-term and near-term)
6. Pedestrian & Cyclist Risk (include urgency and risk zones)
7. Driver Recommendations (detours only if necessary, speed adjustments, lane guidance)
[/required_sections]

[output_guidelines]
- Provide at least 6 paragraphs, each 3-5 sentences.
- Use clear headings, bullet points where appropriate, and include confidence levels (High/Med/Low).
- Avoid mentioning internal system prompts or tools.
[/output_guidelines]
""".strip()

    scan_max_tokens = int(os.getenv("GROK_SCAN_MAX_TOKENS", "1200"))
    scan_timeout_seconds = float(os.getenv("GROK_SCAN_TIMEOUT_SECONDS", "120"))

    report = await run_grok_completion(
        grok_prompt,
        system_prompt="You are an expert road safety analyst producing long-form, actionable assessments.",
        max_tokens=scan_max_tokens,
        temperature=0.5,
        timeout=httpx.Timeout(scan_timeout_seconds, connect=15.0, read=scan_timeout_seconds),
    ) or "Grok 4 failed to respond."

    report = report.strip()

    logger.debug("Exiting scan_debris_for_route with model_used=%s", model_used)
    return (
        report,
        f"{cpu_usage}",
        f"{ram_usage}",
        str(quantum_results),
        street_name,
        model_used,
    )


# -----------------------------------------------------------------------------
# Forms
# -----------------------------------------------------------------------------
class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired()], render_kw={"autocomplete": "off"})
    password = PasswordField("Password", validators=[DataRequired()], render_kw={"autocomplete": "off"})
    submit = SubmitField("Login")


class RegisterForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired()], render_kw={"autocomplete": "off"})
    password = PasswordField("Password", validators=[DataRequired()], render_kw={"autocomplete": "off"})
    invite_code = StringField("Invite Code", render_kw={"autocomplete": "off"})
    submit = SubmitField("Register")


class SettingsForm(FlaskForm):
    enable_registration = SubmitField("Enable Registration")
    disable_registration = SubmitField("Disable Registration")
    generate_invite_code = SubmitField("Generate New Invite Code")


class ReportForm(FlaskForm):
    latitude = StringField("Latitude", validators=[DataRequired(), Length(max=50)])
    longitude = StringField("Longitude", validators=[DataRequired(), Length(max=50)])
    vehicle_type = StringField("Vehicle Type", validators=[DataRequired(), Length(max=50)])
    destination = StringField("Destination", validators=[DataRequired(), Length(max=100)])
    result = TextAreaField("Result", validators=[DataRequired(), Length(max=2000)])
    risk_level = SelectField(
        "Risk Level",
        choices=[("Low", "Low"), ("Medium", "Medium"), ("High", "High")],
        validators=[DataRequired()],
    )
    model_selection = SelectField(
        "Select Model",
        choices=[("grok", "Grok")],
        validators=[DataRequired()],
    )
    submit = SubmitField("Submit Report")


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return redirect(url_for("home"))


@app.route("/home")
def home():
    # NOTE: ORIGINAL SRI values restored here and across templates:
    # Roboto: sha256-Sc7BtUKoWr6RBuNTT0MmuQjqGVQwYBK+21lB58JwUVE=
    # Orbitron: sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00
    return render_template_string(
        r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>QRS - Quantum Road Scanner</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <link href="{{ url_for('static', filename='css/roboto.css') }}" rel="stylesheet"
          integrity="sha256-Sc7BtUKoWr6RBuNTT0MmuQjqGVQwYBK+21lB58JwUVE=" crossorigin="anonymous">
    <link href="{{ url_for('static', filename='css/orbitron.css') }}" rel="stylesheet"
          integrity="sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/bootstrap.min.css') }}"
          integrity="sha256-Ww++W3rXBfapN8SZitAvc9jw2Xb+Ixt0rvDsmWmQyTo=" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/fontawesome.min.css') }}"
          integrity="sha256-rx5u3IdaOCszi7Jb18XD9HSn8bNiEgAqWJbdBvIYYyU=" crossorigin="anonymous">
    <style>
        body {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: #ffffff;
            font-family: 'Roboto', sans-serif;
        }
        .navbar { background: rgba(0, 0, 0, 0.5); }
        .navbar-brand {
            font-family: 'Orbitron', sans-serif;
            font-size: 2rem;
            background: -webkit-linear-gradient(#f0f, #0ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .content { padding: 60px 20px; }
        .section {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 22px;
            box-shadow: 0 10px 25px rgba(0,0,0,.25);
        }
        .section-title { font-family: 'Orbitron', sans-serif; }
        .gradient-text {
            background: -webkit-linear-gradient(#f0f, #0ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        a { color: #9be8ff; }
        a:hover { color: #ffffff; text-decoration: none; }
    </style>
</head>
<body>
    <nav class="navbar navbar-expand-lg navbar-dark">
        <a class="navbar-brand" href="{{ url_for('home') }}">QRS</a>
        <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarNav"
                aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse justify-content-end" id="navbarNav">
            <ul class="navbar-nav">
                {% if 'username' in session %}
                    <li class="nav-item"><a class="nav-link" href="{{ url_for('dashboard') }}">Dashboard</a></li>
                    <li class="nav-item"><a class="nav-link" href="{{ url_for('logout') }}">Logout</a></li>
                {% else %}
                    <li class="nav-item"><a class="nav-link" href="{{ url_for('login') }}">Login</a></li>
                    <li class="nav-item"><a class="nav-link" href="{{ url_for('register') }}">Register</a></li>
                {% endif %}
            </ul>
        </div>
    </nav>

    <div class="container content">
        <div class="text-center mb-5">
            <br><br>
            <h1 class="display-4 gradient-text">Quantum Road Scanner</h1>
            <p class="lead">Enhancing Road Safety with Quantum Simulations, Secure Reverse Geocoding, and Hypertime Analysis</p>
        </div>

        <div class="section">
            <h3 class="section-title">Introduction</h3>
            <p>
                The Quantum Road Scanner (QRS) is an innovative system that leverages quantum computing, advanced algorithms,
                and concepts from hypertime physics to simulate road conditions in real-time. By generating and analyzing
                simulated data, QRS provides comprehensive assessments of potential hazards without collecting, storing,
                or retaining unnecessary user data. The system operates within a quantum-zoned environment with noise
                protections to ensure accuracy, privacy, and tamper-resistant reporting.
            </p>
            <p>
                QRS represents a significant advancement in applying theoretical physics to practical challenges. It builds
                upon foundational research in quantum mechanics, computational physics, and hypertime theories to offer
                novel solutions for road safety, traffic management, and high-confidence route guidance.
            </p>
        </div>

        <div class="section">
            <h3 class="section-title">How QRS Helps You Drive Safer</h3>
            <p>
                QRS combines quantum simulation with secure reverse geocoding to give you a clear, actionable view of
                real-world road conditions at your coordinates. Every scan produces a structured, long-form hazard report
                that includes debris analysis, collision risk, and visibility impacts—paired with confidence levels so you
                know exactly how much certainty to apply to each recommendation.
            </p>
            <ul>
                <li><strong>Secure Coordinate Validation:</strong> Coordinates are normalized and validated to prevent malformed input and precision abuse.</li>
                <li><strong>Reverse Geocoding with Verification:</strong> Grok 4 uses web search to confirm city, county, and state for accuracy.</li>
                <li><strong>Quantum-Driven Hazard Modeling:</strong> Simulated conditions are blended with system telemetry to reduce false positives.</li>
                <li><strong>Actionable Guidance:</strong> Recommendations include speed adjustments, lane guidance, and detours only when necessary.</li>
            </ul>
            <p>
                Whether you are planning a longer route or checking a local road segment, QRS emphasizes clarity and
                safety so you can make quick decisions under pressure.
            </p>
        </div>

        <div class="section">
            <h3 class="section-title">Historical Background and Innovations</h3>
            <p>
                The development of QRS is rooted in the evolution of quantum mechanics and computational theories.
                (This section is included as narrative context for the demo deployment.)
            </p>
            <ul>
                <li><strong>Quantum Mechanics Foundations:</strong> Planck and Heisenberg established key principles.</li>
                <li><strong>Quantum Computing Conceptualization:</strong> Feynman proposed efficient simulation of physics.</li>
                <li><strong>Quantum Algorithms:</strong> Shor and Grover demonstrated speedups for specific problems.</li>
                <li><strong>Hypertime Theories:</strong> Multi-temporal models explore broader state spaces.</li>
                <li><strong>Quantum Simulations in Traffic Systems:</strong> Quantum-inspired methods model stochastic systems.</li>
            </ul>
        </div>

        <div class="section">
            <h3 class="section-title">Hypertime and Multiverse Analysis</h3>
            <p>
                Hypertime is a theoretical framework that proposes additional temporal dimensions beyond conventional time.
                QRS uses the concept as a simulation lens to explore a range of possible outcomes and to express uncertainty
                explicitly when confidence is limited.
            </p>
            <p>
                By simulating multiple temporal paths, QRS can provide insights into potential future events on the road,
                enhancing predictive capabilities without relying on actual data collection.
            </p>
        </div>

        <div class="section">
            <h3 class="section-title">Quantum Algorithms and Computations</h3>
            <p>
                The core computational element is a compact quantum circuit that blends telemetry parameters (CPU/RAM usage)
                into a probabilistic state that influences narrative analysis. This is a simulation-driven safety report,
                not a sensor feed.
            </p>
        </div>

        <div class="section">
            <h3 class="section-title">Get Started</h3>
            <p>
                Use the Dashboard to run a scan at a coordinate, generate a long-form hazard report, and store reports securely.
            </p>
            {% if 'username' in session %}
                <a class="btn btn-light" href="{{ url_for('dashboard') }}">Go to Dashboard</a>
            {% else %}
                <a class="btn btn-light" href="{{ url_for('login') }}">Login</a>
                <a class="btn btn-outline-light" href="{{ url_for('register') }}">Register</a>
            {% endif %}
        </div>
    </div>
</body>
</html>
        """
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    error_message = ""
    form = LoginForm()
    if form.validate_on_submit():
        username = form.username.data
        password = form.password.data
        if authenticate_user(username, password):
            session["username"] = sanitize_input(username)
            return redirect(url_for("dashboard"))
        else:
            error_message = "Invalid username or password. Please try again."

    return render_template_string(
        r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Login - QRS</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <link rel="stylesheet" href="{{ url_for('static', filename='css/orbitron.css') }}"
          integrity="sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00=" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/bootstrap.min.css') }}"
          integrity="sha256-Ww++W3rXBfapN8SZitAvc9jw2Xb+Ixt0rvDsmWmQyTo=" crossorigin="anonymous">
    <style>
        body {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: #ffffff;
            font-family: 'Roboto', sans-serif;
        }
        .container { max-width: 400px; margin-top: 100px; }
        .card { padding: 30px; background-color: rgba(255, 255, 255, 0.1); border: none; border-radius: 15px; }
        .error-message { color: #ff4d4d; }
        .brand {
            font-family: 'Orbitron', sans-serif;
            font-size: 2.5rem;
            font-weight: bold;
            text-align: center;
            margin-bottom: 20px;
            background: -webkit-linear-gradient(#f0f, #0ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        input, label, .btn, .error-message, a { color: #ffffff; }
        input::placeholder { color: #cccccc; opacity: 0.7; }
        .btn-primary {
            background-color: #00cc00;
            border: none;
            border-radius: 10px;
        }
        .btn-primary:hover { background-color: #00aa00; }
        a:hover { color: #ffffff; }
    </style>
</head>
<body>
<div class="container">
    <div class="brand">QRS</div>
    <div class="card">
        {% if error_message %}
            <p class="error-message">{{ error_message }}</p>
        {% endif %}
        <form method="POST">
            {{ form.hidden_tag() }}
            <div class="form-group">
                {{ form.username.label }}
                {{ form.username(class="form-control", placeholder="Username") }}
            </div>
            <div class="form-group">
                {{ form.password.label }}
                {{ form.password(class="form-control", placeholder="Password") }}
            </div>
            {{ form.submit(class="btn btn-primary btn-block mt-3") }}
        </form>
        <div class="text-center mt-3">
            <a href="{{ url_for('register') }}">Need an account? Register</a>
        </div>
    </div>
</div>
</body>
</html>
        """,
        form=form,
        error_message=error_message,
    )


@app.route("/register", methods=["GET", "POST"])
def register():
    error_message = ""
    form = RegisterForm()

    reg_enabled = is_registration_enabled()

    if form.validate_on_submit():
        username = form.username.data
        password = form.password.data
        invite_code = form.invite_code.data if not reg_enabled else None

        success, message = register_user(username, password, invite_code)

        if success:
            flash(message, "success")
            return redirect(url_for("login"))
        else:
            error_message = message

    return render_template_string(
        r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Register - QRS</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <link href="{{ url_for('static', filename='css/roboto.css') }}" rel="stylesheet"
          integrity="sha256-Sc7BtUKoWr6RBuNTT0MmuQjqGVQwYBK+21lB58JwUVE=" crossorigin="anonymous">
    <link href="{{ url_for('static', filename='css/orbitron.css') }}" rel="stylesheet"
          integrity="sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00=" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/bootstrap.min.css') }}"
          integrity="sha256-Ww++W3rXBfapN8SZitAvc9jw2Xb+Ixt0rvDsmWmQyTo=" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/fontawesome.min.css') }}"
          integrity="sha256-rx5u3IdaOCszi7Jb18XD9HSn8bNiEgAqWJbdBvIYYyU=" crossorigin="anonymous">
    <style>
        body {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: #ffffff;
            font-family: 'Roboto', sans-serif;
        }
        .container { max-width: 400px; margin-top: 100px; }
        .walkd { padding: 30px; background-color: rgba(255, 255, 255, 0.1); border: none; border-radius: 15px; }
        .error-message { color: #ff4d4d; }
        .brand {
            font-family: 'Orbitron', sans-serif;
            font-size: 2.5rem;
            font-weight: bold;
            text-align: center;
            margin-bottom: 20px;
            background: -webkit-linear-gradient(#f0f, #0ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        input, label, .btn, .error-message, a { color: #ffffff; }
        input::placeholder { color: #cccccc; opacity: 0.7; }
        .btn-primary { background-color: #00cc00; border: none; border-radius: 10px; }
        .btn-primary:hover { background-color: #00aa00; }
        a:hover { color: #ffffff; }
    </style>
</head>
<body>
<div class="container">
    <div class="brand">QRS</div>
    <div class="walkd">
        {% if error_message %}
            <p class="error-message">{{ error_message }}</p>
        {% endif %}

        {% with messages = get_flashed_messages(with_categories=true) %}
          {% if messages %}
            {% for category, msg in messages %}
              <div class="alert alert-{{ category }}">{{ msg }}</div>
            {% endfor %}
          {% endif %}
        {% endwith %}

        <form method="POST">
            {{ form.hidden_tag() }}
            <div class="form-group">
                {{ form.username.label }}
                {{ form.username(class="form-control", placeholder="Username") }}
            </div>
            <div class="form-group">
                {{ form.password.label }}
                {{ form.password(class="form-control", placeholder="Password") }}
            </div>

            {% if not reg_enabled %}
            <div class="form-group">
                {{ form.invite_code.label }}
                {{ form.invite_code(class="form-control", placeholder="Invite Code") }}
            </div>
            {% endif %}

            {{ form.submit(class="btn btn-primary btn-block mt-3") }}
        </form>
        <div class="text-center mt-3">
            <a href="{{ url_for('login') }}">Already have an account? Login</a>
        </div>
    </div>
</div>
</body>
</html>
        """,
        form=form,
        error_message=error_message,
        reg_enabled=reg_enabled,
    )


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))


@app.route("/settings", methods=["GET", "POST"])
def settings():
    if "username" not in session:
        return redirect(url_for("login"))

    # Basic admin gate
    if not session.get("is_admin", False):
        return jsonify({"error": "Admin access required"}), 403

    form = SettingsForm()
    message = ""

    if form.validate_on_submit():
        if form.enable_registration.data:
            set_registration_enabled(True)
            message = "Registration has been enabled."
        elif form.disable_registration.data:
            set_registration_enabled(False)
            message = "Registration has been disabled."
        elif form.generate_invite_code.data:
            new_invite_code = generate_secure_invite_code()
            with sqlite3.connect(DB_FILE) as db:
                cursor = db.cursor()
                cursor.execute("INSERT INTO invite_codes (code) VALUES (?)", (new_invite_code,))
                db.commit()
            message = f"New invite code generated: {new_invite_code}"

    invite_codes = []
    with sqlite3.connect(DB_FILE) as db:
        cursor = db.cursor()
        cursor.execute("SELECT code FROM invite_codes WHERE is_used = 0")
        invite_codes = [row[0] for row in cursor.fetchall()]

    return render_template_string(
        r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Settings - QRS</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <link href="{{ url_for('static', filename='css/bootstrap.min.css') }}" rel="stylesheet"
          integrity="sha256-Ww++W3rXBfapN8SZitAvc9jw2Xb+Ixt0rvDsmWmQyTo=" crossorigin="anonymous">
    <link href="{{ url_for('static', filename='css/roboto.css') }}" rel="stylesheet"
          integrity="sha256-Sc7BtUKoWr6RBuNTT0MmuQjqGVQwYBK+21lB58JwUVE=" crossorigin="anonymous">
    <link href="{{ url_for('static', filename='css/orbitron.css') }}" rel="stylesheet"
          integrity="sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/fontawesome.min.css') }}"
          integrity="sha256-rx5u3IdaOCszi7Jb18XD9HSn8bNiEgAqWJbdBvIYYyU=" crossorigin="anonymous">
    <style>
        body { background-color: #121212; color: #ffffff; font-family: 'Roboto', sans-serif; }
        .container { margin-top: 40px; max-width: 900px; }
        .card { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; }
        .brand { font-family:'Orbitron',sans-serif; font-size: 1.8rem; }
        .btn { border-radius: 12px; }
        code { color: #a8ffbf; }
    </style>
</head>
<body>
<div class="container">
    <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="brand">QRS Settings</div>
        <a class="btn btn-outline-light" href="{{ url_for('dashboard') }}">Back</a>
    </div>

    {% if message %}
        <div class="alert alert-info">{{ message }}</div>
    {% endif %}

    <div class="card p-4 mb-4">
        <form method="POST">
            {{ form.hidden_tag() }}
            <div class="d-flex gap-2 flex-wrap">
                {{ form.enable_registration(class="btn btn-success") }}
                {{ form.disable_registration(class="btn btn-warning") }}
                {{ form.generate_invite_code(class="btn btn-primary") }}
            </div>
        </form>
    </div>

    <div class="card p-4">
        <h5>Active Invite Codes</h5>
        {% if invite_codes %}
            <ul>
            {% for code in invite_codes %}
                <li><code>{{ code }}</code></li>
            {% endfor %}
            </ul>
        {% else %}
            <p>No unused invite codes.</p>
        {% endif %}
    </div>
</div>
</body>
</html>
        """,
        form=form,
        message=message,
        invite_codes=invite_codes,
    )


@app.route("/dashboard", methods=["GET", "POST"])
def dashboard():
    if "username" not in session:
        return redirect(url_for("login"))

    username = session["username"]
    user_id = get_user_id(username)
    if not user_id:
        session.clear()
        return redirect(url_for("login"))

    reports = get_hazard_reports(user_id)
    csrf_token = generate_csrf()
    preferred_model = get_user_preferred_model(user_id)

    return render_template_string(
        r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Dashboard - Quantum Road Scanner</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <link href="{{ url_for('static', filename='css/roboto.css') }}" rel="stylesheet"
          integrity="sha256-Sc7BtUKoWr6RBuNTT0MmuQjqGVQwYBK+21lB58JwUVE=" crossorigin="anonymous">
    <link href="{{ url_for('static', filename='css/orbitron.css') }}" rel="stylesheet"
          integrity="sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/bootstrap.min.css') }}"
          integrity="sha256-Ww++W3rXBfapN8SZitAvc9jw2Xb+Ixt0rvDsmWmQyTo=" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/fontawesome.min.css') }}"
          integrity="sha256-rx5u3IdaOCszi7Jb18XD9HSn8bNiEgAqWJbdBvIYYyU=" crossorigin="anonymous">

    <style>
        body { background-color: #121212; color: #ffffff; font-family: 'Roboto', sans-serif; }
        .sidebar {
            position: fixed; top: 0; left: 0; height: 100%; width: 220px;
            background-color: #1f1f1f; padding-top: 60px; border-right: 1px solid #333;
        }
        .sidebar a { color: #bbbbbb; padding: 15px 20px; text-decoration: none; display: block; font-size: 1rem; }
        .sidebar a:hover { background-color: #333333; color: #ffffff; }
        .content { margin-left: 240px; padding: 30px; }
        .brand { font-family:'Orbitron',sans-serif; font-size: 1.6rem; }
        .cardish { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 20px; }
        .btn-custom { border-radius: 12px; }
        .form-section { display:none; }
        .table-dark { border-radius: 12px; overflow:hidden; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="text-center brand mb-4">QRS</div>
        <a href="{{ url_for('home') }}"><i class="fas fa-home"></i> Home</a>
        {% if session.get('is_admin', False) %}
            <a href="{{ url_for('settings') }}"><i class="fas fa-cog"></i> Settings</a>
        {% endif %}
        <a href="{{ url_for('logout') }}"><i class="fas fa-sign-out-alt"></i> Logout</a>
    </div>

    <div class="content">
        <h2 class="mb-4">Welcome, {{ session['username'] }}</h2>

        <div class="cardish mb-4">
            <h4>Run a Scan</h4>
            <p class="text-muted">Enter coordinates, reverse-geocode the area, then run a hazard scan.</p>

            <div id="step1" class="form-section">
                <h4>Coordinates</h4>
                <div class="form-group">
                    <label for="latitude">Latitude</label>
                    <input type="text" class="form-control" id="latitude" placeholder="e.g. 40.7128">
                </div>
                <div class="form-group">
                    <label for="longitude">Longitude</label>
                    <input type="text" class="form-control" id="longitude" placeholder="e.g. -74.0060">
                </div>
                <button type="button" class="btn btn-success btn-custom" onclick="nextStep(1)">
                    <i class="fas fa-arrow-right"></i> Next
                </button>
                <div id="statusMessage1" class="mt-3"></div>
            </div>

            <div id="step2" class="form-section">
                <h4>Street Name</h4>
                <p id="streetName">Fetching street name...</p>
                <button type="button" class="btn btn-success btn-custom" onclick="nextStep(2)">
                    <i class="fas fa-arrow-right"></i> Next
                </button>
                <div id="statusMessage2" class="mt-3"></div>
            </div>

            <div id="step3" class="form-section">
                <form id="runScanForm">
                    <div class="form-group">
                        <label for="vehicle_type">Vehicle Type</label>
                        <select class="form-control" id="vehicle_type" name="vehicle_type">
                            <option value="car">Car</option>
                            <option value="truck">Truck</option>
                            <option value="motorbike">Motorbike</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="destination">Destination</label>
                        <input type="text" class="form-control" id="destination" name="destination"
                               placeholder="Enter destination" required>
                    </div>
                    <div class="form-group">
                        <label for="model_selection">Select Model</label>
                        <select class="form-control" id="model_selection" name="model_selection">
                            <option value="grok" {% if preferred_model == 'grok' %}selected{% endif %}>Grok</option>
                        </select>
                    </div>
                    <button type="button" class="btn btn-success btn-custom" onclick="startScan()">
                        <i class="fas fa-play"></i> Start Scan
                    </button>
                </form>
                <div id="statusMessage3" class="mt-3"></div>
            </div>
        </div>

        <div id="reportsSection" class="cardish mt-4">
            <h3>Your Reports</h3>
            {% if reports %}
            <table class="table table-dark table-hover">
                <thead>
                    <tr><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    {% for report in reports %}
                    <tr>
                        <td class="mono">{{ report['timestamp'] }}</td>
                        <td>
                            <button class="btn btn-info btn-sm" onclick="viewReport({{ report['id'] }})">
                                View
                            </button>
                        </td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
            {% else %}
                <p>No reports found yet.</p>
            {% endif %}
        </div>
    </div>

<script>
    const csrfToken = "{{ csrf_token }}";

    function showSection(sectionId) {
        document.querySelectorAll('.form-section').forEach(s => s.style.display = 'none');
        document.getElementById(sectionId).style.display = 'block';
    }

    function nextStep(step) {
        if (step === 1) {
            const lat = document.getElementById('latitude').value.trim();
            const lon = document.getElementById('longitude').value.trim();
            if (!lat || !lon) {
                document.getElementById('statusMessage1').innerHTML = "<div class='alert alert-danger'>Enter both latitude and longitude.</div>";
                return;
            }
            document.getElementById('statusMessage1').innerHTML = "<div class='alert alert-info'>Resolving location...</div>";
            fetch(`/reverse_geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`)
              .then(r => r.json())
              .then(data => {
                  if (data.error) {
                      document.getElementById('statusMessage1').innerHTML = `<div class='alert alert-danger'>${data.error}</div>`;
                      return;
                  }
                  document.getElementById('streetName').textContent = data.street_name || "Unknown Location";
                  showSection('step2');
              })
              .catch(() => {
                  document.getElementById('statusMessage1').innerHTML = "<div class='alert alert-danger'>Reverse geocode failed.</div>";
              });
        } else if (step === 2) {
            showSection('step3');
        }
    }

    function startScan() {
        const lat = document.getElementById('latitude').value.trim();
        const lon = document.getElementById('longitude').value.trim();
        const vehicleType = document.getElementById('vehicle_type').value;
        const destination = document.getElementById('destination').value.trim();
        const model = document.getElementById('model_selection').value;

        if (!lat || !lon || !vehicleType || !destination || !model) {
            document.getElementById('statusMessage3').innerHTML = "<div class='alert alert-danger'>Missing fields.</div>";
            return;
        }

        document.getElementById('statusMessage3').innerHTML = "<div class='alert alert-info'>Scanning...</div>";

        fetch("/start_scan", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
            body: JSON.stringify({
                latitude: lat,
                longitude: lon,
                vehicle_type: vehicleType,
                destination: destination,
                model_selection: model
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                document.getElementById('statusMessage3').innerHTML = `<div class='alert alert-danger'>${data.error}</div>`;
                return;
            }
            document.getElementById('statusMessage3').innerHTML =
                `<div class='alert alert-success'>Scan complete. Model: ${data.model_used}. Risk: ${data.harm_level}.
                 <button class="btn btn-info btn-sm ml-2" onclick="viewReport(${data.report_id})">View Report</button>
                 </div>`;
        })
        .catch(() => {
            document.getElementById('statusMessage3').innerHTML = "<div class='alert alert-danger'>Scan failed.</div>";
        });
    }

    function viewReport(reportId) {
        window.location.href = `/report/${reportId}`;
    }

    document.addEventListener("DOMContentLoaded", () => {
        showSection('step1');
    });
</script>
</body>
</html>
        """,
        reports=reports,
        csrf_token=csrf_token,
        preferred_model=preferred_model,
    )


@app.route("/report/<int:report_id>")
def view_report(report_id: int):
    if "username" not in session:
        return redirect(url_for("login"))
    user_id = get_user_id(session["username"])
    if not user_id:
        return redirect(url_for("login"))

    report = get_hazard_report_by_id(report_id, user_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    # Render markdown safely
    report_html = markdown(report["result"] or "")
    report_html_clean = bleach.clean(
        report_html,
        tags=[
            "p",
            "br",
            "strong",
            "em",
            "ul",
            "ol",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "code",
            "pre",
            "blockquote",
        ],
        attributes={},
        strip=True,
    )

    csrf_token = generate_csrf()
    wheel_color = random.randint(1, 35)

    return render_template_string(
        r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Report #{{ report.id }} - QRS</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <link href="{{ url_for('static', filename='css/roboto.css') }}" rel="stylesheet"
          integrity="sha256-Sc7BtUKoWr6RBuNTT0MmuQjqGVQwYBK+21lB58JwUVE=" crossorigin="anonymous">
    <link href="{{ url_for('static', filename='css/orbitron.css') }}" rel="stylesheet"
          integrity="sha256-3mvPl5g2WhVLrUV4xX3KE8AV8FgrOz38KmWLqKXVh00" crossorigin="anonymous">
    <link rel="stylesheet" href="{{ url_for('static', filename='css/bootstrap.min.css') }}"
          integrity="sha256-Ww++W3rXBfapN8SZitAvc9jw2Xb+Ixt0rvDsmWmQyTo=" crossorigin="anonymous">
    <style>
        body { background-color: #121212; color: #ffffff; font-family: 'Roboto', sans-serif; }
        .container { max-width: 1100px; margin-top: 30px; }
        .cardish { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
                   border-radius: 16px; padding: 24px; }
        .brand { font-family:'Orbitron',sans-serif; font-size: 1.6rem; }
        .meta { opacity: .9; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace; }
        a { color: #9be8ff; }
        a:hover { color: #ffffff; text-decoration:none; }
        pre { background: rgba(0,0,0,.35); padding: 12px; border-radius: 12px; overflow:auto; }
        code { color: #a8ffbf; }
    </style>
</head>
<body>
<div class="container">
    <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="brand">QRS Report</div>
        <div>
            <a class="btn btn-outline-light" href="{{ url_for('dashboard') }}">Back</a>
        </div>
    </div>

    <div class="cardish">
        <div class="meta mb-3">
            <div><strong>Timestamp:</strong> <span class="mono">{{ report.timestamp }}</span></div>
            <div><strong>Location:</strong> {{ report.street_name }}</div>
            <div><strong>Coords:</strong> <span class="mono">{{ report.latitude }}, {{ report.longitude }}</span></div>
            <div><strong>Vehicle:</strong> {{ report.vehicle_type }}</div>
            <div><strong>Destination:</strong> {{ report.destination }}</div>
            <div><strong>Risk Level:</strong> {{ report.risk_level }}</div>
            <div><strong>Model Used:</strong> {{ report.model_used }}</div>
        </div>
        <hr style="border-color: rgba(255,255,255,.12);">
        <div class="report-body">
            {{ report_html_clean|safe }}
        </div>
    </div>
</div>
</body>
</html>
        """,
        report=report,
        report_html_clean=report_html_clean,
        csrf_token=csrf_token,
        wheel_color=wheel_color,
    )


@app.route("/start_scan", methods=["POST"])
def start_scan_route():
    if "username" not in session:
        return redirect(url_for("login"))

    username = session["username"]
    user_id = get_user_id(username)
    if not user_id:
        return jsonify({"error": "Authentication required."}), 401

    if not session.get("is_admin", False):
        if not check_rate_limit(user_id):
            return jsonify({"error": "Rate limit exceeded. Try again later."}), 429

    data = request.get_json() or {}

    lat = data.get("latitude")
    lon = data.get("longitude")
    vehicle_type = data.get("vehicle_type")
    destination = data.get("destination")
    model_selection = data.get("model_selection")

    if not lat or not lon or not vehicle_type or not destination or not model_selection:
        return jsonify({"error": "Missing required data"}), 400

    try:
        lat_float, lat_text = parse_coordinate(lat, "latitude")
        lon_float, lon_text = parse_coordinate(lon, "longitude")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    vehicle_type = sanitize_input(vehicle_type)
    destination = sanitize_input(destination)
    model_selection = sanitize_input(model_selection)

    if not validate_vehicle_type(vehicle_type):
        return jsonify({"error": "Invalid vehicle type."}), 400
    if not validate_destination(destination):
        return jsonify({"error": "Invalid destination."}), 400
    if model_selection not in ALLOWED_MODELS:
        return jsonify({"error": "Invalid model selection."}), 400

    combined_input = f"Vehicle Type: {vehicle_type}\nDestination: {destination}"
    is_allowed, analysis = run_async(phf_filter_input(combined_input))
    if not is_allowed:
        return jsonify({"error": "Input contains disallowed content.", "details": analysis}), 400

    result, cpu_usage, ram_usage, quantum_results, street_name, model_used = run_async(
        scan_debris_for_route(
            lat_float, lon_float, vehicle_type, destination, user_id, selected_model=model_selection
        )
    )

    harm_level = calculate_harm_level(result)

    report_id = save_hazard_report(
        lat_text,
        lon_text,
        street_name,
        vehicle_type,
        destination,
        result,
        cpu_usage,
        ram_usage,
        quantum_results,
        user_id,
        harm_level,
        model_used,
    )

    return jsonify(
        {
            "message": "Scan completed successfully",
            "result": result,
            "harm_level": harm_level,
            "model_used": model_used,
            "report_id": report_id,
        }
    )


@app.route("/reverse_geocode", methods=["GET"])
def reverse_geocode_route():
    if "username" not in session:
        logger.warning("Unauthorized access attempt to /reverse_geocode.")
        return jsonify({"error": "Authentication required."}), 401

    lat = request.args.get("lat")
    lon = request.args.get("lon")

    if not lat or not lon:
        logger.error("Missing latitude or longitude parameters.")
        return jsonify({"error": "Missing parameters."}), 400

    try:
        lat_float, _ = parse_coordinate(lat, "latitude")
        lon_float, _ = parse_coordinate(lon, "longitude")
    except ValueError:
        logger.error("Invalid latitude or longitude format.")
        return jsonify({"error": "Invalid coordinate format."}), 400

    try:
        street_name = run_async(fetch_street_name_llm(lat_float, lon_float))
        logger.info("Successfully resolved street name using LLM: %s", street_name)
        return jsonify({"street_name": street_name}), 200
    except Exception:
        logger.warning("LLM geocoding failed, falling back to standard reverse_geocode.", exc_info=True)
        try:
            street_name = reverse_geocode(lat_float, lon_float, cities)
            logger.info("Successfully resolved street name using fallback method: %s", street_name)
            return jsonify({"street_name": street_name}), 200
        except Exception as fallback_e:
            logger.exception("Both LLM and fallback reverse geocoding failed: %s", fallback_e)
            return jsonify({"error": "Internal server error."}), 500


# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    if serve is None:
        # Dev fallback
        app.run(host="0.0.0.0", port=3000, debug=False)
    else:
        serve(app, host="0.0.0.0", port=3000, threads=4)
